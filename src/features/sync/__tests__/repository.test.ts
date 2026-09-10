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
  it("prefers ordinary repeated-table extraction on a monthly tab without PT or FC markers", () => {
    const rows = [
      ["회원명", "등록일", "매출", "구분", "결제방법", "상품", "", "회원명", "등록일", "매출", "구분", "결제방법", "상품"],
      ["김회원", "2026년 8월 10일", "111,111", "신규", "카드", "PT 10회", "", "박회원", "2026년 8월 11일", "222,222", "재등록", "현금", "FC 6개월"],
    ];
    expect(extractRepeatedTables(rows, "registration", "26.8")).toEqual([
      ["회원명", "등록일", "매출", "구분", "결제방법", "상품"],
      ["김회원", "2026년 8월 10일", "111,111", "신규", "카드", "PT 10회"],
      ["박회원", "2026년 8월 11일", "222,222", "재등록", "현금", "FC 6개월"],
    ]);
  });
  it("extracts FC membership sales with carried-down dates", () => {
    const rows = [["요약"], ["FC", "", "회원명", "개월수", "락커", "운동복", "", "결제 방법", "구분"], ["", "9월 1일", "박용봉", "", "O", "", "40,000", "", ""], ["", "", "신은결", "12개월", "O", "O", "400,000", "카드", "신규"]];
    expect(extractRepeatedTables(rows, "registration", "26.9")).toEqual([["회원명", "결제 날짜", "매출", "RE/NEW", "담당트레이너", "판매트레이너", "결제방법", "상품", "결제상태"], ["박용봉", "2026-09-01", "40,000", "", "", "", "", "FC 회원권", "결제완료"], ["신은결", "2026-09-01", "400,000", "신규", "", "", "카드", "FC 12개월", "결제완료"]]);
  });
  it("keeps PT sales beside FC blocks and carries the trainer and sale type", () => {
    const rows = [
      ["요약"],
      ["PT", "", "회원명", "세션", "", "매출", "구분", "담당트레이너", "결제 방법", "", "FC", "", "회원명", "개월수", "", "", "매출", "결제 방법", "구분"],
      ["", "8월 10일", "김회원", 20, "", "900,000", "신규", "정윤수", "카드", "", "", "8월 12일", "박회원", "12개월", "", "", "500,000", "카드", "신규"],
      ["", "", "이회원", 10, "", "400,000", "OT", "박세준", "현금", "", "", "", "", "", "", "", "", "", ""],
    ];
    expect(extractRepeatedTables(rows, "registration", "26.8")).toEqual([
      ["회원명", "결제 날짜", "매출", "RE/NEW", "담당트레이너", "판매트레이너", "결제방법", "상품", "결제상태"],
      ["김회원", "2026-08-10", "900,000", "신규", "정윤수", "", "카드", "PT 20회", "결제완료"],
      ["이회원", "2026-08-10", "400,000", "OT", "박세준", "", "현금", "PT 10회", "결제완료"],
      ["박회원", "2026-08-12", "500,000", "신규", "", "", "카드", "FC 12개월", "결제완료"],
    ]);
  });
  it("extracts a mixed monthly table when PT and FC markers are on the row above its headers", () => {
    const rows = [
      ["PT", "", "", "", "", "", "", "FC", "", "", "", ""],
      ["", "", "회원명", "매출", "구분", "담당트레이너", "", "", "회원명", "개월수", "매출", "결제 방법"],
      ["", "8월 10일", "김회원", "700,000", "신규", "정윤수", "", "", "박회원", "6개월", "800,000", "카드"],
    ];
    const extracted = extractRepeatedTables(rows, "registration", "26.8");
    expect(extracted).toContainEqual(["김회원", "2026-08-10", "700,000", "신규", "정윤수", "", "", "PT 회원권", "결제완료"]);
    expect(extracted).toContainEqual(["박회원", "2026-08-10", "800,000", "", "", "", "카드", "FC 6개월", "결제완료"]);
  });
  it("uses PT and FC summary labels above a spaced monthly entry table", () => {
    const rows = [
      ["26년 8월"],
      [],
      ["PT매출", "", "0", "", "", "", "", "FC매출", "", "0"],
      [], [], [], [], [], [],
      ["", "회원명", "세션", "결제 날짜", "매출", "", "", "RE/NEW", "담당트레이너", "유입경로", "결제방법", "", "회원명", "세션", "결제 날짜", "매출", "", "", "RE/NEW", "담당트레이너", "유입경로", "결제방법"],
      ["", "김회원", "20", "8월 10일", "900,000", "", "", "신규", "정윤수", "", "카드", "", "박회원", "12개월", "8월 11일", "500,000", "", "", "재등록", "", "", "현금"],
    ];
    expect(extractRepeatedTables(rows, "registration", "26.8")).toEqual([
      ["회원명", "결제 날짜", "매출", "RE/NEW", "담당트레이너", "판매트레이너", "결제방법", "상품", "결제상태"],
      ["김회원", "2026-08-10", "900,000", "신규", "정윤수", "", "카드", "PT 20회", "결제완료"],
      ["박회원", "2026-08-11", "500,000", "재등록", "", "", "현금", "FC 12개월", "결제완료"],
    ]);
  });
  it("keeps the legacy monthly FC layout when the FC marker is outside the header", () => {
    const rows = [
      ["FC 매출"],
      ["", "회원명", "개월수", "", "매출", "결제 방법", "구분"],
      ["9월 3일", "김회원", "6개월", "", "500,000", "카드", "신규"],
    ];
    expect(extractRepeatedTables(rows, "registration", "26.9")).toEqual([
      ["회원명", "결제 날짜", "매출", "RE/NEW", "담당트레이너", "판매트레이너", "결제방법", "상품", "결제상태"],
      ["김회원", "2026-09-03", "500,000", "신규", "", "", "카드", "FC 6개월", "결제완료"],
    ]);
  });
  it("uses a shared row date for FC when the mixed layout has no FC date column", () => {
    const rows = [
      ["PT", "", "회원명", "매출", "구분", "담당트레이너", "", "FC", "회원명", "개월수", "매출", "결제 방법", "구분"],
      ["", "8월 10일", "김회원", "700,000", "신규", "정윤수", "", "", "박회원", "6개월", "800,000", "카드", "신규"],
    ];
    expect(extractRepeatedTables(rows, "registration", "26.8")).toContainEqual(["박회원", "2026-08-10", "800,000", "신규", "", "", "카드", "FC 6개월", "결제완료"]);
  });
  it("does not replace a PT carried date with a later FC section date", () => {
    const rows = [
      ["PT", "", "회원명", "매출", "구분", "담당트레이너", "", "FC", "", "회원명", "개월수", "매출", "결제 방법", "구분"],
      ["", "8월 10일", "김회원", "700,000", "신규", "정윤수", "", "", "", "", "", "", "", ""],
      ["", "", "이회원", "400,000", "재등록", "박세준", "", "", "8월 13일", "박회원", "6개월", "800,000", "카드", "신규"],
    ];
    expect(extractRepeatedTables(rows, "registration", "26.8")).toContainEqual(["이회원", "2026-08-10", "400,000", "재등록", "박세준", "", "", "PT 회원권", "결제완료"]);
  });
  it("preserves sales trainer separately from the assigned trainer", () => {
    const rows = [
      ["PT", "", "회원명", "매출", "구분", "담당트레이너", "판매트레이너", "결제 방법"],
      ["", "8월 10일", "김회원", "777,777", "신규", "박세준", "정윤수", "카드"],
    ];
    expect(extractRepeatedTables(rows, "registration", "26.8")).toContainEqual(["김회원", "2026-08-10", "777,777", "신규", "박세준", "정윤수", "카드", "PT 회원권", "결제완료"]);
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
