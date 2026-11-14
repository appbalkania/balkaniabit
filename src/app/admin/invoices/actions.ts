"use server";

import { requireFinance } from "@/lib/auth";
import { back, dbMessage, isDate, num, orNull, str } from "@/lib/action";
import { chargeInvoice, deliverInvoice } from "@/lib/billing";

const path = (id: string) => `/admin/invoices/${id}`;

export async function recordPayment(fd: FormData) {
  const { supabase } = await requireFinance();
  const id = str(fd, "id");
  const amount = num(fd, "amount");
  const date = str(fd, "date");
  const method = str(fd, "method");
  if (!(amount > 0)) back(path(id), "error", "Enter the amount received");
  if (!isDate(date)) back(path(id), "error", "Date is not valid");
  if (!["bank_transfer", "cash", "card", "other"].includes(method)) back(path(id), "error", "Choose how it was paid");
  const { error } = await supabase.rpc("record_payment", {
    p_invoice: id,
    p_amount: amount,
    p_method: method,
    p_reference: orNull(str(fd, "reference")),
    p_date: date,
  });
  if (error) back(path(id), "error", dbMessage(error));
  back(path(id), "ok", "Payment recorded and posted to the bank account");
}

export async function voidInvoice(fd: FormData) {
  const { supabase } = await requireFinance();
  const id = str(fd, "id");
  const { error } = await supabase.rpc("void_invoice", { p_invoice: id });
  if (error) back(path(id), "error", dbMessage(error));
  back(path(id), "ok", "Invoice voided and reversed in the ledger. Re-run billing for that week to issue a corrected invoice.");
}

export async function resendInvoice(fd: FormData) {
  await requireFinance();
  const id = str(fd, "id");
  const r = await deliverInvoice(id);
  back(path(id), r.ok ? "ok" : "error", r.ok ? "Invoice emailed to the customer" : `Email failed: ${r.error}`);
}

export async function chargeNow(fd: FormData) {
  await requireFinance();
  const id = str(fd, "id");
  const r = await chargeInvoice(id);
  back(path(id), r.status === "failed" || r.status === "skipped" ? "error" : "ok", r.message);
}
