import "server-only";
import { createAdminClient } from "../supabase/server";
import { APP_URL } from "../email";

// Sage Business Cloud Accounting (the online product) - REST API v3.1.
// Docs: https://developer.sage.com/accounting/reference/
//
// NOTE: written against Sage's published API but NOT yet exercised against a live Sage
// company. Connect a Sage trial/demo company and push one invoice before relying on it.
// Sage 50 (desktop) has no cloud API: use the CSV export instead (lib/sage/csv.ts).

const AUTH_URL = "https://www.sageone.com/oauth2/auth/central";
const TOKEN_URL = "https://oauth.accounting.sage.com/token";
const API = "https://api.accounting.sage.com/v3.1";

type Db = ReturnType<typeof createAdminClient>;

export const sageConfigured = () => Boolean(process.env.SAGE_CLIENT_ID && process.env.SAGE_CLIENT_SECRET);
export const sageRedirectUri = () => `${APP_URL}/api/sage/callback`;

export function sageAuthUrl(state: string) {
  const p = new URLSearchParams({
    filter: "apiv3.1",
    response_type: "code",
    client_id: process.env.SAGE_CLIENT_ID ?? "",
    redirect_uri: sageRedirectUri(),
    scope: "full_access",
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: process.env.SAGE_CLIENT_ID ?? "",
      client_secret: process.env.SAGE_CLIENT_SECRET ?? "",
      ...params,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Sage sign-in failed (${res.status}): ${JSON.stringify(json).slice(0, 200)}`);
  return json as { access_token: string; refresh_token: string; expires_in: number };
}

async function saveTokens(db: Db, t: { access_token: string; refresh_token: string; expires_in: number }) {
  const { error } = await db.from("integrations").upsert({
    provider: "sage",
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + (t.expires_in - 30) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function sageExchangeCode(code: string) {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: sageRedirectUri() });
  await saveTokens(createAdminClient(), t);
}

export async function sageStatus() {
  const { data } = await createAdminClient().from("integrations").select("updated_at").eq("provider", "sage").maybeSingle();
  return { configured: sageConfigured(), connected: Boolean(data), since: data?.updated_at ?? null };
}

export async function sageDisconnect() {
  await createAdminClient().from("integrations").delete().eq("provider", "sage");
}

// Sage access tokens last 5 minutes; refresh tokens rotate on every use.
async function accessToken(db: Db) {
  const { data } = await db.from("integrations").select("*").eq("provider", "sage").maybeSingle();
  if (!data?.refresh_token) throw new Error("Sage is not connected");
  if (data.access_token && data.expires_at && new Date(data.expires_at) > new Date()) return data.access_token as string;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: data.refresh_token });
  await saveTokens(db, t);
  return t.access_token;
}

async function sage<T>(db: Db, method: string, path: string, body?: unknown): Promise<T> {
  const token = await accessToken(db);
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Sage ${method} ${path} failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  return json as T;
}

async function sageAll<T>(db: Db, path: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = `${path}${path.includes("?") ? "&" : "?"}items_per_page=200`;
  for (let page = 0; next && page < 20; page++) {
    const res: { $items: T[]; $next: string | null } = await sage(db, "GET", next);
    out.push(...res.$items);
    next = res.$next ? res.$next.replace(/^.*\/v3\.1/, "") : null;
  }
  return out;
}

// Sage tax rate ids are country-prefixed (IE_STANDARD, IE_ZERO, GB_STANDARD ...), so they are
// looked up from the connected Sage company rather than hard-coded: first by the usual id
// suffix for the Sage tax code, then by matching percentage.
const TAX_SUFFIX: Record<string, string> = { T0: "ZERO", T1: "STANDARD", T2: "EXEMPT", T9: "NO_TAX" };
type SageTaxRate = { id: string; percentage: string | number };

async function taxRateResolver(db: Db) {
  const rates = await sageAll<SageTaxRate>(db, "/tax_rates?attributes=percentage");
  return (taxCode: string, vatRate: number) => {
    const suffix = TAX_SUFFIX[taxCode];
    const bySuffix = suffix ? rates.find((r) => r.id.endsWith(`_${suffix}`)) : undefined;
    const byPercent = rates.find((r) => Math.abs(Number(r.percentage) - vatRate * 100) < 0.001);
    const hit = bySuffix ?? byPercent;
    if (!hit) throw new Error(`No Sage tax rate matches ${taxCode} (${vatRate * 100}%)`);
    return hit.id;
  };
}

const CATEGORY_BY_SAGE_TYPE: Record<string, string> = {
  SALES: "sales",
  OTHER_INCOME: "sales",
  DIRECT_EXPENSES: "direct_expenses",
  OVERHEADS: "overheads",
  DEPRECIATION: "overheads",
  FIXED_ASSETS: "fixed_assets",
  CURRENT_ASSETS: "current_assets",
  BANK: "current_assets",
  CURRENT_LIABILITY: "current_liabilities",
  FUTURE_LIABILITY: "long_term_liabilities",
  EQUITY: "capital_reserves",
};

type SageLedger = { id: string; nominal_code: number; name: string; ledger_account_type?: { id: string } };

/** Copy the chart of accounts from Sage into nominal_accounts so both systems use the same codes. */
export async function sageImportNominals() {
  const db = createAdminClient();
  const ledgers = await sageAll<SageLedger>(db, "/ledger_accounts?attributes=nominal_code,name,ledger_account_type");
  const rows = ledgers
    .filter((l) => l.nominal_code != null)
    .map((l) => ({
      code: String(l.nominal_code).padStart(4, "0"),
      name: l.name,
      category: CATEGORY_BY_SAGE_TYPE[l.ledger_account_type?.id ?? ""] ?? "overheads",
    }));
  if (rows.length) {
    const { error } = await db.from("nominal_accounts").upsert(rows, { onConflict: "code" });
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

async function ledgerIdsByCode(db: Db) {
  const ledgers = await sageAll<SageLedger>(db, "/ledger_accounts?attributes=nominal_code");
  return new Map(ledgers.map((l) => [String(l.nominal_code).padStart(4, "0"), l.id]));
}

async function ensureSageContact(db: Db, c: { id: string; name: string; account_ref: string; email: string | null; address: string | null; postcode: string | null; sage_contact_id: string | null }) {
  if (c.sage_contact_id) return c.sage_contact_id;
  const found = await sage<{ $items: { id: string; reference: string }[] }>(db, "GET", `/contacts?search=${encodeURIComponent(c.account_ref)}&contact_type_id=CUSTOMER&attributes=reference`);
  let id = found.$items.find((x) => x.reference === c.account_ref)?.id;
  if (!id) {
    const created = await sage<{ id: string }>(db, "POST", "/contacts", {
      contact: {
        name: c.name,
        reference: c.account_ref,
        contact_type_ids: ["CUSTOMER"],
        main_address: { address_line_1: (c.address ?? "").split("\n")[0] || undefined, postal_code: c.postcode ?? undefined },
        main_contact_person: c.email ? { name: c.name, email: c.email } : undefined,
      },
    });
    id = created.id;
  }
  await db.from("customers").update({ sage_contact_id: id }).eq("id", c.id);
  return id;
}

/** Push invoices and payments that Sage has not seen yet. Returns counts and any per-record errors. */
export async function sagePushOutstanding(limit = 25) {
  const db = createAdminClient();
  const ledgers = await ledgerIdsByCode(db);
  const taxRateId = await taxRateResolver(db);
  const errors: string[] = [];
  let invoices = 0;
  let payments = 0;

  const { data: invs } = await db
    .from("invoices")
    .select("id, number, issue_date, due_date, customers(id, name, account_ref, email, address, postcode, sage_contact_id), invoice_lines(id, description, quantity, unit_price, net, vat, vat_rate, tax_code, nominal_code)")
    .in("status", ["issued", "part_paid", "paid"])
    .is("sage_id", null)
    .order("number")
    .limit(limit);

  for (const inv of invs ?? []) {
    try {
      const customer = inv.customers as unknown as Parameters<typeof ensureSageContact>[1];
      const contactId = await ensureSageContact(db, customer);
      const lines = [...(inv.invoice_lines as { id: number; description: string; quantity: number; unit_price: number; net: number; vat: number; vat_rate: number; tax_code: string; nominal_code: string }[])].sort((a, b) => a.id - b.id);
      const created = await sage<{ id: string }>(db, "POST", "/sales_invoices", {
        sales_invoice: {
          contact_id: contactId,
          date: inv.issue_date,
          due_date: inv.due_date,
          reference: inv.number,
          invoice_lines: lines.map((l) => {
            const ledger = ledgers.get(l.nominal_code);
            if (!ledger) throw new Error(`Nominal ${l.nominal_code} does not exist in Sage`);
            return {
              description: l.description,
              ledger_account_id: ledger,
              quantity: Number(l.quantity),
              unit_price: Number(l.unit_price),
              net_amount: Number(l.net),
              tax_rate_id: taxRateId(l.tax_code, Number(l.vat_rate)),
              tax_amount: Number(l.vat),
              total_amount: Number(l.net) + Number(l.vat),
            };
          }),
        },
      });
      await db.from("invoices").update({ sage_id: created.id, sage_synced_at: new Date().toISOString(), sage_error: null }).eq("id", inv.id);
      invoices += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(`${inv.number}: ${message}`);
      await db.from("invoices").update({ sage_error: message.slice(0, 500) }).eq("id", inv.id);
    }
  }

  // receipts, allocated against the Sage invoice
  const { data: pays } = await db
    .from("payments")
    .select("id, date, amount, method, reference, invoices(number, sage_id), customers(sage_contact_id)")
    .is("sage_synced_at", null)
    .order("date")
    .limit(limit);
  const unsynced = (pays ?? []).filter((p) => (p.invoices as unknown as { sage_id: string | null }).sage_id);
  if (unsynced.length) {
    const banks = await sage<{ $items: { id: string }[] }>(db, "GET", "/bank_accounts");
    const bankId = banks.$items[0]?.id;
    for (const p of unsynced) {
      const inv = p.invoices as unknown as { number: string; sage_id: string };
      try {
        if (!bankId) throw new Error("No bank account found in Sage");
        await sage(db, "POST", "/contact_payments", {
          contact_payment: {
            transaction_type_id: "CUSTOMER_RECEIPT",
            payment_method_id: p.method === "card" ? "CREDIT_DEBIT" : p.method === "cash" ? "CASH" : "BANK_TRANSFER",
            contact_id: (p.customers as unknown as { sage_contact_id: string }).sage_contact_id,
            bank_account_id: bankId,
            date: p.date,
            total_amount: Number(p.amount),
            reference: (p.reference ?? inv.number).slice(0, 25),
            allocated_artefacts: [{ artefact_id: inv.sage_id, amount: Number(p.amount) }],
          },
        });
        await db.from("payments").update({ sage_synced_at: new Date().toISOString() }).eq("id", p.id);
        payments += 1;
      } catch (e) {
        errors.push(`Payment for ${inv.number}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return { invoices, payments, errors };
}
