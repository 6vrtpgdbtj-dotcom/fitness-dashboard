import { saveMappingVersion } from "../save-mapping-version";
import { mapColumns } from "../map-columns";
import type { ConfirmedColumn, MappingDomain } from "../types";

const state = vi.hoisted(() => ({ role: "admin", organizationId: "org-1", records: [] as Record<string, unknown>[], tabs: [] as Record<string, unknown>[], conflictOnce: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ id: "admin-1", role: state.role }) }));
// In-memory boundary double models scoped selects, append-only inserts and version collisions.
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  const filters: Record<string, unknown> = {};
  let inserted: Record<string, unknown> | undefined;
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { filters[key] = value; return query; },
    order: () => query,
    limit: () => query,
    insert: (row: Record<string, unknown>) => { inserted = row; return query; },
    maybeSingle: async () => {
      if (table === "profiles") return { data: { organization_id: state.organizationId }, error: null };
      const rows = table === "sheet_tabs" ? state.tabs : state.records;
      const matching = rows.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
      return { data: matching.sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0] ?? null, error: null };
    },
    single: async () => {
      if (!inserted || table !== "mapping_versions") throw new Error("Unexpected write");
      if (state.conflictOnce) {
        state.conflictOnce = false;
        state.records.push({ ...inserted, id: "concurrent" });
        return { data: null, error: { code: "23505" } };
      }
      const row = { ...inserted, id: `mapping-${inserted.version}`, version: inserted.version };
      state.records.push(row);
      return { data: { id: row.id, version: row.version }, error: null };
    },
  };
  return query;
} }) }));

const connectionId = "11111111-1111-4111-8111-111111111111";
const tabId = "22222222-2222-4222-8222-222222222222";
const input = { sourceConnectionId: connectionId, sourceTabId: tabId, domain: "member" as const, headerRowIndex: 2, columns: [{ sourceHeader: "고객명", field: "name" }] };
beforeEach(() => {
  state.role = "admin";
  state.conflictOnce = false;
  state.records = [{ id: "prior", version: 1, organization_id: "org-1", source_connection_id: connectionId, source_tab_id: tabId, columns: { untouched: true } }];
  state.tabs = [{ id: tabId, organization_id: "org-1", source_connection_id: connectionId, domain: "member" }];
});

it("appends a new scoped version and leaves the existing version untouched", async () => {
  const previous = structuredClone(state.records[0]);
  expect(await saveMappingVersion(input)).toEqual({ id: "mapping-2", version: 2 });
  expect(state.records).toHaveLength(2);
  expect(state.records[0]).toEqual(previous);
  expect(state.records[1]).toMatchObject({ version: 2, organization_id: "org-1", confirmed_by: "admin-1", missing_required_fields: [], mapping_confidence: 1, columns: { domain: "member", headerRowIndex: 2, fields: [{ sourceHeader: "고객명", field: "name" }] } });
});

it("rejects trainer writes and foreign source tabs", async () => {
  state.role = "trainer";
  await expect(saveMappingVersion(input)).rejects.toThrow("Administrator");
  state.role = "admin";
  state.tabs[0].organization_id = "other-org";
  await expect(saveMappingVersion(input)).rejects.toThrow("tab");
  expect(state.records).toHaveLength(1);
});

it("rejects unknown, duplicate, missing identity and mismatched domain mappings", async () => {
  for (const columns of [[{ sourceHeader: "고객명", field: "unknown" }], [{ sourceHeader: "고객명", field: "name" }, { sourceHeader: "성명", field: "name" }], [{ sourceHeader: "고객명", field: null }]]) {
    await expect(saveMappingVersion({ ...input, columns })).rejects.toThrow();
  }
  await expect(saveMappingVersion({ ...input, domain: "lead" })).rejects.toThrow("domain");
  expect(state.records).toHaveLength(1);
});

it("retries a concurrent version-number collision with a new insert", async () => {
  state.conflictOnce = true;
  expect(await saveMappingVersion(input)).toEqual({ id: "mapping-3", version: 3 });
  expect(state.records.map((row) => row.version)).toEqual([1, 2, 3]);
});

it("persists a fixed-size SHA-256 fingerprint for 1,000 long headers while retaining the complete schema", async () => {
  const columns = Array.from({ length: 1000 }, (_, index) => ({ sourceHeader: `${index}:${"경계".repeat(245)}`, field: index === 0 ? "name" : null }));
  await saveMappingVersion({ ...input, columns });
  const stored = state.records[1];
  expect(new TextEncoder().encode(String(stored.mapping_fingerprint)).length).toBeLessThan(100);
  expect(stored.mapping_fingerprint).toMatch(/^mapping:v2:sha256:[a-f0-9]{64}$/);
  expect(stored.columns).toMatchObject({ fields: columns });
});

it("reuses the saved name/unmapped/notes mapping for duplicate headers on the next run", async () => {
  await saveMappingVersion({ ...input, headerRowIndex: 0, columns: [{ sourceHeader: "회원명", field: "name" }, { sourceHeader: "메모", field: null }, { sourceHeader: "메모", field: "notes" }] });
  const stored = state.records[1];
  const columns = stored.columns as { domain: MappingDomain; headerRowIndex: number; fields: ConfirmedColumn[] };
  const result = mapColumns({ organizationId: "org-1", sourceConnectionId: connectionId, sourceTabId: tabId, domain: "member", tabTitle: "회원", rows: [["회원명", "메모", "메모"], ["민수", "운영 메모", "운동 주의사항"]] }, [{
    organizationId: String(stored.organization_id), sourceConnectionId: String(stored.source_connection_id), sourceTabId: String(stored.source_tab_id), version: Number(stored.version), domain: columns.domain, headerRowIndex: columns.headerRowIndex, columns: columns.fields,
  }]);
  expect(result.fields.map((column) => column.field)).toEqual(["name", null, "notes"]);
  expect(result.mappingFingerprint).toBe(stored.mapping_fingerprint);
});
