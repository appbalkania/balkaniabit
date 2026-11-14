import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { sageExchangeCode } from "@/lib/sage/api";

// Sage redirects here after the admin approves the connection.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const done = (kind: "ok" | "error", msg: string) => NextResponse.redirect(`${origin}/admin/sage?${kind}=${encodeURIComponent(msg)}`);

  const session = await getSession();
  if (!session || session.profile.role !== "admin") return done("error", "Only an admin can connect Sage");

  const jar = await cookies();
  const expected = jar.get("sage_oauth_state")?.value;
  jar.delete("sage_oauth_state");
  const code = req.nextUrl.searchParams.get("code");
  if (!code || !expected || req.nextUrl.searchParams.get("state") !== expected) return done("error", "Sage connection could not be verified - please try again");

  try {
    await sageExchangeCode(code);
  } catch (e) {
    return done("error", e instanceof Error ? e.message : "Sage connection failed");
  }
  return done("ok", "Connected to Sage");
}
