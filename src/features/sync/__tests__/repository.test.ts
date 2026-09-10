// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRpcSyncRepository, type RpcClient } from "../supabase-repository";
import { applySync } from "../apply-sync";
import { mapColumns } from "../../mapping/map-columns";
import { discoverDomain, extractRepeatedTables, extractScheduleGrid } from "../sheet-pipeline";

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
  it("extracts side-by-side registration tables with merged amount headers", () => {
    const rows = [
      ["요약", "", "", "", "", "", "", "", "", "", "", ""],
      ["", "회원명", "세션", "결제 날짜", "매출", "", "", "RE/NEW", "담당트레이너", "유입경로", "결제방법", "", "회원명", "세션", "결제 날짜", "매출", "", "", "RE/NEW", "담당트레이너", "유입경로", "결제방법"],
      ["", "김회원", 10, "2026-09-01", "600,000", "", "", "신규", "박코치", "소개", "카드", "", "이회원", 20, "2026-09-02", "900,000", "", "", "재등록", "이코치", "워크인", "현금"],
      ["", "", "", "", "", "", "", "", "", "", "", "", "박회원", 30, "2026-09-03", "1,200,000", "", "", "신규", "이코치", "검색", "카드"],
    ];
    expect(extractRepeatedTables(rows, "registration")).toEqual([
      ["회원명", "세션", "결제 날짜", "매출", "RE/NEW", "담당트레이너", "유입경로", "결제방법"],
      ["김회원", 10, "2026-09-01", "600,000", "신규", "박코치", "소개", "카드"],
      ["이회원", 20, "2026-09-02", "900,000", "재등록", "이코치", "워크인", "현금"],
      ["박회원", 30, "2026-09-03", "1,200,000", "신규", "이코치", "검색", "카드"],
    ]);
  });
  it("extracts FC membership sales with carried-down dates", () => {
    const rows = [["요약"], ["FC", "", "회원명", "개월수", "락커", "운동복", "", "결제 방법", "구분"], ["", "9월 1일", "박용봉", "", "O", "", "40,000", "", ""], ["", "", "신은결", "12개월", "O", "O", "400,000", "카드", "신규"]];
    expect(extractRepeatedTables(rows, "registration", "26.9")).toEqual([["회원명", "결제 날짜", "매출", "RE/NEW", "결제방법", "상품", "결제상태"], ["박용봉", "2026-09-01", "40,000", "", "", "FC 회원권", "결제완료"], ["신은결", "2026-09-01", "400,000", "신규", "카드", "FC 12개월", "결제완료"]]);
  });
  it("turns a daily trainer grid into class records", () => {
    const rows = [
      ["", "", "지세환", "", "박세준", "", "정윤수", ""],
      ["", "7:00", "", "", "", "", "", ""],
      ["", "8:00", "", "", "이정임23/50", "", "", ""],
      ["", "9:00", "", "", "배수정34/50", "", "식사", ""],
      ["", "10:00", "", "", "", "", "김민정 20/25", ""],
    ];
    expect(extractScheduleGrid(rows, "1", "중산점 스케줄 26.09", "2026-09-01")).toEqual([
      ["회원명", "수업일", "수업시작시간", "담당트레이너", "잔여횟수", "수업상태", "수업ID"],
      ["이정임", "2026-09-01", "08:00", "박세준", 27, "완료", "schedule|%EC%9D%B4%EC%A0%95%EC%9E%84|2026-09-01|08:00|%EB%B0%95%EC%84%B8%EC%A4%80"],
      ["배수정", "2026-09-01", "09:00", "박세준", 16, "완료", "schedule|%EB%B0%B0%EC%88%98%EC%A0%95|2026-09-01|09:00|%EB%B0%95%EC%84%B8%EC%A4%80"],
      ["김민정", "2026-09-01", "10:00", "정윤수", 5, "완료", "schedule|%EA%B9%80%EB%AF%BC%EC%A0%95|2026-09-01|10:00|%EC%A0%95%EC%9C%A4%EC%88%98"],
    ]);
  });
});
