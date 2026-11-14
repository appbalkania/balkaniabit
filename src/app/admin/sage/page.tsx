import { connectSage, disconnectSage, importNominals, markExported, pushToSage } from "./actions";
import { requireFinance } from "@/lib/auth";
import { Badge, Card, Field, Flash, PageHeader, first, type SP } from "@/components/ui";
import { Submit } from "@/components/client";
import { sageStatus } from "@/lib/sage/api";
import { fmtDateTime, todayISO } from "@/lib/format";

export const metadata = { title: "Sage" };

export default async function SagePage({ searchParams }: { searchParams: SP }) {
  const { supabase, profile } = await requireFinance();
  const sp = await searchParams;
  const today = todayISO();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(first(sp.from)) ? first(sp.from) : `${today.slice(0, 7)}-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(first(sp.to)) ? first(sp.to) : today;
  const status = await sageStatus();
  const [{ count: invPending }, { count: payPending }, { count: expPending }] = await Promise.all([
    supabase.from("invoices").select("id", { count: "exact", head: true }).in("status", ["issued", "part_paid", "paid"]).is("sage_synced_at", null),
    supabase.from("payments").select("id", { count: "exact", head: true }).is("sage_synced_at", null),
    supabase.from("expenses").select("id", { count: "exact", head: true }).is("sage_synced_at", null),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Sage" subtitle="Send invoices, receipts and expenses to Sage on the same nominal codes" />
      <Flash searchParams={searchParams} />

      <div className="mb-5 rounded-md border border-gray-200 bg-white px-4 py-3 text-sm">
        Not yet in Sage: <strong>{invPending ?? 0}</strong> invoices · <strong>{payPending ?? 0}</strong> receipts · <strong>{expPending ?? 0}</strong> expenses
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Sage 50 Accounts (desktop) – CSV import">
          <div className="space-y-3 p-4 text-sm">
            <p>
              Download a file and import it in Sage 50 with <strong>File › Import › Audit Trail Transactions</strong>. Invoices go in as SI, receipts as SA, expenses as BP (paid) or PI (on account).
            </p>
            <form method="get" action="/api/sage/export" className="grid grid-cols-2 gap-3">
              <Field label="From">
                <input className="input" type="date" name="from" defaultValue={from} required />
              </Field>
              <Field label="To">
                <input className="input" type="date" name="to" defaultValue={to} required />
              </Field>
              <label className="col-span-2 flex items-center gap-2">
                <input type="checkbox" name="only_new" value="1" defaultChecked /> Only items not exported before
              </label>
              <button className="btn btn-navy col-span-2">Download CSV</button>
            </form>
            <form action={markExported} className="border-t border-gray-100 pt-3">
              <input type="hidden" name="from" value={from} />
              <input type="hidden" name="to" value={to} />
              <p className="mb-2 text-xs text-gray-500">After Sage has imported the file successfully, mark those items so they are not exported twice.</p>
              <Submit className="btn btn-outline btn-sm" confirm="Has Sage imported the file without errors?">
                Mark {from} – {to} as imported
              </Submit>
            </form>
            <p className="text-xs text-gray-500">Before the first import: make sure each customer exists in Sage with the same account ref, and suppliers used for “on account” expenses exist with the reference shown in the file.</p>
          </div>
        </Card>

        <Card title="Sage Accounting (cloud) – live connection">
          <div className="space-y-3 p-4 text-sm">
            <p>
              Status:{" "}
              {status.connected ? <Badge tone="green">Connected</Badge> : status.configured ? <Badge tone="amber">Not connected</Badge> : <Badge>Not configured</Badge>}
              {status.since ? <span className="ml-2 text-xs text-gray-500">since {fmtDateTime(status.since)}</span> : null}
            </p>
            {!status.configured ? (
              <p className="text-xs text-gray-500">Register an app at developerselfservice.sageone.com and add SAGE_CLIENT_ID / SAGE_CLIENT_SECRET to the environment. Callback URL: your-site/api/sage/callback.</p>
            ) : null}
            {profile.role === "admin" && status.configured ? (
              <form action={status.connected ? disconnectSage : connectSage}>
                <Submit className={status.connected ? "btn btn-danger btn-sm" : "btn btn-navy btn-sm"}>{status.connected ? "Disconnect" : "Connect to Sage"}</Submit>
              </form>
            ) : null}
            {status.connected ? (
              <>
                <form action={importNominals} className="flex items-center justify-between gap-2 border-t border-gray-100 pt-3">
                  <span>Copy the chart of accounts from Sage.</span>
                  <Submit className="btn btn-outline btn-sm">Import nominal codes</Submit>
                </form>
                <form action={pushToSage} className="flex items-center justify-between gap-2">
                  <span>Send new invoices and receipts now (also runs nightly).</span>
                  <Submit className="btn btn-primary btn-sm">Send to Sage</Submit>
                </form>
                <p className="text-xs text-amber-700">
                  The cloud connection has not yet been tested against a live Sage company. Try it on a Sage trial company first and check one invoice before relying on it. Expenses are not pushed by
                  the live connection — use the CSV or enter them in Sage.
                </p>
              </>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
