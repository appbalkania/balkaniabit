import { first } from "./ui";
import { todayISO } from "@/lib/format";

/** Read ?from=&to= with sensible defaults (this calendar year to date). */
export function readPeriod(sp: Record<string, string | string[] | undefined>) {
  const today = todayISO();
  const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = ok(first(sp.from)) ? first(sp.from) : `${today.slice(0, 4)}-01-01`;
  const to = ok(first(sp.to)) ? first(sp.to) : today;
  return { from, to };
}

export function PeriodForm({ from, to, label = "Show" }: { from: string; to: string; label?: string }) {
  return (
    <form method="get" className="no-print mb-4 flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="label">From</span>
        <input className="input" type="date" name="from" defaultValue={from} required />
      </label>
      <label className="block">
        <span className="label">To</span>
        <input className="input" type="date" name="to" defaultValue={to} required />
      </label>
      <button className="btn btn-navy">{label}</button>
    </form>
  );
}
