import "server-only";
import { createClient } from "@/lib/supabase/server";
import { mapColumns } from "@/features/mapping/map-columns";
import { redactPhones } from "@/features/sync/normalize-fields";
import type { MappingDomain } from "@/features/mapping/types";
import type { AdminWorkspace } from "./types";
// Final output boundary also covers old imports that predate phone redaction.
function scrub(value: unknown): unknown {
  if (typeof value === "string") return redactPhones(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,scrub(v)]));
  return value;
}
type RawTab = { id: string; organization_id: string; source_connection_id: string; title: string; domain: MappingDomain | null; header_row: number | null; rows: unknown[][] | null; headers: unknown[]; mapping: { domain: MappingDomain; headerRowIndex: number; fields: { sourceHeader: string; field: string | null }[] } | null };
export async function readAdminWorkspace(): Promise<AdminWorkspace> {
  const { data, error } = await (await createClient()).rpc("admin_workspace");
  if (error || !data) throw new Error("관리자 데이터를 불러오지 못했습니다.");
  const raw = data as Omit<AdminWorkspace,"tabs"> & { tabs: RawTab[] };
  const tabs = raw.tabs.map(tab => {
    const domain = tab.domain ?? tab.mapping?.domain ?? "member";
    const rows = tab.rows ?? [tab.headers];
    const mappingResult = mapColumns({ organizationId: tab.organization_id, sourceConnectionId: tab.source_connection_id, sourceTabId: tab.id, domain, tabTitle: tab.title, rows,
      ...(tab.header_row ? { headerRowIndex: tab.header_row - 1 } : {}) }, tab.mapping ? [{ organizationId: tab.organization_id, sourceConnectionId: tab.source_connection_id, sourceTabId: tab.id, domain, version: 1, headerRowIndex: tab.mapping.headerRowIndex, columns: tab.mapping.fields }] : []);
    return { id: tab.id, source_connection_id: tab.source_connection_id, title: tab.title, domain: tab.domain, mappingResult };
  });
  return scrub({ ...raw, tabs }) as AdminWorkspace;
}
