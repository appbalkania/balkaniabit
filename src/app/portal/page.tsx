import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { Card, Empty, Expiry, Flash, PageHeader, Stat, StatusBadge, TableWrap, ZoneBadge, type SP } from "@/components/ui";
import { ZONES, addDays, fmtDate, money, paymentMethodLabel, qty, todayISO, zoneLabel } from "@/lib/format";

export const metadata = { title: "Overview" };

export default async function PortalHome({ searchParams }: { searchParams: SP }) {
  const { supabase, customerId } = await requireCustomer();
  const today = todayISO();
  const [{ data: c }, { data: stock }, { data: bal }, { data: orders }, { data: settings }] = await Promise.all([
    supabase.from("customers").select("name, payment_method, stripe_payment_method_id, stripe_payment_method_label, expiry_alert_days").eq("id", customerId).single(),
    supabase.from("stock_summary").select("*").eq("customer_id", customerId).order("expiry_date", { nullsFirst: false }),
    supabase.from("customer_balances").select("*").eq("customer_id", customerId).maybeSingle(),
    supabase.from("goods_out").select("id, number, reference, requested_date, status").eq("customer_id", customerId).in("status", ["requested", "allocated", "picking", "picked"]).order("created_at", { ascending: false }),
    supabase.from("company_settings").select("expiry_alert_days").single(),
  ]);
  const alertDays = c?.expiry_alert_days ?? settings?.expiry_alert_days ?? 30;
  const rows = stock ?? [];
  const byZone = Object.fromEntries(ZONES.map((z) => [z, rows.filter((r) => r.temp_zone === z).reduce((n, r) => n + r.pallets, 0)]));
  const soon = addDays(today, alertDays);
  const expiring = rows.filter((r) => r.expiry_date && r.expiry_date <= soon);

  return (
    <>
      <PageHeader title={`Welcome, ${c?.name ?? ""}`} subtitle={fmtDate(today)}>
        <Link href="/portal/collections/new" className="btn btn-primary">
          Request a collection
        </Link>
        <Link href="/portal/deliveries/new" className="btn btn-outline">
          Pre-advise a delivery
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ZONES.map((z) => (
          <Stat key={z} label={`${zoneLabel(z)} pallets`} value={byZone[z]} href="/portal/stock" />
        ))}
        <Stat
          label="Balance"
          value={money(bal?.outstanding ?? 0)}
          hint={Number(bal?.overdue ?? 0) > 0 ? `${money(bal?.overdue)} overdue` : `Pays by ${paymentMethodLabel(c?.payment_method).toLowerCase()}`}
          tone={Number(bal?.overdue ?? 0) > 0 ? "red" : undefined}
          href="/portal/invoices"
        />
      </div>

      {c && c.payment_method === "bank_transfer" && !c.stripe_payment_method_id ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Save time: set up Direct Debit or a card and your weekly invoices will be paid automatically.{" "}
          <Link href="/portal/payment" className="font-semibold underline">
            Set up payment
          </Link>
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card title={`Expired or expiring within ${alertDays} days`} actions={<Link href="/portal/stock" className="link text-xs">All stock</Link>}>
          {expiring.length ? (
            <TableWrap>
              <table className="tbl">
                <tbody>
                  {expiring.slice(0, 10).map((r, i) => (
                    <tr key={i}>
                      <td>{r.description}</td>
                      <td>
                        <ZoneBadge zone={r.temp_zone} />
                      </td>
                      <td>{r.batch_no ?? ""}</td>
                      <td>
                        <Expiry date={r.expiry_date} alertDays={alertDays} />
                      </td>
                      <td className="num">{r.pallets} plt</td>
                      <td className="num">
                        {qty(r.quantity)} {r.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <Empty>Nothing expiring soon.</Empty>
          )}
        </Card>
        <Card title="Open collections" actions={<Link href="/portal/collections" className="link text-xs">All</Link>}>
          {orders?.length ? (
            <table className="tbl">
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>{o.number}</td>
                    <td>{o.reference ?? ""}</td>
                    <td>{fmtDate(o.requested_date)}</td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No collections in progress.</Empty>
          )}
        </Card>
      </div>
    </>
  );
}
