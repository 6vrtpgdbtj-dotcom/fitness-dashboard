// Only the server Auth client owns refresh sessions. Realtime receives a short-
// lived access token through the authenticated same-origin handoff endpoint.
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_APP_URL?.startsWith("https:") === true,
    sameSite: "lax" as const,
    path: "/",
  };
}
