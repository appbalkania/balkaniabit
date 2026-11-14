import Link from "next/link";
import { notFound } from "next/navigation";
import { addAdhocCharge, deleteAdhocCharge, inviteCustomerUser, removeCustomerUser, saveRates, updateCustomer } from "../actions";
import { CustomerFields } from "../fields";
import { requireFinance } from "@/lib/auth";
import { Badge, Card, Empty, Expiry, Field, Flash, PageHeader, StatusBadge, TableWrap, ZoneBadge, type SP } from "@/components/ui";
import { Submit } from "@/components/client";
import { fmtDate, money, paymentMethodLabel, qty, todayISO } from "@/lib/format";

export const metadata = { title: "Customer" };

export default async function CustomerDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const { supabase } = await requireFinance();
  const { data: c } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();

  const [{ data: taxCodes }, { data: types }, { data: rates }, { data: users }, { data: stock }, { data: invoices }, { data: adhoc }, { data: bal }] = await Promise.all([
    supabase.from("tax_codes").select("code, description").order("code"),
    supabase.from("charge_types").select("code, name, basis, default_rate").eq("is_active", true).order("sort"),
    supabase.from("customer_rates").select("charge_type_code, rate").eq("customer_id", id),
    supabase.from("profiles").select("id, email, full_name").eq("customer_id", id),
    supabase.from("stock_summary").select("*").eq("customer_id", id).order("expiry_date", { nullsFirst: false }),
    supabase.from("invoices").select("id, number, issue_date, total, amount_paid, status, payment_status").eq("customer_id", id).neq("status", "draft").order("issue_date", { ascending: false }).limit(12),
    supabase.from("adhoc_charges").select("id, date, description, quantity, unit_price").eq("customer_id", id).is("invoice_line_id", null).order("date"),
    supabase.from("customer_balances").select("*").eq("customer_id", id).maybeSingle(),
  ]);
  const own = new Map((rates ?? []).map((r) => [r.charge_type_code, r.rate]));
  const totalPallets = (stock ?? []).reduce((n, s) => n + s.pallets, 0);
  const autoReady = c.payment_method !== "bank_transfer" && c.stripe_payment_method_id && c.auto_charge;

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={
          <>
            {c.account_ref} · {totalPallets} pallets in store · owes {money(bal?.outstanding ?? 0)}
            {Number(bal?.overdue ?? 0) > 0 ? <span className="font-semibold text-red-700"> ({money(bal?.overdue)} overdue)</span> : null}
          </>
        }
      >
        <Link href={`/admin/stock?customer=${id}`} className="btn btn-outline">
          Pallets
        </Link>
        <Link href={`/admin/invoices?customer=${id}`} className="btn btn-outline">
          Invoices
        </Link>
        <Link href="/admin/customers" className="btn btn-outline">
          Back
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />

      <div className="mb-5 rounded-md border border-gray-200 bg-white px-4 py-3 text-sm">
        <strong>Payment:</strong> {paymentMethodLabel(c.payment_method)}
        {c.payment_method === "bank_transfer" ? (
          " – invoices are emailed for the customer to pay."
        ) : autoReady ? (
          <>
            {" "}
            – <Badge tone="green">collected automatically</Badge> from {c.stripe_payment_method_label}.
          </>
        ) : (
          <>
            {" "}
            – <Badge tone="amber">not set up yet</Badge> The customer must sign in to the portal and go to <em>Payment details</em> to add their card or Direct Debit mandate. Until then invoices are emailed with a pay-online link.
          </>
        )}
      </div>

      <form action={updateCustomer}>
        <input type="hidden" name="id" value={id} />
        <Card
          title="Details"
          actions={
            <>
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" name="is_active" defaultChecked={c.is_active} /> Active
              </label>
              <Submit className="btn btn-primary btn-sm">Save</Submit>
            </>
          }
        >
          <CustomerFields c={c} taxCodes={taxCodes ?? []} />
        </Card>
      </form>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Prices for this customer">
          <form action={saveRates}>
            <input type="hidden" name="id" value={id} />
            <table className="tbl">
              <thead>
                <tr>
                  <th>Charge</th>
                  <th className="num">Standard</th>
                  <th className="w-36">This customer</th>
                </tr>
              </thead>
              <tbody>
                {(types ?? [])
                  .filter((t) => t.basis !== "adhoc")
                  .map((t) => (
                    <tr key={t.code}>
                      <td>
                        {t.name}
                        <div className="text-xs text-gray-500">{t.basis === "storage_week" ? "per pallet per week" : "per pallet"}</div>
                      </td>
                      <td className="num">{money(t.default_rate)}</td>
                      <td>
                        <input type="hidden" name="code" value={t.code} />
                        <input className="input" type="number" name="rate" min={0} step="0.01" defaultValue={own.get(t.code) ?? ""} placeholder="standard" aria-label={`${t.name} rate`} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <div className="p-3">
              <Submit className="btn btn-outline btn-sm">Save prices</Submit>
            </div>
          </form>
        </Card>

        <Card title="Portal logins">
          {users?.length ? (
            <ul className="divide-y divide-gray-100">
              {users.map((u) => (
                <li key={u.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span>
                    {u.full_name ? `${u.full_name} · ` : ""}
                    {u.email}
                  </span>
                  <form action={removeCustomerUser}>
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="user_id" value={u.id} />
                    <Submit className="btn btn-danger btn-sm" confirm={`Remove portal access for ${u.email}?`}>
                      Remove
                    </Submit>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nobody from this customer can sign in yet.</Empty>
          )}
          <form action={inviteCustomerUser} className="grid gap-3 border-t border-gray-100 p-4 sm:grid-cols-3">
            <input type="hidden" name="id" value={id} />
            <Field label="Name">
              <input className="input" name="full_name" maxLength={80} />
            </Field>
            <Field label="Email">
              <input className="input" type="email" name="email" required defaultValue={users?.length ? "" : (c.email?.split(/[,;]/)[0] ?? "")} />
            </Field>
            <div className="flex items-end">
              <Submit className="btn btn-navy w-full">Send invitation</Submit>
            </div>
          </form>
        </Card>

        <Card title="One-off charges for the next invoice">
          {adhoc?.length ? (
            <table className="tbl">
              <tbody>
                {adhoc.map((a) => (
                  <tr key={a.id}>
                    <td>{fmtDate(a.date)}</td>
                    <td>{a.description}</td>
                    <td className="num">
                      {qty(a.quantity)} × {money(a.unit_price)}
                    </td>
                    <td className="num">{money(Number(a.quantity) * Number(a.unit_price))}</td>
                    <td>
                      <form action={deleteAdhocCharge}>
                        <input type="hidden" name="id" value={id} />
                        <input type="hidden" name="charge_id" value={a.id} />
                        <Submit className="btn btn-danger btn-sm">Remove</Submit>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <form action={addAdhocCharge} className="grid grid-cols-2 gap-3 border-t border-gray-100 p-4 sm:grid-cols-5">
            <input type="hidden" name="id" value={id} />
            <Field label="Description" className="col-span-2">
              <input className="input" name="description" placeholder="e.g. Re-wrap pallets" required maxLength={120} />
            </Field>
            <Field label="Date">
              <input className="input" type="date" name="date" defaultValue={todayISO()} required />
            </Field>
            <Field label="Qty">
              <input className="input" type="number" name="quantity" min={0.001} step="0.001" defaultValue={1} required />
            </Field>
            <Field label="Price each">
              <input className="input" type="number" name="unit_price" min={0} step="0.01" required />
            </Field>
            <input type="hidden" name="charge_type_code" value="OTHER" />
            <div className="col-span-2 sm:col-span-5">
              <Submit className="btn btn-outline btn-sm">Add charge</Submit>
            </div>
          </form>
        </Card>

        <Card title="Recent invoices" actions={<Link href={`/admin/invoices?customer=${id}`} className="link text-xs">All</Link>}>
          {invoices?.length ? (
            <table className="tbl">
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <Link href={`/admin/invoices/${i.id}`} className="link">
                        {i.number}
                      </Link>
                    </td>
                    <td>{fmtDate(i.issue_date)}</td>
                    <td className="num">{money(i.total)}</td>
                    <td>
                      <StatusBadge status={i.status} />
                      {i.payment_status === "failed" ? <Badge tone="red">payment failed</Badge> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No invoices yet.</Empty>
          )}
        </Card>
      </div>

      <Card title={`Stock in the warehouse – ${totalPallets} pallets`} className="mt-5">
        {stock?.length ? (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Goods</th>
                  <th>Storage</th>
                  <th>Batch</th>
                  <th>Expiry</th>
                  <th className="num">Pallets</th>
                  <th className="num">On order</th>
                  <th className="num">Qty</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((s, i) => (
                  <tr key={i}>
                    <td>{s.description}</td>
                    <td>
                      <ZoneBadge zone={s.temp_zone} />
                    </td>
                    <td>{s.batch_no ?? "—"}</td>
                    <td>
                      <Expiry date={s.expiry_date} alertDays={c.expiry_alert_days ?? 30} />
                    </td>
                    <td className="num">{s.pallets}</td>
                    <td className="num">{s.pallets_on_order || ""}</td>
                    <td className="num">
                      {qty(s.quantity)} {s.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <Empty>No stock in the warehouse.</Empty>
        )}
      </Card>
    </>
  );
}
