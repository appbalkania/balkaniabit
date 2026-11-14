import Link from "next/link";
import { requireFinance } from "@/lib/auth";
import { Badge, Card, Empty, Flash, PageHeader, StatusBadge, TableWrap, first, type SP } from "@/components/ui";
import { isUuid } from "@/lib/action";
import { fmtDate, money, todayISO } from "@/lib/format";

export const metadata = { title: "Invoices" };

const FILTERS = [
  ["open", "Unpaid"],
  ["overdue", "Overdue"],
  ["failed", "Payment failed"],
  ["paid", "Paid"],
  ["void", "Void"],
  ["all", "All"],
];

export default async function Invoices({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireFinance();
  const sp = await searchParams;
  const status = first(sp.status) || "open";
  const customer = first(sp.customer);
  const today = todayISO();

  let q = supabase
    .from("invoices")
    .select("id, number, issue_date, due_date, period_start, total, amount_paid, status, payment_status, emailed_at, email_error, sage_synced_at, customers(name, account_ref)")
    .neq("status", "draft")
    .order("issue_date", { ascending: false })
    .order("number", { ascending: false })
    .limit(300);
  if (isUuid(customer)) q = q.eq("customer_id", customer);
  if (status === "open") q = q.in("status", ["issued", "part_paid"]);
  else if (status === "overdue") q = q.in("status", ["issued", "part_paid"]).lt("due_date", today);
  else if (status === "failed") q = q.in("status", ["issued", "part_paid"]).eq("payment_status", "failed");
  else if (status !== "all") q = q.eq("status", status);
  const { data } = await q;
  const owed = (data ?? []).filter((i) => ["issued", "part_paid"].includes(i.status)).reduce((n, i) => n + Number(i.total) - Number(i.amount_paid), 0);

  return (
    <>
      <PageHeader title="Invoices" subtitle={owed ? `${money(owed)} outstanding in this list` : undefined}>
        <Link href="/admin/billing" className="btn btn-primary">
          Weekly billing
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={`/admin/invoices?status=${k}${customer ? `&customer=${customer}` : ""}`} className={`btn btn-sm ${status === k ? "btn-navy" : "btn-outline"}`}>
            {label}
          </Link>
        ))}
      </div>
      <Card>
        {data?.length ? (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th>Week</th>
                  <th>Due</th>
                  <th className="num">Total</th>
                  <th className="num">Balance</th>
                  <th>Status</th>
                  <th>Emailed</th>
                </tr>
              </thead>
              <tbody>
                {data.map((i) => {
                  const balance = Number(i.total) - Number(i.amount_paid);
                  const overdue = ["issued", "part_paid"].includes(i.status) && i.due_date < today;
                  return (
                    <tr key={i.id}>
                      <td>
                        <Link href={`/admin/invoices/${i.id}`} className="link">
                          {i.number}
                        </Link>
                      </td>
                      <td>{(i.customers as unknown as { name: string })?.name}</td>
                      <td>{fmtDate(i.issue_date)}</td>
                      <td>{i.period_start ? fmtDate(i.period_start) : "—"}</td>
                      <td className={overdue ? "font-semibold text-red-700" : ""}>{fmtDate(i.due_date)}</td>
                      <td className="num">{money(i.total)}</td>
                      <td className="num">{i.status === "void" ? "—" : money(balance)}</td>
                      <td className="space-x-1">
                        <StatusBadge status={i.status} />
                        {i.payment_status === "processing" ? <Badge tone="cyan">collecting</Badge> : null}
                        {i.payment_status === "failed" && i.status !== "paid" ? <Badge tone="red">payment failed</Badge> : null}
                      </td>
                      <td>{i.emailed_at ? fmtDate(i.emailed_at) : i.email_error ? <Badge tone="red">failed</Badge> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <Empty>No invoices here.</Empty>
        )}
      </Card>
    </>
  );
}
