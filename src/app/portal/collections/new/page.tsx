import Link from "next/link";
import { requestCollection } from "../../actions";
import { requireCustomer } from "@/lib/auth";
import { Card, Empty, Expiry, Field, Flash, PageHeader, TableWrap, ZoneBadge, type SP } from "@/components/ui";
import { CheckAll, Submit } from "@/components/client";
import { addDays, fmtDate, qty, todayISO } from "@/lib/format";

export const metadata = { title: "Request a collection" };

export default async function NewCollection({ searchParams }: { searchParams: SP }) {
  const { supabase, customerId } = await requireCustomer();
  const { data: pallets } = await supabase
    .from("pallets")
    .select("id, label, description, temp_zone, quantity, unit, batch_no, expiry_date, received_at")
    .eq("customer_id", customerId)
    .eq("status", "stored")
    .order("description")
    .order("expiry_date", { nullsFirst: false })
    .limit(2000);

  return (
    <>
      <PageHeader title="Request a collection" subtitle="Tick the pallets you want. Earliest expiry is listed first for each product.">
        <Link href="/portal/collections" className="btn btn-outline">
          Cancel
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />
      <form action={requestCollection} className="space-y-5">
        <Card title="Pallets available">
          {pallets?.length ? (
            <TableWrap>
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="w-8">
                      <CheckAll name="pallet_id" />
                    </th>
                    <th>Goods</th>
                    <th>Storage</th>
                    <th>Batch</th>
                    <th>Expiry</th>
                    <th className="num">Qty</th>
                    <th>Pallet</th>
                    <th>In since</th>
                  </tr>
                </thead>
                <tbody>
                  {pallets.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <input type="checkbox" name="pallet_id" value={p.id} aria-label={`Select ${p.label}`} />
                      </td>
                      <td className="font-medium">{p.description}</td>
                      <td>
                        <ZoneBadge zone={p.temp_zone} />
                      </td>
                      <td>{p.batch_no ?? "—"}</td>
                      <td>
                        <Expiry date={p.expiry_date} />
                      </td>
                      <td className="num">
                        {qty(p.quantity)} {p.unit}
                      </td>
                      <td className="font-mono text-xs">{p.label}</td>
                      <td>{fmtDate(p.received_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <Empty>No pallets are available to collect right now.</Empty>
          )}
        </Card>
        <Card title="Collection details">
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Collection date">
              <input className="input" type="date" name="requested_date" min={todayISO()} defaultValue={addDays(todayISO(), 1)} required />
            </Field>
            <Field label="Your reference">
              <input className="input" name="reference" maxLength={60} />
            </Field>
            <Field label="Type">
              <select className="input" name="method" defaultValue="collection">
                <option value="collection">We will collect</option>
                <option value="delivery">Please deliver</option>
              </select>
            </Field>
            <Field label="Delivery address" hint="Only if we are delivering">
              <input className="input" name="delivery_address" maxLength={300} />
            </Field>
            <Field label="Notes (haulier, vehicle, time slot…)" className="sm:col-span-2 lg:col-span-4">
              <input className="input" name="notes" maxLength={300} />
            </Field>
          </div>
        </Card>
        {pallets?.length ? <Submit>Send request</Submit> : null}
      </form>
    </>
  );
}
