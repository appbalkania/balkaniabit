import { saveChargeTypes } from "./actions";
import { requireFinance } from "@/lib/auth";
import { Card, Flash, PageHeader, ZoneBadge, type SP } from "@/components/ui";
import { Submit } from "@/components/client";

export const metadata = { title: "Rates" };

const BASIS: Record<string, string> = {
  storage_week: "per pallet, per week",
  per_pallet_in: "per pallet received",
  per_pallet_out: "per pallet dispatched",
  adhoc: "one-off charges",
};

export default async function Rates({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireFinance();
  const [{ data: types }, { data: nominals }] = await Promise.all([
    supabase.from("charge_types").select("*").order("sort"),
    supabase.from("nominal_accounts").select("code, name").eq("category", "sales").eq("is_active", true).order("code"),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Rates" subtitle="Standard prices. Set a different price for one customer on their customer page." />
      <Flash searchParams={searchParams} />
      <form action={saveChargeTypes}>
        <Card>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Charge</th>
                  <th>Basis</th>
                  <th className="w-32">Rate (ex VAT)</th>
                  <th>Sales nominal (Sage)</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {(types ?? []).map((t) => (
                  <tr key={t.code}>
                    <td>
                      <input type="hidden" name="code" value={t.code} />
                      <input className="input" name="name" defaultValue={t.name} maxLength={60} aria-label="Name" />
                      {t.temp_zone ? (
                        <div className="mt-1">
                          <ZoneBadge zone={t.temp_zone} />
                        </div>
                      ) : null}
                    </td>
                    <td className="text-xs text-gray-600">{BASIS[t.basis]}</td>
                    <td>
                      {t.basis === "adhoc" ? (
                        <input type="hidden" name="default_rate" value="0" />
                      ) : (
                        <input className="input" type="number" name="default_rate" min={0} step="0.01" defaultValue={t.default_rate} aria-label="Rate" />
                      )}
                    </td>
                    <td>
                      <select className="input" name="nominal_code" defaultValue={t.nominal_code} aria-label="Nominal code">
                        {(nominals ?? []).map((n) => (
                          <option key={n.code} value={n.code}>
                            {n.code} – {n.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input type="checkbox" name={`active_${t.code}`} defaultChecked={t.is_active} aria-label="Active" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-gray-100 p-4">
            <Submit>Save rates</Submit>
            <p className="mt-2 text-xs text-gray-500">A charge at 0.00 is never invoiced. Changes apply to the next weekly invoice; issued invoices are not changed.</p>
          </div>
        </Card>
      </form>
    </div>
  );
}
