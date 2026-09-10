// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { applySync } from "../apply-sync";
import { createRpcSyncRepository } from "../supabase-repository";
import { mapColumns } from "../../mapping/map-columns";
const db = new PGlite();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = id(1), admin = id(2);
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const entries = Object.entries(args);
  return (await db.query<{ result: T }>(`select public.${name}(${entries.map(([key], index) => `${key} => $${index + 1}`).join(",")}) result`, entries.map(([, value]) => typeof value === "object" ? JSON.stringify(value) : value))).rows[0].result;
}
const client = { async rpc(name: string, args: Record<string, unknown>) {
  try { return { data: await rpc(name, args), error: null }; } catch (error) { return { data: null, error: { message: (error as Error).message } }; }
} };
async function source(n: number, organizationId = org) {
  const scope = { organizationId, sourceConnectionId: id(n), sourceTabId: id(n + 1) };
  const owner = organizationId === org ? admin : id(n + 3);
  if (owner !== admin) {
    await db.query("insert into auth.users(id) values($1)", [owner]);
    await db.query("insert into profiles(id,organization_id,role,is_active) values($1,$2,'admin',true)", [owner, organizationId]);
  }
  await db.query("insert into sheet_connections(id,organization_id,spreadsheet_id,display_name,connected_by) values($1,$2,$4,'Source',$3)", [scope.sourceConnectionId, organizationId, owner, `sheet-${n}`]);
  await db.query("insert into sheet_tabs(id,organization_id,source_connection_id,google_sheet_id,title,domain) values($1,$2,$3,0,'Members','member')", [scope.sourceTabId, organizationId, scope.sourceConnectionId]);
  await db.query("insert into mapping_versions(id,organization_id,source_connection_id,source_tab_id,version,mapping_fingerprint,mapping_confidence) values($1,$2,$3,$4,1,'map',1)", [id(n + 2), organizationId, scope.sourceConnectionId, scope.sourceTabId]);
  const lease = await rpc<string>("sync_acquire", { p_connection_id: scope.sourceConnectionId, p_reason: "manual" });
  return { scope, lease, mappingId: id(n + 2) };
}
async function ingest(s: Awaited<ReturnType<typeof source>>, values: unknown[][]) {
  const rows = [["회원ID", "회원명", "전화뒤4자리", "생년월일"], ...values];
  return applySync({ ...s.scope, rows, mappingVersionId: s.mappingId, capturedAt: new Date().toISOString(), mapping: mapColumns({ ...s.scope, rows, domain: "member", tabTitle: "Members" }) }, createRpcSyncRepository(client, s.lease));
}
const members = async () => (await db.query<{ id: string; name: string; record_status: string; source_connection_id: string; raw_snapshot_id: string }>("select id,name,record_status,source_connection_id,raw_snapshot_id from members order by source_connection_id,id")).rows;
beforeAll(async () => {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create table auth.identities(user_id uuid,provider text); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;");
  for (const name of (await readdir("supabase/migrations")).sort().filter(name => name.endsWith(".sql") && !name.includes("dashboard_realtime"))) await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
}, 30000);
beforeEach(async () => {
  await db.exec("begin");
  await db.query("select set_config('test.uid',$1,true)", [admin]);
  await db.query("insert into auth.users(id) values($1)", [admin]);
  await db.query("insert into profiles(id,organization_id,role,is_active) values($1,$2,'admin',true)", [admin, org]);
});
afterEach(async () => { await db.exec("rollback"); });
afterAll(() => db.close());

it("quarantines scored candidates across connections, counts the committed status and preserves both sources", async () => {
  const first = await source(10), second = await source(20);
  await ingest(first, [["LOCAL-A", "김 민수", "5678", "1990-01-01"]]);
  const result = await ingest(second, [["LOCAL-B", "김민수", "5678", "1990-01-01"]]);
  expect((await members()).map(row => row.record_status)).toEqual(["valid", "review_required"]);
  expect(result.member).toMatchObject({ inserted: 0, reviewRequired: 1 });
  expect(new Set((await members()).map(row => row.raw_snapshot_id)).size).toBe(2);
  const workspace = await rpc<{ records: { issues: { code: string; candidates?: { memberId: string; score: number; reasons: string[] }[] }[] }[] }>("admin_workspace", {});
  expect(workspace.records[0].issues).toContainEqual(expect.objectContaining({ code: "duplicate_member_candidate", candidates: [{ memberId: (await members())[0].id, score: 100, reasons: ["name", "phone_last4", "birth_date"] }] }));
  const event = (await db.query<{ payload: { changes: { issues: { after: unknown[] } } } }>("select payload from audit_events where source_connection_id=$1", [second.scope.sourceConnectionId])).rows[0].payload;
  expect(event.changes.issues.after).toContainEqual(expect.objectContaining({ code: "duplicate_member_candidate" }));
  const auditCount = (await db.query("select * from audit_events")).rows.length;
  await ingest(second, [["LOCAL-B", "김민수", "5678", "1990-01-01"]]);
  expect((await db.query("select * from audit_events")).rows).toHaveLength(auditCount);
});

it("requires explicit review even for a shared external ID and preserves a later merge through resync", async () => {
  const first = await source(10), second = await source(20);
  await ingest(first, [["M1", "민수", "1234", "1990-01-01"]]);
  await ingest(second, [["M1", "민수", "1234", "1990-01-01"]]);
  const [retained, alias] = await members();
  expect(alias.record_status).toBe("review_required");
  expect((await db.query("select * from member_aliases")).rows).toEqual([]);
  await rpc("admin_review", { p_id: alias.id, p_command: { action: "merge", retainedId: retained.id } });
  await ingest(second, [["M1", "민수", "1234", "1990-01-01"]]);
  expect((await members()).map(row => row.record_status)).toEqual(["valid", "archived"]);
  expect((await db.query("select source_provenance from member_aliases")).rows[0]).toMatchObject({ source_provenance: { source_connection_id: second.scope.sourceConnectionId, raw_snapshot_id: alias.raw_snapshot_id } });
});

it("preserves an explicit distinct-person approval when both sources sync again", async () => {
  const first = await source(10), second = await source(20);
  await ingest(first, [["A", "동명이인", "1234", "1990-01-01"]]);
  await ingest(second, [["B", "동명이인", "9999", "1995-01-01"]]);
  const review = (await members())[1];
  expect(review.record_status).toBe("review_required");
  await rpc("admin_review", { p_id: review.id, p_command: { action: "approve", domain: "member" } });
  await ingest(second, [["B", "동명이인", "9999", "1995-01-01"]]);
  await ingest(first, [["A", "동명이인", "1234", "1990-01-01"]]);
  expect((await members()).map(row => row.record_status)).toEqual(["valid", "valid"]);
});

it("does not conflate different people solely by phone suffix or members of another organization", async () => {
  const first = await source(10), second = await source(20), other = await source(30, id(99));
  await ingest(first, [["A", "민수", "1234", "1990-01-01"]]);
  await ingest(second, [["B", "서연", "1234", "1995-01-01"]]);
  await ingest(other, [["A", "민수", "1234", "1990-01-01"]]);
  expect((await members()).map(row => row.record_status)).toEqual(["valid", "valid", "valid"]);
});

it("adjudicates different source IDs sharing a name within the same commit", async () => {
  const first = await source(10);
  await ingest(first, [["A", "동명이인", "1234", "1990-01-01"], ["B", "동명이인", "9999", "1995-01-01"]]);
  expect((await members()).map(row => row.record_status).sort()).toEqual(["review_required", "valid"]);
});

it("does not silently attach name-only registrations while a distinct member is unresolved", async () => {
  const first = await source(10), second = await source(20);
  await ingest(first, [["A", "동명이인", "1234", "1990-01-01"]]);
  await ingest(second, [["B", "동명이인", "9999", "1995-01-01"]]);
  const rows = [["등록ID", "회원명", "등록일", "실결제금액", "결제상태"], ["R1", "동명이인", "2026-09-05", 600000, "결제완료"]];
  await applySync({ ...second.scope, rows, mappingVersionId: second.mappingId, capturedAt: new Date().toISOString(), mapping: mapColumns({ ...second.scope, rows, domain: "registration", tabTitle: "등록" }) }, createRpcSyncRepository(client, second.lease));
  expect((await db.query("select member_id,paid_amount::integer,record_status from registrations")).rows).toEqual([{ member_id: null, paid_amount: 600000, record_status: "valid" }]);
  const [retained, alias] = await members();
  await rpc("admin_review", { p_id: alias.id, p_command: { action: "merge", retainedId: retained.id } });
  await applySync({ ...second.scope, rows, mappingVersionId: second.mappingId, capturedAt: new Date().toISOString(), mapping: mapColumns({ ...second.scope, rows, domain: "registration", tabTitle: "등록" }) }, createRpcSyncRepository(client, second.lease));
  expect((await db.query("select member_id from registrations")).rows).toEqual([{ member_id: retained.id }]);
});

it("exposes candidate members even when they fall beyond the default 500-member selector", async () => {
  const first = await source(10), second = await source(20);
  await ingest(first, [["A", "ZZZ", "1234", "1990-01-01"]]);
  const retained = (await members())[0];
  await db.query("insert into members(organization_id,source_connection_id,source_tab_id,source_record_key,name,record_status) select $1,$2,$3,'dummy-' || n,'AAA' || n,'valid' from generate_series(1,501) n", [org, first.scope.sourceConnectionId, first.scope.sourceTabId]);
  await ingest(second, [["B", "ZZZ", "9999", "1995-01-01"]]);
  const workspace = await rpc<{ members: { id: string }[] }>("admin_workspace", {});
  expect(workspace.members.some(row => row.id === retained.id)).toBe(true);
});

it("holds the organization lock during canonical commit and rejects stale or cross-tenant commits", async () => {
  const first = await source(10);
  await db.exec("create function public.require_candidate_lock() returns trigger language plpgsql as $$ begin if not exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory' and granted) then raise exception 'missing_candidate_lock'; end if; return new; end $$; create trigger require_candidate_lock before insert on members for each row execute function public.require_candidate_lock();");
  await ingest(first, [["A", "민수", "1234", "1990-01-01"]]);
  const state = (await db.query<{ record: unknown }>("select record from sync_record_state")).rows[0].record;
  await db.exec("savepoint forbidden_scope");
  await expect(rpc("sync_commit_records", { p_organization_id: id(99), p_connection_id: first.scope.sourceConnectionId, p_tab_id: first.scope.sourceTabId, p_lease: first.lease, p_records: [state], p_audits: [] })).rejects.toThrow("connection_not_found");
  await db.exec("rollback to savepoint forbidden_scope");
  await db.query("update sync_leases set expires_at=now()-interval '1 second'");
  await db.exec("savepoint stale_lease");
  await expect(ingest(first, [["B", "민수", "1234", "1990-01-01"]])).rejects.toThrow("lease_lost");
  await db.exec("rollback to savepoint stale_lease");
  expect(await members()).toHaveLength(1);
});

it("denies direct browser access to candidate state and the internal commit function", async () => {
  await source(10);
  await db.exec("set role authenticated; savepoint denied_candidate_read");
  await expect(db.query("select * from private.member_distinct_pairs")).rejects.toThrow(/permission denied/);
  await db.exec("rollback to savepoint denied_candidate_read; savepoint denied_commit");
  await expect(db.query("select private.sync_commit_records_base(null,null,null,null,'[]','[]')")).rejects.toThrow(/permission denied/);
  await db.exec("rollback to savepoint denied_commit; reset role");
});
