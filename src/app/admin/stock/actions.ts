"use server";

import { requireStaff } from "@/lib/auth";
import { back, dbMessage, isDate, num, orNull, str } from "@/lib/action";

/** Correct a pallet's quantity / batch / expiry. Every change is written to the movement log. */
export async function adjustPallet(fd: FormData) {
  const { supabase } = await requireStaff();
  const id = str(fd, "pallet_id");
  const path = `/admin/stock/${id}`;
  const quantity = num(fd, "quantity");
  const expiry = str(fd, "expiry_date");
  if (!Number.isFinite(quantity) || quantity < 0) back(path, "error", "Quantity must be zero or more");
  if (expiry && !isDate(expiry)) back(path, "error", "Expiry date is not valid");

  const { data: before } = await supabase.from("pallets").select("quantity, batch_no, expiry_date, status").eq("id", id).maybeSingle();
  if (!before) back(path, "error", "Pallet not found");
  if (before.status === "dispatched") back(path, "error", "This pallet has left the warehouse and can no longer be changed");

  const after = { quantity, batch_no: orNull(str(fd, "batch_no")), expiry_date: orNull(expiry), notes: orNull(str(fd, "notes")) };
  const { error } = await supabase.from("pallets").update(after).eq("id", id);
  if (error) back(path, "error", dbMessage(error));

  const changes = [
    Number(before.quantity) !== quantity ? `qty ${before.quantity} → ${quantity}` : null,
    (before.batch_no ?? "") !== (after.batch_no ?? "") ? `batch ${before.batch_no ?? "none"} → ${after.batch_no ?? "none"}` : null,
    (before.expiry_date ?? "") !== (after.expiry_date ?? "") ? `expiry ${before.expiry_date ?? "none"} → ${after.expiry_date ?? "none"}` : null,
  ].filter(Boolean);
  if (changes.length) {
    const reason = str(fd, "reason");
    await supabase.from("stock_movements").insert({ pallet_id: id, type: "adjust", note: `${changes.join("; ")}${reason ? ` (${reason})` : ""}` });
  }
  back(path, "ok", changes.length ? "Pallet updated and logged" : "Saved");
}
