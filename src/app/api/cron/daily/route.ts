import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorised } from "@/lib/cron";
import { processPendingInvoices } from "@/lib/billing";
import { sageStatus, sagePushOutstanding } from "@/lib/sage/api";

export const maxDuration = 300;

// Every night: pick up any invoice that was issued but not yet emailed/charged, and push
// new invoices + receipts to Sage Accounting (cloud) when it is connected.
export async function GET(req: NextRequest) {
  if (!cronAuthorised(req)) return new NextResponse("Unauthorised", { status: 401 });
  const pending = await processPendingInvoices(100);

  let sage: unknown = "not connected";
  if ((await sageStatus()).connected) {
    try {
      sage = await sagePushOutstanding(100);
    } catch (e) {
      sage = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return NextResponse.json({ ok: true, invoices_processed: pending.length, sage });
}
