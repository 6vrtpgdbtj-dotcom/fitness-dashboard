import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { createGoogleOAuthClient, saveGoogleCredentials } from "@/lib/google/oauth";
import { getOrganizationId } from "@/lib/google/sheets";

const stateCookie = "google_oauth_state";

export async function GET(request: NextRequest) {
  const user = await requireUser();
  if (user.role !== "admin") return NextResponse.redirect(new URL("/dashboard", request.url));

  const expectedState = request.cookies.get(stateCookie)?.value;
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const response = NextResponse.redirect(new URL("/settings/sheets", request.url));
  response.cookies.delete({ name: stateCookie, path: "/api/google/callback" });

  if (!expectedState || !state || state !== expectedState || !code) {
    return NextResponse.redirect(new URL("/settings/sheets?error=oauth", request.url));
  }

  try {
    const { tokens } = await createGoogleOAuthClient().getToken(code);
    const organizationId = await getOrganizationId(user.id);
    await saveGoogleCredentials({ organizationId, profileId: user.id, credentials: tokens });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/settings/sheets?error=oauth", request.url));
  }
}
