import Link from "next/link";
import { notFound } from "next/navigation";
import { adjustPallet } from "../actions";
import { putawayPallet } from "../../goods-in/actions";
import { requireStaff } from "@/lib/auth";
import { Card, Expiry, Field, Flash, PageHeader, StatusBadge, TableWrap, ZoneBadge, type SP } from "@/components/ui";
import { Submit } from "@/components/client";
import { fmtDateTime, qty } from "@/lib/format";

export const metadata = { title: "Pallet" };

const MOVE_LABEL: Record<string, string> = {
  receive: "Received",
  putaway: "Put away",
  move: "Moved",
  allocate: "Allocated to order",
  deallocate: "Released from order",
  pick: "Picked",
  dispatch: "Dispatched",
  adjust: "Adjusted",
};

export default async function PalletDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const { supabase } = await requireStaff();
  const { data: p } = await supabase
    .from("pallets")
    .select("*, customers(name), locations(code), goods_in(id, number), goods_out(id, number)")
    .eq("id", id)
    .maybeSingle();
  if (!p) notFound();

  const [{ data: moves }, { data: free }] = await Promise.all([
    supabase
      .from("stock_movements")
      .select("id, type, note, created_at, user_id, from_loc:locations!stock_movements_from_location_id_fkey(code), to_loc:locations!stock_movements_to_location_id_fkey(code)")
      .eq("pallet_id", id)
      .order("id"),
    supabase.from("location_usage").select("code, capacity, used").eq("is_active", true).eq("zone", p.temp_zone).order("code").limit(1000),
  ]);
  const { data: staff } = await supabase.from("profiles").select("id, full_name, email");
  const who = new Map((staff ?? []).map((s) => [s.id, s.full_name || s.email || "staff"]));
  const movable = p.status === "received" || p.status === "stored";
  const editable = p.status !== "dispatched";
  const goodsIn = p.goods_in as { id: string; number: string } | null;
  const goodsOut = p.goods_out as { id: string; number: string } | null;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={p.label}
        subtitle={
          <>
            {(p.customers as { name: string }).name} · {p.description} · <ZoneBadge zone={p.temp_zone} /> <StatusBadge status={p.status} />
          </>
        }
      >
        <Link href="/admin/stock" className="btn btn-outline">
          Back to stock
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />

      <div className="card mb-5 grid grid-cols-2 gap-4 p-4 text-sm md:grid-cols-4">
        <Info label="Location" value={(p.locations as { code: string } | null)?.code ?? "Not located"} />
        <Info label="Quantity" value={`${qty(p.quantity)} ${p.unit}`} />
        <Info label="Batch" value={p.batch_no ?? "—"} />
        <div>
          <div className="text-xs font-medium tracking-wide text-gray-500 uppercase">Expiry</div>
          <div className="mt-0.5 font-medium">{editable ? <Expiry date={p.expiry_date} /> : (p.expiry_date ?? "—")}</div>
        </div>
        <Info label="Received" value={fmtDateTime(p.received_at)} />
        <Info label="Dispatched" value={fmtDateTime(p.dispatched_at)} />
        <div>
          <div className="text-xs font-medium tracking-wide text-gray-500 uppercase">Goods in</div>
          {goodsIn ? (
            <Link className="link" href={`/admin/goods-in/${goodsIn.id}`}>
              {goodsIn.number}
            </Link>
          ) : (
            "—"
          )}
        </div>
        <div>
          <div className="text-xs font-medium tracking-wide text-gray-500 uppercase">Goods out</div>
          {goodsOut ? (
            <Link className="link" href={`/admin/goods-out/${goodsOut.id}`}>
              {goodsOut.number}
            </Link>
          ) : (
            "—"
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {movable ? (
          <Card title={p.location_id ? "Move to another location" : "Put away"}>
            <form action={putawayPallet} className="flex items-end gap-3 p-4">
              <input type="hidden" name="id" value={p.goods_in_id ?? ""} />
              <input type="hidden" name="pallet_id" value={p.id} />
              <input type="hidden" name="return_to" value={`/admin/stock/${p.id}`} />
              <Field label={`${p.temp_zone} location`} hint="Scan or type the location code" className="flex-1">
                <input className="input font-mono uppercase" name="location" list="free-locations" required autoComplete="off" />
              </Field>
              <datalist id="free-locations">
                {(free ?? [])
                  .filter((l) => l.used < l.capacity)
                  .map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.capacity - l.used} free
                    </option>
                  ))}
              </datalist>
              <Submit>{p.location_id ? "Move" : "Put away"}</Submit>
            </form>
          </Card>
        ) : null}

        {editable ? (
          <Card title="Correct details">
            <form action={adjustPallet} className="grid gap-3 p-4 sm:grid-cols-2">
              <input type="hidden" name="pallet_id" value={p.id} />
              <Field label={`Quantity (${p.unit})`}>
                <input className="input" type="number" name="quantity" min={0} step="0.01" defaultValue={p.quantity} required />
              </Field>
              <Field label="Expiry date">
                <input className="input" type="date" name="expiry_date" defaultValue={p.expiry_date ?? ""} />
              </Field>
              <Field label="Batch">
                <input className="input" name="batch_no" defaultValue={p.batch_no ?? ""} maxLength={40} />
              </Field>
              <Field label="Reason for change">
                <input className="input" name="reason" maxLength={120} placeholder="e.g. damaged cases removed" />
              </Field>
              <Field label="Notes" className="sm:col-span-2">
                <input className="input" name="notes" defaultValue={p.notes ?? ""} maxLength={300} />
              </Field>
              <div>
                <Submit className="btn btn-outline">Save changes</Submit>
              </div>
            </form>
          </Card>
        ) : null}
      </div>

      <Card title="History" className="mt-5">
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>From</th>
                <th>To</th>
                <th>By</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {(moves ?? []).map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(m.created_at)}</td>
                  <td>{MOVE_LABEL[m.type] ?? m.type}</td>
                  <td className="font-mono text-xs">{(m.from_loc as unknown as { code: string } | null)?.code ?? ""}</td>
                  <td className="font-mono text-xs">{(m.to_loc as unknown as { code: string } | null)?.code ?? ""}</td>
                  <td>{m.user_id ? (who.get(m.user_id) ?? "customer") : "system"}</td>
                  <td className="text-gray-600">{m.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium tracking-wide text-gray-500 uppercase">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}
