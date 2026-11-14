import Link from "next/link";
import { notFound } from "next/navigation";
import { addPallet, allocate, cancelGoodsOut, dispatch, pickAll, pickPallet, removePallet, resendGoodsOutEmail } from "../actions";
import { requireStaff } from "@/lib/auth";
import { Card, Empty, Expiry, Field, Flash, PageHeader, StatusBadge, TableWrap, ZoneBadge, type SP } from "@/components/ui";
import { PrintButton, Submit } from "@/components/client";
import { fmtDate, fmtDateTime, qty, todayISO } from "@/lib/format";

export const metadata = { title: "Goods out" };

type Pallet = { id: string; label: string; description: string; temp_zone: string; quantity: number; unit: string; batch_no: string | null; expiry_date: string | null; status: string; locations: { code: string } | null };

export default async function GoodsOutDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const { supabase } = await requireStaff();
  const { data: o } = await supabase.from("goods_out").select("*, customers(name, account_ref, email), goods_out_lines(*)").eq("id", id).maybeSingle();
  if (!o) notFound();
  const { data: palletData } = await supabase
    .from("pallets")
    .select("id, label, description, temp_zone, quantity, unit, batch_no, expiry_date, status, locations(code)")
    .eq("goods_out_id", id)
    .order("label");
  // walk order for the picker: by location
  const pallets = ((palletData ?? []) as unknown as Pallet[]).sort((a, b) => (a.locations?.code ?? "").localeCompare(b.locations?.code ?? ""));
  const lines = (o.goods_out_lines as { id: number; description: string; pallets: number }[]).sort((a, b) => a.id - b.id);
  const customer = o.customers as { name: string; account_ref: string; email: string | null };
  const open = !["dispatched", "cancelled"].includes(o.status);
  const requested = lines.reduce((n, l) => n + l.pallets, 0);
  const toPick = pallets.filter((p) => p.status === "allocated").length;
  const path = `/admin/goods-out/${id}`;

  return (
    <>
      <PageHeader
        title={`Goods out ${o.number}`}
        subtitle={
          <>
            {customer.name} ({customer.account_ref}) · <StatusBadge status={o.status} />
            {o.source === "portal" ? " · requested by customer in the portal" : ""}
          </>
        }
      >
        <PrintButton>Print pick list</PrintButton>
        {o.status === "dispatched" ? (
          <form action={resendGoodsOutEmail}>
            <input type="hidden" name="id" value={id} />
            <Submit className="btn btn-outline">{o.notified_at ? "Re-send customer email" : "Send customer email"}</Submit>
          </form>
        ) : null}
        {open ? (
          <form action={cancelGoodsOut}>
            <input type="hidden" name="id" value={id} />
            <Submit className="btn btn-danger" confirm="Cancel this order and return its pallets to stock?">
              Cancel order
            </Submit>
          </form>
        ) : null}
        <Link href="/admin/goods-out" className="btn btn-outline">
          Back
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />

      <div className="card mb-5 grid grid-cols-2 gap-4 p-4 text-sm md:grid-cols-5">
        <Info label="Reference" value={o.reference ?? "—"} />
        <Info label="Type" value={o.method === "delivery" ? "Delivery" : "Customer collection"} />
        <Info label="Requested for" value={fmtDate(o.requested_date)} />
        <Info label="Dispatched" value={fmtDateTime(o.dispatched_at)} />
        <Info label="Customer emailed" value={o.notified_at ? fmtDateTime(o.notified_at) : open ? "On dispatch" : "—"} />
        {o.collected_by ? <Info label="Collected by" value={o.collected_by} /> : null}
        {o.delivery_address ? <Info label="Deliver to" value={o.delivery_address} className="col-span-2" /> : null}
        {o.notes ? <Info label="Notes" value={o.notes} className="col-span-2 md:col-span-5" /> : null}
      </div>

      {lines.length && open && pallets.length < requested ? (
        <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            {pallets.length} of {requested} requested pallets allocated ({lines.map((l) => `${l.pallets} × ${l.description}`).join(", ")}).
          </span>
          <form action={allocate}>
            <input type="hidden" name="id" value={id} />
            <Submit className="btn btn-navy btn-sm">Allocate stock (FEFO)</Submit>
          </form>
        </div>
      ) : null}

      <Card
        title={`Pallets on this order – ${pallets.length}`}
        actions={
          open && toPick > 0 ? (
            <form action={pickAll}>
              <input type="hidden" name="id" value={id} />
              <Submit className="btn btn-outline btn-sm" confirm={`Mark all ${toPick} pallets as picked?`}>
                Mark all picked
              </Submit>
            </form>
          ) : null
        }
      >
        {pallets.length ? (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Pallet</th>
                  <th>Goods</th>
                  <th>Storage</th>
                  <th>Batch</th>
                  <th>Expiry</th>
                  <th className="num">Qty</th>
                  <th>Status</th>
                  <th className="no-print"></th>
                </tr>
              </thead>
              <tbody>
                {pallets.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono font-semibold">{p.locations?.code ?? "—"}</td>
                    <td className="font-mono text-xs">{p.label}</td>
                    <td>{p.description}</td>
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
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="no-print">
                      {open ? (
                        <div className="flex justify-end gap-1.5">
                          {p.status === "allocated" ? (
                            <form action={pickPallet}>
                              <input type="hidden" name="pallet_id" value={p.id} />
                              <input type="hidden" name="label" value={p.label} />
                              <input type="hidden" name="return_to" value={path} />
                              <Submit className="btn btn-primary btn-sm">Picked</Submit>
                            </form>
                          ) : null}
                          <form action={removePallet}>
                            <input type="hidden" name="id" value={id} />
                            <input type="hidden" name="pallet_id" value={p.id} />
                            <Submit className="btn btn-danger btn-sm">Remove</Submit>
                          </form>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <Empty>No pallets allocated yet.</Empty>
        )}
      </Card>

      {open ? (
        <div className="no-print mt-5 grid gap-5 lg:grid-cols-2">
          <Card title="Add a specific pallet">
            <form action={addPallet} className="flex items-end gap-3 p-4">
              <input type="hidden" name="id" value={id} />
              <Field label="Pallet label" hint="Scan or type, e.g. PAL-0000123. Use this when the customer wants a particular batch." className="flex-1">
                <input className="input font-mono uppercase" name="label" placeholder="PAL-" required autoComplete="off" />
              </Field>
              <Submit className="btn btn-outline">Add</Submit>
            </form>
          </Card>
          <Card title="Dispatch">
            <form action={dispatch} className="grid gap-3 p-4 sm:grid-cols-2">
              <input type="hidden" name="id" value={id} />
              <Field label="Collected by" hint="Driver / haulier / vehicle reg">
                <input className="input" name="collected_by" maxLength={80} defaultValue={o.collected_by ?? ""} />
              </Field>
              <Field label="Date left">
                <input className="input" type="date" name="dispatched_date" defaultValue={todayISO()} max={todayISO()} required />
              </Field>
              <div className="sm:col-span-2">
                <p className="mb-2 text-xs text-gray-500">
                  Every pallet must be picked first. Storage charging stops from this date, and the customer is emailed what was collected (with expiry dates) and everything that remains in the warehouse.
                </p>
                <Submit className="btn btn-primary w-full" confirm={`Dispatch ${pallets.length} pallets and email the customer?`}>
                  Dispatch {pallets.length} pallet{pallets.length === 1 ? "" : "s"}
                </Submit>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </>
  );
}

function Info({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs font-medium tracking-wide text-gray-500 uppercase">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}
