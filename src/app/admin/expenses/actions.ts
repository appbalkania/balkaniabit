"use server";

import { requireFinance } from "@/lib/auth";
import { back, dbMessage, isDate, orNull, str } from "@/lib/action";

const P = "/admin/expenses";
const FROM = ["bank", "cash", "credit_card", "on_credit"];

export async function addExpense(fd: FormData) {
  const { supabase, user } = await requireFinance();
  const date = str(fd, "date");
  const net = Number(str(fd, "net"));
  const taxCode = str(fd, "tax_code");
  const vatRaw = str(fd, "vat");
  if (!isDate(date)) back(P, "error", "Date is not valid");
  if (!str(fd, "supplier")) back(P, "error", "Enter the supplier");
  if (!(net > 0)) back(P, "error", "Net amount must be more than zero");
  if (!FROM.includes(str(fd, "paid_from"))) back(P, "error", "Choose how it was paid");

  const { data: tax } = await supabase.from("tax_codes").select("rate").eq("code", taxCode).maybeSingle();
  if (!tax) back(P, "error", "Choose a tax code");
  // VAT left blank = worked out from the tax code
  const vat = vatRaw === "" ? Math.round(net * Number(tax.rate) * 100) / 100 : Number(vatRaw);
  if (!Number.isFinite(vat) || vat < 0) back(P, "error", "VAT amount is not valid");

  let receiptPath: string | null = null;
  const file = fd.get("receipt");
  if (file instanceof File && file.size > 0) {
    if (file.size > 8 * 1024 * 1024) back(P, "error", "Receipt file must be under 8 MB");
    if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(file.type)) back(P, "error", "Receipt must be a photo (JPG/PNG/HEIC) or PDF");
    const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
    receiptPath = `${date.slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("receipts").upload(receiptPath, file, { contentType: file.type, upsert: false });
    if (upErr) back(P, "error", `Receipt upload failed: ${upErr.message}`);
  }

  const { error } = await supabase.from("expenses").insert({
    date,
    supplier: str(fd, "supplier").slice(0, 80),
    reference: orNull(str(fd, "reference").slice(0, 40)),
    description: orNull(str(fd, "description").slice(0, 200)),
    nominal_code: str(fd, "nominal_code"),
    tax_code: taxCode,
    net,
    vat,
    paid_from: str(fd, "paid_from"),
    receipt_path: receiptPath,
    created_by: user.id,
  });
  if (error) {
    if (receiptPath) await supabase.storage.from("receipts").remove([receiptPath]);
    back(P, "error", dbMessage(error));
  }
  back(P, "ok", `Expense saved and posted to nominal ${str(fd, "nominal_code")}`);
}

export async function deleteExpense(fd: FormData) {
  const { supabase } = await requireFinance();
  const id = str(fd, "id");
  const { data: e } = await supabase.from("expenses").select("receipt_path, sage_synced_at").eq("id", id).maybeSingle();
  if (!e) back(P, "error", "Expense not found");
  if (e.sage_synced_at) back(P, "error", "This expense has already been exported to Sage. Correct it in Sage, or post a reversing journal.");
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) back(P, "error", dbMessage(error));
  if (e.receipt_path) await supabase.storage.from("receipts").remove([e.receipt_path]);
  back(P, "ok", "Expense deleted and its ledger entry removed");
}
