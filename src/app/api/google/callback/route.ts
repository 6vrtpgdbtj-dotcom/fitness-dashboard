import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { createGoogleOAuthClient, saveGoogleCredentials } from "@/lib/google/oauth";
import { getOrganizationId } from "@/lib/google/sheets";
import { appOrigin } from "@/lib/auth/app-url";

const stateCookie = "google_oauth_state";

export async function GET(request: NextRequest) {
  const user = await requireUser();
  // Every terminal response consumes the nonce and uses the trusted app origin.
  function redirectTo(path: string) {
    const response = NextResponse.redirect(new URL(path, appOrigin()));
    response.cookies.delete({ name: stateCookie, path: "/api/google/callback" });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  if (user.role !== "admin") return redirectTo("/dashboard");

  const expectedState = request.cookies.get(stateCookie)?.value;
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  if (!expectedState || !state || state !== expectedState || !code || request.nextUrl.searchParams.has("error")) {
    return redirectTo("/settings/sheets?error=oauth");
  }

  try {
    const { tokens } = await createGoogleOAuthClient().getToken(code);
    const organizationId = await getOrganizationId(user.id);
    await saveGoogleCredentials({ organizationId, profileId: user.id, credentials: tokens });
    return redirectTo("/settings/sheets");
  } catch {
    return redirectTo("/settings/sheets?error=oauth");
  }
}
