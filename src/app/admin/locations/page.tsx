import { addLocation, generateLocations, updateLocation } from "./actions";
import { requireStaff } from "@/lib/auth";
import { Card, Empty, Field, Flash, PageHeader, TableWrap, ZoneBadge, first, type SP } from "@/components/ui";
import { Submit } from "@/components/client";
import { ZONES, zoneLabel } from "@/lib/format";

export const metadata = { title: "Locations" };

function ZoneSelect() {
  return (
    <select className="input" name="zone" defaultValue="ambient">
      {ZONES.map((z) => (
        <option key={z} value={z}>
          {zoneLabel(z)}
        </option>
      ))}
    </select>
  );
}

export default async function Locations({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireStaff();
  const sp = await searchParams;
  const zone = first(sp.zone);
  const filter = first(sp.show);

  let q = supabase.from("location_usage").select("*").order("code").limit(2000);
  if ((ZONES as string[]).includes(zone)) q = q.eq("zone", zone);
  const { data } = await q;
  const all = data ?? [];
  const rows = filter === "free" ? all.filter((l) => l.is_active && l.used < l.capacity) : filter === "full" ? all.filter((l) => l.used >= l.capacity) : all;
  const totals = ZONES.map((z) => {
    const ls = all.filter((l) => l.zone === z && l.is_active);
    return { z, cap: ls.reduce((n, l) => n + l.capacity, 0), used: ls.reduce((n, l) => n + l.used, 0) };
  });

  return (
    <>
      <PageHeader title="Locations" subtitle="Racking and floor positions. Pallets can only be put into a location of the same storage type." />
      <Flash searchParams={searchParams} />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {totals.map((t) => (
          <div key={t.z} className="card p-4">
            <ZoneBadge zone={t.z} />
            <div className="text-navy mt-2 text-2xl font-bold tabular-nums">
              {t.used} / {t.cap}
            </div>
            <div className="text-xs text-gray-500">pallet spaces used</div>
            <div className="mt-2 h-2 rounded bg-gray-100">
              <div className="bg-brand h-2 rounded" style={{ width: `${t.cap ? Math.min(100, (t.used / t.cap) * 100) : 0}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card title="Create a racking block">
          <form action={generateLocations} className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-5">
            <Field label="Storage">
              <ZoneSelect />
            </Field>
            <Field label="Aisle">
              <input className="input uppercase" name="aisle" placeholder="A" required maxLength={4} />
            </Field>
            <Field label="Bays">
              <input className="input" type="number" name="bays" min={1} max={200} defaultValue={10} required />
            </Field>
            <Field label="Levels">
              <input className="input" type="number" name="levels" min={1} max={20} defaultValue={4} required />
            </Field>
            <Field label="Pallets each">
              <input className="input" type="number" name="capacity" min={1} max={100} defaultValue={1} required />
            </Field>
            <p className="col-span-2 text-xs text-gray-500 sm:col-span-4">Codes are made as zone-aisle-bay-level, e.g. F-A-03-2 = Frozen, aisle A, bay 03, level 2.</p>
            <Submit className="btn btn-primary">Create</Submit>
          </form>
        </Card>
        <Card title="Add a single location">
          <form action={addLocation} className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
            <Field label="Code">
              <input className="input uppercase" name="code" placeholder="FLOOR-1" required maxLength={20} />
            </Field>
            <Field label="Storage">
              <ZoneSelect />
            </Field>
            <Field label="Pallets">
              <input className="input" type="number" name="capacity" min={1} max={100} defaultValue={1} required />
            </Field>
            <div className="flex items-end">
              <Submit className="btn btn-primary">Add</Submit>
            </div>
          </form>
        </Card>
      </div>

      <form method="get" className="no-print mb-3 flex flex-wrap gap-2">
        <select className="input w-40" name="zone" defaultValue={zone}>
          <option value="">All storage</option>
          {ZONES.map((z) => (
            <option key={z} value={z}>
              {zoneLabel(z)}
            </option>
          ))}
        </select>
        <select className="input w-40" name="show" defaultValue={filter}>
          <option value="">All locations</option>
          <option value="free">With free space</option>
          <option value="full">Full</option>
        </select>
        <button className="btn btn-navy">Filter</button>
      </form>

      <Card>
        {rows.length ? (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Storage</th>
                  <th className="num">In use</th>
                  <th>Capacity / active</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className={l.is_active ? "" : "opacity-50"}>
                    <td className="font-mono font-semibold">{l.code}</td>
                    <td>
                      <ZoneBadge zone={l.zone} />
                    </td>
                    <td className={`num ${l.used >= l.capacity ? "font-semibold text-red-700" : ""}`}>
                      {l.used} / {l.capacity}
                    </td>
                    <td>
                      <form action={updateLocation} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={l.id} />
                        <input className="input w-20" type="number" name="capacity" min={1} max={100} defaultValue={l.capacity} aria-label="Capacity" />
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" name="is_active" defaultChecked={l.is_active} /> Active
                        </label>
                        <Submit className="btn btn-outline btn-sm">Save</Submit>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <Empty>No locations yet. Create a racking block above.</Empty>
        )}
      </Card>
    </>
  );
}
