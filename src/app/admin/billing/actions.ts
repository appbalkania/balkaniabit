"use server";

import { requireFinance } from "@/lib/auth";
import { back, dbMessage, isDate, str } from "@/lib/action";
import { createAdminClient } from "@/lib/supabase/server";
import { processPendingInvoices } from "@/lib/billing";
import { mondayOf } from "@/lib/format";

const P = "/admin/billing";

/** Bill a finished week by hand (normally the Monday cron does this). Safe to repeat. */
export async function runBilling(fd: FormData) {
  await requireFinance();
  const picked = str(fd, "week");
  if (!isDate(picked)) back(P, "error", "Choose a week");
  const week = mondayOf(picked);
  // billing functions are callable only with the server key (see migration 0005)
  const { data, error } = await createAdminClient().rpc("run_weekly_billing", { p_week_start: week });
  if (error) back(P, "error", dbMessage(error));
  const created = (data as unknown[] | null)?.length ?? 0;
  const sent = created ? await processPendingInvoices(100) : [];
  const emailed = sent.filter((s) => s.emailed).length;
  back(P, "ok", `Week commencing ${week}: ${created} new invoice${created === 1 ? "" : "s"} issued, ${emailed} emailed${created ? ". Automatic payments started where set up." : " (customers already billed for that week are skipped)."}`);
}

/** Email + collect any issued invoices that have not gone out yet (e.g. after fixing an email address). */
export async function sendPending() {
  await requireFinance();
  const r = await processPendingInvoices(100);
  back(P, "ok", r.length ? `${r.filter((x) => x.emailed).length} of ${r.length} invoices emailed` : "Nothing waiting to be sent");
}

export async function retryFailedEmails() {
  await requireFinance();
  const db = createAdminClient();
  await db.from("invoices").update({ email_error: null }).is("emailed_at", null).not("email_error", "is", null).in("status", ["issued", "part_paid"]);
  const r = await processPendingInvoices(100);
  back(P, "ok", `${r.filter((x) => x.emailed).length} of ${r.length} invoices emailed`);
}
