import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/auth/csrf";
import { readUserScope } from "@/lib/auth/user-scope";
import { manualSyncResponse } from "@/features/sync/http-handlers";
import { getSyncService } from "@/features/sync/production-runtime";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossOrigin(_request);
  if (rejected) return rejected;
  const client = await createClient();
  const scope = await readUserScope(client);
  if (!scope.user) return new Response(null, { status: scope.error === "unauthenticated" ? 401 : 403 });
  if (scope.user.role !== "admin") return new Response(null, { status: 403 });
  const { data: profile, error } = await client.from("profiles").select("organization_id").eq("id", scope.user.id).maybeSingle();
  if (error || !profile?.organization_id) return new Response(null, { status: 403 });
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return new Response(null, { status: 400 });
  return manualSyncResponse(id, { role: scope.user.role, organizationId: profile.organization_id }, getSyncService());
}
