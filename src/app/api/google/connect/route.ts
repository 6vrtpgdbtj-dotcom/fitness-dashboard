import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { createGoogleAuthorizationUrl, createGoogleOAuthState } from "@/lib/google/oauth";

const stateCookie = "google_oauth_state";

export async function GET() {
  const user = await requireUser();
  if (user.role !== "admin") return NextResponse.redirect(new URL("/dashboard", process.env.NEXT_PUBLIC_APP_URL));

  const state = createGoogleOAuthState();
  const response = NextResponse.redirect(createGoogleAuthorizationUrl(state));
  response.cookies.set(stateCookie, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/api/google/callback",
    maxAge: 10 * 60,
  });
  return response;
}
