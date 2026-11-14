import "server-only";
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: Stripe | null = null;

/** Stripe client, or null when STRIPE_SECRET_KEY has not been configured yet. */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  client ??= new Stripe(key);
  return client;
}

/** Find or create the Stripe customer that mirrors one of our customers. */
export async function ensureStripeCustomer(
  stripe: Stripe,
  db: SupabaseClient,
  customer: { id: string; name: string; email: string | null; account_ref: string; stripe_customer_id: string | null }
) {
  if (customer.stripe_customer_id) return customer.stripe_customer_id;
  const created = await stripe.customers.create(
    {
      name: customer.name,
      email: customer.email ?? undefined,
      metadata: { customer_id: customer.id, account_ref: customer.account_ref },
    },
    { idempotencyKey: `customer-${customer.id}` }
  );
  await db.from("customers").update({ stripe_customer_id: created.id }).eq("id", customer.id);
  return created.id;
}

/** "Visa •••• 4242" / "SEPA Direct Debit •••• 3000" */
export function describePaymentMethod(pm: Stripe.PaymentMethod) {
  if (pm.type === "card" && pm.card) {
    const brand = pm.card.brand.charAt(0).toUpperCase() + pm.card.brand.slice(1);
    return `${brand} •••• ${pm.card.last4} (exp ${String(pm.card.exp_month).padStart(2, "0")}/${pm.card.exp_year})`;
  }
  if (pm.type === "sepa_debit" && pm.sepa_debit) {
    return `SEPA Direct Debit ${pm.sepa_debit.country ?? ""} •••• ${pm.sepa_debit.last4 ?? ""}`.replace(/\s+/g, " ");
  }
  if (pm.type === "bacs_debit" && pm.bacs_debit) {
    return `Direct Debit ${pm.bacs_debit.sort_code ?? ""} •••• ${pm.bacs_debit.last4 ?? ""}`.replace(/\s+/g, " ");
  }
  return pm.type;
}
