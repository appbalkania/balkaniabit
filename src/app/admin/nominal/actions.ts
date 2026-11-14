"use server";

import { requireFinance } from "@/lib/auth";
import { back, dbMessage, isDate, str } from "@/lib/action";

const CATS = ["fixed_assets", "current_assets", "current_liabilities", "long_term_liabilities", "capital_reserves", "sales", "purchases", "direct_expenses", "overheads"];

export async function saveNominal(fd: FormData) {
  const { supabase } = await requireFinance();
  const code = str(fd, "code");
  const name = str(fd, "name");
  const category = str(fd, "category");
  if (!/^\d{4,8}$/.test(code)) back("/admin/nominal", "error", "Nominal codes are 4-8 digits, as in Sage");
  if (!name) back("/admin/nominal", "error", "Enter a name");
  if (!CATS.includes(category)) back("/admin/nominal", "error", "Choose a category");
  const { error } = await supabase.from("nominal_accounts").upsert({ code, name, category, is_active: fd.get("is_active") !== "off" });
  if (error) back("/admin/nominal", "error", dbMessage(error));
  back("/admin/nominal", "ok", `Nominal ${code} saved`);
}

/** Manual double-entry journal (opening balances, wages, depreciation, corrections). */
export async function postJournal(fd: FormData) {
  const { supabase } = await requireFinance();
  const P = "/admin/journals";
  const date = str(fd, "date");
  const description = str(fd, "description");
  if (!isDate(date)) back(P, "error", "Date is not valid");
  if (!description) back(P, "error", "Describe the journal");

  const codes = fd.getAll("nominal_code").map(String);
  const debits = fd.getAll("debit").map((v) => String(v).trim());
  const credits = fd.getAll("credit").map((v) => String(v).trim());
  const notes = fd.getAll("line_description").map((v) => String(v).trim());
  const lines: { nominal_code: string; debit: number; credit: number; description: string | null }[] = [];
  for (let i = 0; i < codes.length; i++) {
    if (!codes[i]) continue;
    const d = debits[i] ? Number(debits[i]) : 0;
    const c = credits[i] ? Number(credits[i]) : 0;
    if (!Number.isFinite(d) || !Number.isFinite(c) || d < 0 || c < 0) back(P, "error", `Line ${i + 1}: amounts must be positive numbers`);
    if ((d > 0) === (c > 0)) back(P, "error", `Line ${i + 1}: enter a debit OR a credit`);
    lines.push({ nominal_code: codes[i], debit: Math.round(d * 100) / 100, credit: Math.round(c * 100) / 100, description: notes[i] || null });
  }
  if (lines.length < 2) back(P, "error", "A journal needs at least two lines");
  const dr = lines.reduce((n, l) => n + l.debit, 0);
  const cr = lines.reduce((n, l) => n + l.credit, 0);
  if (Math.round(dr * 100) !== Math.round(cr * 100)) back(P, "error", `Debits (${dr.toFixed(2)}) and credits (${cr.toFixed(2)}) must be equal`);

  const { data: j, error } = await supabase.from("journals").insert({ date, description, source_type: "manual" }).select("id").single();
  if (error || !j) back(P, "error", dbMessage(error));
  const { error: e2 } = await supabase.from("journal_lines").insert(lines.map((l) => ({ ...l, journal_id: j.id })));
  if (e2) {
    await supabase.from("journals").delete().eq("id", j.id);
    back(P, "error", dbMessage(e2));
  }
  back(P, "ok", `Journal posted (${dr.toFixed(2)})`);
}

export async function deleteJournal(fd: FormData) {
  const { supabase } = await requireFinance();
  const { error } = await supabase.from("journals").delete().eq("id", str(fd, "id")).eq("source_type", "manual");
  if (error) back("/admin/journals", "error", dbMessage(error));
  back("/admin/journals", "ok", "Journal deleted");
}
