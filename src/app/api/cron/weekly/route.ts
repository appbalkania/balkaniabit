import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorised } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/server";
import { processPendingInvoices } from "@/lib/billing";
import { sendExpiryAlerts } from "@/lib/notifications";

export const maxDuration = 300;

// Every Monday morning (vercel.json):
//   1. invoice every customer for last week's storage (frozen / chilled / ambient + extras)
//   2. email each invoice as a PDF and start card / Direct Debit collection
//   3. email customers whose stock is expired or about to expire
export async function GET(req: NextRequest) {
  if (!cronAuthorised(req)) return new NextResponse("Unauthorised", { status: 401 });
  const db = createAdminClient();

  const { data: created, error } = await db.rpc("run_weekly_billing", {});
  if (error) return NextResponse.json({ ok: false, step: "billing", error: error.message }, { status: 500 });

  const delivered = await processPendingInvoices(200);
  const expiry = await sendExpiryAlerts();
  return NextResponse.json({
    ok: true,
    invoices_created: (created as unknown[] | null)?.length ?? 0,
    invoices_processed: delivered.length,
    emailed: delivered.filter((d) => d.emailed).length,
    expiry_alerts: expiry,
  });
}
