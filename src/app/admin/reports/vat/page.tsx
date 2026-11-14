import Link from "next/link";
import { requireFinance } from "@/lib/auth";
import { Card, PageHeader, first, type SP } from "@/components/ui";
import { PrintButton } from "@/components/client";
import { fmtDate, money, todayISO } from "@/lib/format";

export const metadata = { title: "VAT return" };

// Irish VAT is normally filed bi-monthly: Jan-Feb, Mar-Apr, ... Nov-Dec.
function periods() {
  const today = todayISO();
  const y = Number(today.slice(0, 4));
  const out: { from: string; to: string; label: string }[] = [];
  for (const year of [y, y - 1]) {
    for (let m = 11; m >= 1; m -= 2) {
      const from = `${year}-${String(m).padStart(2, "0")}-01`;
      if (from > today) continue;
      const to = new Date(Date.UTC(year, m + 1, 0)).toISOString().slice(0, 10);
      out.push({ from, to, label: `${fmtDate(from).slice(3)} – ${fmtDate(to).slice(3)}` });
    }
  }
  return out;
}

export default async function VatReturn({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireFinance();
  const sp = await searchParams;
  const list = periods();
  const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  // default: the most recent period that has finished
  const done = list.find((p) => p.to < todayISO()) ?? list[0];
  const from = ok(first(sp.from)) ? first(sp.from) : done.from;
  const to = ok(first(sp.to)) ? first(sp.to) : done.to;

  const { data, error } = await supabase.rpc("report_vat_return", { p_from: from, p_to: to });
  const v = (data?.[0] ?? {}) as Record<string, number>;
  const n = (k: string) => Number(v[k] ?? 0);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="VAT return (VAT3)" subtitle={`${fmtDate(from)} to ${fmtDate(to)} · invoice basis`}>
        <PrintButton />
      </PageHeader>
      <div className="no-print mb-3 flex flex-wrap gap-1.5">
        {list.slice(0, 8).map((p) => (
          <Link key={p.from} href={`/admin/reports/vat?from=${p.from}&to=${p.to}`} className={`btn btn-sm ${p.from === from && p.to === to ? "btn-navy" : "btn-outline"}`}>
            {p.label}
          </Link>
        ))}
      </div>
      <form method="get" className="no-print mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">From</span>
          <input className="input" type="date" name="from" defaultValue={from} />
        </label>
        <label className="block">
          <span className="label">To</span>
          <input className="input" type="date" name="to" defaultValue={to} />
        </label>
        <button className="btn btn-navy">Show</button>
      </form>

      {error ? <p className="text-sm text-red-700">{error.message}</p> : null}
      <Card>
        <table className="tbl">
          <tbody>
            <Box code="T1" label="VAT on sales" value={n("t1")} />
            <Box code="T2" label="VAT on purchases" value={n("t2")} />
            <Box code="T3" label="Net payable (T1 minus T2)" value={n("t3")} strong />
            <Box code="T4" label="Net repayable (T2 minus T1)" value={n("t4")} strong />
            <Box code="E1" label="Intra-EU supplies of goods" value={n("e1")} />
            <Box code="E2" label="Intra-EU acquisitions of goods" value={n("e2")} />
            <Box code="ES1" label="Intra-EU supplies of services" value={n("es1")} />
            <Box code="ES2" label="Intra-EU acquisitions of services" value={n("es2")} />
          </tbody>
        </table>
      </Card>
      <Card title="Supporting totals (ex VAT)" className="mt-4">
        <table className="tbl">
          <tbody>
            <tr>
              <td>Sales in the VAT return</td>
              <td className="num">{money(n("net_sales"))}</td>
            </tr>
            <tr>
              <td>Purchases in the VAT return</td>
              <td className="num">{money(n("net_purchases"))}</td>
            </tr>
          </tbody>
        </table>
      </Card>
      <p className="mt-3 text-xs text-gray-500">
        Figures for filing on ROS. Sales are dated by invoice date; voided invoices are reversed in the period they were voided. E1/E2/ES1/ES2 are always 0 here because this system only records
        domestic storage sales and domestic expenses — add any EU trade by hand. If you use the cash receipts basis, use Sage&apos;s VAT return instead. Check against Sage before you submit.
      </p>
    </div>
  );
}

function Box({ code, label, value, strong }: { code: string; label: string; value: number; strong?: boolean }) {
  return (
    <tr className={strong ? "bg-navy-50" : ""}>
      <td className="w-16 font-mono font-semibold">{code}</td>
      <td className={strong ? "text-navy font-semibold" : ""}>{label}</td>
      <td className={`num ${strong ? "font-bold" : ""}`}>{money(value)}</td>
    </tr>
  );
}
