import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Turns the tokens Supabase puts in the URL fragment (#access_token=...) into the
// session cookie. Invitation links from Supabase's default email template arrive this
// way, and the fragment never reaches the server, so <HashSession> posts it here.
export async function POST(request: NextRequest) {
  // only accept calls from our own pages
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  }

  let body: { access_token?: unknown; refresh_token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const access_token = typeof body.access_token === "string" ? body.access_token : "";
  const refresh_token = typeof body.refresh_token === "string" ? body.refresh_token : "";
  if (!access_token || !refresh_token) {
    return NextResponse.json({ error: "Missing tokens" }, { status: 400 });
  }

  // setSession checks the access token with Supabase before writing the cookie
  const supabase = await createClient();
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) return NextResponse.json({ error: error.message }, { status: 401 });
  return NextResponse.json({ ok: true });
}
