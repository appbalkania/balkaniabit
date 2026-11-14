import { requireFinance } from "@/lib/auth";
import { Card, PageHeader, first, type SP } from "@/components/ui";
import { PrintButton } from "@/components/client";
import { balance, profitAndLoss, r2, trialBalance, type TBRow } from "@/lib/reports";
import { fmtDate, money, todayISO } from "@/lib/format";

export const metadata = { title: "Balance sheet" };

export default async function BalanceSheet({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireFinance();
  const asAtRaw = first((await searchParams).as_at);
  const asAt = /^\d{4}-\d{2}-\d{2}$/.test(asAtRaw) ? asAtRaw : todayISO();
  const rows = await trialBalance(supabase, null, asAt);
  const pick = (c: string) => rows.filter((r) => r.category === c).map((r) => ({ ...r, amount: balance(r) }));
  const sum = (xs: { amount: number }[]) => xs.reduce((n, x) => n + x.amount, 0);

  const fixed = pick("fixed_assets");
  const current = pick("current_assets");
  const liabilities = pick("current_liabilities");
  const longTerm = pick("long_term_liabilities");
  const capital = pick("capital_reserves");
  // no year-end close is run here, so all profit to date sits in reserves
  const profit = profitAndLoss(rows).totals.net;

  const netCurrent = sum(current) - sum(liabilities);
  const netAssets = sum(fixed) + netCurrent - sum(longTerm);
  const capitalTotal = sum(capital) + profit;
  const balanced = r2(netAssets) === r2(capitalTotal);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Balance sheet" subtitle={`As at ${fmtDate(asAt)}`}>
        <PrintButton />
      </PageHeader>
      <form method="get" className="no-print mb-4 flex items-end gap-3">
        <label className="block">
          <span className="label">As at</span>
          <input className="input" type="date" name="as_at" defaultValue={asAt} />
        </label>
        <button className="btn btn-navy">Show</button>
      </form>
      <Card>
        <table className="tbl">
          <tbody>
            <Group title="Fixed assets" rows={fixed} />
            <Sub label="Total fixed assets" value={sum(fixed)} />
            <Group title="Current assets" rows={current} />
            <Sub label="Total current assets" value={sum(current)} />
            <Group title="Current liabilities" rows={liabilities} />
            <Sub label="Total current liabilities" value={sum(liabilities)} />
            <Sub label="Net current assets" value={netCurrent} strong />
            <Group title="Long-term liabilities" rows={longTerm} />
            <Sub label="Net assets" value={netAssets} strong big />
            <Group title="Capital & reserves" rows={capital} />
            <tr>
              <td></td>
              <td>Profit and loss to date</td>
              <td className="num">{money(profit)}</td>
            </tr>
            <Sub label="Total capital & reserves" value={capitalTotal} strong big />
          </tbody>
        </table>
      </Card>
      {!balanced ? <p className="mt-2 text-sm font-semibold text-red-700">Warning: the balance sheet does not balance. Check for manual journals posted to unclassified nominal codes.</p> : null}
      <p className="mt-2 text-xs text-gray-500">
        Covers activity recorded in this system. To match Sage exactly, post your opening balances as a journal (Accounts › Journals) dated the day before you started using it.
      </p>
    </div>
  );
}

function Group({ title, rows }: { title: string; rows: (TBRow & { amount: number })[] }) {
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
          <td className="num">{money(r.amount)}</td>
        </tr>
      ))}
    </>
  );
}

function Sub({ label, value, strong, big }: { label: string; value: number; strong?: boolean; big?: boolean }) {
  return (
    <tr className={strong ? "bg-navy-50" : ""}>
      <td></td>
      <td className={`${strong ? "text-navy font-bold" : "font-semibold"} ${big ? "text-base" : ""}`}>{label}</td>
      <td className={`num ${strong ? "font-bold" : "font-semibold"} ${big ? "text-base" : ""}`}>{money(value)}</td>
    </tr>
  );
}
