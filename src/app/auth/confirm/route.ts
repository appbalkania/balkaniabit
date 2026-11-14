import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Landing point for invitation and password-reset emails. The Supabase email templates
// must point here (see README "Email templates"):
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/account
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/account
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const nextParam = searchParams.get("next") ?? "/account";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/account";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      const msg = type === "invite" || type === "recovery" ? "?ok=" + encodeURIComponent("Welcome - please choose a password now") : "";
      return NextResponse.redirect(`${origin}${next}${msg}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("That link has expired or was already used - please request a new one")}`);
}
