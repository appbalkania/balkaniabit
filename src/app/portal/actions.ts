"use server";

import { redirect } from "next/navigation";
import { requireCustomer } from "@/lib/auth";
import { back, dbMessage, isDate, isUuid, orNull, str } from "@/lib/action";
import { parseGoodsInLines } from "@/components/forms";
import { getStripe, ensureStripeCustomer } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { APP_URL, emailLayout, sendEmail } from "@/lib/email";
import { CURRENCY, DIRECT_DEBIT_TYPE, esc, fmtDate } from "@/lib/format";

/** Let the warehouse know something needs doing (to the company email in Settings). */
async function tellWarehouse(subject: string, html: string) {
  const { data: s } = await createAdminClient().from("company_settings").select("company_name, email").single();
  if (s?.email) await sendEmail({ kind: "goods_out", to: s.email, subject, html: await emailLayout(s.company_name, subject, html) });
}

export async function preAdviseDelivery(fd: FormData) {
  const { supabase, customerId } = await requireCustomer();
  const P = "/portal/deliveries/new";
  const expected = str(fd, "expected_date");
  if (!isDate(expected)) back(P, "error", "Choose the date it will arrive");
  const { lines, error: lineErr } = parseGoodsInLines(fd);
  if (lineErr) back(P, "error", lineErr);
  if (!lines.length) back(P, "error", "Add at least one line");

  const { data: g, error } = await supabase
    .from("goods_in")
    .insert({ customer_id: customerId, source: "portal", reference: orNull(str(fd, "reference")), carrier: orNull(str(fd, "carrier")), expected_date: expected, notes: orNull(str(fd, "notes")) })
    .select("id, number")
    .single();
  if (error || !g) back(P, "error", dbMessage(error));
  const { error: e2 } = await supabase.from("goods_in_lines").insert(lines.map((l) => ({ ...l, goods_in_id: g.id })));
  if (e2) back(P, "error", dbMessage(e2));

  const pallets = lines.reduce((n, l) => n + l.pallets, 0);
  await tellWarehouse(`Delivery pre-advised: ${g.number}, ${pallets} pallets on ${fmtDate(expected)}`, `<p>A customer has pre-advised a delivery of <strong>${pallets} pallets</strong> for ${fmtDate(expected)}.</p><p><a href="${APP_URL}/admin/goods-in/${g.id}">Open ${esc(g.number)}</a></p>`);
  back("/portal/deliveries", "ok", `Thank you – delivery ${g.number} is booked. We will email you when it has been received and put away.`);
}

export async function requestCollection(fd: FormData) {
  const { supabase } = await requireCustomer();
  const P = "/portal/collections/new";
  const ids = fd.getAll("pallet_id").map(String).filter(isUuid);
  const date = str(fd, "requested_date");
  if (!ids.length) back(P, "error", "Tick the pallets you want to collect");
  if (!isDate(date)) back(P, "error", "Choose a collection date");
  const method = str(fd, "method") === "delivery" ? "delivery" : "collection";
  if (method === "delivery" && !str(fd, "delivery_address")) back(P, "error", "Enter the delivery address");

  const { data: orderId, error } = await supabase.rpc("request_goods_out", {
    p_pallet_ids: ids,
    p_reference: str(fd, "reference"),
    p_requested_date: date,
    p_method: method,
    p_delivery_address: str(fd, "delivery_address"),
    p_notes: str(fd, "notes"),
  });
  if (error) back(P, "error", dbMessage(error));
  await tellWarehouse(`Collection requested: ${ids.length} pallets for ${fmtDate(date)}`, `<p>A customer has requested ${method === "delivery" ? "delivery" : "collection"} of <strong>${ids.length} pallets</strong> on ${fmtDate(date)}.</p><p><a href="${APP_URL}/admin/goods-out/${orderId}">Open the order</a></p>`);
  back("/portal/collections", "ok", `Request sent for ${ids.length} pallet${ids.length === 1 ? "" : "s"}. We will email you when they leave the warehouse.`);
}

/** Stripe-hosted page where the customer saves a card or signs a Direct Debit mandate. */
export async function startPaymentSetup() {
  const { customerId } = await requireCustomer();
  const stripe = getStripe();
  if (!stripe) back("/portal/payment", "error", "Online payments are not available yet - please contact us");
  const db = createAdminClient();
  const { data: c } = await db.from("customers").select("id, name, email, account_ref, stripe_customer_id").eq("id", customerId).single();
  if (!c) back("/portal/payment", "error", "Account not found");
  const stripeCustomer = await ensureStripeCustomer(stripe, db, c);
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    currency: CURRENCY.toLowerCase(),
    customer: stripeCustomer,
    allowed_payment_method_types: [DIRECT_DEBIT_TYPE, "card"],
    client_reference_id: c.id,
    metadata: { customer_id: c.id },
    success_url: `${APP_URL}/portal/payment?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/portal/payment`,
  });
  redirect(session.url!);
}

export async function removePaymentMethod() {
  const { customerId } = await requireCustomer();
  const db = createAdminClient();
  const { data: c } = await db.from("customers").select("stripe_payment_method_id").eq("id", customerId).single();
  const stripe = getStripe();
  if (stripe && c?.stripe_payment_method_id) {
    try {
      await stripe.paymentMethods.detach(c.stripe_payment_method_id);
    } catch {
      // already detached in Stripe
    }
  }
  await db.from("customers").update({ stripe_payment_method_id: null, stripe_payment_method_label: null, stripe_mandate_id: null, payment_method: "bank_transfer" }).eq("id", customerId);
  back("/portal/payment", "ok", "Payment details removed. Future invoices will be emailed for you to pay.");
}

/** One-off card payment of an invoice balance through Stripe Checkout. */
export async function payInvoice(fd: FormData) {
  const { supabase, customerId } = await requireCustomer();
  const id = str(fd, "id");
  const P = `/portal/invoices/${id}`;
  const stripe = getStripe();
  if (!stripe) back(P, "error", "Online payments are not available yet - please pay by bank transfer");
  // read through RLS so a customer can only pay their own invoice
  const { data: inv } = await supabase.from("invoices").select("id, number, total, amount_paid, status, payment_status").eq("id", id).maybeSingle();
  if (!inv) back("/portal/invoices", "error", "Invoice not found");
  const balance = Math.round((Number(inv.total) - Number(inv.amount_paid)) * 100);
  if (!["issued", "part_paid"].includes(inv.status) || balance <= 0) back(P, "error", "Nothing to pay on this invoice");
  if (inv.payment_status === "processing") back(P, "error", "A payment for this invoice is already being processed");

  const db = createAdminClient();
  const { data: c } = await db.from("customers").select("id, name, email, account_ref, stripe_customer_id").eq("id", customerId).single();
  const stripeCustomer = await ensureStripeCustomer(stripe, db, c!);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: stripeCustomer,
    allowed_payment_method_types: ["card"],
    line_items: [{ quantity: 1, price_data: { currency: CURRENCY.toLowerCase(), unit_amount: balance, product_data: { name: `Invoice ${inv.number}` } } }],
    payment_intent_data: { metadata: { invoice_id: inv.id, invoice_number: inv.number }, description: `Invoice ${inv.number}` },
    metadata: { invoice_id: inv.id },
    success_url: `${APP_URL}/portal/invoices/${inv.id}?ok=${encodeURIComponent("Thank you - your payment is being confirmed")}`,
    cancel_url: `${APP_URL}/portal/invoices/${inv.id}`,
  });
  redirect(session.url!);
}
