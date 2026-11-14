import { ZONES, zoneLabel } from "@/lib/format";

/** Blank goods-in line rows. Rows left without a description are ignored on submit. */
export function GoodsInLineRows({ rows = 6, defaultZone = "ambient" }: { rows?: number; defaultZone?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="tbl min-w-[820px]">
        <thead>
          <tr>
            <th>Goods / description</th>
            <th>Storage</th>
            <th className="w-20">Pallets</th>
            <th className="w-24">Qty / pallet</th>
            <th className="w-24">Unit</th>
            <th className="w-32">Batch</th>
            <th className="w-40">Expiry date</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              <td>
                <input className="input" name="description" placeholder={i === 0 ? "e.g. Frozen peas 10kg" : ""} aria-label="Description" maxLength={120} />
              </td>
              <td>
                <select className="input" name="temp_zone" defaultValue={defaultZone} aria-label="Storage type">
                  {ZONES.map((z) => (
                    <option key={z} value={z}>
                      {zoneLabel(z)}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input className="input" name="pallets" type="number" min={1} max={500} step={1} aria-label="Pallets" />
              </td>
              <td>
                <input className="input" name="quantity_per_pallet" type="number" min={0} step="0.01" aria-label="Quantity per pallet" />
              </td>
              <td>
                <input className="input" name="unit" defaultValue="cases" aria-label="Unit" maxLength={20} />
              </td>
              <td>
                <input className="input" name="batch_no" aria-label="Batch" maxLength={40} />
              </td>
              <td>
                <input className="input" name="expiry_date" type="date" aria-label="Expiry date" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type GoodsInLine = {
  description: string;
  temp_zone: string;
  pallets: number;
  quantity_per_pallet: number;
  unit: string;
  batch_no: string | null;
  expiry_date: string | null;
};

/** Read the rows rendered by <GoodsInLineRows>. Returns an error message for the first bad row. */
export function parseGoodsInLines(fd: FormData): { lines: GoodsInLine[]; error?: string } {
  const col = (k: string) => fd.getAll(k).map((v) => String(v).trim());
  const [desc, zone, pallets, qpp, unit, batch, expiry] = ["description", "temp_zone", "pallets", "quantity_per_pallet", "unit", "batch_no", "expiry_date"].map(col);
  const lines: GoodsInLine[] = [];
  for (let i = 0; i < desc.length; i++) {
    if (!desc[i]) continue;
    const n = Number(pallets[i]);
    if (!Number.isInteger(n) || n < 1 || n > 500) return { lines, error: `"${desc[i]}": enter the number of pallets (1-500)` };
    if (!(ZONES as string[]).includes(zone[i])) return { lines, error: `"${desc[i]}": choose Frozen, Chilled or Ambient` };
    const q = qpp[i] === "" ? 0 : Number(qpp[i]);
    if (!Number.isFinite(q) || q < 0) return { lines, error: `"${desc[i]}": quantity per pallet is not a valid number` };
    if (expiry[i] && !/^\d{4}-\d{2}-\d{2}$/.test(expiry[i])) return { lines, error: `"${desc[i]}": expiry date is not valid` };
    lines.push({
      description: desc[i].slice(0, 120),
      temp_zone: zone[i],
      pallets: n,
      quantity_per_pallet: q,
      unit: (unit[i] || "cases").slice(0, 20),
      batch_no: batch[i] ? batch[i].slice(0, 40) : null,
      expiry_date: expiry[i] || null,
    });
  }
  return { lines };
}

export function CustomerSelect({ customers, defaultValue }: { customers: { id: string; name: string; account_ref: string }[]; defaultValue?: string }) {
  return (
    <select className="input" name="customer_id" required defaultValue={defaultValue ?? ""}>
      <option value="" disabled>
        Choose customer…
      </option>
      {customers.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} ({c.account_ref})
        </option>
      ))}
    </select>
  );
}
