import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { saveSetupFromSession } from "@/lib/stripe-sync";
import { createAdminClient } from "@/lib/supabase/server";
import { APP_URL, emailLayout, sendEmail } from "@/lib/email";
import { esc, money } from "@/lib/format";

export const maxDuration = 60;

// Stripe → us. Configure in the Stripe dashboard (Developers › Webhooks) pointing at
// /api/stripe/webhook with the events listed in the README.
export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return new NextResponse("Stripe not configured", { status: 503 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return new NextResponse("Bad signature", { status: 400 });
  }

  const db = createAdminClient();
  const { data: seen } = await db.from("stripe_events").select("id").eq("id", event.id).maybeSingle();
  if (seen) return NextResponse.json({ received: true, duplicate: true });

  try {
    await handle(stripe, db, event);
  } catch (e) {
    // a 500 makes Stripe retry later; every handler is safe to run again
    console.error("stripe webhook", event.type, e);
    return new NextResponse("Handler failed", { status: 500 });
  }
  await db.from("stripe_events").insert({ id: event.id, type: event.type });
  return NextResponse.json({ received: true });
}

type Db = ReturnType<typeof createAdminClient>;

async function handle(stripe: Stripe, db: Db, event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode === "setup") await saveSetupFromSession(stripe, s);
      // one-off invoice payments are recorded from payment_intent.succeeded
      return;
    }

    case "payment_intent.processing": {
      const pi = event.data.object as Stripe.PaymentIntent;
      if (pi.metadata?.invoice_id) await db.from("invoices").update({ payment_status: "processing", stripe_payment_intent_id: pi.id }).eq("id", pi.metadata.invoice_id).neq("status", "paid");
      return;
    }

    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const invoiceId = pi.metadata?.invoice_id;
      if (!invoiceId) return;
      const type = pi.payment_method_types.includes("sepa_debit") && !pi.payment_method_types.includes("card") ? "sepa_debit" : pi.payment_method_types.includes("bacs_debit") && !pi.payment_method_types.includes("card") ? "bacs_debit" : "card";
      const { error } = await db.rpc("record_payment", {
        p_invoice: invoiceId,
        p_amount: pi.amount_received / 100,
        p_method: type,
        p_reference: pi.id,
        p_stripe_pi: pi.id,
      });
      if (error) {
        // money arrived for an invoice that was voided meanwhile: needs a manual refund, retrying won't help
        if (/cannot take payment/.test(error.message)) {
          await db.from("invoices").update({ payment_error: `Payment ${pi.id} received after void - refund it in Stripe` }).eq("id", invoiceId);
          return;
        }
        throw new Error(error.message);
      }
      return;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const invoiceId = pi.metadata?.invoice_id;
      if (!invoiceId) return;
      const reason = pi.last_payment_error?.message ?? "Payment failed";
      await db.from("invoices").update({ payment_status: "failed", payment_error: reason }).eq("id", invoiceId).neq("status", "paid");
      const { data: inv } = await db.from("invoices").select("id, number, total, amount_paid, customers(id, name, email)").eq("id", invoiceId).single();
      const { data: s } = await db.from("company_settings").select("company_name, email").single();
      if (inv) {
        const c = inv.customers as unknown as { id: string; name: string; email: string | null };
        const company = s?.company_name ?? "BIT Storage";
        const body = `<p>Dear ${esc(c.name)},</p><p>We were unable to collect <strong>${money(Number(inv.total) - Number(inv.amount_paid))}</strong> for invoice <strong>${esc(inv.number)}</strong>.</p><p>Reason given by the bank: ${esc(reason)}</p><p>Please pay online or update your payment details:</p><p><a href="${APP_URL}/portal/invoices/${inv.id}" style="background:#0a9a7a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Pay invoice</a></p>`;
        await sendEmail({ kind: "payment_failed", to: c.email, subject: `Payment failed – invoice ${inv.number}`, html: await emailLayout(company, "Payment failed", body), customerId: c.id, relatedId: inv.id });
        if (s?.email) await sendEmail({ kind: "payment_failed", to: s.email, subject: `[Staff] Payment failed – ${inv.number} (${c.name})`, html: await emailLayout(company, "Payment failed", `<p>${esc(c.name)}: ${esc(reason)}</p><p><a href="${APP_URL}/admin/invoices/${inv.id}">Open invoice</a></p>`) });
      }
      return;
    }

    case "mandate.updated": {
      // Direct Debit mandate cancelled by the customer or their bank: stop trying to collect
      const m = event.data.object as Stripe.Mandate;
      if (m.status !== "active") {
        await db.from("customers").update({ stripe_payment_method_id: null, stripe_payment_method_label: `Mandate ${m.status} – needs new details`, auto_charge: false }).eq("stripe_mandate_id", m.id);
      }
      return;
    }

    case "charge.refunded":
    case "charge.dispute.created":
      // Refunds and disputes are handled by hand: record a manual journal and contact the customer.
      return;
  }
}
