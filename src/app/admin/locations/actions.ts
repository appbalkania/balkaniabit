"use server";

import { requireStaff } from "@/lib/auth";
import { back, dbMessage, isUuid, str } from "@/lib/action";
import { ZONES } from "@/lib/format";

const P = "/admin/locations";
const zoneOk = (z: string) => (ZONES as string[]).includes(z);
const PREFIX: Record<string, string> = { frozen: "F", chilled: "C", ambient: "A" };

export async function addLocation(fd: FormData) {
  const { supabase } = await requireStaff();
  const code = str(fd, "code").toUpperCase();
  const zone = str(fd, "zone");
  const capacity = Number(str(fd, "capacity") || 1);
  if (!/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(code)) back(P, "error", "Location code: letters, numbers and dashes only (max 20)");
  if (!zoneOk(zone)) back(P, "error", "Choose a storage type");
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) back(P, "error", "Capacity must be 1-100 pallets");
  const { data: wh } = await supabase.from("warehouses").select("id").order("code").limit(1).single();
  if (!wh) back(P, "error", "Create a warehouse first");
  const { error } = await supabase.from("locations").insert({ warehouse_id: wh.id, code, zone, capacity });
  if (error) back(P, "error", dbMessage(error));
  back(P, "ok", `Location ${code} added`);
}

/** Create a whole racking block at once: e.g. aisle A, bays 1-20, levels 1-4 = 80 locations. */
export async function generateLocations(fd: FormData) {
  const { supabase } = await requireStaff();
  const zone = str(fd, "zone");
  const aisle = str(fd, "aisle").toUpperCase();
  const bays = Number(str(fd, "bays"));
  const levels = Number(str(fd, "levels"));
  const capacity = Number(str(fd, "capacity") || 1);
  if (!zoneOk(zone)) back(P, "error", "Choose a storage type");
  if (!/^[A-Z0-9]{1,4}$/.test(aisle)) back(P, "error", "Aisle: 1-4 letters or numbers");
  if (!Number.isInteger(bays) || bays < 1 || bays > 200) back(P, "error", "Bays must be 1-200");
  if (!Number.isInteger(levels) || levels < 1 || levels > 20) back(P, "error", "Levels must be 1-20");
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) back(P, "error", "Capacity must be 1-100");
  const { data: wh } = await supabase.from("warehouses").select("id").order("code").limit(1).single();
  if (!wh) back(P, "error", "Create a warehouse first");

  const rows = [];
  for (let b = 1; b <= bays; b++) {
    for (let l = 1; l <= levels; l++) {
      const bay = String(b).padStart(2, "0");
      rows.push({ warehouse_id: wh.id, zone, aisle, bay, level: String(l), capacity, code: `${PREFIX[zone]}-${aisle}-${bay}-${l}` });
    }
  }
  const { error, count } = await supabase.from("locations").upsert(rows, { onConflict: "warehouse_id,code", ignoreDuplicates: true, count: "exact" });
  if (error) back(P, "error", dbMessage(error));
  back(P, "ok", `${count ?? rows.length} locations created (existing codes were left unchanged)`);
}

export async function updateLocation(fd: FormData) {
  const { supabase } = await requireStaff();
  const id = str(fd, "id");
  const capacity = Number(str(fd, "capacity"));
  if (!isUuid(id)) back(P, "error", "Unknown location");
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) back(P, "error", "Capacity must be 1-100");
  const { error } = await supabase.from("locations").update({ capacity, is_active: fd.get("is_active") === "on" }).eq("id", id);
  if (error) back(P, "error", dbMessage(error));
  back(P, "ok", "Location updated");
}
