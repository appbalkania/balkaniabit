import "server-only";
import Stripe from "stripe";
import { createAdminClient } from "./supabase/server";
import { renderInvoicePdf, type InvoiceForPdf } from "./invoice-pdf";
import { APP_URL, emailLayout, emailTable, sendEmail } from "./email";
import { CURRENCY, esc, fmtDate, isDirectDebit, money, qty } from "./format";
import { getStripe } from "./stripe";

type Db = ReturnType<typeof createAdminClient>;

/** Everything needed to print an invoice. Uses the service role: callers must authorise first. */
export async function loadInvoice(db: Db, invoiceId: string) {
  const [{ data: inv }, { data: company }] = await Promise.all([
    db
      .from("invoices")
      .select(
        "*, customers(id, account_ref, name, email, address, postcode, vat_number, payment_method, auto_charge, stripe_customer_id, stripe_payment_method_id, stripe_mandate_id), invoice_lines(id, description, quantity, unit_price, net, vat, vat_rate)"
      )
      .eq("id", invoiceId)
      .single(),
    db.from("company_settings").select("*").single(),
  ]);
  if (!inv || !company) return null;
  const customer = inv.customers as {
    id: string;
    account_ref: string;
    name: string;
    email: string | null;
    address: string | null;
    postcode: string | null;
    vat_number: string | null;
    payment_method: string;
    auto_charge: boolean;
    stripe_customer_id: string | null;
    stripe_payment_method_id: string | null;
    stripe_mandate_id: string | null;
  };
  type Line = InvoiceForPdf["lines"][number] & { id: number };
  const lines = [...(inv.invoice_lines as Line[])].sort((a, b) => a.id - b.id);
  const forPdf: InvoiceForPdf = {
    number: inv.number,
    status: inv.status,
    issue_date: inv.issue_date,
    due_date: inv.due_date,
    period_start: inv.period_start,
    period_end: inv.period_end,
    net: inv.net,
    vat: inv.vat,
    total: inv.total,
    amount_paid: inv.amount_paid,
    lines,
    customer: { ...customer, has_saved_method: Boolean(customer.stripe_payment_method_id) && customer.auto_charge },
    company,
  };
  return { inv, customer, company, forPdf };
}

/** Email the invoice PDF to the customer and stamp emailed_at. */
export async function deliverInvoice(invoiceId: string): Promise<{ ok: boolean; error?: string }> {
  const db = createAdminClient();
  const loaded = await loadInvoice(db, invoiceId);
  if (!loaded) return { ok: false, error: "Invoice not found" };
  const { inv, customer, company, forPdf } = loaded;
  if (inv.status === "draft") return { ok: false, error: "Invoice has not been issued" };

  const pdf = await renderInvoicePdf(forPdf);
  const balance = Number(inv.total) - Number(inv.amount_paid);
  const auto = forPdf.customer.has_saved_method && balance > 0;
  const payLine =
    balance <= 0
      ? `<p>This invoice is paid in full. Thank you.</p>`
      : auto
        ? `<p>The balance will be collected automatically by <strong>${isDirectDebit(customer.payment_method) ? "Direct Debit" : "card"}</strong>. You do not need to do anything.</p>`
        : `<p>Please pay by <strong>${fmtDate(inv.due_date)}</strong>. You can pay online by card, or set up Direct Debit so future invoices are collected automatically:</p>
           <p><a href="${APP_URL}/portal/invoices/${inv.id}" style="background:#0a9a7a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">View and pay invoice</a></p>`;

  const body = `
    <p>Dear ${esc(customer.name)},</p>
    <p>Please find attached invoice <strong>${esc(inv.number)}</strong>${
      inv.period_start ? ` for pallet storage for the week ${fmtDate(inv.period_start)} to ${fmtDate(inv.period_end)}` : ""
    }.</p>
    ${emailTable(
      ["Description", "Qty", "Rate", "Net"],
      forPdf.lines.map((l) => [l.description, qty(l.quantity), money(l.unit_price), money(l.net)])
    )}
    <p style="margin:0">Net: ${money(inv.net)} &nbsp;·&nbsp; VAT: ${money(inv.vat)} &nbsp;·&nbsp; <strong>Total: ${money(inv.total)}</strong></p>
    ${payLine}`;

  const res = await sendEmail({
    kind: "invoice",
    to: customer.email,
    subject: `Invoice ${inv.number} from ${company.company_name} – ${money(inv.total)}`,
    html: emailLayout(company.company_name, `Invoice ${inv.number}`, body),
    attachments: [{ filename: `${inv.number}.pdf`, content: pdf }],
    customerId: customer.id,
    relatedId: inv.id,
  });
  await db
    .from("invoices")
    .update(res.ok ? { emailed_at: new Date().toISOString(), email_error: null } : { email_error: res.error ?? "Email failed" })
    .eq("id", inv.id);
  return { ok: res.ok, error: res.error };
}

export type ChargeOutcome = { status: "succeeded" | "processing" | "failed" | "skipped"; message: string };

/**
 * Collect an invoice from the customer's saved card or Direct Debit mandate.
 * Card payments usually succeed immediately; SEPA Direct Debit goes to "processing" and
 * the Stripe webhook records the payment when it clears (typically 5 business days).
 */
export async function chargeInvoice(invoiceId: string): Promise<ChargeOutcome> {
  const stripe = getStripe();
  if (!stripe) return { status: "skipped", message: "Stripe is not configured" };
  const db = createAdminClient();
  const loaded = await loadInvoice(db, invoiceId);
  if (!loaded) return { status: "skipped", message: "Invoice not found" };
  const { inv, customer } = loaded;

  const balance = Math.round((Number(inv.total) - Number(inv.amount_paid)) * 100);
  if (!["issued", "part_paid"].includes(inv.status) || balance <= 0) return { status: "skipped", message: "Nothing to collect" };
  if (inv.payment_status === "processing") return { status: "skipped", message: "A payment is already in progress" };
  if (!customer.stripe_customer_id || !customer.stripe_payment_method_id) {
    return { status: "skipped", message: "Customer has no saved card or Direct Debit" };
  }
  const type = isDirectDebit(customer.payment_method) ? (customer.payment_method as "sepa_debit" | "bacs_debit") : "card";
  const attempt = Number(inv.charge_attempts) + 1;

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: balance,
        currency: CURRENCY.toLowerCase(),
        customer: customer.stripe_customer_id,
        payment_method: customer.stripe_payment_method_id,
        allowed_payment_method_types: [type],
        ...(type !== "card" && customer.stripe_mandate_id ? { mandate: customer.stripe_mandate_id } : {}),
        off_session: true,
        confirm: true,
        description: `Invoice ${inv.number}`,
        metadata: { invoice_id: inv.id, invoice_number: inv.number },
      },
      // same key on a retry of the same attempt = Stripe returns the first result instead of charging twice
      { idempotencyKey: `invoice-${inv.id}-attempt-${attempt}` }
    );

    await db
      .from("invoices")
      .update({
        stripe_payment_intent_id: pi.id,
        charge_attempts: attempt,
        payment_status: pi.status === "succeeded" ? "succeeded" : "processing",
        payment_error: null,
      })
      .eq("id", inv.id);

    if (pi.status === "succeeded") {
      // the webhook will also report this; record_payment is idempotent per PaymentIntent
      const { error } = await db.rpc("record_payment", {
        p_invoice: inv.id,
        p_amount: pi.amount_received / 100,
        p_method: type,
        p_reference: pi.id,
        p_stripe_pi: pi.id,
      });
      if (error) return { status: "processing", message: `Charged, but recording failed: ${error.message}` };
      return { status: "succeeded", message: `Charged ${money(balance / 100)}` };
    }
    return {
      status: "processing",
      message: type !== "card" ? "Direct Debit submitted - it usually clears within 5 business days" : `Payment ${pi.status}`,
    };
  } catch (e) {
    const message = e instanceof Stripe.errors.StripeError ? e.message : e instanceof Error ? e.message : String(e);
    await db
      .from("invoices")
      .update({ charge_attempts: attempt, payment_status: "failed", payment_error: message })
      .eq("id", inv.id);
    return { status: "failed", message };
  }
}

/**
 * Deliver every issued invoice that has not been emailed yet, then start automatic collection.
 * Called by the weekly cron after run_weekly_billing(); safe to call again to pick up stragglers.
 */
export async function processPendingInvoices(limit = 50) {
  const db = createAdminClient();
  const { data: pending } = await db
    .from("invoices")
    .select("id, number, customers(auto_charge, stripe_payment_method_id)")
    .eq("status", "issued")
    .is("emailed_at", null)
    .is("email_error", null)
    .order("number")
    .limit(limit);

  const results: { number: string; emailed: boolean; charge: string }[] = [];
  for (const row of pending ?? []) {
    const c = row.customers as unknown as { auto_charge: boolean; stripe_payment_method_id: string | null };
    const mail = await deliverInvoice(row.id);
    let charge = "not attempted";
    if (c.auto_charge && c.stripe_payment_method_id) {
      const outcome = await chargeInvoice(row.id);
      charge = `${outcome.status}: ${outcome.message}`;
    }
    results.push({ number: row.number, emailed: mail.ok, charge });
  }
  return results;
}
