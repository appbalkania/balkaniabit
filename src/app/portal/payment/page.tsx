import { removePaymentMethod, startPaymentSetup } from "../actions";
import { requireCustomer } from "@/lib/auth";
import { Card, Flash, PageHeader, first, type SP } from "@/components/ui";
import { Submit } from "@/components/client";
import { getStripe } from "@/lib/stripe";
import { saveSetupFromSession } from "@/lib/stripe-sync";

export const metadata = { title: "Payment details" };

export default async function PaymentDetails({ searchParams }: { searchParams: SP }) {
  const { supabase, customerId } = await requireCustomer();
  const sessionId = first((await searchParams).session_id);

  // back from Stripe: store the new card / mandate straight away (the webhook does the same)
  let justSaved: string | null = null;
  const stripe = getStripe();
  if (sessionId && stripe && /^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.metadata?.customer_id === customerId) {
        const r = await saveSetupFromSession(stripe, session);
        if (r.ok) justSaved = r.label ?? "saved";
      }
    } catch {
      // the webhook will finish the job
    }
  }

  const { data: c } = await supabase.from("customers").select("payment_method, stripe_payment_method_id, stripe_payment_method_label, auto_charge").eq("id", customerId).single();
  const hasMethod = Boolean(c?.stripe_payment_method_id);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Payment details" subtitle="How your weekly storage invoices are paid" />
      <Flash searchParams={searchParams} />
      {justSaved ? (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Saved: {justSaved}. Future invoices will be collected automatically.
        </div>
      ) : null}
      <Card>
        <div className="space-y-4 p-5 text-sm">
          {hasMethod ? (
            <>
              <p>
                Invoices are collected automatically from <strong>{c?.stripe_payment_method_label}</strong>
                {c?.auto_charge ? "" : " (automatic collection is currently paused by BIT Storage)"}.
              </p>
              <p className="text-gray-600">You will still receive every invoice by email before it is collected.</p>
              <div className="flex flex-wrap gap-2">
                <form action={startPaymentSetup}>
                  <Submit className="btn btn-navy">Change payment details</Submit>
                </form>
                <form action={removePaymentMethod}>
                  <Submit className="btn btn-danger" confirm="Stop automatic payments? You will need to pay each invoice yourself.">
                    Remove
                  </Submit>
                </form>
              </div>
            </>
          ) : (
            <>
              <p>
                Set up <strong>SEPA Direct Debit</strong> from your business bank account (IBAN), or save a <strong>card</strong>. Each weekly invoice is then paid automatically – no more bank transfers.
              </p>
              <p className="text-gray-600">You will be taken to Stripe, our secure payment provider. We never see your full card or bank details.</p>
              <form action={startPaymentSetup}>
                <Submit className="btn btn-primary">Set up automatic payment</Submit>
              </form>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
