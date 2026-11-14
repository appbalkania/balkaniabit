import Link from "next/link";
import { createGoodsOut } from "../actions";
import { requireStaff } from "@/lib/auth";
import { Card, Empty, Expiry, Field, Flash, PageHeader, TableWrap, ZoneBadge, first, type SP } from "@/components/ui";
import { Submit } from "@/components/client";
import { isUuid } from "@/lib/action";
import { qty, todayISO } from "@/lib/format";

export const metadata = { title: "New goods out" };

type Row = { description: string; temp_zone: string; unit: string; available: number; quantity: number; earliest: string | null; expired: number };

export default async function NewGoodsOut({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireStaff();
  const customerId = first((await searchParams).customer);
  const { data: customers } = await supabase.from("customers").select("id, name, account_ref").eq("is_active", true).order("name");

  // stock the customer has in a location, rolled up per product
  const rows: Row[] = [];
  if (isUuid(customerId)) {
    const today = todayISO();
    const { data: stock } = await supabase
      .from("pallets")
      .select("description, temp_zone, unit, quantity, expiry_date")
      .eq("customer_id", customerId)
      .eq("status", "stored")
      .order("description")
      .limit(5000);
    const map = new Map<string, Row>();
    for (const p of stock ?? []) {
      const key = p.description.toLowerCase();
      let r = map.get(key);
      if (!r) map.set(key, (r = { description: p.description, temp_zone: p.temp_zone, unit: p.unit, available: 0, quantity: 0, earliest: null, expired: 0 }));
      if (p.expiry_date && p.expiry_date < today) {
        r.expired += 1;
        continue;
      }
      r.available += 1;
      r.quantity += Number(p.quantity);
      if (p.expiry_date && (!r.earliest || p.expiry_date < r.earliest)) r.earliest = p.expiry_date;
    }
    rows.push(...map.values());
  }

  return (
    <>
      <PageHeader title="New goods out" subtitle="Release stock for collection or delivery">
        <Link href="/admin/goods-out" className="btn btn-outline">
          Cancel
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />

      <Card title="1. Customer" className="mb-5">
        <form method="get" className="flex flex-wrap items-end gap-3 p-4">
          <label className="block min-w-64 flex-1">
            <span className="label">Customer</span>
            <select className="input" name="customer" defaultValue={customerId} required>
              <option value="" disabled>
                Choose customer…
              </option>
              {(customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.account_ref})
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-outline">Show stock</button>
        </form>
      </Card>

      {isUuid(customerId) ? (
        <form action={createGoodsOut} className="space-y-5">
          <input type="hidden" name="customer_id" value={customerId} />
          <Card title="2. What is going out">
            {rows.length ? (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Goods</th>
                      <th>Storage</th>
                      <th className="num">Pallets available</th>
                      <th className="num">Total qty</th>
                      <th>Earliest expiry</th>
                      <th className="w-32">Pallets to release</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.description}>
                        <td className="font-medium">
                          {r.description}
                          {r.expired ? <div className="text-xs font-normal text-red-700">+ {r.expired} expired pallet{r.expired === 1 ? "" : "s"} (add by label on the order if they must go)</div> : null}
                        </td>
                        <td>
                          <ZoneBadge zone={r.temp_zone} />
                        </td>
                        <td className="num">{r.available}</td>
                        <td className="num">
                          {qty(r.quantity)} {r.unit}
                        </td>
                        <td>
                          <Expiry date={r.earliest} />
                        </td>
                        <td>
                          <input type="hidden" name="description" value={r.description} />
                          <input className="input" type="number" name="pallets" min={0} max={r.available} step={1} placeholder="0" aria-label={`Pallets of ${r.description}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <Empty>This customer has no pallets in a storage location.</Empty>
            )}
            <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
              Pallets are chosen automatically first-expiry-first-out (FEFO). Expired stock is never picked automatically.
            </p>
          </Card>

          <Card title="3. Collection details">
            <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Customer reference">
                <input className="input" name="reference" maxLength={60} />
              </Field>
              <Field label="Requested for">
                <input className="input" type="date" name="requested_date" defaultValue={todayISO()} />
              </Field>
              <Field label="Type">
                <select className="input" name="method" defaultValue="collection">
                  <option value="collection">Customer collection</option>
                  <option value="delivery">Delivery</option>
                </select>
              </Field>
              <Field label="Delivery address" hint="Only for deliveries">
                <input className="input" name="delivery_address" maxLength={300} />
              </Field>
              <Field label="Notes" className="sm:col-span-2 lg:col-span-4">
                <input className="input" name="notes" maxLength={300} />
              </Field>
            </div>
          </Card>
          {rows.length ? <Submit>Create order and allocate stock</Submit> : null}
        </form>
      ) : null}
    </>
  );
}
