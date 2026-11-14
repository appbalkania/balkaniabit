"use server";

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { back, dbMessage, isDate, isUuid, orNull, str } from "@/lib/action";
import { parseGoodsInLines } from "@/components/forms";
import { notifyGoodsIn } from "@/lib/notifications";
import { todayISO } from "@/lib/format";

export async function createGoodsIn(fd: FormData) {
  const { supabase } = await requireStaff();
  const customerId = str(fd, "customer_id");
  const expected = str(fd, "expected_date");
  if (!isUuid(customerId)) back("/admin/goods-in/new", "error", "Choose a customer");
  if (expected && !isDate(expected)) back("/admin/goods-in/new", "error", "Expected date is not valid");
  const { lines, error: lineError } = parseGoodsInLines(fd);
  if (lineError) back("/admin/goods-in/new", "error", lineError);
  if (!lines.length) back("/admin/goods-in/new", "error", "Add at least one line");

  const { data: g, error } = await supabase
    .from("goods_in")
    .insert({
      customer_id: customerId,
      reference: orNull(str(fd, "reference")),
      carrier: orNull(str(fd, "carrier")),
      expected_date: orNull(expected),
      notes: orNull(str(fd, "notes")),
    })
    .select("id")
    .single();
  if (error || !g) back("/admin/goods-in/new", "error", dbMessage(error));

  const { error: e2 } = await supabase.from("goods_in_lines").insert(lines.map((l) => ({ ...l, goods_in_id: g.id })));
  if (e2) {
    await supabase.from("goods_in").delete().eq("id", g.id);
    back("/admin/goods-in/new", "error", dbMessage(e2));
  }
  redirect(`/admin/goods-in/${g.id}`);
}

export async function addLines(fd: FormData) {
  const { supabase } = await requireStaff();
  const id = str(fd, "id");
  const path = `/admin/goods-in/${id}`;
  const { lines, error: lineError } = parseGoodsInLines(fd);
  if (lineError) back(path, "error", lineError);
  if (!lines.length) back(path, "error", "Enter a description and number of pallets");
  const { data: g } = await supabase.from("goods_in").select("status").eq("id", id).single();
  if (g?.status !== "expected") back(path, "error", "Lines can only be changed before the delivery is received");
  const { error } = await supabase.from("goods_in_lines").insert(lines.map((l) => ({ ...l, goods_in_id: id })));
  if (error) back(path, "error", dbMessage(error));
  back(path, "ok", "Line added");
}

export async function deleteLine(fd: FormData) {
  const { supabase } = await requireStaff();
  const id = str(fd, "id");
  const path = `/admin/goods-in/${id}`;
  const { data: g } = await supabase.from("goods_in").select("status").eq("id", id).single();
  if (g?.status !== "expected") back(path, "error", "Lines can only be changed before the delivery is received");
  const { error } = await supabase.from("goods_in_lines").delete().eq("id", Number(str(fd, "line_id"))).eq("goods_in_id", id);
  if (error) back(path, "error", dbMessage(error));
  back(path, "ok", "Line removed");
}

export async function receiveGoodsIn(fd: FormData) {
  const { supabase } = await requireStaff();
  const id = str(fd, "id");
  const path = `/admin/goods-in/${id}`;
  const date = str(fd, "received_date");
  const args: { p_goods_in: string; p_received_at?: string } = { p_goods_in: id };
  // a back-dated receipt is stamped at midday on that day; today's uses the actual time
  if (date && isDate(date) && date !== todayISO()) args.p_received_at = `${date}T12:00:00Z`;
  const { data, error } = await supabase.rpc("receive_goods_in", args);
  if (error) back(path, "error", dbMessage(error));
  back(path, "ok", `${data} pallet${data === 1 ? "" : "s"} booked in. Print the labels, then put each line away.`);
}

/** After any putaway: if the whole receipt is now located, email the customer (once). */
async function notifyIfComplete(id: string) {
  const res = await notifyGoodsIn(id);
  if (res.ok) return " Customer emailed.";
  if (res.skipped && (res.error === "Not fully put away yet" || res.error === "Already notified")) return "";
  return ` Customer email NOT sent: ${res.error}.`;
}

async function locationId(supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"], code: string) {
  const { data } = await supabase.from("locations").select("id").eq("code", code.toUpperCase()).eq("is_active", true).limit(1);
  return data?.[0]?.id as string | undefined;
}

export async function putawayLine(fd: FormData) {
  const { supabase } = await requireStaff();
  const id = str(fd, "id");
  const path = `/admin/goods-in/${id}`;
  const code = str(fd, "location");
  const loc = await locationId(supabase, code);
  if (!loc) back(path, "error", `Location "${code}" not found`);
  const { data, error } = await supabase.rpc("putaway_line", { p_line: Number(str(fd, "line_id")), p_location: loc });
  if (error) back(path, "error", dbMessage(error));
  back(path, "ok", `${data} pallet${data === 1 ? "" : "s"} put away in ${code.toUpperCase()}.${await notifyIfComplete(id)}`);
}

export async function putawayPallet(fd: FormData) {
  const { supabase } = await requireStaff();
  const id = str(fd, "id");
  const path = str(fd, "return_to") || `/admin/goods-in/${id}`;
  const code = str(fd, "location");
  const loc = await locationId(supabase, code);
  if (!loc) back(path, "error", `Location "${code}" not found`);
  const { error } = await supabase.rpc("putaway_pallet", { p_pallet: str(fd, "pallet_id"), p_location: loc });
  if (error) back(path, "error", dbMessage(error));
  back(path, "ok", `Pallet moved to ${code.toUpperCase()}.${id ? await notifyIfComplete(id) : ""}`);
}

export async function cancelGoodsIn(fd: FormData) {
  const { supabase } = await requireStaff();
  const id = str(fd, "id");
  const { data, error } = await supabase.from("goods_in").update({ status: "cancelled" }).eq("id", id).eq("status", "expected").select("id");
  if (error || !data?.length) back(`/admin/goods-in/${id}`, "error", error ? dbMessage(error) : "Only deliveries that have not arrived can be cancelled");
  back("/admin/goods-in", "ok", "Delivery cancelled");
}

export async function resendGoodsInEmail(fd: FormData) {
  await requireStaff();
  const id = str(fd, "id");
  const res = await notifyGoodsIn(id, true);
  back(`/admin/goods-in/${id}`, res.ok ? "ok" : "error", res.ok ? "Email sent to customer" : `Email not sent: ${res.error}`);
}
