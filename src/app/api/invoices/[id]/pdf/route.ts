import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadInvoice } from "@/lib/billing";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { isUuid } from "@/lib/action";

// Invoice PDF for finance staff, or for the customer the invoice belongs to.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  if (!isUuid(id)) return new NextResponse("Not found", { status: 404 });

  // authorise with the user's own (row-level-secured) client first
  const { data: visible } = await session.supabase.from("invoices").select("id").eq("id", id).neq("status", "draft").maybeSingle();
  const { role } = session.profile;
  if (!visible || role === "warehouse") return new NextResponse("Not found", { status: 404 });

  const loaded = await loadInvoice(createAdminClient(), id);
  if (!loaded) return new NextResponse("Not found", { status: 404 });
  const pdf = await renderInvoicePdf(loaded.forPdf);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${loaded.inv.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
