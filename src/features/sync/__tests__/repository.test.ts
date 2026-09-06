// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRpcSyncRepository, type RpcClient } from "../supabase-repository";
import { applySync } from "../apply-sync";
import { mapColumns } from "../../mapping/map-columns";
import { discoverDomain } from "../sheet-pipeline";

describe("production repository boundary", () => {
  it("commits records and audits in one fenced RPC after the independent snapshot", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client: RpcClient = { rpc: async (name, args) => { calls.push({ name, args }); return { data: name === "sync_insert_snapshot" ? "snapshot-id" : name === "sync_read_records" ? [] : null, error: null }; } };
    const scope = { organizationId: "org", sourceConnectionId: "conn", sourceTabId: "tab" };
    const rows = [["회원명", "회원ID"], ["민수", "M1"]];
    const result = await applySync({ ...scope, mappingVersionId: "mapping", capturedAt: "2026-09-06T00:00:00Z", rows, mapping: mapColumns({ ...scope, rows, domain: "member", tabTitle: "회원" }) }, createRpcSyncRepository(client, "lease"));
    expect(result.member.inserted).toBe(1);
    expect(calls.map((call) => call.name)).toEqual(["sync_insert_snapshot", "sync_read_records", "sync_commit_records"]);
    expect(calls[2].args).toMatchObject({ p_connection_id: "conn", p_organization_id: "org", p_tab_id: "tab", p_lease: "lease", p_records: [{ values: { name: "민수", external_member_id: "M1" }, raw_snapshot_id: "snapshot-id" }], p_audits: [{ action: "insert", rawSnapshotId: "snapshot-id" }] });
  });
  it("never publishes buffered writes when the transaction callback fails", async () => {
    const names: string[] = [];
    const client: RpcClient = { rpc: async (name) => { names.push(name); return { data: [], error: null }; } };
    await expect(createRpcSyncRepository(client, "lease").transaction({ organizationId: "org", sourceConnectionId: "conn", sourceTabId: "tab" }, async () => { throw new Error("normalization failed"); })).rejects.toThrow("normalization failed");
    expect(names).toEqual(["sync_read_records"]);
  });
  it("propagates the database fencing failure instead of reporting success", async () => {
    const client: RpcClient = { rpc: async (name) => name === "sync_commit_records" ? { data: null, error: { message: "lease_lost" } } : { data: [], error: null } };
    await expect(createRpcSyncRepository(client, "old-lease").transaction({ organizationId: "org", sourceConnectionId: "conn", sourceTabId: "tab" }, async () => "ok")).rejects.toThrow("lease_lost");
  });
});
describe("tab discovery", () => {
  it("uses strong domain headers and leaves ambiguous miscellaneous tabs alone", () => {
    expect(discoverDomain("월별 결제", [["회원명", "등록일", "실결제금액"], ["민수", "2026-09-01", 100000]])).toBe("registration");
    expect(discoverDomain("시간표", [["회원명", "수업일", "수업시간"], ["민수", "2026-09-01", "14:00"]])).toBe("class");
    expect(discoverDomain("기타", [["이름", "메모"], ["민수", "hello"]])).toBeNull();
  });
});
