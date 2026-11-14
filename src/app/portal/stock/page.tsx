import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { Card, Empty, Expiry, PageHeader, StatusBadge, TableWrap, ZoneBadge, first, type SP } from "@/components/ui";
import { PrintButton } from "@/components/client";
import { fmtDate, qty } from "@/lib/format";

export const metadata = { title: "Stock & expiry" };

export default async function PortalStock({ searchParams }: { searchParams: SP }) {
  const { supabase, customerId } = await requireCustomer();
  const view = first((await searchParams).view) === "pallets" ? "pallets" : "summary";
  const [{ data: summary }, { data: pallets }, { data: c }] = await Promise.all([
    supabase.from("stock_summary").select("*").eq("customer_id", customerId).order("expiry_date", { nullsFirst: false }).order("description"),
    view === "pallets"
      ? supabase.from("pallets").select("id, label, description, temp_zone, quantity, unit, batch_no, expiry_date, status, received_at, locations(code)").eq("customer_id", customerId).neq("status", "dispatched").order("expiry_date", { nullsFirst: false }).limit(2000)
      : Promise.resolve({ data: [] }),
    supabase.from("customers").select("expiry_alert_days").eq("id", customerId).single(),
  ]);
  const total = (summary ?? []).reduce((n, s) => n + s.pallets, 0);
  const alert = c?.expiry_alert_days ?? 30;

  return (
    <>
      <PageHeader title="Stock & expiry" subtitle={`${total} pallets in our warehouse`}>
        <PrintButton />
        <Link href="/portal/collections/new" className="btn btn-primary">
          Request a collection
        </Link>
      </PageHeader>
      <div className="no-print mb-3 flex gap-1.5">
        <Link href="/portal/stock" className={`btn btn-sm ${view === "summary" ? "btn-navy" : "btn-outline"}`}>
          By product
        </Link>
        <Link href="/portal/stock?view=pallets" className={`btn btn-sm ${view === "pallets" ? "btn-navy" : "btn-outline"}`}>
          Every pallet
        </Link>
      </div>
      <Card>
        {view === "summary" ? (
          summary?.length ? (
            <TableWrap>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Goods</th>
                    <th>Storage</th>
                    <th>Batch</th>
                    <th>Expiry</th>
                    <th className="num">Pallets</th>
                    <th className="num">Being collected</th>
                    <th className="num">Total qty</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s, i) => (
                    <tr key={i}>
                      <td className="font-medium">{s.description}</td>
                      <td>
                        <ZoneBadge zone={s.temp_zone} />
                      </td>
                      <td>{s.batch_no ?? "—"}</td>
                      <td>
                        <Expiry date={s.expiry_date} alertDays={alert} />
                      </td>
                      <td className="num">{s.pallets}</td>
                      <td className="num">{s.pallets_on_order || ""}</td>
                      <td className="num">
                        {qty(s.quantity)} {s.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <Empty>You have no stock with us at the moment.</Empty>
          )
        ) : pallets?.length ? (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Pallet</th>
                  <th>Goods</th>
                  <th>Storage</th>
                  <th>Location</th>
                  <th>Batch</th>
                  <th>Expiry</th>
                  <th className="num">Qty</th>
                  <th>Received</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pallets.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono text-xs">{p.label}</td>
                    <td>{p.description}</td>
                    <td>
                      <ZoneBadge zone={p.temp_zone} />
                    </td>
                    <td className="font-mono text-xs">{(p.locations as unknown as { code: string } | null)?.code ?? "—"}</td>
                    <td>{p.batch_no ?? "—"}</td>
                    <td>
                      <Expiry date={p.expiry_date} alertDays={alert} />
                    </td>
                    <td className="num">
                      {qty(p.quantity)} {p.unit}
                    </td>
                    <td>{fmtDate(p.received_at)}</td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <Empty>You have no stock with us at the moment.</Empty>
        )}
      </Card>
    </>
  );
}
