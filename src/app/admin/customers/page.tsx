import Link from "next/link";
import { requireFinance } from "@/lib/auth";
import { Badge, Card, Empty, Flash, PageHeader, TableWrap, first, type SP } from "@/components/ui";
import { money, paymentMethodLabel } from "@/lib/format";

export const metadata = { title: "Customers" };

export default async function Customers({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireFinance();
  const search = first((await searchParams).q).replace(/[%,()]/g, " ").trim();
  let q = supabase.from("customers").select("id, account_ref, name, email, payment_method, auto_charge, stripe_payment_method_id, is_active").order("name");
  if (search) q = q.or(`name.ilike.%${search}%,account_ref.ilike.%${search}%,email.ilike.%${search}%`);
  const [{ data }, { data: balances }, { data: stock }] = await Promise.all([
    q,
    supabase.from("customer_balances").select("*"),
    supabase.from("stock_summary").select("customer_id, pallets").limit(10000),
  ]);
  const bal = new Map((balances ?? []).map((b) => [b.customer_id, b]));
  const pallets = new Map<string, number>();
  for (const s of stock ?? []) pallets.set(s.customer_id, (pallets.get(s.customer_id) ?? 0) + s.pallets);

  return (
    <>
      <PageHeader title="Customers">
        <Link href="/admin/customers/new" className="btn btn-primary">
          + New customer
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />
      <form method="get" className="mb-3 flex gap-2">
        <input className="input max-w-sm" name="q" defaultValue={search} placeholder="Search name, account or email" />
        <button className="btn btn-navy">Search</button>
      </form>
      <Card>
        {data?.length ? (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th className="num">Pallets in store</th>
                  <th>Payment</th>
                  <th className="num">Owed</th>
                  <th className="num">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {data.map((c) => {
                  const b = bal.get(c.id);
                  return (
                    <tr key={c.id} className={c.is_active ? "" : "opacity-50"}>
                      <td className="font-mono text-xs">{c.account_ref}</td>
                      <td>
                        <Link href={`/admin/customers/${c.id}`} className="link">
                          {c.name}
                        </Link>
                        {c.is_active ? null : <span className="ml-2 text-xs text-gray-500">inactive</span>}
                      </td>
                      <td className="text-gray-600">{c.email ?? <span className="text-red-700">missing</span>}</td>
                      <td className="num">{pallets.get(c.id) ?? 0}</td>
                      <td>
                        {paymentMethodLabel(c.payment_method)}{" "}
                        {c.payment_method !== "bank_transfer" ? (
                          c.stripe_payment_method_id && c.auto_charge ? <Badge tone="green">auto</Badge> : <Badge tone="amber">not set up</Badge>
                        ) : null}
                      </td>
                      <td className="num">{b ? money(b.outstanding) : "—"}</td>
                      <td className={`num ${Number(b?.overdue ?? 0) > 0 ? "font-semibold text-red-700" : ""}`}>{b?.overdue ? money(b.overdue) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <Empty>No customers yet.</Empty>
        )}
      </Card>
    </>
  );
}
