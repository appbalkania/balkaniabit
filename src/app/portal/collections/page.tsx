import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { Card, Empty, Flash, PageHeader, StatusBadge, TableWrap, type SP } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Collections" };

export default async function PortalCollections({ searchParams }: { searchParams: SP }) {
  const { supabase, customerId } = await requireCustomer();
  const { data } = await supabase
    .from("goods_out")
    .select("id, number, reference, method, requested_date, dispatched_at, collected_by, status, pallets(count)")
    .eq("customer_id", customerId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <>
      <PageHeader title="Collections">
        <Link href="/portal/collections/new" className="btn btn-primary">
          Request a collection
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />
      <Card>
        {data?.length ? (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Your reference</th>
                  <th>Type</th>
                  <th className="num">Pallets</th>
                  <th>Requested for</th>
                  <th>Left warehouse</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.map((o) => (
                  <tr key={o.id}>
                    <td>{o.number}</td>
                    <td>{o.reference ?? "—"}</td>
                    <td className="capitalize">{o.method}</td>
                    <td className="num">{(o.pallets as unknown as { count: number }[])[0]?.count ?? 0}</td>
                    <td>{fmtDate(o.requested_date)}</td>
                    <td>
                      {fmtDate(o.dispatched_at)}
                      {o.collected_by ? <div className="text-xs text-gray-500">{o.collected_by}</div> : null}
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <Empty>No collections yet.</Empty>
        )}
      </Card>
    </>
  );
}
