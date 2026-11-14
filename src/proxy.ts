import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Keeps the Supabase session cookie fresh and bounces signed-out visitors to /login.
// This is only a convenience check: every page and action re-verifies the user and
// the database enforces access with row level security.
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const path = request.nextUrl.pathname;

  if (!url || !key) {
    // not configured yet: show the setup checklist
    if (path === "/setup") return NextResponse.next();
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && (path.startsWith("/admin") || path.startsWith("/portal"))) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  // everything except static assets and API routes (which authenticate themselves)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
