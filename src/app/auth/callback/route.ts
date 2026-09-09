import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readUserScope } from "@/lib/auth/user-scope";
import { appOrigin } from "@/lib/auth/app-url";

export async function GET(request: NextRequest) {
  const origin = appOrigin();
  function redirectTo(path: string) {
    const response = NextResponse.redirect(new URL(path, origin));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  const code = request.nextUrl.searchParams.get("code");
  if (!code || request.nextUrl.searchParams.has("error")) return redirectTo("/login?error=oauth");

  const client = await createClient();
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) return redirectTo("/login?error=oauth");

  let result = await readUserScope(client);
  if (!result.user && result.error === "not-approved") {
    const claimed = await client.rpc("claim_trainer_invitation");
    if (!claimed.error && claimed.data === true) result = await readUserScope(client);
  }
  if (!result.user) {
    await client.auth.signOut();
    return redirectTo("/login?error=not-approved");
  }
  return redirectTo("/dashboard");
}
