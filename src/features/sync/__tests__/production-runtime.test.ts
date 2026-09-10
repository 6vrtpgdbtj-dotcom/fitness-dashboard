// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSyncService } from "../production-runtime";
import type { StoredRecord } from "../types";

const boundary = vi.hoisted(() => ({ database: null as unknown, rows: [] as unknown[][], stoppedChannels: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => boundary.database }));
vi.mock("@/lib/google/oauth", () => ({ getAuthorizedGoogleClient: async () => ({}) }));
vi.mock("googleapis", () => ({ google: { sheets: () => ({ spreadsheets: {
  get: async () => ({ data: { sheets: [{ properties: { sheetId: 0, title: "기타" } }] } }),
  values: { get: async () => ({ data: { values: boundary.rows } }) },
} }), drive: () => ({ files: { watch: async () => ({ data: { resourceId: "new-resource", expiration: String(Date.now() + 86400000) } }) }, channels: { stop: async ({ requestBody }: { requestBody: { id: string } }) => { boundary.stoppedChannels.push(requestBody.id); } } }) } }));
afterEach(() => { vi.unstubAllEnvs(); });

describe("production ingestion", () => {
  it.each(["canonical", "legacy", "both"])("registers watches using %s notification secret configuration", async (mode) => {
    vi.stubEnv("GOOGLE_NOTIFICATION_SECRET", mode === "legacy" ? undefined : "canonical-notification-secret-at-least-32-characters");
    vi.stubEnv("GOOGLE_WATCH_SECRET", mode === "canonical" ? undefined : mode === "both" ? "short-invalid-legacy" : "legacy-notification-secret-at-least-32-characters");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com");
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: "conn", organization_id: "org", spreadsheet_id: "sheet", is_active: true }, error: null }) };
    boundary.database = {
      from: () => query,
      async rpc(name: string) { return { data: name === "sync_acquire" ? "lease" : null, error: null }; },
    };
    const watch = await getSyncService().registerWatch("conn");
    expect(watch.channelId).toMatch(/^[0-9a-f-]{36}$/);
    expect(watch.expiration.getTime()).toBeGreaterThan(Date.now());
  });
  it("never sends a remote channel stop after watch activation loses its lease", async () => {
    vi.stubEnv("GOOGLE_WATCH_SECRET", "a-stable-random-watch-secret-at-least-32-characters");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com");
    boundary.stoppedChannels = [];
    const cleanupLeases: unknown[] = [];
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: "conn", organization_id: "org", spreadsheet_id: "sheet", is_active: true }, error: null }) };
    boundary.database = {
      from: () => query,
      async rpc(name: string, args: Record<string, unknown>) {
        if (name === "sync_acquire") return { data: "old-lease", error: null };
        if (name === "sync_save_watch" && args.p_resource_id) return { data: null, error: { message: "lease_lost" } };
        if (name === "sync_watch_cleanup") { cleanupLeases.push(args.p_lease); return { data: null, error: { message: "lease_lost" } }; }
        return { data: null, error: null };
      },
    };
    await expect(getSyncService().registerWatch("conn")).rejects.toThrow("lease_lost");
    expect(cleanupLeases).toEqual(["old-lease"]);
    expect(boundary.stoppedChannels).toEqual([]);
  });
  it.each([0, 60])("ingests a confirmed ambiguous tab using its one-column header at row %i", async (headerRowIndex) => {
    boundary.rows = [...Array.from({ length: headerRowIndex }, () => ["intro"]), ["별명"], ["민수"]];
    const writes: StoredRecord[] = [];
    const rpcNames: string[] = [];
    const confirmation = { id: "version", version: 1, confirmed_by: "admin", mapping_fingerprint: "old", columns: { domain: "member", headerRowIndex, fields: [{ sourceHeader: "별명", field: "name" }] } };
    // Google and the Supabase transport are external boundaries. Mapping,
    // normalization, orchestration and the real RPC repository stay active.
    boundary.database = {
      from(table: string) {
        const data = table === "sheet_connections" ? { id: "conn", organization_id: "org", spreadsheet_id: "sheet", is_active: true, trainer_id: null }
          : table === "sheet_tabs" ? { id: "tab", domain: null, is_active: true } : [confirmation];
        const query = {
          select: () => query, eq: () => query, order: () => query, limit: () => query,
          maybeSingle: async () => ({ data: Array.isArray(data) ? data[0] : data, error: null }),
          insert: () => query,
          single: async () => ({ data: { ...confirmation, id: "applied-version" }, error: null }),
          then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data, error: null }).then(resolve); },
        };
        return query;
      },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcNames.push(name);
        if (name === "sync_acquire") return { data: "lease", error: null };
        if (name === "sync_upsert_tab") return { data: { id: "tab", domain: "member", is_active: true }, error: null };
        if (name === "sync_insert_snapshot") return { data: "snapshot", error: null };
        if (name === "sync_read_records") return { data: [], error: null };
        if (name === "sync_commit_records") writes.push(...args.p_records as StoredRecord[]);
        return { data: null, error: null };
      },
    };
    const result = await getSyncService().runSheetSync("conn", "manual");
    expect(result.member.inserted).toBe(1);
    expect(writes).toMatchObject([{ values: { name: "민수" }, record_status: "valid", source_tab_id: "tab" }]);
    expect(rpcNames).toContain("sync_upsert_tab");
    expect(rpcNames).toContain("sync_update_tab_mapping");
  });
});
