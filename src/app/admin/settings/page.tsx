import { saveSettings, saveTaxCode } from "./actions";
import { requireAdmin } from "@/lib/auth";
import { Card, Field, Flash, PageHeader, type SP } from "@/components/ui";
import { Submit } from "@/components/client";
import { CURRENCY } from "@/lib/format";

export const metadata = { title: "Settings" };

const NOMINALS: [string, string][] = [
  ["nominal_debtors", "Debtors control"],
  ["nominal_bank", "Bank current account"],
  ["nominal_cash", "Petty cash"],
  ["nominal_credit_card", "Company credit card"],
  ["nominal_creditors", "Creditors control"],
  ["nominal_sales_vat", "Sales VAT"],
  ["nominal_purchase_vat", "Purchase VAT"],
];

export default async function Settings({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireAdmin();
  const [{ data: s }, { data: taxCodes }, { data: log }] = await Promise.all([
    supabase.from("company_settings").select("*").single(),
    supabase.from("tax_codes").select("*").order("code"),
    supabase.from("email_log").select("id, kind, recipient, subject, status, error, created_at").order("id", { ascending: false }).limit(25),
  ]);
  if (!s) return null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Settings" subtitle={`Currency: ${CURRENCY} (set NEXT_PUBLIC_CURRENCY in the environment)`} />
      <Flash searchParams={searchParams} />
      <form action={saveSettings} className="space-y-5">
        <Card title="Company (printed on invoices)">
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Trading name">
              <input className="input" name="company_name" defaultValue={s.company_name} required />
            </Field>
            <Field label="Legal name">
              <input className="input" name="legal_name" defaultValue={s.legal_name ?? ""} />
            </Field>
            <Field label="VAT number">
              <input className="input uppercase" name="vat_number" defaultValue={s.vat_number ?? ""} placeholder="IE1234567T" />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <textarea className="input" name="address" rows={2} defaultValue={s.address ?? ""} />
            </Field>
            <Field label="Company registration (CRO) number">
              <input className="input" name="company_number" defaultValue={s.company_number ?? ""} />
            </Field>
            <Field label="Phone">
              <input className="input" name="phone" defaultValue={s.phone ?? ""} />
            </Field>
            <Field label="Email">
              <input className="input" name="email" defaultValue={s.email ?? ""} />
            </Field>
            <Field label="Bank details for transfers" hint="e.g. IBAN IE00 XXXX 0000 0000 0000 00, BIC XXXXIE2D">
              <input className="input" name="bank_details" defaultValue={s.bank_details ?? ""} />
            </Field>
          </div>
        </Card>
        <Card title="Billing & stock">
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Storage charging">
              <select className="input" name="storage_billing_mode" defaultValue={s.storage_billing_mode}>
                <option value="part_week">Part week = full week</option>
                <option value="daily">Daily pro-rata (days ÷ 7)</option>
              </select>
            </Field>
            <Field label="Default payment terms (days)">
              <input className="input" type="number" name="default_payment_terms_days" min={0} max={120} defaultValue={s.default_payment_terms_days} />
            </Field>
            <Field label="Invoice number prefix" hint={`Next: ${s.invoice_prefix}${String(s.next_invoice_no).padStart(6, "0")}`}>
              <input className="input" name="invoice_prefix" defaultValue={s.invoice_prefix} maxLength={8} />
            </Field>
            <Field label="Expiry warning (days)">
              <input className="input" type="number" name="expiry_alert_days" min={1} max={365} defaultValue={s.expiry_alert_days} />
            </Field>
          </div>
        </Card>
        <Card title="Sage control accounts">
          <div className="grid gap-4 p-4 sm:grid-cols-3 lg:grid-cols-4">
            {NOMINALS.map(([k, label]) => (
              <Field key={k} label={label}>
                <input className="input font-mono" name={k} defaultValue={(s as Record<string, string>)[k]} required pattern="\d{4,8}" />
              </Field>
            ))}
          </div>
        </Card>
        <Submit>Save settings</Submit>
      </form>

      <Card title="VAT / tax codes" className="mt-5">
        <table className="tbl">
          <thead>
            <tr>
              <th>Code</th>
              <th>Description</th>
              <th className="num">Rate</th>
              <th>In VAT return</th>
            </tr>
          </thead>
          <tbody>
            {(taxCodes ?? []).map((t) => (
              <tr key={t.code}>
                <td className="font-mono">{t.code}</td>
                <td>{t.description}</td>
                <td className="num">{(Number(t.rate) * 100).toFixed(2).replace(/\.?0+$/, "")}%</td>
                <td>{t.in_vat_return ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={saveTaxCode} className="grid gap-3 border-t border-gray-100 p-4 sm:grid-cols-5">
          <Field label="Code">
            <input className="input font-mono uppercase" name="code" required placeholder="T1" />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <input className="input" name="description" maxLength={60} />
          </Field>
          <Field label="Rate %">
            <input className="input" type="number" name="rate" min={0} max={100} step="0.01" required />
          </Field>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" name="in_vat_return" defaultChecked /> In return
            </label>
            <Submit className="btn btn-outline btn-sm">Save</Submit>
          </div>
        </form>
        <p className="px-4 pb-3 text-xs text-gray-500">Codes must match Sage (Settings › Configuration › Tax Codes). Changing a rate affects new invoices and expenses only.</p>
      </Card>

      <Card title="Recent emails" className="mt-5">
        <div className="overflow-x-auto">
          <table className="tbl">
            <tbody>
              {(log ?? []).map((l) => (
                <tr key={l.id}>
                  <td className="text-xs whitespace-nowrap">{new Date(l.created_at).toLocaleString("en-IE", { timeZone: "Europe/Dublin" })}</td>
                  <td>{l.kind}</td>
                  <td className="text-gray-600">{l.recipient}</td>
                  <td>{l.subject}</td>
                  <td className={l.status === "sent" ? "text-emerald-700" : "text-red-700"}>
                    {l.status}
                    {l.error ? <div className="text-xs">{l.error}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
