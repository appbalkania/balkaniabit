import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Landing point for links in Supabase emails (password reset, invites).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/dashboard";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  // No ?code: either the link failed, or Supabase sent the session in the #fragment,
  // which survives this redirect and is picked up by <HashSession> on the login page.
  if (code || searchParams.get("error")) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("That link has expired - please request a new one")}`);
  }
  return NextResponse.redirect(`${origin}/login`);
}
