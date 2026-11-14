"use server";

import { requireAdmin } from "@/lib/auth";
import { back, dbMessage, orNull, str } from "@/lib/action";

const P = "/admin/settings";

export async function saveSettings(fd: FormData) {
  const { supabase } = await requireAdmin();
  const terms = Number(str(fd, "default_payment_terms_days"));
  const alert = Number(str(fd, "expiry_alert_days"));
  const mode = str(fd, "storage_billing_mode");
  if (!str(fd, "company_name")) back(P, "error", "Company name is required");
  if (!Number.isInteger(terms) || terms < 0 || terms > 120) back(P, "error", "Payment terms must be 0-120 days");
  if (!Number.isInteger(alert) || alert < 1 || alert > 365) back(P, "error", "Expiry alert must be 1-365 days");
  if (!["part_week", "daily"].includes(mode)) back(P, "error", "Choose a billing method");
  const codes = ["nominal_debtors", "nominal_bank", "nominal_cash", "nominal_credit_card", "nominal_creditors", "nominal_sales_vat", "nominal_purchase_vat"];
  const nominal: Record<string, string> = {};
  for (const k of codes) {
    nominal[k] = str(fd, k);
    if (!/^\d{4,8}$/.test(nominal[k])) back(P, "error", `${k.replace("nominal_", "")} nominal code is not valid`);
  }
  const prefix = str(fd, "invoice_prefix");
  if (!/^[A-Za-z0-9-]{0,8}$/.test(prefix)) back(P, "error", "Invoice prefix: letters, numbers and dashes only (max 8)");

  const { error } = await supabase
    .from("company_settings")
    .update({
      company_name: str(fd, "company_name"),
      legal_name: orNull(str(fd, "legal_name")),
      address: orNull(str(fd, "address")),
      phone: orNull(str(fd, "phone")),
      email: orNull(str(fd, "email")),
      vat_number: orNull(str(fd, "vat_number").toUpperCase()),
      company_number: orNull(str(fd, "company_number")),
      bank_details: orNull(str(fd, "bank_details")),
      invoice_prefix: prefix,
      default_payment_terms_days: terms,
      storage_billing_mode: mode,
      expiry_alert_days: alert,
      ...nominal,
    })
    .eq("id", true);
  if (error) back(P, "error", dbMessage(error));
  back(P, "ok", "Settings saved");
}

export async function saveTaxCode(fd: FormData) {
  const { supabase } = await requireAdmin();
  const code = str(fd, "code").toUpperCase();
  const rate = Number(str(fd, "rate"));
  if (!/^T\d{1,2}$/.test(code)) back(P, "error", "Tax codes look like T0, T1 ... T99 (as in Sage)");
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) back(P, "error", "Rate is a percentage, 0-100");
  const { error } = await supabase.from("tax_codes").upsert({
    code,
    description: str(fd, "description") || code,
    rate: Math.round(rate * 100) / 10000,
    in_vat_return: fd.get("in_vat_return") === "on",
  });
  if (error) back(P, "error", dbMessage(error));
  back(P, "ok", `Tax code ${code} saved. Existing invoices keep the rate they were issued with.`);
}
