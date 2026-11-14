import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { Card, Empty, Flash, PageHeader, StatusBadge, TableWrap, type SP } from "@/components/ui";
import { fmtDate, money, todayISO } from "@/lib/format";

export const metadata = { title: "Invoices" };

export default async function PortalInvoices({ searchParams }: { searchParams: SP }) {
  const { supabase, customerId } = await requireCustomer();
  const { data } = await supabase
    .from("invoices")
    .select("id, number, issue_date, due_date, period_start, period_end, total, amount_paid, status, payment_status")
    .eq("customer_id", customerId)
    .neq("status", "void")
    .order("issue_date", { ascending: false })
    .limit(200);
  const today = todayISO();
  const owed = (data ?? []).filter((i) => ["issued", "part_paid"].includes(i.status)).reduce((n, i) => n + Number(i.total) - Number(i.amount_paid), 0);

  return (
    <>
      <PageHeader title="Invoices" subtitle={`Balance: ${money(owed)}`} />
      <Flash searchParams={searchParams} />
      <Card>
        {data?.length ? (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Storage week</th>
                  <th>Due</th>
                  <th className="num">Total</th>
                  <th className="num">Balance</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.map((i) => {
                  const open = ["issued", "part_paid"].includes(i.status);
                  return (
                    <tr key={i.id}>
                      <td>
                        <Link href={`/portal/invoices/${i.id}`} className="link">
                          {i.number}
                        </Link>
                      </td>
                      <td>{fmtDate(i.issue_date)}</td>
                      <td>{i.period_start ? `${fmtDate(i.period_start)} – ${fmtDate(i.period_end)}` : "—"}</td>
                      <td className={open && i.due_date < today ? "font-semibold text-red-700" : ""}>{fmtDate(i.due_date)}</td>
                      <td className="num">{money(i.total)}</td>
                      <td className="num">{money(Number(i.total) - Number(i.amount_paid))}</td>
                      <td>
                        <StatusBadge status={i.payment_status === "processing" && open ? "processing" : i.status} />
                      </td>
                      <td>
                        <a href={`/api/invoices/${i.id}/pdf`} className="link text-xs" target="_blank" rel="noopener">
                          PDF
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <Empty>No invoices yet.</Empty>
        )}
      </Card>
    </>
  );
}
