import "server-only";
import { createAdminClient } from "./supabase/server";
import { emailLayout, emailTable, sendEmail, type EmailResult } from "./email";
import { addDays, esc, fmtDate, qty, todayISO, zoneLabel } from "./format";

type SummaryRow = {
  description: string;
  temp_zone: string;
  batch_no: string | null;
  expiry_date: string | null;
  unit: string;
  pallets: number;
  quantity: number;
};

type PalletRow = {
  label: string;
  description: string;
  temp_zone: string;
  quantity: number;
  unit: string;
  batch_no: string | null;
  expiry_date: string | null;
  status: string;
  locations: { code: string } | null;
};

type Group = {
  description: string;
  zone: string;
  batch: string | null;
  expiry: string | null;
  unit: string;
  pallets: number;
  quantity: number;
  locations: Set<string>;
};

/** Collapse pallets into product / batch / expiry rows (how a customer thinks about stock). */
export function groupPallets(pallets: PalletRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const p of pallets) {
    const key = [p.description.toLowerCase(), p.temp_zone, p.batch_no ?? "", p.expiry_date ?? ""].join("|");
    let g = map.get(key);
    if (!g) {
      g = {
        description: p.description,
        zone: p.temp_zone,
        batch: p.batch_no,
        expiry: p.expiry_date,
        unit: p.unit,
        pallets: 0,
        quantity: 0,
        locations: new Set(),
      };
      map.set(key, g);
    }
    g.pallets += 1;
    g.quantity += Number(p.quantity);
    if (p.locations?.code) g.locations.add(p.locations.code);
  }
  // earliest expiry first
  return [...map.values()].sort(
    (a, b) => (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999") || a.description.localeCompare(b.description)
  );
}

const PALLET_COLS = "label, description, temp_zone, quantity, unit, batch_no, expiry_date, status, locations(code)";

async function companyName(db: ReturnType<typeof createAdminClient>) {
  const { data } = await db.from("company_settings").select("company_name").single();
  return data?.company_name ?? "BIT Storage";
}

/**
 * "Goods received" email: what arrived, how many pallets, where each lot is stored and its expiry date.
 * Sent once all pallets on the receipt have a location. Pass force to re-send.
 */
export async function notifyGoodsIn(goodsInId: string, force = false): Promise<EmailResult> {
  const db = createAdminClient();
  const { data: g } = await db
    .from("goods_in")
    .select("id, number, reference, carrier, status, received_at, notified_at, customers(id, name, email)")
    .eq("id", goodsInId)
    .single();
  if (!g) return { ok: false, error: "Goods-in not found" };
  if (g.status !== "putaway") return { ok: false, skipped: true, error: "Not fully put away yet" };
  if (g.notified_at && !force) return { ok: false, skipped: true, error: "Already notified" };
  const customer = g.customers as unknown as { id: string; name: string; email: string | null };

  const { data: pallets } = await db.from("pallets").select(PALLET_COLS).eq("goods_in_id", goodsInId).order("label");
  const rows = (pallets ?? []) as unknown as PalletRow[];
  const groups = groupPallets(rows);
  const company = await companyName(db);

  const body = `
    <p>Dear ${esc(customer.name)},</p>
    <p>We have received and put away the following goods on <strong>${fmtDate(g.received_at)}</strong>.</p>
    <p style="margin:0">Receipt: <strong>${esc(g.number)}</strong>${g.reference ? ` &nbsp;·&nbsp; Your reference: <strong>${esc(g.reference)}</strong>` : ""}${g.carrier ? ` &nbsp;·&nbsp; Carrier: ${esc(g.carrier)}` : ""}</p>
    <p style="margin:4px 0 0">Total pallets received: <strong>${rows.length}</strong></p>
    ${emailTable(
      ["Goods", "Storage", "Batch", "Expiry date", "Pallets", "Total qty", "Location"],
      groups.map((x) => [
        x.description,
        zoneLabel(x.zone),
        x.batch,
        x.expiry ? fmtDate(x.expiry) : "No expiry",
        x.pallets,
        `${qty(x.quantity)} ${x.unit}`,
        [...x.locations].sort().join(", "),
      ])
    )}
    <p style="font-size:12px;color:#6b7280">Pallet labels: ${rows.map((p) => esc(p.label)).join(", ")}</p>
    <p>If anything here does not match your delivery note, please reply to this email as soon as possible.</p>`;

  const res = await sendEmail({
    kind: "goods_in",
    to: customer.email,
    subject: `Goods received – ${rows.length} pallet${rows.length === 1 ? "" : "s"} (${g.number}${g.reference ? ` / ${g.reference}` : ""})`,
    html: await emailLayout(company, "Goods received", body),
    customerId: customer.id,
    relatedId: g.id,
  });
  if (res.ok) await db.from("goods_in").update({ notified_at: new Date().toISOString() }).eq("id", g.id);
  return res;
}

/**
 * "Goods collected" email: which pallets left (with expiry dates) and everything that
 * remains in the warehouse afterwards, with quantities and expiry dates.
 */
export async function notifyGoodsOut(goodsOutId: string, force = false): Promise<EmailResult> {
  const db = createAdminClient();
  const { data: o } = await db
    .from("goods_out")
    .select("id, number, reference, method, collected_by, status, dispatched_at, notified_at, customers(id, name, email)")
    .eq("id", goodsOutId)
    .single();
  if (!o) return { ok: false, error: "Order not found" };
  if (o.status !== "dispatched") return { ok: false, skipped: true, error: "Not dispatched yet" };
  if (o.notified_at && !force) return { ok: false, skipped: true, error: "Already notified" };
  const customer = o.customers as unknown as { id: string; name: string; email: string | null };

  const [{ data: gone }, { data: left }] = await Promise.all([
    db.from("pallets").select(PALLET_COLS).eq("goods_out_id", goodsOutId).order("label"),
    db.from("stock_summary").select("*").eq("customer_id", customer.id).order("expiry_date", { nullsFirst: false }).order("description"),
  ]);
  const goneRows = (gone ?? []) as unknown as PalletRow[];
  const leftRows = (left ?? []) as SummaryRow[];
  const leftPallets = leftRows.reduce((n, r) => n + r.pallets, 0);
  const company = await companyName(db);
  const verb = o.method === "delivery" ? "dispatched" : "collected";

  const remaining = leftRows.length
    ? emailTable(
        ["Goods", "Storage", "Batch", "Expiry date", "Pallets", "Total qty"],
        leftRows.map((x) => [
          x.description,
          zoneLabel(x.temp_zone),
          x.batch_no,
          x.expiry_date ? fmtDate(x.expiry_date) : "No expiry",
          x.pallets,
          `${qty(x.quantity)} ${x.unit}`,
        ])
      )
    : `<p><em>You now have no stock remaining in our warehouse.</em></p>`;

  const body = `
    <p>Dear ${esc(customer.name)},</p>
    <p>The following goods were <strong>${verb}</strong> on <strong>${fmtDate(o.dispatched_at)}</strong>.</p>
    <p style="margin:0">Order: <strong>${esc(o.number)}</strong>${o.reference ? ` &nbsp;·&nbsp; Your reference: <strong>${esc(o.reference)}</strong>` : ""}${o.collected_by ? ` &nbsp;·&nbsp; Collected by: ${esc(o.collected_by)}` : ""}</p>
    <h3 style="margin:20px 0 0;font-size:15px;color:#0b2559">${verb === "collected" ? "Collected" : "Dispatched"} – ${goneRows.length} pallet${goneRows.length === 1 ? "" : "s"}</h3>
    ${emailTable(
      ["Pallet", "Goods", "Batch", "Expiry date", "Qty"],
      goneRows.map((p) => [
        p.label,
        p.description,
        p.batch_no,
        p.expiry_date ? fmtDate(p.expiry_date) : "No expiry",
        `${qty(p.quantity)} ${p.unit}`,
      ])
    )}
    <h3 style="margin:20px 0 0;font-size:15px;color:#0b2559">Remaining in our warehouse – ${leftPallets} pallet${leftPallets === 1 ? "" : "s"}</h3>
    ${remaining}`;

  const res = await sendEmail({
    kind: "goods_out",
    to: customer.email,
    subject: `Goods ${verb} – ${goneRows.length} pallet${goneRows.length === 1 ? "" : "s"} (${o.number}), ${leftPallets} remaining`,
    html: await emailLayout(company, `Goods ${verb}`, body),
    customerId: customer.id,
    relatedId: o.id,
  });
  if (res.ok) await db.from("goods_out").update({ notified_at: new Date().toISOString() }).eq("id", o.id);
  return res;
}

/** Weekly digest per customer of pallets that have expired or will within their alert window. */
export async function sendExpiryAlerts(): Promise<{ customers: number; sent: number }> {
  const db = createAdminClient();
  const { data: s } = await db.from("company_settings").select("company_name, expiry_alert_days").single();
  const company = s?.company_name ?? "BIT Storage";
  const { data: customers } = await db
    .from("customers")
    .select("id, name, email, expiry_alert_days")
    .eq("is_active", true);

  let sent = 0;
  let withStock = 0;
  for (const c of customers ?? []) {
    const days = c.expiry_alert_days ?? s?.expiry_alert_days ?? 30;
    const cutoff = addDays(todayISO(), days);
    const { data: summary } = await db
      .from("stock_summary")
      .select("*")
      .eq("customer_id", c.id)
      .not("expiry_date", "is", null)
      .lte("expiry_date", cutoff)
      .order("expiry_date");
    const rows = (summary ?? []) as SummaryRow[];
    if (!rows.length) continue;
    withStock += 1;
    const pallets = rows.reduce((n, r) => n + r.pallets, 0);
    const today = todayISO();
    const body = `
      <p>Dear ${esc(c.name)},</p>
      <p>The following stock in our warehouse has expired or will expire within the next <strong>${days} days</strong>.</p>
      ${emailTable(
        ["Goods", "Storage", "Batch", "Expiry date", "Status", "Pallets", "Total qty"],
        rows.map((x) => [
          x.description,
          zoneLabel(x.temp_zone),
          x.batch_no,
          fmtDate(x.expiry_date),
          (x.expiry_date ?? "") < today ? "EXPIRED" : "Expiring soon",
          x.pallets,
          `${qty(x.quantity)} ${x.unit}`,
        ])
      )}
      <p>Please let us know how you would like us to handle this stock, or request a collection from the customer portal.</p>`;
    const res = await sendEmail({
      kind: "expiry",
      to: c.email,
      subject: `Stock expiry notice – ${pallets} pallet${pallets === 1 ? "" : "s"} expired or expiring soon`,
      html: await emailLayout(company, "Stock expiry notice", body),
      customerId: c.id,
    });
    if (res.ok) sent += 1;
  }
  return { customers: withStock, sent };
}
