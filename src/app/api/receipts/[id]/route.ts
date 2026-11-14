import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { isUuid } from "@/lib/action";

// Short-lived link to an expense receipt. Finance staff only (enforced by RLS on both
// the expenses table and the private "receipts" storage bucket).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !isUuid(id)) return new NextResponse("Not found", { status: 404 });
  const { data: e } = await session.supabase.from("expenses").select("receipt_path").eq("id", id).maybeSingle();
  if (!e?.receipt_path) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await session.supabase.storage.from("receipts").createSignedUrl(e.receipt_path, 60);
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
