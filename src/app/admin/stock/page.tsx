import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { Card, Empty, Expiry, Flash, PageHeader, StatusBadge, TableWrap, ZoneBadge, first, type SP } from "@/components/ui";
import { isUuid } from "@/lib/action";
import { ZONES, fmtDate, qty, zoneLabel } from "@/lib/format";

export const metadata = { title: "Stock" };

const PAGE = 200;

export default async function Stock({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireStaff();
  const sp = await searchParams;
  const customer = first(sp.customer);
  const zone = first(sp.zone);
  const status = first(sp.status) || "in_store";
  const search = first(sp.q).replace(/[%,()]/g, " ").trim();

  let q = supabase
    .from("pallets")
    .select("id, label, description, temp_zone, quantity, unit, batch_no, expiry_date, status, received_at, customers(name), locations(code)", { count: "exact" })
    .order("received_at", { ascending: false })
    .limit(PAGE);
  if (isUuid(customer)) q = q.eq("customer_id", customer);
  if ((ZONES as string[]).includes(zone)) q = q.eq("temp_zone", zone);
  if (status === "in_store") q = q.neq("status", "dispatched");
  else if (status !== "all") q = q.eq("status", status);
  if (search) q = q.or(`label.ilike.%${search}%,description.ilike.%${search}%,batch_no.ilike.%${search}%`);

  const [{ data, count }, { data: customers }] = await Promise.all([q, supabase.from("customers").select("id, name").order("name")]);

  return (
    <>
      <PageHeader title="Stock" subtitle={`${count ?? 0} pallet${count === 1 ? "" : "s"} match${count === 1 ? "es" : ""}`} />
      <Flash searchParams={searchParams} />
      <form method="get" className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block">
          <span className="label">Search</span>
          <input className="input" name="q" defaultValue={search} placeholder="Label, goods or batch" />
        </label>
        <label className="block">
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
        <label className="block">
          <span className="label">Storage</span>
          <select className="input" name="zone" defaultValue={zone}>
            <option value="">All</option>
            {ZONES.map((z) => (
              <option key={z} value={z}>
                {zoneLabel(z)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Status</span>
          <select className="input" name="status" defaultValue={status}>
            <option value="in_store">In the warehouse</option>
            <option value="received">Awaiting putaway</option>
            <option value="stored">Stored</option>
            <option value="allocated">Allocated to an order</option>
            <option value="picked">Picked</option>
            <option value="dispatched">Dispatched</option>
            <option value="all">Everything</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className="btn btn-navy">Filter</button>
          <Link href="/admin/stock" className="btn btn-outline">
            Reset
          </Link>
        </div>
      </form>

      <Card>
        {data?.length ? (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Pallet</th>
                  <th>Customer</th>
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
                {data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/admin/stock/${p.id}`} className="link font-mono text-xs">
                        {p.label}
                      </Link>
                    </td>
                    <td>{(p.customers as unknown as { name: string })?.name}</td>
                    <td>{p.description}</td>
                    <td>
                      <ZoneBadge zone={p.temp_zone} />
                    </td>
                    <td className="font-mono text-xs">{(p.locations as unknown as { code: string } | null)?.code ?? "—"}</td>
                    <td>{p.batch_no ?? "—"}</td>
                    <td>{p.status === "dispatched" ? fmtDate(p.expiry_date) : <Expiry date={p.expiry_date} />}</td>
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
          <Empty>No pallets match.</Empty>
        )}
        {(count ?? 0) > PAGE ? <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">Showing the newest {PAGE} of {count}. Narrow the filters to see the rest.</p> : null}
      </Card>
    </>
  );
}
