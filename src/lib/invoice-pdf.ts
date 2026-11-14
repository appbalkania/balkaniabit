import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { LOGO_JPEG_BASE64 } from "./logo-data";
import { fmtDate, isDirectDebit, money, qty } from "./format";

export type InvoiceForPdf = {
  number: string;
  status: string;
  issue_date: string;
  due_date: string;
  period_start: string | null;
  period_end: string | null;
  net: number;
  vat: number;
  total: number;
  amount_paid: number;
  lines: { description: string; quantity: number; unit_price: number; net: number; vat: number; vat_rate: number }[];
  customer: {
    account_ref: string;
    name: string;
    address: string | null;
    postcode: string | null;
    vat_number: string | null;
    payment_method: string;
    has_saved_method: boolean;
  };
  company: {
    company_name: string;
    tagline: string | null;
    legal_name: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    vat_number: string | null;
    company_number: string | null;
    bank_details: string | null;
  };
};

const NAVY = rgb(0.043, 0.145, 0.349);
const GREEN = rgb(0.039, 0.604, 0.478);
const GREY = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.88, 0.9, 0.93);
const BLACK = rgb(0.07, 0.09, 0.15);

// The built-in PDF fonts only cover Latin-1; swap anything else so drawing never throws.
const safe = (s: unknown) =>
  String(s ?? "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF€\n]/g, "?"); // € = euro, present in the PDF's WinAnsi encoding

function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const out: string[] = [];
  for (const para of safe(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}

export async function renderInvoicePdf(inv: InvoiceForPdf): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${inv.number}`);
  pdf.setAuthor(inv.company.company_name);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const W = 595.28;
  const H = 841.89;
  const M = 42;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const text = (s: string, x: number, yy: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) =>
    page.drawText(safe(s), { x, y: yy, size: o.size ?? 9.5, font: o.font ?? font, color: o.color ?? BLACK });
  const right = (s: string, xRight: number, yy: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => {
    const f = o.font ?? font;
    const size = o.size ?? 9.5;
    text(s, xRight - f.widthOfTextAtSize(safe(s), size), yy, o);
  };

  // ---- header: logo left, company details right ----
  try {
    const logo = await pdf.embedJpg(Buffer.from(LOGO_JPEG_BASE64, "base64"));
    const w = 150;
    const h = (logo.height / logo.width) * w;
    page.drawImage(logo, { x: M - 6, y: y - h + 8, width: w, height: h });
  } catch {
    text(inv.company.company_name, M, y - 20, { size: 18, font: bold, color: NAVY });
  }
  let cy = y;
  right(inv.company.legal_name || inv.company.company_name, W - M, cy, { font: bold, size: 10.5, color: NAVY });
  cy -= 13;
  for (const l of wrap(inv.company.address ?? "", font, 8.5, 220)) {
    if (l) {
      right(l, W - M, cy, { size: 8.5, color: GREY });
      cy -= 11;
    }
  }
  for (const l of [inv.company.phone, inv.company.email].filter(Boolean) as string[]) {
    right(l, W - M, cy, { size: 8.5, color: GREY });
    cy -= 11;
  }
  if (inv.company.vat_number) {
    right(`VAT No. ${inv.company.vat_number}`, W - M, cy, { size: 8.5, color: GREY });
    cy -= 11;
  }
  y = Math.min(y - 86, cy - 8);

  // ---- title ----
  text(inv.status === "void" ? "INVOICE (VOID)" : "INVOICE", M, y, { size: 20, font: bold, color: NAVY });
  right(inv.number, W - M, y, { size: 14, font: bold, color: GREEN });
  y -= 14;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: NAVY });
  y -= 20;

  // ---- bill to / meta ----
  const top = y;
  text("INVOICE TO", M, y, { size: 7.5, font: bold, color: GREY });
  y -= 13;
  text(inv.customer.name, M, y, { font: bold, size: 10.5 });
  y -= 13;
  for (const l of wrap([inv.customer.address, inv.customer.postcode].filter(Boolean).join("\n"), font, 9.5, 240)) {
    if (l) {
      text(l, M, y);
      y -= 12;
    }
  }
  if (inv.customer.vat_number) {
    text(`VAT No. ${inv.customer.vat_number}`, M, y, { color: GREY, size: 8.5 });
    y -= 12;
  }

  let my = top;
  const meta: [string, string][] = [
    ["Invoice date", fmtDate(inv.issue_date)],
    ["Due date", fmtDate(inv.due_date)],
    ["Account", inv.customer.account_ref],
  ];
  if (inv.period_start && inv.period_end) {
    meta.push(["Storage week", `${fmtDate(inv.period_start)} - ${fmtDate(inv.period_end)}`]);
  }
  for (const [k, v] of meta) {
    text(k, 340, my, { color: GREY, size: 8.5 });
    right(v, W - M, my, { font: bold });
    my -= 14;
  }
  y = Math.min(y, my) - 14;

  // ---- lines ----
  const col = { desc: M + 6, qty: 352, rate: 408, net: 470, vat: W - M - 6 };
  const header = () => {
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: NAVY });
    const o = { size: 8, font: bold, color: rgb(1, 1, 1) };
    text("DESCRIPTION", col.desc, y, o);
    right("QTY", col.qty, y, o);
    right("RATE", col.rate, y, o);
    right("NET", col.net, y, o);
    right("VAT", col.vat, y, o);
    y -= 22;
  };
  header();
  for (const l of inv.lines) {
    const lines = wrap(l.description, font, 9.5, col.qty - 50 - col.desc);
    const height = lines.length * 12 + 8;
    if (y - height < M + 150) {
      page = pdf.addPage([W, H]);
      y = H - M;
      header();
    }
    lines.forEach((s, i) => text(s, col.desc, y - i * 12));
    right(qty(l.quantity), col.qty, y);
    right(money(l.unit_price), col.rate, y);
    right(money(l.net), col.net, y);
    right(`${money(l.vat)} (${Math.round(Number(l.vat_rate) * 100)}%)`, col.vat, y, { size: 8.5 });
    y -= height;
    // divider sits in the gap between this row's descenders and the next row's capitals
    page.drawLine({ start: { x: M, y: y + 13 }, end: { x: W - M, y: y + 13 }, thickness: 0.5, color: LINE });
  }

  // ---- totals ----
  y -= 8;
  const balance = Number(inv.total) - Number(inv.amount_paid);
  const totals: [string, string, boolean][] = [
    ["Net", money(inv.net), false],
    ["VAT", money(inv.vat), false],
    ["Total", money(inv.total), true],
  ];
  if (Number(inv.amount_paid) > 0) {
    totals.push(["Paid", `-${money(inv.amount_paid)}`, false], ["Balance due", money(balance), true]);
  }
  for (const [k, v, strong] of totals) {
    text(k, 400, y, { font: strong ? bold : font, color: strong ? NAVY : GREY, size: strong ? 11 : 9.5 });
    right(v, W - M - 6, y, { font: strong ? bold : font, size: strong ? 11 : 9.5, color: strong ? NAVY : BLACK });
    y -= strong ? 18 : 14;
  }

  // ---- how to pay ----
  y -= 10;
  page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.5, color: LINE });
  y -= 8;
  text("PAYMENT", M, y, { size: 7.5, font: bold, color: GREY });
  y -= 13;
  let how: string;
  if (balance <= 0) how = "This invoice has been paid in full. Thank you.";
  else if (inv.customer.has_saved_method && isDirectDebit(inv.customer.payment_method))
    how = `The balance of ${money(balance)} will be collected by Direct Debit. You do not need to do anything.`;
  else if (inv.customer.has_saved_method && inv.customer.payment_method === "card")
    how = `The balance of ${money(balance)} will be charged to your card on file. You do not need to do anything.`;
  else
    how =
      `Please pay ${money(balance)} by ${fmtDate(inv.due_date)}, quoting ${inv.number}. ` +
      `You can pay online by card or set up Direct Debit in the customer portal.` +
      (inv.company.bank_details ? `\nBank transfer: ${inv.company.bank_details}` : "");
  for (const l of wrap(how, font, 9.5, W - 2 * M)) {
    text(l, M, y);
    y -= 12;
  }

  // ---- footer on every page ----
  const foot = [
    inv.company.legal_name || inv.company.company_name,
    inv.company.company_number ? `Company Reg. No. ${inv.company.company_number}` : null,
    inv.company.vat_number ? `VAT No. ${inv.company.vat_number}` : null,
  ]
    .filter(Boolean)
    .join("  |  ");
  for (const p of pdf.getPages()) {
    const w = font.widthOfTextAtSize(safe(foot), 7.5);
    p.drawText(safe(foot), { x: (W - w) / 2, y: 24, size: 7.5, font, color: GREY });
  }

  return Buffer.from(await pdf.save());
}
