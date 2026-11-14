import Link from "next/link";
import { pickPallet } from "../goods-out/actions";
import { requireStaff } from "@/lib/auth";
import { Card, Empty, Expiry, Flash, PageHeader, ZoneBadge, type SP } from "@/components/ui";
import { Submit } from "@/components/client";
import { fmtDate, qty } from "@/lib/format";

export const metadata = { title: "Pick list" };

type Row = {
  id: string;
  label: string;
  description: string;
  temp_zone: string;
  quantity: number;
  unit: string;
  batch_no: string | null;
  expiry_date: string | null;
  locations: { code: string } | null;
  goods_out: { id: string; number: string; requested_date: string | null; customers: { name: string } };
};

// Picker's screen, built for a phone or handheld: big rows in walking order (by location),
// one tap or one scan per pallet.
export default async function PickList({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireStaff();
  const { data } = await supabase
    .from("pallets")
    .select("id, label, description, temp_zone, quantity, unit, batch_no, expiry_date, locations(code), goods_out!inner(id, number, requested_date, customers(name))")
    .eq("status", "allocated")
    .limit(500);
  const rows = ((data ?? []) as unknown as Row[]).sort(
    (a, b) =>
      (a.goods_out.requested_date ?? "9999").localeCompare(b.goods_out.requested_date ?? "9999") ||
      a.goods_out.number.localeCompare(b.goods_out.number) ||
      (a.locations?.code ?? "").localeCompare(b.locations?.code ?? "")
  );
  const orders = new Map<string, Row[]>();
  for (const r of rows) orders.set(r.goods_out.id, [...(orders.get(r.goods_out.id) ?? []), r]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Pick list" subtitle={`${rows.length} pallet${rows.length === 1 ? "" : "s"} to pick across ${orders.size} order${orders.size === 1 ? "" : "s"}`} />
      <Flash searchParams={searchParams} />

      <form action={pickPallet} className="card mb-5 flex items-end gap-3 p-4">
        <label className="block flex-1">
          <span className="label">Scan pallet label to confirm pick</span>
          <input className="input font-mono text-lg uppercase" name="label" placeholder="PAL-" required autoFocus autoComplete="off" />
        </label>
        <Submit className="btn btn-primary">Pick</Submit>
      </form>

      {orders.size === 0 ? (
        <Card>
          <Empty>Nothing to pick right now.</Empty>
        </Card>
      ) : null}

      <div className="space-y-5">
        {[...orders.values()].map((list) => {
          const o = list[0].goods_out;
          return (
            <Card
              key={o.id}
              title={
                <>
                  <Link href={`/admin/goods-out/${o.id}`} className="link">
                    {o.number}
                  </Link>{" "}
                  · {o.customers.name} · for {fmtDate(o.requested_date)}
                </>
              }
            >
              <ul className="divide-y divide-gray-100">
                {list.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="bg-navy w-24 shrink-0 rounded-md px-2 py-2 text-center font-mono text-sm font-bold text-white">{p.locations?.code ?? "?"}</div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{p.description}</div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
                        <span className="font-mono">{p.label}</span>
                        <ZoneBadge zone={p.temp_zone} />
                        <span>
                          {qty(p.quantity)} {p.unit}
                        </span>
                        {p.batch_no ? <span>Batch {p.batch_no}</span> : null}
                        <Expiry date={p.expiry_date} />
                      </div>
                    </div>
                    <form action={pickPallet}>
                      <input type="hidden" name="pallet_id" value={p.id} />
                      <input type="hidden" name="label" value={p.label} />
                      <Submit className="btn btn-primary">Picked</Submit>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
