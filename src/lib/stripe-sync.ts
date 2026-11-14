import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "./supabase/server";
import { describePaymentMethod } from "./stripe";

/**
 * After a customer finishes Stripe Checkout in "setup" mode, store the card / Direct Debit
 * mandate on their customer record so future invoices are collected automatically.
 * Called from both the return page and the webhook; safe to run twice.
 */
export async function saveSetupFromSession(stripe: Stripe, session: Stripe.Checkout.Session) {
  if (session.mode !== "setup" || session.status !== "complete") return { ok: false, reason: "Setup not complete" };
  const customerId = session.metadata?.customer_id ?? session.client_reference_id;
  if (!customerId) return { ok: false, reason: "No customer on session" };
  const setupIntentId = typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
  if (!setupIntentId) return { ok: false, reason: "No setup intent" };

  const si = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });
  const pm = si.payment_method as Stripe.PaymentMethod | null;
  if (!pm) return { ok: false, reason: "No payment method" };

  const db = createAdminClient();
  const { data: c } = await db.from("customers").select("id, stripe_customer_id").eq("id", customerId).maybeSingle();
  // the session must belong to the Stripe customer we created for this account
  if (!c || c.stripe_customer_id !== (typeof session.customer === "string" ? session.customer : session.customer?.id)) {
    return { ok: false, reason: "Customer mismatch" };
  }
  const method = pm.type === "card" ? "card" : pm.type === "sepa_debit" ? "sepa_debit" : pm.type === "bacs_debit" ? "bacs_debit" : null;
  if (!method) return { ok: false, reason: `Unsupported payment method ${pm.type}` };

  await stripe.customers.update(c.stripe_customer_id, { invoice_settings: { default_payment_method: pm.id } });
  await db
    .from("customers")
    .update({
      payment_method: method,
      stripe_payment_method_id: pm.id,
      stripe_payment_method_label: describePaymentMethod(pm),
      stripe_mandate_id: typeof si.mandate === "string" ? si.mandate : (si.mandate?.id ?? null),
      auto_charge: true,
    })
    .eq("id", c.id);
  return { ok: true, label: describePaymentMethod(pm) };
}
