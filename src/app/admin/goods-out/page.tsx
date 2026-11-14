import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { Card, Empty, Flash, PageHeader, StatusBadge, TableWrap, first, type SP } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Goods out" };

const FILTERS = [
  ["open", "Open"],
  ["dispatched", "Dispatched"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
];

export default async function GoodsOutList({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireStaff();
  const status = first((await searchParams).status) || "open";

  let q = supabase
    .from("goods_out")
    .select("id, number, reference, requested_date, method, status, source, dispatched_at, notified_at, customers(name), pallets(count)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status === "open") q = q.in("status", ["requested", "allocated", "picking", "picked"]);
  else if (status !== "all") q = q.eq("status", status);
  const { data } = await q;

  return (
    <>
      <PageHeader title="Goods out" subtitle="Collections and deliveries leaving the warehouse">
        <Link href="/admin/pick" className="btn btn-outline">
          Pick list
        </Link>
        <Link href="/admin/goods-out/new" className="btn btn-primary">
          + New goods out
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={`/admin/goods-out?status=${k}`} className={`btn btn-sm ${status === k ? "btn-navy" : "btn-outline"}`}>
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
                  <th>Reference</th>
                  <th>Type</th>
                  <th className="num">Pallets</th>
                  <th>Requested for</th>
                  <th>Dispatched</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <Link href={`/admin/goods-out/${g.id}`} className="link">
                        {g.number}
                      </Link>
                      {g.source === "portal" ? <span className="ml-2 text-xs text-gray-500">customer request</span> : null}
                    </td>
                    <td>{(g.customers as unknown as { name: string })?.name}</td>
                    <td>{g.reference ?? "—"}</td>
                    <td className="capitalize">{g.method}</td>
                    <td className="num">{(g.pallets as unknown as { count: number }[])[0]?.count ?? 0}</td>
                    <td>{fmtDate(g.requested_date)}</td>
                    <td>{fmtDate(g.dispatched_at)}</td>
                    <td>
                      <StatusBadge status={g.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <Empty>No orders here.</Empty>
        )}
      </Card>
    </>
  );
}
