import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { readUserScope } from "@/lib/auth/user-scope";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  function redirectTo(path: string) {
    const redirected = NextResponse.redirect(new URL(path, request.url));
    response.cookies.getAll().forEach((cookie) => redirected.cookies.set(cookie));
    redirected.headers.set("Cache-Control", "private, no-store");
    return redirected;
  }
  let config;
  try {
    config = getSupabaseConfig();
  } catch {
    return redirectTo("/login?error=configuration");
  }
  const client = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const result = await readUserScope(client);
  if (!result.user) return redirectTo(result.error === "unauthenticated" ? "/login" : "/login?error=not-approved");
  if (request.nextUrl.pathname.startsWith("/settings") && result.user.role !== "admin") return redirectTo("/dashboard");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

// Route groups do not appear in URLs. Keep all dashboard entry points here;
// server pages/actions/APIs must also call requireUser at their data boundary.
export const config = {
  matcher: ["/dashboard/:path*", "/members/:path*", "/registrations/:path*", "/leads/:path*", "/classes/:path*", "/settings/:path*"],
};
