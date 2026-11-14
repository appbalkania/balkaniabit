"use server";

import { requireFinance } from "@/lib/auth";
import { back } from "@/lib/action";
import { sendExpiryAlerts } from "@/lib/notifications";

export async function sendExpiryNow() {
  await requireFinance();
  const r = await sendExpiryAlerts();
  back("/admin/expiry", r.sent === r.customers ? "ok" : "error", `${r.sent} of ${r.customers} customers with expiring stock emailed (see the email log for any failures)`);
}
