import Link from "next/link";
import { sendExpiryNow } from "./actions";
import { requireStaff } from "@/lib/auth";
import { Card, Empty, Expiry, Flash, PageHeader, StatusBadge, TableWrap, ZoneBadge, first, type SP } from "@/components/ui";
import { PrintButton, Submit } from "@/components/client";
import { isUuid } from "@/lib/action";
import { addDays, qty, todayISO } from "@/lib/format";

export const metadata = { title: "Expiry dates" };

export default async function ExpiryReport({ searchParams }: { searchParams: SP }) {
  const { supabase, profile } = await requireStaff();
  const sp = await searchParams;
  const { data: s } = await supabase.from("company_settings").select("expiry_alert_days").single();
  const days = Math.min(Math.max(Number(first(sp.days)) || s?.expiry_alert_days || 30, 1), 3650);
  const customer = first(sp.customer);
  const cutoff = addDays(todayISO(), days);

  let q = supabase
    .from("pallets")
    .select("id, label, description, temp_zone, quantity, unit, batch_no, expiry_date, status, customers(name), locations(code)")
    .neq("status", "dispatched")
    .not("expiry_date", "is", null)
    .lte("expiry_date", cutoff)
    .order("expiry_date")
    .limit(1000);
  if (isUuid(customer)) q = q.eq("customer_id", customer);
  const [{ data }, { data: customers }] = await Promise.all([q, supabase.from("customers").select("id, name").order("name")]);
  const today = todayISO();
  const expired = (data ?? []).filter((p) => (p.expiry_date ?? "") < today).length;

  return (
    <>
      <PageHeader title="Expiry dates" subtitle={`${data?.length ?? 0} pallets expired or expiring within ${days} days · ${expired} already expired`}>
        <PrintButton />
        {profile.role !== "warehouse" ? (
          <form action={sendExpiryNow}>
            <Submit className="btn btn-outline" confirm="Email every customer with expiring stock now?">
              Email customers now
            </Submit>
          </form>
        ) : null}
      </PageHeader>
      <Flash searchParams={searchParams} />
      <form method="get" className="card no-print mb-4 flex flex-wrap items-end gap-3 p-4">
        <label className="block">
          <span className="label">Within (days)</span>
          <input className="input w-28" type="number" name="days" min={1} max={3650} defaultValue={days} />
        </label>
        <label className="block min-w-56">
          <span className="label">Customer</span>
          <select className="input" name="customer" defaultValue={customer}>
            <option value="">All customers</option>
            {(customers ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-navy">Show</button>
      </form>
      <Card>
        {data?.length ? (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Expiry</th>
                  <th>Customer</th>
                  <th>Goods</th>
                  <th>Batch</th>
                  <th>Storage</th>
                  <th>Location</th>
                  <th>Pallet</th>
                  <th className="num">Qty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Expiry date={p.expiry_date} alertDays={days} />
                    </td>
                    <td>{(p.customers as unknown as { name: string })?.name}</td>
                    <td>{p.description}</td>
                    <td>{p.batch_no ?? "—"}</td>
                    <td>
                      <ZoneBadge zone={p.temp_zone} />
                    </td>
                    <td className="font-mono text-xs">{(p.locations as unknown as { code: string } | null)?.code ?? "—"}</td>
                    <td>
                      <Link href={`/admin/stock/${p.id}`} className="link font-mono text-xs">
                        {p.label}
                      </Link>
                    </td>
                    <td className="num">
                      {qty(p.quantity)} {p.unit}
                    </td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <Empty>Nothing expiring in that window.</Empty>
        )}
      </Card>
      <p className="no-print mt-2 text-xs text-gray-500">Customers with stock in their alert window are emailed automatically every Monday morning.</p>
    </>
  );
}
