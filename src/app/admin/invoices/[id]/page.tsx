import Link from "next/link";
import { notFound } from "next/navigation";
import { chargeNow, recordPayment, resendInvoice, voidInvoice } from "../actions";
import { requireFinance } from "@/lib/auth";
import { Badge, Card, Field, Flash, PageHeader, StatusBadge, TableWrap, type SP } from "@/components/ui";
import { Submit } from "@/components/client";
import { fmtDate, fmtDateTime, money, paymentMethodLabel, qty, todayISO } from "@/lib/format";

export const metadata = { title: "Invoice" };

export default async function InvoiceDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const { supabase } = await requireFinance();
  const { data: inv } = await supabase
    .from("invoices")
    .select("*, customers(id, name, account_ref, email, payment_method, auto_charge, stripe_payment_method_id, stripe_payment_method_label), invoice_lines(*), payments(*)")
    .eq("id", id)
    .maybeSingle();
  if (!inv) notFound();
  const c = inv.customers as { id: string; name: string; account_ref: string; email: string | null; payment_method: string; auto_charge: boolean; stripe_payment_method_id: string | null; stripe_payment_method_label: string | null };
  const lines = [...(inv.invoice_lines as { id: number; description: string; quantity: number; unit_price: number; net: number; vat: number; tax_code: string; nominal_code: string }[])].sort((a, b) => a.id - b.id);
  const payments = inv.payments as { id: string; date: string; amount: number; method: string; reference: string | null }[];
  const balance = Number(inv.total) - Number(inv.amount_paid);
  const open = ["issued", "part_paid"].includes(inv.status);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Invoice ${inv.number}`}
        subtitle={
          <>
            <Link className="link" href={`/admin/customers/${c.id}`}>
              {c.name}
            </Link>{" "}
            · <StatusBadge status={inv.status} />
            {inv.payment_status === "processing" ? <Badge tone="cyan">Direct Debit / card collecting</Badge> : null}
          </>
        }
      >
        <a href={`/api/invoices/${id}/pdf`} className="btn btn-outline" target="_blank" rel="noopener">
          PDF
        </a>
        {inv.status !== "void" ? (
          <form action={resendInvoice}>
            <input type="hidden" name="id" value={id} />
            <Submit className="btn btn-outline">{inv.emailed_at ? "Re-send email" : "Email to customer"}</Submit>
          </form>
        ) : null}
        <Link href="/admin/invoices" className="btn btn-outline">
          Back
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />

      {inv.payment_status === "failed" && open ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Automatic payment failed ({inv.charge_attempts} attempt{inv.charge_attempts === 1 ? "" : "s"}): {inv.payment_error}
        </div>
      ) : null}
      {inv.email_error && !inv.emailed_at ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Invoice email not delivered: {inv.email_error}</div>
      ) : null}

      <div className="card mb-5 grid grid-cols-2 gap-4 p-4 text-sm md:grid-cols-6">
        <Info label="Issued" value={fmtDate(inv.issue_date)} />
        <Info label="Due" value={fmtDate(inv.due_date)} />
        <Info label="Week" value={inv.period_start ? `${fmtDate(inv.period_start)} – ${fmtDate(inv.period_end)}` : "—"} />
        <Info label="Emailed" value={fmtDateTime(inv.emailed_at)} />
        <Info label="Sage" value={inv.sage_synced_at ? `Sent ${fmtDate(inv.sage_synced_at)}` : (inv.sage_error ?? "Not sent yet")} />
        <Info label="Pays by" value={`${paymentMethodLabel(c.payment_method)}${c.stripe_payment_method_id && c.auto_charge ? " (auto)" : ""}`} />
      </div>

      <Card>
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Description</th>
                <th className="num">Qty</th>
                <th className="num">Rate</th>
                <th className="num">Net</th>
                <th>Tax</th>
                <th className="num">VAT</th>
                <th>Nominal</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="num">{qty(l.quantity)}</td>
                  <td className="num">{money(l.unit_price)}</td>
                  <td className="num">{money(l.net)}</td>
                  <td>{l.tax_code}</td>
                  <td className="num">{money(l.vat)}</td>
                  <td className="font-mono text-xs">{l.nominal_code}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td colSpan={3} className="text-right">
                  Totals
                </td>
                <td className="num">{money(inv.net)}</td>
                <td></td>
                <td className="num">{money(inv.vat)}</td>
                <td className="num">{money(inv.total)}</td>
              </tr>
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title={`Payments – balance ${money(inv.status === "void" ? 0 : balance)}`}>
          {payments.length ? (
            <table className="tbl">
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.date)}</td>
                    <td>{paymentMethodLabel(p.method)}</td>
                    <td className="text-xs text-gray-500">{p.reference}</td>
                    <td className="num">{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-3 text-sm text-gray-500">No payments yet.</p>
          )}
          {open && balance > 0 && inv.payment_status !== "processing" ? (
            <form action={recordPayment} className="grid grid-cols-2 gap-3 border-t border-gray-100 p-4">
              <input type="hidden" name="id" value={id} />
              <Field label="Amount received">
                <input className="input" type="number" name="amount" step="0.01" min={0.01} max={balance} defaultValue={balance.toFixed(2)} required />
              </Field>
              <Field label="Date">
                <input className="input" type="date" name="date" defaultValue={todayISO()} required />
              </Field>
              <Field label="Method">
                <select className="input" name="method" defaultValue="bank_transfer">
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card (terminal)</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Reference">
                <input className="input" name="reference" maxLength={60} />
              </Field>
              <div className="col-span-2">
                <Submit>Record payment</Submit>
              </div>
            </form>
          ) : null}
        </Card>

        {open ? (
          <Card title="Actions">
            <div className="space-y-3 p-4 text-sm">
              {c.stripe_payment_method_id && balance > 0 && inv.payment_status !== "processing" ? (
                <form action={chargeNow} className="flex items-center justify-between gap-3">
                  <input type="hidden" name="id" value={id} />
                  <span>Collect {money(balance)} now from {c.stripe_payment_method_label}.</span>
                  <Submit className="btn btn-navy btn-sm" confirm={`Charge ${money(balance)} to ${c.stripe_payment_method_label}?`}>
                    Collect now
                  </Submit>
                </form>
              ) : null}
              {inv.amount_paid == 0 && inv.payment_status !== "processing" ? (
                <form action={voidInvoice} className="flex items-center justify-between gap-3">
                  <input type="hidden" name="id" value={id} />
                  <span>Cancel this invoice. The ledger entries are reversed; you can then re-run billing for the week.</span>
                  <Submit className="btn btn-danger btn-sm" confirm={`Void ${inv.number}? This cannot be undone.`}>
                    Void
                  </Submit>
                </form>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium tracking-wide text-gray-500 uppercase">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}
