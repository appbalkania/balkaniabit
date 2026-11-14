import { requireFinance } from "@/lib/auth";
import { Card, PageHeader, type SP } from "@/components/ui";
import { PrintButton } from "@/components/client";
import { PeriodForm, readPeriod } from "@/components/period";
import { profitAndLoss, trialBalance, type TBRow } from "@/lib/reports";
import { fmtDate, money } from "@/lib/format";

export const metadata = { title: "Profit & loss" };

export default async function PnL({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireFinance();
  const { from, to } = readPeriod(await searchParams);
  const pnl = profitAndLoss(await trialBalance(supabase, from, to));
  const t = pnl.totals;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Profit & loss" subtitle={`${fmtDate(from)} to ${fmtDate(to)}`}>
        <PrintButton />
      </PageHeader>
      <PeriodForm from={from} to={to} />
      <Card>
        <table className="tbl">
          <tbody>
            <Section title="Sales" rows={pnl.sales} total={t.sales} />
            <Section title="Purchases" rows={pnl.purchases} total={t.purchases} negative />
            <Section title="Direct expenses" rows={pnl.direct} total={t.direct} negative />
            <TotalRow label="Gross profit" value={t.gross} strong />
            <Section title="Overheads" rows={pnl.overheads} total={t.overheads} negative />
            <TotalRow label={t.net >= 0 ? "Net profit" : "Net loss"} value={t.net} strong big />
          </tbody>
        </table>
      </Card>
      <p className="mt-2 text-xs text-gray-500">
        Built from this system&apos;s ledger: storage invoices, expenses and any manual journals. Sales are shown net of VAT. Items posted only in Sage (wages, depreciation, bank charges entered there) are not included unless you also journal them here.
      </p>
    </div>
  );
}

function Section({ title, rows, total, negative }: { title: string; rows: (TBRow & { amount: number })[]; total: number; negative?: boolean }) {
  if (!rows.length) return null;
  return (
    <>
      <tr>
        <td colSpan={3} className="bg-gray-50 text-xs font-semibold tracking-wide text-gray-600 uppercase">
          {title}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.code}>
          <td className="w-20 font-mono text-xs text-gray-500">{r.code}</td>
          <td>{r.name}</td>
          <td className="num">{money(negative ? -r.amount : r.amount)}</td>
        </tr>
      ))}
      <TotalRow label={`Total ${title.toLowerCase()}`} value={negative ? -total : total} />
    </>
  );
}

function TotalRow({ label, value, strong, big }: { label: string; value: number; strong?: boolean; big?: boolean }) {
  return (
    <tr className={strong ? "bg-navy-50" : ""}>
      <td></td>
      <td className={`${strong ? "text-navy font-bold" : "font-semibold"} ${big ? "text-base" : ""}`}>{label}</td>
      <td className={`num ${strong ? "font-bold" : "font-semibold"} ${big ? "text-base" : ""} ${value < 0 ? "text-red-700" : ""}`}>{money(value)}</td>
    </tr>
  );
}
