import { addExpense, deleteExpense } from "./actions";
import { requireFinance } from "@/lib/auth";
import { Card, Empty, Field, Flash, PageHeader, TableWrap, first, type SP } from "@/components/ui";
import { Submit } from "@/components/client";
import { fmtDate, money, todayISO } from "@/lib/format";

export const metadata = { title: "Expenses" };

const PAID: Record<string, string> = { bank: "Bank", cash: "Petty cash", credit_card: "Credit card", on_credit: "On account (unpaid)" };

export default async function Expenses({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireFinance();
  const month = /^\d{4}-\d{2}$/.test(first((await searchParams).month)) ? first((await searchParams).month) : todayISO().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  const [{ data: expenses }, { data: nominals }, { data: taxCodes }] = await Promise.all([
    supabase.from("expenses").select("*, nominal_accounts(name)").gte("date", from).lte("date", to).order("date", { ascending: false }),
    supabase.from("nominal_accounts").select("code, name, category").in("category", ["purchases", "direct_expenses", "overheads", "fixed_assets"]).eq("is_active", true).order("code"),
    supabase.from("tax_codes").select("code, description").order("code"),
  ]);
  const totals = (expenses ?? []).reduce((t, e) => ({ net: t.net + Number(e.net), vat: t.vat + Number(e.vat) }), { net: 0, vat: 0 });

  return (
    <>
      <PageHeader title="Expenses" subtitle="Costs and purchase invoices. Each one posts to the ledger on its Sage nominal code." />
      <Flash searchParams={searchParams} />

      <Card title="Add an expense" className="mb-5">
        <form action={addExpense} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date">
            <input className="input" type="date" name="date" defaultValue={todayISO()} required />
          </Field>
          <Field label="Supplier">
            <input className="input" name="supplier" required maxLength={80} />
          </Field>
          <Field label="Their invoice / receipt no.">
            <input className="input" name="reference" maxLength={40} />
          </Field>
          <Field label="Description">
            <input className="input" name="description" maxLength={200} />
          </Field>
          <Field label="Nominal code" className="lg:col-span-2">
            <select className="input" name="nominal_code" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {(nominals ?? []).map((n) => (
                <option key={n.code} value={n.code}>
                  {n.code} – {n.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tax code">
            <select className="input" name="tax_code" defaultValue="T1">
              {(taxCodes ?? []).map((t) => (
                <option key={t.code} value={t.code}>
                  {t.code} – {t.description}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Paid from">
            <select className="input" name="paid_from" defaultValue="bank">
              {Object.entries(PAID).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Net (ex VAT)">
            <input className="input" type="number" name="net" min={0.01} step="0.01" required />
          </Field>
          <Field label="VAT" hint="Leave blank to calculate from the tax code">
            <input className="input" type="number" name="vat" min={0} step="0.01" />
          </Field>
          <Field label="Receipt (photo or PDF)" className="lg:col-span-2">
            <input className="input" type="file" name="receipt" accept="image/*,application/pdf" capture="environment" />
          </Field>
          <div className="lg:col-span-4">
            <Submit>Save expense</Submit>
          </div>
        </form>
      </Card>

      <form method="get" className="mb-3 flex items-end gap-2">
        <label className="block">
          <span className="label">Month</span>
          <input className="input" type="month" name="month" defaultValue={month} />
        </label>
        <button className="btn btn-navy">Show</button>
      </form>

      <Card title={`${fmtDate(from)} – ${fmtDate(to)}: net ${money(totals.net)}, VAT ${money(totals.vat)}`}>
        {expenses?.length ? (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th>Description</th>
                  <th>Nominal</th>
                  <th>Tax</th>
                  <th className="num">Net</th>
                  <th className="num">VAT</th>
                  <th className="num">Gross</th>
                  <th>Paid from</th>
                  <th>Receipt</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtDate(e.date)}</td>
                    <td>
                      {e.supplier}
                      {e.reference ? <div className="text-xs text-gray-500">{e.reference}</div> : null}
                    </td>
                    <td className="text-gray-600">{e.description}</td>
                    <td>
                      <span className="font-mono text-xs">{e.nominal_code}</span> <span className="text-xs text-gray-500">{(e.nominal_accounts as { name: string } | null)?.name}</span>
                    </td>
                    <td>{e.tax_code}</td>
                    <td className="num">{money(e.net)}</td>
                    <td className="num">{money(e.vat)}</td>
                    <td className="num">{money(e.gross)}</td>
                    <td>{PAID[e.paid_from]}</td>
                    <td>
                      {e.receipt_path ? (
                        <a className="link" href={`/api/receipts/${e.id}`} target="_blank" rel="noopener">
                          View
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {e.sage_synced_at ? (
                        <span className="text-xs text-gray-500">in Sage</span>
                      ) : (
                        <form action={deleteExpense}>
                          <input type="hidden" name="id" value={e.id} />
                          <Submit className="btn btn-danger btn-sm" confirm="Delete this expense and its ledger entry?">
                            Delete
                          </Submit>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <Empty>No expenses this month.</Empty>
        )}
      </Card>
    </>
  );
}
