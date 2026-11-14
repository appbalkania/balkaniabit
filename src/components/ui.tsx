import Link from "next/link";
import type { ReactNode } from "react";
import { daysUntil, fmtDate, zoneLabel } from "@/lib/format";

export type SP = Promise<Record<string, string | string[] | undefined>>;
export const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-navy text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-gray-600">{subtitle}</p> : null}
      </div>
      {children ? <div className="no-print flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

/** Green / red banner driven by ?ok= and ?error= (set by server actions). */
export async function Flash({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ok = first(sp.ok);
  const error = first(sp.error);
  if (!ok && !error) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={`no-print mb-4 rounded-md border px-4 py-3 text-sm ${
        error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-900"
      }`}
    >
      {error || ok}
    </div>
  );
}

const TONES: Record<string, string> = {
  gray: "bg-gray-100 text-gray-700",
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  blue: "bg-blue-100 text-blue-800",
  navy: "bg-navy-50 text-navy",
  cyan: "bg-cyan-100 text-cyan-800",
};

export function Badge({ tone = "gray", children }: { tone?: keyof typeof TONES | string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone] ?? TONES.gray}`}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  expected: "amber",
  received: "blue",
  putaway: "green",
  stored: "green",
  requested: "amber",
  allocated: "blue",
  picking: "cyan",
  picked: "navy",
  dispatched: "gray",
  cancelled: "red",
  draft: "gray",
  issued: "amber",
  part_paid: "cyan",
  paid: "green",
  void: "red",
  processing: "cyan",
  failed: "red",
  succeeded: "green",
};
const STATUS_LABEL: Record<string, string> = { putaway: "Put away", part_paid: "Part paid", issued: "Unpaid" };

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "gray"}>{STATUS_LABEL[status] ?? zoneLabel(status)}</Badge>;
}

export function ZoneBadge({ zone }: { zone: string }) {
  const tone = zone === "frozen" ? "blue" : zone === "chilled" ? "cyan" : "amber";
  return <Badge tone={tone}>{zoneLabel(zone)}</Badge>;
}

/** Expiry date coloured by urgency: red = expired, amber = inside the alert window. */
export function Expiry({ date, alertDays = 30 }: { date: string | null; alertDays?: number }) {
  if (!date) return <span className="text-gray-400">No expiry</span>;
  const d = daysUntil(date);
  if (d < 0) return <span className="font-semibold text-red-700">{fmtDate(date)} · expired</span>;
  if (d <= alertDays) return <span className="font-semibold text-amber-700">{fmtDate(date)} · {d === 0 ? "today" : `${d}d`}</span>;
  return <span>{fmtDate(date)}</span>;
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: "red" | "amber" }) {
  const body = (
    <div className={`card h-full p-4 ${href ? "hover:border-brand transition-colors" : ""}`}>
      <div className="text-xs font-medium tracking-wide text-gray-500 uppercase">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-navy"}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-gray-500">{hint}</div> : null}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <h2 className="text-navy text-sm font-semibold">{title}</h2>
          {actions ? <div className="no-print flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-gray-500">{hint}</span> : null}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-gray-500">{children}</div>;
}

/** Horizontal scroll wrapper so wide tables work on a phone / handheld. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}
