import Link from "next/link";
import { notFound } from "next/navigation";
import { addLines, cancelGoodsIn, deleteLine, putawayLine, receiveGoodsIn, resendGoodsInEmail } from "../actions";
import { requireStaff } from "@/lib/auth";
import { Card, Empty, Expiry, Flash, PageHeader, StatusBadge, TableWrap, ZoneBadge, type SP } from "@/components/ui";
import { GoodsInLineRows } from "@/components/forms";
import { Submit } from "@/components/client";
import { ZONES, fmtDate, fmtDateTime, qty, todayISO } from "@/lib/format";

export const metadata = { title: "Goods in" };

type Line = { id: number; description: string; temp_zone: string; pallets: number; quantity_per_pallet: number; unit: string; batch_no: string | null; expiry_date: string | null };
type Pallet = { id: string; label: string; description: string; temp_zone: string; quantity: number; unit: string; batch_no: string | null; expiry_date: string | null; status: string; goods_in_line_id: number | null; locations: { code: string } | null };

export default async function GoodsInDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const { supabase } = await requireStaff();

  const { data: g } = await supabase
    .from("goods_in")
    .select("*, customers(name, account_ref, email), goods_in_lines(*)")
    .eq("id", id)
    .maybeSingle();
  if (!g) notFound();
  const lines = [...(g.goods_in_lines as Line[])].sort((a, b) => a.id - b.id);
  const customer = g.customers as { name: string; account_ref: string; email: string | null };
  const isExpected = g.status === "expected";
  const isIn = g.status === "received" || g.status === "putaway";

  const [{ data: palletData }, { data: free }] = await Promise.all([
    isIn
      ? supabase.from("pallets").select("id, label, description, temp_zone, quantity, unit, batch_no, expiry_date, status, goods_in_line_id, locations(code)").eq("goods_in_id", id).order("label")
      : Promise.resolve({ data: [] }),
    g.status === "received"
      ? supabase.from("location_usage").select("code, zone, capacity, used").eq("is_active", true).order("code").limit(1000)
      : Promise.resolve({ data: [] }),
  ]);
  const pallets = (palletData ?? []) as unknown as Pallet[];
  const freeLocs = (free ?? []).filter((l) => l.used < l.capacity);
  const waiting = (lineId: number) => pallets.filter((p) => p.goods_in_line_id === lineId && p.status === "received").length;
  const totalPallets = lines.reduce((n, l) => n + l.pallets, 0);

  return (
    <>
      <PageHeader
        title={`Goods in ${g.number}`}
        subtitle={
          <>
            {customer.name} ({customer.account_ref}) · <StatusBadge status={g.status} />
          </>
        }
      >
        {isIn ? (
          <Link href={`/admin/goods-in/${id}/labels`} className="btn btn-outline">
            Print pallet labels
          </Link>
        ) : null}
        {g.status === "putaway" ? (
          <form action={resendGoodsInEmail}>
            <input type="hidden" name="id" value={id} />
            <Submit className="btn btn-outline">{g.notified_at ? "Re-send customer email" : "Send customer email"}</Submit>
          </form>
        ) : null}
        {isExpected ? (
          <form action={cancelGoodsIn}>
            <input type="hidden" name="id" value={id} />
            <Submit className="btn btn-danger" confirm="Cancel this delivery?">
              Cancel delivery
            </Submit>
          </form>
        ) : null}
        <Link href="/admin/goods-in" className="btn btn-outline">
          Back
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />

      <div className="card mb-5 grid grid-cols-2 gap-4 p-4 text-sm md:grid-cols-5">
        <Info label="Reference" value={g.reference ?? "—"} />
        <Info label="Carrier" value={g.carrier ?? "—"} />
        <Info label="Expected" value={fmtDate(g.expected_date)} />
        <Info label="Received" value={fmtDateTime(g.received_at)} />
        <Info label="Customer emailed" value={g.notified_at ? fmtDateTime(g.notified_at) : isIn ? "When fully put away" : "—"} />
        {g.notes ? <Info label="Notes" value={g.notes} className="col-span-2 md:col-span-5" /> : null}
      </div>

      {g.status === "putaway" && !g.notified_at ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The goods-received email has not gone to the customer{customer.email ? "" : " (no email address on the customer record)"}. Use “Send customer email” above once fixed.
        </div>
      ) : null}

      <Card title={`Goods – ${totalPallets} pallet${totalPallets === 1 ? "" : "s"}`}>
        {lines.length ? (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Goods</th>
                  <th>Storage</th>
                  <th className="num">Pallets</th>
                  <th className="num">Qty / pallet</th>
                  <th>Batch</th>
                  <th>Expiry</th>
                  <th>{g.status === "received" ? "Put away to location" : ""}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="font-medium">{l.description}</td>
                    <td>
                      <ZoneBadge zone={l.temp_zone} />
                    </td>
                    <td className="num">{l.pallets}</td>
                    <td className="num">
                      {qty(l.quantity_per_pallet)} {l.unit}
                    </td>
                    <td>{l.batch_no ?? "—"}</td>
                    <td>
                      <Expiry date={l.expiry_date} />
                    </td>
                    <td>
                      {isExpected ? (
                        <form action={deleteLine}>
                          <input type="hidden" name="id" value={id} />
                          <input type="hidden" name="line_id" value={l.id} />
                          <Submit className="btn btn-danger btn-sm">Remove</Submit>
                        </form>
                      ) : g.status === "received" && waiting(l.id) > 0 ? (
                        <form action={putawayLine} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={id} />
                          <input type="hidden" name="line_id" value={l.id} />
                          <input className="input w-36 font-mono uppercase" name="location" list={`loc-${l.temp_zone}`} placeholder="Scan / type" required autoComplete="off" aria-label="Location code" />
                          <Submit className="btn btn-primary btn-sm">Put away {waiting(l.id)}</Submit>
                        </form>
                      ) : isIn ? (
                        <span className="text-xs text-emerald-700">All located</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <Empty>No lines yet.</Empty>
        )}
        {ZONES.map((z) => (
          <datalist key={z} id={`loc-${z}`}>
            {freeLocs
              .filter((l) => l.zone === z)
              .map((l) => (
                <option key={l.code} value={l.code}>
                  {l.capacity - l.used} free
                </option>
              ))}
          </datalist>
        ))}
      </Card>

      {g.status === "received" ? (
        <p className="mt-2 text-xs text-gray-500">
          “Put away” places every waiting pallet of the line in one location. To split a line across locations, move individual pallets from the{" "}
          <Link className="link" href={`/admin/stock?status=received`}>
            stock screen
          </Link>
          . Frozen, chilled and ambient pallets can only go into a matching location. The customer is emailed automatically when the last pallet is located.
        </p>
      ) : null}

      {isExpected ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <Card title="Add another line" className="lg:col-span-2">
            <form action={addLines}>
              <input type="hidden" name="id" value={id} />
              <GoodsInLineRows rows={1} />
              <div className="p-3">
                <Submit className="btn btn-outline">Add line</Submit>
              </div>
            </form>
          </Card>
          <Card title="Delivery has arrived">
            <form action={receiveGoodsIn} className="space-y-3 p-4">
              <input type="hidden" name="id" value={id} />
              <label className="block">
                <span className="label">Date received</span>
                <input className="input" type="date" name="received_date" defaultValue={todayISO()} max={todayISO()} required />
              </label>
              <p className="text-xs text-gray-500">Check the lines match what is on the vehicle first. This creates {totalPallets} pallet labels and storage charging starts from this date.</p>
              <Submit className="btn btn-primary w-full" confirm={`Book in ${totalPallets} pallets?`}>
                Receive {totalPallets} pallet{totalPallets === 1 ? "" : "s"}
              </Submit>
            </form>
          </Card>
        </div>
      ) : null}

      {isIn ? (
        <Card title="Pallets" className="mt-5">
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Goods</th>
                  <th>Batch</th>
                  <th>Expiry</th>
                  <th className="num">Qty</th>
                  <th>Location</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pallets.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono text-xs">{p.label}</td>
                    <td>{p.description}</td>
                    <td>{p.batch_no ?? "—"}</td>
                    <td>
                      <Expiry date={p.expiry_date} />
                    </td>
                    <td className="num">
                      {qty(p.quantity)} {p.unit}
                    </td>
                    <td className="font-mono text-xs">{p.locations?.code ?? "—"}</td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
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
