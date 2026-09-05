"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/auth/app-url";

export async function signInWithGoogle() {
  let url: string | null = null;
  try {
    const client = await createClient();
    const result = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${appOrigin()}/auth/callback` },
    });
    if (!result.error) url = result.data.url;
  } catch {
    redirect("/login?error=configuration");
  }
  redirect(url ?? "/login?error=oauth");
}
