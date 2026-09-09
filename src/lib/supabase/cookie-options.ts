// Browser Supabase Realtime currently shares the SSR session; see security review
// for the HttpOnly limitation. Never send these cookies over HTTP in production.
export function sessionCookieOptions() {
  return {
    secure: process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_APP_URL?.startsWith("https:") === true,
    sameSite: "lax" as const,
    path: "/",
  };
}
