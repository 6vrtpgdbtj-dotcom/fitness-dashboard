import type { SupabaseClient } from "@supabase/supabase-js";

export type UserScope = { id: string; role: "admin" | "trainer"; trainerId: string | null };
export type ScopeResult = { user: UserScope; error: null } | { user: null; error: "unauthenticated" | "not-approved" };

// Always verify the user with Auth; never authorize from cookie session claims
// or user-editable OAuth metadata. Profiles are managed by approved admins.
export async function readUserScope(client: SupabaseClient): Promise<ScopeResult> {
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return { user: null, error: "unauthenticated" };

  const { data: profile, error } = await client.from("profiles")
    .select("id, organization_id, role, trainer_id, is_active")
    .eq("id", user.id).maybeSingle();

  if (error || !profile || profile.id !== user.id || !profile.organization_id ||
    profile.is_active !== true || !["admin", "trainer"].includes(profile.role) ||
    (profile.role === "trainer" && !profile.trainer_id)) {
    return { user: null, error: "not-approved" };
  }

  return { user: { id: user.id, role: profile.role, trainerId: profile.role === "trainer" ? profile.trainer_id : null }, error: null };
}
