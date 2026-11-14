import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { Card, Empty, Flash, PageHeader, StatusBadge, TableWrap, type SP } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Deliveries in" };

export default async function PortalDeliveries({ searchParams }: { searchParams: SP }) {
  const { supabase, customerId } = await requireCustomer();
  const { data } = await supabase
    .from("goods_in")
    .select("id, number, reference, expected_date, received_at, status, goods_in_lines(pallets)")
    .eq("customer_id", customerId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <>
      <PageHeader title="Deliveries in">
        <Link href="/portal/deliveries/new" className="btn btn-primary">
          Pre-advise a delivery
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
                  <th className="num">Pallets</th>
                  <th>Expected</th>
                  <th>Received</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.map((g) => (
                  <tr key={g.id}>
                    <td>{g.number}</td>
                    <td>{g.reference ?? "—"}</td>
                    <td className="num">{(g.goods_in_lines as { pallets: number }[]).reduce((n, l) => n + l.pallets, 0)}</td>
                    <td>{fmtDate(g.expected_date)}</td>
                    <td>{fmtDate(g.received_at)}</td>
                    <td>
                      <StatusBadge status={g.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <Empty>No deliveries yet.</Empty>
        )}
      </Card>
    </>
  );
}
