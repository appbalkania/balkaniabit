"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin, requireFinance } from "@/lib/auth";
import { back } from "@/lib/action";
import { sageAuthUrl, sageConfigured, sageDisconnect, sageImportNominals, sagePushOutstanding } from "@/lib/sage/api";

const P = "/admin/sage";

export async function connectSage() {
  await requireAdmin();
  if (!sageConfigured()) back(P, "error", "Add SAGE_CLIENT_ID and SAGE_CLIENT_SECRET to the environment first");
  const state = randomBytes(16).toString("hex");
  (await cookies()).set("sage_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  redirect(sageAuthUrl(state));
}

export async function disconnectSage() {
  await requireAdmin();
  await sageDisconnect();
  back(P, "ok", "Sage disconnected");
}

export async function importNominals() {
  await requireFinance();
  let n: number;
  try {
    n = await sageImportNominals();
  } catch (e) {
    back(P, "error", e instanceof Error ? e.message : String(e));
  }
  back(P, "ok", `${n} nominal codes imported from Sage`);
}

export async function pushToSage() {
  await requireFinance();
  let result: Awaited<ReturnType<typeof sagePushOutstanding>>;
  try {
    result = await sagePushOutstanding(50);
  } catch (e) {
    back(P, "error", e instanceof Error ? e.message : String(e));
  }
  const { invoices, payments, errors } = result;
  back(P, errors.length ? "error" : "ok", `${invoices} invoices and ${payments} payments sent to Sage.${errors.length ? ` ${errors.length} failed: ${errors.slice(0, 3).join("; ")}` : ""}`);
}

export async function markExported(fd: FormData) {
  const { supabase } = await requireFinance();
  const from = String(fd.get("from"));
  const to = String(fd.get("to"));
  const now = new Date().toISOString();
  await Promise.all([
    supabase.from("invoices").update({ sage_synced_at: now }).is("sage_synced_at", null).in("status", ["issued", "part_paid", "paid"]).gte("issue_date", from).lte("issue_date", to),
    supabase.from("payments").update({ sage_synced_at: now }).is("sage_synced_at", null).gte("date", from).lte("date", to),
    supabase.from("expenses").update({ sage_synced_at: now }).is("sage_synced_at", null).gte("date", from).lte("date", to),
  ]);
  back(`${P}?from=${from}&to=${to}`, "ok", "Marked as imported into Sage. They will be left out of the next 'new only' export.");
}
