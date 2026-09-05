import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { readUserScope, type UserScope } from "./user-scope";

export async function requireUser(): Promise<UserScope> {
  const result = await readUserScope(await createClient());
  if (!result.user) redirect(result.error === "unauthenticated" ? "/login" : "/login?error=not-approved");
  return result.user;
}
