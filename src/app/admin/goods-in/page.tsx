import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { Card, Empty, Flash, PageHeader, StatusBadge, TableWrap, first, type SP } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Goods in" };

const FILTERS = [
  ["open", "Open"],
  ["expected", "Expected"],
  ["received", "Awaiting putaway"],
  ["putaway", "Completed"],
  ["all", "All"],
];

export default async function GoodsInList({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireStaff();
  const status = first((await searchParams).status) || "open";

  let q = supabase
    .from("goods_in")
    .select("id, number, reference, carrier, expected_date, received_at, status, source, notified_at, customers(name), goods_in_lines(pallets)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status === "open") q = q.in("status", ["expected", "received"]);
  else if (status !== "all") q = q.eq("status", status);
  const { data } = await q;

  return (
    <>
      <PageHeader title="Goods in" subtitle="Deliveries arriving at the warehouse">
        <Link href="/admin/goods-in/new" className="btn btn-primary">
          + New goods in
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={`/admin/goods-in?status=${k}`} className={`btn btn-sm ${status === k ? "btn-navy" : "btn-outline"}`}>
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
                  <th className="num">Pallets</th>
                  <th>Expected</th>
                  <th>Received</th>
                  <th>Status</th>
                  <th>Customer emailed</th>
                </tr>
              </thead>
              <tbody>
                {data.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <Link href={`/admin/goods-in/${g.id}`} className="link">
                        {g.number}
                      </Link>
                      {g.source === "portal" ? <span className="ml-2 text-xs text-gray-500">pre-advised</span> : null}
                    </td>
                    <td>{(g.customers as unknown as { name: string })?.name}</td>
                    <td>{g.reference ?? "—"}</td>
                    <td className="num">{(g.goods_in_lines as { pallets: number }[]).reduce((n, l) => n + l.pallets, 0)}</td>
                    <td>{fmtDate(g.expected_date)}</td>
                    <td>{fmtDate(g.received_at)}</td>
                    <td>
                      <StatusBadge status={g.status} />
                    </td>
                    <td>{g.notified_at ? fmtDate(g.notified_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <Empty>No deliveries here.</Empty>
        )}
      </Card>
    </>
  );
}
