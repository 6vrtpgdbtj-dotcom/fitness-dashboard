import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserScope } from "@/lib/auth/user-scope";
import type { AnalyticsRows } from "./types";

const fields = {
  members:
    "id,trainer_id,record_status,name,status,remaining_sessions,expected_end_date",
  registrations:
    "id,trainer_id,record_status,member_id,registration_date,registration_type,paid_amount,registered_sessions,acquisition_source,status",
  leads:
    "id,trainer_id,record_status,member_id,lead_date,consultation_date,status,is_registered,acquisition_source",
  classes:
    "id,trainer_id,record_status,member_id,class_date,starts_at,status,deducted_sessions,remaining_sessions",
  trainers: "id,display_name",
  connections: "id,display_name,status,last_successful_sync_at",
};

/** Use the cookie-bound client, never the service-role client. RLS owns organization
 * isolation; explicit trainer predicates and valid-only reads further constrain data.
 * Pagination prevents silent truncation at the default PostgREST row limit. */
export async function readAnalyticsRows(
  client: SupabaseClient,
  scope: UserScope,
) {
  if (scope.role === "trainer" && !scope.trainerId)
    throw new Error("trainer_scope_required");
  const read = async <K extends keyof AnalyticsRows>(
    key: K,
  ): Promise<AnalyticsRows[K]> => {
    if (key === "connections" && scope.role !== "admin") return [];
    const rows: unknown[] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = client
        .from(key === "connections" ? "sheet_connections" : key)
        .select(fields[key])
        .order("id")
        .range(offset, offset + 999);
      if (["members", "registrations", "leads", "classes"].includes(key)) {
        query = query.eq("record_status", "valid");
        if (scope.role === "trainer")
          query = query.eq("trainer_id", scope.trainerId!);
      } else if (key === "trainers" && scope.role === "trainer")
        query = query.eq("id", scope.trainerId!);
      if (key === "connections") query = query.eq("is_active", true);
      const { data, error } = await query;
      if (error || !data) throw new Error("dashboard_unavailable");
      rows.push(...data);
      if (data.length < 1000) break;
    }
    return rows as AnalyticsRows[K];
  };
  const [
    members,
    registrations,
    leads,
    classes,
    trainers,
    connections,
    profile,
  ] = await Promise.all([
    read("members"),
    read("registrations"),
    read("leads"),
    read("classes"),
    read("trainers"),
    read("connections"),
    client
      .from("profiles")
      .select("organization_id")
      .eq("id", scope.id)
      .eq("is_active", true)
      .single(),
  ]);
  if (profile.error || !profile.data?.organization_id)
    throw new Error("dashboard_unavailable");
  return {
    rows: { members, registrations, leads, classes, trainers, connections },
    realtimeTopic:
      scope.role === "admin"
        ? `org:${profile.data.organization_id}`
        : `org:${profile.data.organization_id}:trainer:${scope.trainerId}`,
  };
}
