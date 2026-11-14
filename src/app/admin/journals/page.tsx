import { deleteJournal, postJournal } from "../nominal/actions";
import { requireFinance } from "@/lib/auth";
import { Card, Empty, Field, Flash, PageHeader, TableWrap, type SP } from "@/components/ui";
import { Submit } from "@/components/client";
import { fmtDate, money, todayISO } from "@/lib/format";

export const metadata = { title: "Journals" };

const SOURCE: Record<string, string> = { invoice: "Invoice", invoice_void: "Void", payment: "Payment", expense: "Expense", manual: "Manual" };

export default async function Journals({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireFinance();
  const [{ data: nominals }, { data: journals }] = await Promise.all([
    supabase.from("nominal_accounts").select("code, name").eq("is_active", true).order("code"),
    supabase.from("journals").select("id, date, description, source_type, journal_lines(nominal_code, debit, credit)").order("date", { ascending: false }).order("created_at", { ascending: false }).limit(100),
  ]);

  return (
    <>
      <PageHeader title="Journals" subtitle="Every ledger posting. Add manual journals for opening balances, wages, depreciation and corrections." />
      <Flash searchParams={searchParams} />
      <Card title="New manual journal" className="mb-5">
        <form action={postJournal}>
          <div className="grid gap-3 p-4 sm:grid-cols-3">
            <Field label="Date">
              <input className="input" type="date" name="date" defaultValue={todayISO()} required />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <input className="input" name="description" required maxLength={120} placeholder="e.g. Opening balances from Sage" />
            </Field>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl min-w-[640px]">
              <thead>
                <tr>
                  <th>Nominal</th>
                  <th>Details</th>
                  <th className="w-32">Debit</th>
                  <th className="w-32">Credit</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 8 }, (_, i) => (
                  <tr key={i}>
                    <td>
                      <select className="input" name="nominal_code" defaultValue="" aria-label="Nominal code">
                        <option value=""></option>
                        {(nominals ?? []).map((n) => (
                          <option key={n.code} value={n.code}>
                            {n.code} – {n.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input className="input" name="line_description" maxLength={80} aria-label="Details" />
                    </td>
                    <td>
                      <input className="input" type="number" name="debit" min={0} step="0.01" aria-label="Debit" />
                    </td>
                    <td>
                      <input className="input" type="number" name="credit" min={0} step="0.01" aria-label="Credit" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4">
            <Submit>Post journal</Submit>
            <span className="ml-3 text-xs text-gray-500">Debits must equal credits.</span>
          </div>
        </form>
      </Card>

      <Card title="Recent postings">
        {journals?.length ? (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Lines</th>
                  <th className="num">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {journals.map((j) => {
                  const lines = j.journal_lines as { nominal_code: string; debit: number; credit: number }[];
                  return (
                    <tr key={j.id}>
                      <td>{fmtDate(j.date)}</td>
                      <td>{SOURCE[j.source_type]}</td>
                      <td>{j.description}</td>
                      <td className="font-mono text-xs">{lines.map((l) => `${l.nominal_code} ${Number(l.debit) ? "Dr" : "Cr"} ${Number(l.debit || l.credit).toFixed(2)}`).join(" · ")}</td>
                      <td className="num">{money(lines.reduce((n, l) => n + Number(l.debit), 0))}</td>
                      <td>
                        {j.source_type === "manual" ? (
                          <form action={deleteJournal}>
                            <input type="hidden" name="id" value={j.id} />
                            <Submit className="btn btn-danger btn-sm" confirm="Delete this journal?">
                              Delete
                            </Submit>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <Empty>No postings yet.</Empty>
        )}
      </Card>
    </>
  );
}
