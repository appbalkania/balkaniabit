"use server";

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { back, dbMessage, isDate, isUuid, orNull, str } from "@/lib/action";
import { notifyGoodsOut } from "@/lib/notifications";
import { todayISO } from "@/lib/format";

export async function createGoodsOut(fd: FormData) {
  const { supabase } = await requireStaff();
  const customerId = str(fd, "customer_id");
  const here = `/admin/goods-out/new?customer=${customerId}`;
  if (!isUuid(customerId)) back("/admin/goods-out/new", "error", "Choose a customer");
  const requested = str(fd, "requested_date");
  if (requested && !isDate(requested)) back(here, "error", "Requested date is not valid");

  // one "pallets" input per stock row; rows left blank / 0 are ignored
  const descriptions = fd.getAll("description").map(String);
  const counts = fd.getAll("pallets").map((v) => String(v).trim());
  const lines: { description: string; pallets: number }[] = [];
  for (let i = 0; i < descriptions.length; i++) {
    if (!counts[i] || counts[i] === "0") continue;
    const n = Number(counts[i]);
    if (!Number.isInteger(n) || n < 1 || n > 500) back(here, "error", `"${descriptions[i]}": pallets must be a whole number`);
    lines.push({ description: descriptions[i], pallets: n });
  }
  if (!lines.length) back(here, "error", "Enter the number of pallets to release on at least one line");

  const { data: o, error } = await supabase
    .from("goods_out")
    .insert({
      customer_id: customerId,
      reference: orNull(str(fd, "reference")),
      requested_date: orNull(requested),
      method: str(fd, "method") === "delivery" ? "delivery" : "collection",
      delivery_address: orNull(str(fd, "delivery_address")),
      notes: orNull(str(fd, "notes")),
    })
    .select("id")
    .single();
  if (error || !o) back(here, "error", dbMessage(error));

  const { error: e2 } = await supabase.from("goods_out_lines").insert(lines.map((l) => ({ ...l, goods_out_id: o.id })));
  if (e2) {
    await supabase.from("goods_out").delete().eq("id", o.id);
    back(here, "error", dbMessage(e2));
  }

  const { data: short, error: e3 } = await supabase.rpc("allocate_goods_out", { p_goods_out: o.id });
  const path = `/admin/goods-out/${o.id}`;
  if (e3) back(path, "error", `Order saved but stock was not allocated: ${dbMessage(e3)}`);
  if (short > 0) back(path, "error", `Order saved, but ${short} pallet${short === 1 ? "" : "s"} could not be allocated (not enough unexpired stock in a location).`);
  redirect(path);
}

export async function allocate(fd: FormData) {
  const { supabase } = await requireStaff();
  const id = str(fd, "id");
  const path = `/admin/goods-out/${id}`;
  const { data: short, error } = await supabase.rpc("allocate_goods_out", { p_goods_out: id });
  if (error) back(path, "error", dbMessage(error));
  if (short > 0) back(path, "error", `${short} pallet${short === 1 ? "" : "s"} still short - not enough unexpired stock in a location.`);
  back(path, "ok", "Stock allocated, earliest expiry first");
}

export async function addPallet(fd: FormData) {
  const { supabase } = await requireStaff();
  const id = str(fd, "id");
  const path = `/admin/goods-out/${id}`;
  const label = str(fd, "label").toUpperCase();
  const { data: p } = await supabase.from("pallets").select("id").eq("label", label).maybeSingle();
  if (!p) back(path, "error", `Pallet "${label}" not found`);
  const { error } = await supabase.rpc("allocate_pallet", { p_goods_out: id, p_pallet: p.id });
  if (error) back(path, "error", dbMessage(error));
  back(path, "ok", `${label} added to the order`);
}

export async function removePallet(fd: FormData) {
  const { supabase } = await requireStaff();
  const path = `/admin/goods-out/${str(fd, "id")}`;
  const { error } = await supabase.rpc("deallocate_pallet", { p_pallet: str(fd, "pallet_id") });
  if (error) back(path, "error", dbMessage(error));
  back(path, "ok", "Pallet released back to stock");
}

/** Picker confirms one pallet, by button or by scanning / typing its label. */
export async function pickPallet(fd: FormData) {
  const { supabase } = await requireStaff();
  const path = str(fd, "return_to") || "/admin/pick";
  let palletId = str(fd, "pallet_id");
  const label = str(fd, "label").toUpperCase();
  if (!palletId) {
    const { data: p } = await supabase.from("pallets").select("id").eq("label", label).maybeSingle();
    if (!p) back(path, "error", `Pallet "${label}" not found`);
    palletId = p.id;
  }
  const { error } = await supabase.rpc("pick_pallet", { p_pallet: palletId });
  if (error) back(path, "error", dbMessage(error));
  back(path, "ok", `${label || "Pallet"} picked`);
}

export async function pickAll(fd: FormData) {
  const { supabase } = await requireStaff();
  const id = str(fd, "id");
  const path = `/admin/goods-out/${id}`;
  const { data: pallets } = await supabase.from("pallets").select("id").eq("goods_out_id", id).eq("status", "allocated");
  for (const p of pallets ?? []) {
    const { error } = await supabase.rpc("pick_pallet", { p_pallet: p.id });
    if (error) back(path, "error", dbMessage(error));
  }
  back(path, "ok", `${pallets?.length ?? 0} pallets marked as picked`);
}

/** Goods leave the building: stamps the pallets and emails the customer what went and what remains. */
export async function dispatch(fd: FormData) {
  const { supabase } = await requireStaff();
  const id = str(fd, "id");
  const path = `/admin/goods-out/${id}`;
  const date = str(fd, "dispatched_date");
  const args: { p_goods_out: string; p_collected_by: string; p_dispatched_at?: string } = {
    p_goods_out: id,
    p_collected_by: str(fd, "collected_by"),
  };
  if (date && isDate(date) && date !== todayISO()) args.p_dispatched_at = `${date}T12:00:00Z`;
  const { data: n, error } = await supabase.rpc("dispatch_goods_out", args);
  if (error) back(path, "error", dbMessage(error));

  const mail = await notifyGoodsOut(id);
  back(
    path,
    mail.ok ? "ok" : "error",
    `${n} pallet${n === 1 ? "" : "s"} dispatched. ${mail.ok ? "Customer emailed with what was collected and what remains." : `Customer email NOT sent: ${mail.error}`}`
  );
}

export async function cancelGoodsOut(fd: FormData) {
  const { supabase } = await requireStaff();
  const id = str(fd, "id");
  const { error } = await supabase.rpc("cancel_goods_out", { p_goods_out: id });
  if (error) back(`/admin/goods-out/${id}`, "error", dbMessage(error));
  back("/admin/goods-out", "ok", "Order cancelled and its pallets returned to stock");
}

export async function resendGoodsOutEmail(fd: FormData) {
  await requireStaff();
  const id = str(fd, "id");
  const res = await notifyGoodsOut(id, true);
  back(`/admin/goods-out/${id}`, res.ok ? "ok" : "error", res.ok ? "Email sent to customer" : `Email not sent: ${res.error}`);
}
