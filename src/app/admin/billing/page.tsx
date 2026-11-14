import Link from "next/link";
import { retryFailedEmails, runBilling, sendPending } from "./actions";
import { requireFinance } from "@/lib/auth";
import { Card, Empty, Field, Flash, PageHeader, TableWrap, type SP } from "@/components/ui";
import { Submit } from "@/components/client";
import { addDays, fmtDate, fmtDateTime, money, mondayOf, todayISO } from "@/lib/format";

export const metadata = { title: "Weekly billing" };

export default async function Billing({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireFinance();
  const lastWeek = addDays(mondayOf(todayISO()), -7);

  const [{ data: runs }, { data: settings }, { data: rates }, { count: unsent }, { count: failedEmail }] = await Promise.all([
    supabase.from("billing_runs").select("id, week_start, week_end, last_run_at, invoices(total, status)").order("week_start", { ascending: false }).limit(12),
    supabase.from("company_settings").select("storage_billing_mode").single(),
    supabase.from("charge_types").select("name, default_rate").eq("basis", "storage_week").eq("is_active", true).order("sort"),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "issued").is("emailed_at", null).is("email_error", null),
    supabase.from("invoices").select("id", { count: "exact", head: true }).in("status", ["issued", "part_paid"]).is("emailed_at", null).not("email_error", "is", null),
  ]);

  return (
    <>
      <PageHeader title="Weekly billing" subtitle="Storage is invoiced every Monday for the previous Monday–Sunday week">
        <Link href="/admin/rates" className="btn btn-outline">
          Rates
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />

      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Card title="How charges are worked out" className="lg:col-span-2">
          <div className="space-y-2 p-4 text-sm text-gray-700">
            <p>Each customer gets one invoice per week with up to three storage lines:</p>
            <ul className="list-disc pl-5">
              {(rates ?? []).map((r) => (
                <li key={r.name}>
                  {r.name}: <strong>{money(r.default_rate)}</strong> per pallet per week (unless the customer has its own price)
                </li>
              ))}
            </ul>
            <p>
              {settings?.storage_billing_mode === "daily" ? (
                <>
                  <strong>Daily pro-rata:</strong> a pallet is charged for the days it was in store that week (days ÷ 7). The day it arrives and the day it leaves both count.
                </>
              ) : (
                <>
                  <strong>Part week = full week:</strong> a pallet in store on any day of the week is charged the full weekly rate.
                </>
              )}{" "}
              Change this in{" "}
              <Link href="/admin/settings" className="link">
                Settings
              </Link>
              .
            </p>
            <p>Handling in/out charges (if set above zero) and any one-off charges are added to the same invoice. The invoice is posted to the ledger, emailed as a PDF, and collected automatically by card or Direct Debit where the customer has set that up.</p>
          </div>
        </Card>

        <Card title="Run billing by hand">
          <form action={runBilling} className="space-y-3 p-4">
            <Field label="Any day in the week to bill" hint="Runs automatically every Monday at 06:00. Customers already billed for the week are skipped.">
              <input className="input" type="date" name="week" defaultValue={lastWeek} max={addDays(mondayOf(todayISO()), -1)} required />
            </Field>
            <Submit className="btn btn-primary w-full" confirm="Issue invoices for that week and email them to customers?">
              Bill week
            </Submit>
          </form>
          {(unsent ?? 0) > 0 || (failedEmail ?? 0) > 0 ? (
            <div className="space-y-2 border-t border-gray-100 p-4 text-sm">
              {(unsent ?? 0) > 0 ? (
                <form action={sendPending} className="flex items-center justify-between gap-2">
                  <span>{unsent} issued invoices not yet emailed.</span>
                  <Submit className="btn btn-outline btn-sm">Send now</Submit>
                </form>
              ) : null}
              {(failedEmail ?? 0) > 0 ? (
                <form action={retryFailedEmails} className="flex items-center justify-between gap-2">
                  <span className="text-red-700">{failedEmail} invoice emails failed.</span>
                  <Submit className="btn btn-outline btn-sm">Retry</Submit>
                </form>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>

      <Card title="Billing runs">
        {runs?.length ? (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Week</th>
                  <th className="num">Invoices</th>
                  <th className="num">Total</th>
                  <th>Last run</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const inv = (r.invoices as { total: number; status: string }[]).filter((i) => i.status !== "void");
                  return (
                    <tr key={r.id}>
                      <td>
                        {fmtDate(r.week_start)} – {fmtDate(r.week_end)}
                      </td>
                      <td className="num">{inv.length}</td>
                      <td className="num">{money(inv.reduce((n, i) => n + Number(i.total), 0))}</td>
                      <td>{fmtDateTime(r.last_run_at)}</td>
                      <td>
                        <Link href={`/admin/invoices?status=all`} className="link text-xs">
                          Invoices
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <Empty>No billing runs yet.</Empty>
        )}
      </Card>
    </>
  );
}
