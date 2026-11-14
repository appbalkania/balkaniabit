import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Sage 50 Accounts: File > Import > "Audit Trail Transactions" (CSV, no header row needed,
// but Sage lets you tick "First row contains headings" - we include one).
//
// Column order is Sage's standard import layout:
//   Type, Account Reference, Nominal A/C Ref, Department Code, Date, Reference, Details,
//   Net Amount, Tax Code, Tax Amount, Exchange Rate, Extra Reference
//
//   SI = sales invoice line      (Account Reference = customer account ref)
//   SA = sales receipt on account (Nominal = bank account the money went into)
//   BP = bank payment            (Account Reference = bank nominal; expense paid straight from bank/cash/card)
//   PI = purchase invoice        (Account Reference = supplier ref; expense bought on credit)

const HEADER = [
  "Type",
  "Account Reference",
  "Nominal A/C Ref",
  "Department Code",
  "Date",
  "Reference",
  "Details",
  "Net Amount",
  "Tax Code",
  "Tax Amount",
  "Exchange Rate",
  "Extra Reference",
];

const cell = (v: unknown) => {
  const s = String(v ?? "");
  // neutralise spreadsheet formulas and quote anything containing separators
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
};
const ukDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const amt = (n: unknown) => Number(n ?? 0).toFixed(2);
const supplierRef = (name: string) =>
  name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8) || "SUPPLIER";

export type SageExport = { csv: string; rows: number; invoiceIds: string[]; paymentIds: string[]; expenseIds: string[] };

/**
 * Build the Sage 50 import file for everything in the date range.
 * `onlyNew` leaves out records already exported (sage_synced_at set).
 */
export async function buildSage50Csv(db: SupabaseClient, from: string, to: string, onlyNew: boolean): Promise<SageExport> {
  const { data: s } = await db
    .from("company_settings")
    .select("nominal_bank, nominal_cash, nominal_credit_card")
    .single();
  const bank = s?.nominal_bank ?? "1200";

  let invQ = db
    .from("invoices")
    .select("id, number, issue_date, customers(account_ref), invoice_lines(id, description, net, vat, tax_code, nominal_code)")
    .in("status", ["issued", "part_paid", "paid"])
    .gte("issue_date", from)
    .lte("issue_date", to)
    .order("number");
  let payQ = db
    .from("payments")
    .select("id, date, amount, method, reference, invoices(number), customers(account_ref)")
    .gte("date", from)
    .lte("date", to)
    .order("date");
  let expQ = db.from("expenses").select("*").gte("date", from).lte("date", to).order("date");
  if (onlyNew) {
    invQ = invQ.is("sage_synced_at", null);
    payQ = payQ.is("sage_synced_at", null);
    expQ = expQ.is("sage_synced_at", null);
  }
  const [{ data: invoices }, { data: payments }, { data: expenses }] = await Promise.all([invQ, payQ, expQ]);

  const rows: unknown[][] = [];
  for (const inv of invoices ?? []) {
    const ref = (inv.customers as unknown as { account_ref: string }).account_ref;
    const lines = [...(inv.invoice_lines as { id: number; description: string; net: number; vat: number; tax_code: string; nominal_code: string }[])].sort(
      (a, b) => a.id - b.id
    );
    for (const l of lines) {
      rows.push(["SI", ref, l.nominal_code, 0, ukDate(inv.issue_date), inv.number, l.description.slice(0, 60), amt(l.net), l.tax_code, amt(l.vat), 1, ""]);
    }
  }
  for (const p of payments ?? []) {
    const ref = (p.customers as unknown as { account_ref: string }).account_ref;
    const invNo = (p.invoices as unknown as { number: string }).number;
    rows.push(["SA", ref, bank, 0, ukDate(p.date), invNo, `Receipt ${invNo} (${p.method})`.slice(0, 60), amt(p.amount), "T9", "0.00", 1, (p.reference ?? "").slice(0, 30)]);
  }
  for (const e of expenses ?? []) {
    const details = `${e.supplier}${e.description ? ` - ${e.description}` : ""}`.slice(0, 60);
    if (e.paid_from === "on_credit") {
      rows.push(["PI", supplierRef(e.supplier), e.nominal_code, 0, ukDate(e.date), e.reference ?? "", details, amt(e.net), e.tax_code, amt(e.vat), 1, ""]);
    } else {
      const paidFrom = e.paid_from === "cash" ? (s?.nominal_cash ?? "1230") : e.paid_from === "credit_card" ? (s?.nominal_credit_card ?? "1240") : bank;
      rows.push(["BP", paidFrom, e.nominal_code, 0, ukDate(e.date), e.reference ?? "", details, amt(e.net), e.tax_code, amt(e.vat), 1, ""]);
    }
  }

  const csv = [HEADER, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  return {
    csv,
    rows: rows.length,
    invoiceIds: (invoices ?? []).map((i) => i.id),
    paymentIds: (payments ?? []).map((p) => p.id),
    expenseIds: (expenses ?? []).map((e) => e.id),
  };
}
