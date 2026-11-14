import Link from "next/link";
import { saveNominal } from "./actions";
import { requireFinance } from "@/lib/auth";
import { Card, Field, Flash, PageHeader, TableWrap, type SP } from "@/components/ui";
import { Submit } from "@/components/client";
import { CATEGORY_LABEL, balance, trialBalance } from "@/lib/reports";
import { money } from "@/lib/format";

export const metadata = { title: "Nominal codes" };

export default async function Nominal({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireFinance();
  const [{ data: accounts }, tb] = await Promise.all([supabase.from("nominal_accounts").select("*").order("code"), trialBalance(supabase, null, null)]);
  const bal = new Map(tb.map((r) => [r.code, balance(r)]));

  return (
    <>
      <PageHeader title="Nominal codes" subtitle="The chart of accounts, matching your Sage company">
        <Link href="/admin/journals" className="btn btn-outline">
          Journals
        </Link>
        <Link href="/admin/sage" className="btn btn-outline">
          Import from Sage
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />
      <Card title="Add or rename a code" className="mb-5">
        <form action={saveNominal} className="grid gap-3 p-4 sm:grid-cols-4">
          <Field label="Code">
            <input className="input font-mono" name="code" required pattern="\d{4,8}" placeholder="7100" />
          </Field>
          <Field label="Name">
            <input className="input" name="name" required maxLength={60} />
          </Field>
          <Field label="Category">
            <select className="input" name="category" defaultValue="overheads">
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <Submit>Save</Submit>
          </div>
        </form>
        <p className="px-4 pb-3 text-xs text-gray-500">Saving an existing code renames it. Codes must be identical to Sage for the export to post correctly.</p>
      </Card>
      <Card>
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Category</th>
                <th className="num">Balance (all time)</th>
              </tr>
            </thead>
            <tbody>
              {(accounts ?? []).map((a) => (
                <tr key={a.code} className={a.is_active ? "" : "opacity-50"}>
                  <td className="font-mono">{a.code}</td>
                  <td>{a.name}</td>
                  <td className="text-gray-600">{CATEGORY_LABEL[a.category]}</td>
                  <td className="num">{bal.has(a.code) ? money(bal.get(a.code)) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
