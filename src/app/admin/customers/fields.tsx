import { Field } from "@/components/ui";
import { DIRECT_DEBIT_TYPE } from "@/lib/format";

type C = {
  account_ref?: string;
  name?: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  postcode?: string | null;
  vat_number?: string | null;
  tax_code?: string;
  payment_terms_days?: number;
  payment_method?: string;
  auto_charge?: boolean;
  expiry_alert_days?: number | null;
  notes?: string | null;
};

export function CustomerFields({ c = {}, taxCodes, isNew }: { c?: C; taxCodes: { code: string; description: string }[]; isNew?: boolean }) {
  return (
    <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
      {isNew ? (
        <Field label="Account ref" hint="Same as the Sage account (max 8)">
          <input className="input font-mono uppercase" name="account_ref" maxLength={8} required pattern="[A-Za-z0-9]{1,8}" />
        </Field>
      ) : null}
      <Field label="Company name" className={isNew ? "" : "sm:col-span-2"}>
        <input className="input" name="name" defaultValue={c.name} required maxLength={120} />
      </Field>
      <Field label="Contact name">
        <input className="input" name="contact_name" defaultValue={c.contact_name ?? ""} maxLength={80} />
      </Field>
      <Field label="Phone">
        <input className="input" name="phone" defaultValue={c.phone ?? ""} maxLength={40} />
      </Field>
      <Field label="Email for invoices & stock emails" hint="Several? Separate with commas" className="sm:col-span-2">
        <input className="input" name="email" defaultValue={c.email ?? ""} maxLength={250} />
      </Field>
      <Field label="Address" className="sm:col-span-2">
        <textarea className="input" name="address" rows={2} defaultValue={c.address ?? ""} maxLength={300} />
      </Field>
      <Field label="Eircode / postcode">
        <input className="input uppercase" name="postcode" defaultValue={c.postcode ?? ""} maxLength={12} />
      </Field>
      <Field label="Customer VAT number">
        <input className="input uppercase" name="vat_number" defaultValue={c.vat_number ?? ""} maxLength={20} />
      </Field>
      <Field label="VAT / tax code">
        <select className="input" name="tax_code" defaultValue={c.tax_code ?? "T1"}>
          {taxCodes.map((t) => (
            <option key={t.code} value={t.code}>
              {t.code} – {t.description}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Payment terms (days)">
        <input className="input" type="number" name="payment_terms_days" min={0} max={120} defaultValue={c.payment_terms_days ?? 7} />
      </Field>
      <Field label="Pays by">
        <select className="input" name="payment_method" defaultValue={c.payment_method ?? "bank_transfer"}>
          <option value="bank_transfer">Bank transfer</option>
          <option value="card">Card (saved, charged automatically)</option>
          <option value={DIRECT_DEBIT_TYPE}>Direct Debit (collected automatically)</option>
        </select>
      </Field>
      <Field label="Expiry alert (days)" hint="Blank = company default">
        <input className="input" type="number" name="expiry_alert_days" min={1} max={365} defaultValue={c.expiry_alert_days ?? ""} />
      </Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" name="auto_charge" defaultChecked={c.auto_charge ?? true} />
        Collect automatically when an invoice is issued
      </label>
      <Field label="Internal notes" className="sm:col-span-2 lg:col-span-4">
        <input className="input" name="notes" defaultValue={c.notes ?? ""} maxLength={500} />
      </Field>
    </div>
  );
}
