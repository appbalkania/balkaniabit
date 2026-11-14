"use server";

import { redirect } from "next/navigation";
import { requireFinance } from "@/lib/auth";
import { back, dbMessage, isDate, isUuid, num, orNull, str } from "@/lib/action";
import { createAdminClient } from "@/lib/supabase/server";
import { APP_URL } from "@/lib/email";

const METHODS = ["bank_transfer", "card", "sepa_debit", "bacs_debit"];

function customerFields(fd: FormData) {
  const terms = Number(str(fd, "payment_terms_days") || 7);
  const alert = str(fd, "expiry_alert_days");
  return {
    name: str(fd, "name"),
    contact_name: orNull(str(fd, "contact_name")),
    email: orNull(str(fd, "email").toLowerCase()),
    phone: orNull(str(fd, "phone")),
    address: orNull(str(fd, "address")),
    postcode: orNull(str(fd, "postcode").toUpperCase()),
    vat_number: orNull(str(fd, "vat_number").toUpperCase()),
    tax_code: str(fd, "tax_code") || "T1",
    payment_terms_days: terms,
    payment_method: METHODS.includes(str(fd, "payment_method")) ? str(fd, "payment_method") : "bank_transfer",
    auto_charge: fd.get("auto_charge") === "on",
    expiry_alert_days: alert === "" ? null : Number(alert),
    notes: orNull(str(fd, "notes")),
  };
}

function validate(f: ReturnType<typeof customerFields>, path: string) {
  if (!f.name) back(path, "error", "Name is required");
  if (f.email && !f.email.split(/[,;]\s*/).every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) back(path, "error", "Email address is not valid (separate several with commas)");
  if (!Number.isInteger(f.payment_terms_days) || f.payment_terms_days < 0 || f.payment_terms_days > 120) back(path, "error", "Payment terms must be 0-120 days");
  if (f.expiry_alert_days !== null && (!Number.isInteger(f.expiry_alert_days) || f.expiry_alert_days < 1 || f.expiry_alert_days > 365)) back(path, "error", "Expiry alert must be 1-365 days");
}

export async function createCustomer(fd: FormData) {
  const { supabase } = await requireFinance();
  const ref = str(fd, "account_ref").toUpperCase();
  if (!/^[A-Z0-9]{1,8}$/.test(ref)) back("/admin/customers/new", "error", "Account ref: 1-8 letters/numbers, the same as the customer's Sage account reference");
  const f = customerFields(fd);
  validate(f, "/admin/customers/new");
  const { data, error } = await supabase.from("customers").insert({ ...f, account_ref: ref }).select("id").single();
  if (error || !data) back("/admin/customers/new", "error", dbMessage(error));
  redirect(`/admin/customers/${data.id}?ok=${encodeURIComponent("Customer created. Set any special rates below.")}`);
}

export async function updateCustomer(fd: FormData) {
  const { supabase } = await requireFinance();
  const id = str(fd, "id");
  const path = `/admin/customers/${id}`;
  const f = customerFields(fd);
  validate(f, path);
  const { error } = await supabase.from("customers").update({ ...f, is_active: fd.get("is_active") === "on" }).eq("id", id);
  if (error) back(path, "error", dbMessage(error));
  back(path, "ok", "Customer saved");
}

/** Blank = use the standard rate; a number = this customer's own price. */
export async function saveRates(fd: FormData) {
  const { supabase } = await requireFinance();
  const id = str(fd, "id");
  const path = `/admin/customers/${id}`;
  const codes = fd.getAll("code").map(String);
  const rates = fd.getAll("rate").map((v) => String(v).trim());
  for (let i = 0; i < codes.length; i++) {
    if (rates[i] === "") {
      await supabase.from("customer_rates").delete().eq("customer_id", id).eq("charge_type_code", codes[i]);
      continue;
    }
    const r = Number(rates[i]);
    if (!Number.isFinite(r) || r < 0) back(path, "error", `Rate for ${codes[i]} is not valid`);
    const { error } = await supabase.from("customer_rates").upsert({ customer_id: id, charge_type_code: codes[i], rate: r });
    if (error) back(path, "error", dbMessage(error));
  }
  back(path, "ok", "Rates saved. They apply from the next weekly invoice.");
}

export async function addAdhocCharge(fd: FormData) {
  const { supabase } = await requireFinance();
  const id = str(fd, "id");
  const path = `/admin/customers/${id}`;
  const quantity = num(fd, "quantity");
  const unitPrice = num(fd, "unit_price");
  const date = str(fd, "date");
  if (!str(fd, "description")) back(path, "error", "Describe the charge");
  if (!(quantity > 0) || !(unitPrice >= 0)) back(path, "error", "Quantity and price must be valid numbers");
  if (!isDate(date)) back(path, "error", "Date is not valid");
  const { error } = await supabase.from("adhoc_charges").insert({
    customer_id: id,
    date,
    charge_type_code: str(fd, "charge_type_code") || "OTHER",
    description: str(fd, "description").slice(0, 120),
    quantity,
    unit_price: unitPrice,
  });
  if (error) back(path, "error", dbMessage(error));
  back(path, "ok", "Charge added. It will appear on the next weekly invoice.");
}

export async function deleteAdhocCharge(fd: FormData) {
  const { supabase } = await requireFinance();
  const id = str(fd, "id");
  const { error } = await supabase.from("adhoc_charges").delete().eq("id", str(fd, "charge_id")).is("invoice_line_id", null);
  if (error) back(`/admin/customers/${id}`, "error", dbMessage(error));
  back(`/admin/customers/${id}`, "ok", "Charge removed");
}

/** Give someone at the customer a login to the portal (emails them an invitation link). */
export async function inviteCustomerUser(fd: FormData) {
  await requireFinance();
  const id = str(fd, "id");
  const path = `/admin/customers/${id}`;
  const email = str(fd, "email").toLowerCase();
  const name = str(fd, "full_name");
  if (!isUuid(id)) back("/admin/customers", "error", "Unknown customer");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) back(path, "error", "Enter a valid email address");

  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("id, role, customer_id").eq("email", email).maybeSingle();
  if (existing) {
    if (existing.role !== "customer") back(path, "error", "That email belongs to a staff login");
    if (existing.customer_id && existing.customer_id !== id) back(path, "error", "That login is already linked to another customer");
    await admin.from("profiles").update({ customer_id: id }).eq("id", existing.id);
    back(path, "ok", `${email} already had a login and now has access to this customer's portal`);
  }

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: name },
    redirectTo: `${APP_URL}/auth/callback?next=/account`,
  });
  if (error || !data.user) back(path, "error", error?.message ?? "Invite failed");
  // the database trigger created the profile; link it to this customer
  await admin.from("profiles").update({ customer_id: id, role: "customer", full_name: name || null }).eq("id", data.user.id);
  back(path, "ok", `Invitation emailed to ${email}. They choose a password from the link.`);
}

export async function removeCustomerUser(fd: FormData) {
  await requireFinance();
  const id = str(fd, "id");
  const admin = createAdminClient();
  await admin.from("profiles").update({ customer_id: null }).eq("id", str(fd, "user_id")).eq("customer_id", id).eq("role", "customer");
  back(`/admin/customers/${id}`, "ok", "Portal access removed");
}
