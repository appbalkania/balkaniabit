import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TBRow = { code: string; name: string; category: string; debit: number; credit: number };

export const CATEGORY_LABEL: Record<string, string> = {
  sales: "Sales",
  purchases: "Purchases",
  direct_expenses: "Direct expenses",
  overheads: "Overheads",
  fixed_assets: "Fixed assets",
  current_assets: "Current assets",
  current_liabilities: "Current liabilities",
  long_term_liabilities: "Long-term liabilities",
  capital_reserves: "Capital & reserves",
};

export async function trialBalance(db: SupabaseClient, from: string | null, to: string | null): Promise<TBRow[]> {
  const { data, error } = await db.rpc("report_trial_balance", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return ((data ?? []) as TBRow[]).map((r) => ({ ...r, debit: Number(r.debit), credit: Number(r.credit) }));
}

/** Natural-sign balance: income / liabilities / capital positive when in credit, everything else when in debit. */
export function balance(r: TBRow) {
  return ["sales", "current_liabilities", "long_term_liabilities", "capital_reserves"].includes(r.category) ? r.credit - r.debit : r.debit - r.credit;
}

export function profitAndLoss(rows: TBRow[]) {
  const by = (c: string) => rows.filter((r) => r.category === c).map((r) => ({ ...r, amount: balance(r) }));
  const sum = (xs: { amount: number }[]) => xs.reduce((n, x) => n + x.amount, 0);
  const sales = by("sales");
  const purchases = by("purchases");
  const direct = by("direct_expenses");
  const overheads = by("overheads");
  const gross = sum(sales) - sum(purchases) - sum(direct);
  return { sales, purchases, direct, overheads, totals: { sales: sum(sales), purchases: sum(purchases), direct: sum(direct), overheads: sum(overheads), gross, net: gross - sum(overheads) } };
}

export const r2 = (n: number) => Math.round(n * 100) / 100;
