import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { Card, Empty, Expiry, Flash, PageHeader, Stat, StatusBadge, TableWrap, ZoneBadge, type SP } from "@/components/ui";
import { ZONES, addDays, fmtDate, money, todayISO, zoneLabel } from "@/lib/format";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  const { supabase, profile } = await requireStaff();
  const finance = profile.role !== "warehouse";
  const today = todayISO();

  const { data: settings } = await supabase.from("company_settings").select("expiry_alert_days").single();
  const alertDays = settings?.expiry_alert_days ?? 30;
  const soon = addDays(today, alertDays);

  const inStore = () => supabase.from("pallets").select("id", { count: "exact", head: true }).neq("status", "dispatched");
  const [frozen, chilled, ambient, awaiting, expired, expiring, capacity, goodsIn, goodsOut, nextExpiry] = await Promise.all([
    inStore().eq("temp_zone", "frozen"),
    inStore().eq("temp_zone", "chilled"),
    inStore().eq("temp_zone", "ambient"),
    inStore().eq("status", "received"),
    inStore().lt("expiry_date", today),
    inStore().gte("expiry_date", today).lte("expiry_date", soon),
    supabase.from("locations").select("zone, capacity").eq("is_active", true),
    supabase.from("goods_in").select("id, number, reference, expected_date, status, source, customers(name)").in("status", ["expected", "received"]).order("expected_date", { nullsFirst: false }).limit(8),
    supabase.from("goods_out").select("id, number, reference, requested_date, status, source, customers(name)").in("status", ["requested", "allocated", "picking", "picked"]).order("requested_date", { nullsFirst: false }).limit(8),
    supabase.from("pallets").select("id, label, description, temp_zone, expiry_date, customers(name), locations(code)").neq("status", "dispatched").not("expiry_date", "is", null).lte("expiry_date", soon).order("expiry_date").limit(8),
  ]);
  const count: Record<string, number> = { frozen: frozen.count ?? 0, chilled: chilled.count ?? 0, ambient: ambient.count ?? 0 };
  const cap: Record<string, number> = { frozen: 0, chilled: 0, ambient: 0 };
  for (const l of capacity.data ?? []) cap[l.zone] += l.capacity;

  let money_: { outstanding: number; overdue: number; failed: number; zeroRates: boolean } | null = null;
  if (finance) {
    const [{ data: open }, { data: rates }] = await Promise.all([
      supabase.from("invoices").select("total, amount_paid, due_date, payment_status").in("status", ["issued", "part_paid"]),
      supabase.from("charge_types").select("default_rate").eq("basis", "storage_week").eq("is_active", true),
    ]);
    money_ = { outstanding: 0, overdue: 0, failed: 0, zeroRates: (rates ?? []).some((r) => Number(r.default_rate) === 0) };
    for (const i of open ?? []) {
      const bal = Number(i.total) - Number(i.amount_paid);
      money_.outstanding += bal;
      if (i.due_date < today) money_.overdue += bal;
      if (i.payment_status === "failed") money_.failed += 1;
    }
  }

  return (
    <>
      <PageHeader title="Dashboard" subtitle={fmtDate(today)}>
        <Link href="/admin/goods-in/new" className="btn btn-primary">
          + Goods in
        </Link>
        <Link href="/admin/goods-out/new" className="btn btn-navy">
          + Goods out
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />

      {money_?.zeroRates ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          One or more storage rates are still €0.00, so that storage will not be invoiced.{" "}
          <Link href="/admin/rates" className="font-semibold underline">
            Set your Frozen / Chilled / Ambient rates
          </Link>
          .
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ZONES.map((z) => (
          <Stat
            key={z}
            label={`${zoneLabel(z)} pallets`}
            value={count[z]}
            hint={cap[z] ? `${Math.round((count[z] / cap[z]) * 100)}% of ${cap[z]} spaces` : "no locations set up"}
            href={`/admin/stock?zone=${z}`}
          />
        ))}
        <Stat label="Awaiting putaway" value={awaiting.count ?? 0} hint="received, no location yet" href="/admin/stock?status=received" tone={(awaiting.count ?? 0) > 0 ? "amber" : undefined} />
        <Stat label="Expired in store" value={expired.count ?? 0} href="/admin/expiry" tone={(expired.count ?? 0) > 0 ? "red" : undefined} />
        <Stat label={`Expiring in ${alertDays} days`} value={expiring.count ?? 0} href="/admin/expiry" tone={(expiring.count ?? 0) > 0 ? "amber" : undefined} />
        {money_ ? (
          <Stat
            label="Owed by customers"
            value={money(money_.outstanding)}
            hint={
              <>
                {money(money_.overdue)} overdue{money_.failed ? ` · ${money_.failed} failed payment${money_.failed === 1 ? "" : "s"}` : ""}
              </>
            }
            href="/admin/invoices?status=open"
            tone={money_.failed ? "red" : undefined}
          />
        ) : null}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card title="Goods in – expected and awaiting putaway" actions={<Link href="/admin/goods-in" className="link text-xs">All</Link>}>
          {goodsIn.data?.length ? (
            <TableWrap>
              <table className="tbl">
                <tbody>
                  {goodsIn.data.map((g) => (
                    <tr key={g.id}>
                      <td>
                        <Link href={`/admin/goods-in/${g.id}`} className="link">
                          {g.number}
                        </Link>
                      </td>
                      <td>{(g.customers as unknown as { name: string })?.name}</td>
                      <td className="text-gray-500">{g.reference}</td>
                      <td>{fmtDate(g.expected_date)}</td>
                      <td>
                        <StatusBadge status={g.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <Empty>Nothing expected.</Empty>
          )}
        </Card>

        <Card title="Goods out – open orders" actions={<Link href="/admin/goods-out" className="link text-xs">All</Link>}>
          {goodsOut.data?.length ? (
            <TableWrap>
              <table className="tbl">
                <tbody>
                  {goodsOut.data.map((g) => (
                    <tr key={g.id}>
                      <td>
                        <Link href={`/admin/goods-out/${g.id}`} className="link">
                          {g.number}
                        </Link>
                      </td>
                      <td>{(g.customers as unknown as { name: string })?.name}</td>
                      <td className="text-gray-500">{g.source === "portal" ? "Customer request" : g.reference}</td>
                      <td>{fmtDate(g.requested_date)}</td>
                      <td>
                        <StatusBadge status={g.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <Empty>No open orders.</Empty>
          )}
        </Card>

        <Card title="Next to expire" className="xl:col-span-2" actions={<Link href="/admin/expiry" className="link text-xs">Expiry report</Link>}>
          {nextExpiry.data?.length ? (
            <TableWrap>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Pallet</th>
                    <th>Customer</th>
                    <th>Goods</th>
                    <th>Storage</th>
                    <th>Location</th>
                    <th>Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {nextExpiry.data.map((p) => (
                    <tr key={p.id}>
                      <td className="font-mono text-xs">{p.label}</td>
                      <td>{(p.customers as unknown as { name: string })?.name}</td>
                      <td>{p.description}</td>
                      <td>
                        <ZoneBadge zone={p.temp_zone} />
                      </td>
                      <td className="font-mono text-xs">{(p.locations as unknown as { code: string } | null)?.code ?? "—"}</td>
                      <td>
                        <Expiry date={p.expiry_date} alertDays={alertDays} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <Empty>Nothing expiring in the next {alertDays} days.</Empty>
          )}
        </Card>
      </div>
    </>
  );
}
