import Link from "next/link";
import { notFound } from "next/navigation";
import { payInvoice } from "../../actions";
import { requireCustomer } from "@/lib/auth";
import { Card, Flash, PageHeader, StatusBadge, TableWrap, type SP } from "@/components/ui";
import { Submit } from "@/components/client";
import { fmtDate, money, paymentMethodLabel, qty } from "@/lib/format";

export const metadata = { title: "Invoice" };

export default async function PortalInvoice({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const { supabase } = await requireCustomer();
  const { data: inv } = await supabase.from("invoices").select("*, invoice_lines(id, description, quantity, unit_price, net, vat), payments(id, date, amount, method)").eq("id", id).maybeSingle();
  if (!inv) notFound();
  const lines = [...(inv.invoice_lines as { id: number; description: string; quantity: number; unit_price: number; net: number; vat: number }[])].sort((a, b) => a.id - b.id);
  const payments = inv.payments as { id: string; date: string; amount: number; method: string }[];
  const balance = Number(inv.total) - Number(inv.amount_paid);
  const canPay = ["issued", "part_paid"].includes(inv.status) && balance > 0 && inv.payment_status !== "processing";

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={`Invoice ${inv.number}`}
        subtitle={
          <>
            {fmtDate(inv.issue_date)} · due {fmtDate(inv.due_date)} · <StatusBadge status={inv.status} />
          </>
        }
      >
        <a href={`/api/invoices/${id}/pdf`} className="btn btn-outline" target="_blank" rel="noopener">
          Download PDF
        </a>
        <Link href="/portal/invoices" className="btn btn-outline">
          Back
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />

      {inv.payment_status === "processing" && balance > 0 ? (
        <div className="mb-4 rounded-md border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">Your payment is being collected. Direct Debit payments take a few working days to clear.</div>
      ) : null}

      <Card>
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Description</th>
                <th className="num">Qty</th>
                <th className="num">Rate</th>
                <th className="num">Net</th>
                <th className="num">VAT</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="num">{qty(l.quantity)}</td>
                  <td className="num">{money(l.unit_price)}</td>
                  <td className="num">{money(l.net)}</td>
                  <td className="num">{money(l.vat)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="text-right font-semibold">
                  Total (incl. VAT {money(inv.vat)})
                </td>
                <td colSpan={2} className="num text-navy text-base font-bold">
                  {money(inv.total)}
                </td>
              </tr>
              {payments.map((p) => (
                <tr key={p.id} className="text-gray-600">
                  <td colSpan={3} className="text-right">
                    Paid {fmtDate(p.date)} ({paymentMethodLabel(p.method)})
                  </td>
                  <td colSpan={2} className="num">
                    −{money(p.amount)}
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="text-right font-semibold">
                  Balance due
                </td>
                <td colSpan={2} className="num font-bold">
                  {money(balance)}
                </td>
              </tr>
            </tbody>
          </table>
        </TableWrap>
      </Card>

      {canPay ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <form action={payInvoice}>
            <input type="hidden" name="id" value={id} />
            <Submit className="btn btn-primary">Pay {money(balance)} by card</Submit>
          </form>
          <Link href="/portal/payment" className="link text-sm">
            Or set up Direct Debit for future invoices
          </Link>
        </div>
      ) : null}
    </div>
  );
}
