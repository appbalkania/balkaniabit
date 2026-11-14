export type Zone = "frozen" | "chilled" | "ambient";
export const ZONES: Zone[] = ["frozen", "chilled", "ambient"];
export const zoneLabel = (z: string) => z.charAt(0).toUpperCase() + z.slice(1);

// Ireland by default: euro and SEPA Direct Debit. Set NEXT_PUBLIC_CURRENCY=GBP to trade in
// sterling instead (Direct Debit then uses the UK Bacs scheme).
export const CURRENCY = (process.env.NEXT_PUBLIC_CURRENCY ?? "EUR").toUpperCase();
const LOCALE = CURRENCY === "GBP" ? "en-GB" : "en-IE";
export const DIRECT_DEBIT_TYPE: "sepa_debit" | "bacs_debit" = CURRENCY === "GBP" ? "bacs_debit" : "sepa_debit";
export const isDirectDebit = (method: string | null | undefined) => method === "sepa_debit" || method === "bacs_debit";
export const paymentMethodLabel = (method: string | null | undefined) =>
  isDirectDebit(method) ? "Direct Debit" : method === "card" ? "Card" : method === "cash" ? "Cash" : method === "bank_transfer" ? "Bank transfer" : "Other";

const cur = new Intl.NumberFormat(LOCALE, { style: "currency", currency: CURRENCY });
export const money = (n: number | string | null | undefined) => cur.format(Number(n ?? 0));

const num = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 3 });
export const qty = (n: number | string | null | undefined) => num.format(Number(n ?? 0));

const TZ = "Europe/Dublin";
const dFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
const dtFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});

/** "14 Nov 2026". Accepts a date (YYYY-MM-DD) or timestamp. */
export function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  // a bare date is a calendar day, not an instant: pin it to midday so no timezone can shift it
  const d = new Date(v.length === 10 ? v + "T12:00:00Z" : v);
  return isNaN(d.getTime()) ? "—" : dFmt.format(d);
}
export function fmtDateTime(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : dtFmt.format(d);
}

/** Today's date in Ireland as YYYY-MM-DD. */
export function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}
export function addDays(iso: string, days: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** Whole days from today until the given date; negative = already passed. */
export function daysUntil(iso: string) {
  const a = new Date(todayISO() + "T12:00:00Z").getTime();
  const b = new Date(iso + "T12:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}
/** Monday of the week containing the given date. */
export function mondayOf(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

export const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
