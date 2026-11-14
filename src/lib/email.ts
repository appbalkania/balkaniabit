import "server-only";
import { Resend } from "resend";
import { createAdminClient } from "./supabase/server";
import { esc } from "./format";

export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export type EmailResult = { ok: boolean; skipped?: boolean; error?: string };

type SendArgs = {
  kind: "invoice" | "goods_in" | "goods_out" | "expiry" | "payment_failed";
  to: string | null | undefined;
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer }[];
  customerId?: string | null;
  relatedId?: string | null;
};

/**
 * Send one email through Resend and record the outcome in email_log.
 * Never throws: a mail failure must not undo the warehouse / billing action that triggered it.
 */
export async function sendEmail(args: SendArgs): Promise<EmailResult> {
  let result: EmailResult;
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!args.to) {
    result = { ok: false, skipped: true, error: "Customer has no email address" };
  } else if (!key || !from) {
    result = { ok: false, skipped: true, error: "Email is not configured (RESEND_API_KEY / EMAIL_FROM)" };
  } else {
    try {
      const { error } = await new Resend(key).emails.send({
        from,
        to: args.to.split(/[,;]\s*/).filter(Boolean),
        subject: args.subject,
        html: args.html,
        attachments: args.attachments,
      });
      result = error ? { ok: false, error: error.message } : { ok: true };
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  try {
    await createAdminClient().from("email_log").insert({
      kind: args.kind,
      recipient: args.to ?? null,
      subject: args.subject,
      customer_id: args.customerId ?? null,
      related_id: args.relatedId ?? null,
      status: result.ok ? "sent" : result.skipped ? "skipped" : "failed",
      error: result.error ?? null,
    });
  } catch {
    // logging is best-effort
  }
  return result;
}

/** Shared branded wrapper for every customer email. */
export async function emailLayout(company: string, heading: string, bodyHtml: string) {
  let tagline = "";
  let address = "";
  let legal = "";
  try {
    const { data } = await createAdminClient().from("company_settings").select("tagline, address, legal_name").single();
    tagline = data?.tagline ?? "";
    address = (data?.address ?? "").replace(/\s*\n\s*/g, ", ");
    legal = data?.legal_name && data.legal_name !== company ? data.legal_name : "";
  } catch {
    // footer details are cosmetic
  }
  const brand = [legal ? `${company} (${legal})` : company, tagline].filter(Boolean).join(" – ");
  return `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#111827">
<div style="max-width:680px;margin:0 auto;padding:24px 12px">
  <div style="background:#fff;border:1px solid #e5e7eb;border-bottom:0;padding:16px 24px;border-radius:8px 8px 0 0">
    <img src="${APP_URL}/palletpoint-logo.jpg" alt="${esc(brand)}" width="180" style="display:block;width:180px;height:auto;border:0" />
  </div>
  <div style="background:#0b2559;color:#fff;padding:12px 24px">
    <div style="font-size:16px;font-weight:bold">${esc(heading)}</div>
  </div>
  <div style="background:#fff;border:1px solid #e5e7eb;border-top:0;padding:24px;border-radius:0 0 8px 8px;font-size:14px;line-height:1.5">
    ${bodyHtml}
  </div>
  <div style="font-size:12px;color:#6b7280;padding:12px 4px">
    ${esc([brand, address].filter(Boolean).join(" · "))}<br />
    This is an automatic message. View your stock, orders and invoices any time at
    <a href="${APP_URL}/portal" style="color:#0a9a7a">${APP_URL.replace(/^https?:\/\//, "")}</a>.
  </div>
</div></body></html>`;
}

/** Simple bordered HTML table for emails. Cell values are escaped. */
export function emailTable(headers: string[], rows: (string | number | null)[][]) {
  const th = headers
    .map(
      (h) =>
        `<th style="text-align:left;padding:8px 10px;background:#eef2fa;border:1px solid #d9e0ee;font-size:12px;text-transform:uppercase;color:#0b2559">${esc(h)}</th>`
    )
    .join("");
  const trs = rows
    .map(
      (r) =>
        `<tr>${r.map((c) => `<td style="padding:8px 10px;border:1px solid #e5e7eb">${esc(c ?? "—")}</td>`).join("")}</tr>`
    )
    .join("");
  return `<table style="border-collapse:collapse;width:100%;margin:12px 0;font-size:13px"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}
