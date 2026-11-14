import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { buildSage50Csv } from "@/lib/sage/csv";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["admin", "accounts"].includes(session.profile.role)) return new NextResponse("Not allowed", { status: 403 });
  const p = req.nextUrl.searchParams;
  const from = p.get("from") ?? "";
  const to = p.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return new NextResponse("Bad dates", { status: 400 });
  // uses the user's own client, so finance-only row level security applies
  const out = await buildSage50Csv(session.supabase, from, to, p.get("only_new") === "1");
  return new NextResponse(out.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sage-import-${from}-to-${to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
