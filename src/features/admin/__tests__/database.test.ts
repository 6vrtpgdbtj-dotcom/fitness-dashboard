// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
const db = new PGlite();
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = uid(1), admin = uid(2), connection = uid(3), tab = uid(4), trainer = uid(5), coach = uid(6), member = uid(7), duplicate = uid(8), outsider = uid(9);
async function call<T = unknown>(name: string, args: unknown[]) { return (await db.query<{ value: T }>(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as value`, args.map(v => v && typeof v === "object" ? JSON.stringify(v) : v))).rows[0].value; }
const review = (id: string, command: object) => call("admin_review", [id, command]);
beforeAll(async () => {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create table auth.identities(user_id uuid,provider text); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;");
  for (const name of (await readdir("supabase/migrations")).sort().filter(n => n.endsWith(".sql") && !n.includes("dashboard_realtime"))) await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
}, 30000);
beforeEach(async () => {
  await db.exec("begin");
  await db.query("select set_config('test.uid',$1,true)", [admin]);
  await db.query("insert into auth.users(id) values($1),($2)", [admin, coach]);
  await db.query("insert into trainers(id,organization_id,display_name,email) values($1,$2,'Coach','coach@example.com')", [trainer, org]);
  await db.query("insert into profiles(id,organization_id,role,trainer_id,is_active) values($1,$2,'admin',null,true),($3,$2,'trainer',$4,true)", [admin, org, coach, trainer]);
  await db.query("insert into sheet_connections(id,organization_id,spreadsheet_id,display_name,connected_by) values($1,$2,'s','Sheet',$3)", [connection, org, admin]);
  await db.query("insert into sheet_tabs(id,organization_id,source_connection_id,google_sheet_id,title,domain) values($1,$2,$3,0,'Members','member')", [tab, org, connection]);
  await db.query("insert into members(id,organization_id,source_connection_id,source_tab_id,source_record_key,name,external_member_id,record_status) values($1,$3,$4,$5,'keep','Keep','M1','valid'),($2,$3,$4,$5,'alias','Alias','M2','review_required')", [member, duplicate, org, connection, tab]);
});
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db.close(); });
it("requires an active administrator in the database, including direct RPC calls", async () => {
  await db.query("select set_config('test.uid',$1,true)", [coach]);
  await expect(review(duplicate, { action: "reject", domain: "member" })).rejects.toThrow("admin_required");
});
it("rejects targets outside the authenticated organization", async () => { await expect(review(outsider, { action: "reject", domain: "member" })).rejects.toThrow("target_not_found"); });
it("merges atomically while preserving source rows, aliases, dependent provenance and audit identifiers", async () => {
  for (const table of ["registrations", "leads", "classes"]) await db.query(`insert into ${table}(organization_id,source_connection_id,source_tab_id,source_record_key,member_id) values($1,$2,$3,'event',$4)`, [org, connection, tab, duplicate]);
  await review(duplicate, { action: "merge", retainedId: member });
  expect((await db.query("select record_status,source_record_key from members where id=$1", [duplicate])).rows[0]).toEqual({ record_status: "archived", source_record_key: "alias" });
  expect((await db.query("select alias_member_id,retained_member_id from member_aliases")).rows).toEqual([{ alias_member_id: duplicate, retained_member_id: member }]);
  for (const table of ["registrations", "leads", "classes"]) expect((await db.query(`select member_id,source_record_key from ${table}`)).rows[0]).toEqual({ member_id: member, source_record_key: "event" });
  expect((await db.query("select action,payload from audit_events where action='member_merge'")).rows[0]).toMatchObject({ payload: { beforeId: duplicate, afterId: member } });
  await db.query("update members set record_status='valid',name='Resynced' where id=$1", [duplicate]);
  expect((await db.query("select record_status from members where id=$1", [duplicate])).rows[0]).toEqual({ record_status: "archived" });
});
it("rolls back the merge if auditing fails", async () => {
  await db.exec("create function public.fail_audit() returns trigger language plpgsql as $$ begin raise exception 'audit_failed'; end $$; create trigger fail_audit before insert on audit_events for each row execute function public.fail_audit(); savepoint operation");
  await expect(review(duplicate, { action: "merge", retainedId: member })).rejects.toThrow("audit_failed");
  await db.exec("rollback to savepoint operation");
  expect((await db.query("select * from member_aliases")).rows).toHaveLength(0);
  expect((await db.query("select record_status from members where id=$1", [duplicate])).rows[0]).toEqual({ record_status: "review_required" });
});
it("preserves reviewed field corrections and rejection through later sync writes", async () => {
  await review(duplicate, { action: "correct", domain: "member", fields: { name: "Corrected" } });
  await review(duplicate, { action: "reject", domain: "member" });
  await db.query("update members set name='Old sheet value',record_status='valid' where id=$1", [duplicate]);
  expect((await db.query("select name,record_status from members where id=$1", [duplicate])).rows[0]).toEqual({ name: "Corrected", record_status: "rejected" });
  expect((await db.query("select action from audit_events order by action")).rows).toEqual([{ action: "record_correct" }, { action: "record_reject" }]);
});
it("rejects immutable provenance changes at the database boundary", async () => { await expect(review(duplicate, { action: "correct", domain: "member", fields: { source_record_key: "oops" } })).rejects.toThrow("invalid_fields"); });
it("updates active state in both trainer and login profile and audits assignments", async () => {
  await call("admin_trainer", [{ action: "activate", trainerId: trainer, active: false }]);
  expect((await db.query("select is_active from profiles where id=$1", [coach])).rows[0]).toEqual({ is_active: false });
  await call("admin_trainer", [{ action: "activate", trainerId: trainer, active: true }]);
  await call("admin_trainer", [{ action: "assign", connectionId: connection, mode: "direct", trainerId: trainer }]);
  expect((await db.query("select trainer_id from members where id=$1", [member])).rows[0]).toEqual({ trainer_id: trainer });
  expect((await db.query("select action from audit_events where action='trainer_assignment'")).rows).toHaveLength(1);
});
it("claims only a single approved verified Google invitation and never overwrites an existing profile", async () => {
  const user = uid(20);
  await call("admin_trainer", [{ action: "invite", email: "new@example.com", displayName: "New", active: true }]);
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'new@example.com',now())", [user]);
  await db.query("insert into auth.identities(user_id,provider) values($1,'google')", [user]);
  await db.query("select set_config('test.uid',$1,true)", [user]);
  expect(await call("claim_trainer_invitation", [])).toBe(true);
  expect((await db.query("select role,is_active,organization_id from profiles where id=$1", [user])).rows[0]).toEqual({ role: "trainer", is_active: true, organization_id: org });
  expect(await call("claim_trainer_invitation", [])).toBe(false);
});
it("does not claim unverified email", async () => {
  await call("admin_trainer", [{ action: "invite", email: "new@example.com", displayName: "New", active: true }]);
  await db.query("insert into auth.users(id,email) values($1,'new@example.com')", [uid(20)]);
  await db.query("select set_config('test.uid',$1,true)", [uid(20)]);
  expect(await call("claim_trainer_invitation", [])).toBe(false);
});
it("resolves a mapped trainer and an archived alias when later rows sync", async () => {
  await review(duplicate, { action: "merge", retainedId: member });
  await db.query("insert into sync_record_state(organization_id,source_connection_id,source_tab_id,domain,source_record_key,record) values($1,$2,$3,'member','keep',$4)", [org, connection, tab, JSON.stringify({ record_status:"valid",hints:{ trainer_name:"Coach" } })]);
  await call("admin_trainer", [{ action: "assign", connectionId: connection, mode: "column" }]);
  await db.query("insert into classes(organization_id,source_connection_id,source_tab_id,source_record_key) values($1,$2,$3,'class')", [org, connection, tab]);
  await db.query("insert into sync_record_state(organization_id,source_connection_id,source_tab_id,domain,source_record_key,record) values($1,$2,$3,'class','class',$4)", [org, connection, tab, JSON.stringify({ hints: { external_member_id: "M2", trainer_name: "Coach" } })]);
  expect((await db.query("select trainer_id,member_id from classes")).rows[0]).toEqual({ trainer_id: trainer, member_id: member });
});
it("keeps the original alias identity and provenance after its source is renamed", async () => {
  await review(duplicate, { action: "merge", retainedId: member });
  await db.query("update members set name='Renamed',external_member_id='M3' where id=$1", [duplicate]);
  await db.query("insert into classes(organization_id,source_connection_id,source_tab_id,source_record_key) values($1,$2,$3,'class')", [org, connection, tab]);
  await db.query("insert into sync_record_state(organization_id,source_connection_id,source_tab_id,domain,source_record_key,record) values($1,$2,$3,'class','class',$4)", [org, connection, tab, JSON.stringify({ hints: { external_member_id: "M2" } })]);
  expect((await db.query("select member_id from classes")).rows[0]).toEqual({ member_id: member });
  expect((await db.query("select alias_name,alias_external_member_id,source_provenance from member_aliases")).rows[0]).toMatchObject({ alias_name: "Alias", alias_external_member_id: "M2", source_provenance: { source_connection_id: connection, source_tab_id: tab, source_record_key: "alias" } });
});
it("enforces authenticated grants and tenant RLS for the new administrative tables", async () => {
  await review(duplicate, { action: "merge", retainedId: member });
  await db.exec("set local role authenticated");
  expect((await db.query("select * from member_aliases")).rows).toHaveLength(1);
  await db.query("select set_config('test.uid',$1,true)", [coach]);
  expect((await db.query("select * from member_aliases")).rows).toHaveLength(0);
  await db.exec("savepoint rejected_rpc");
  await expect(review(duplicate, { action: "reject", domain: "member" })).rejects.toThrow("admin_required");
  await db.exec("rollback to savepoint rejected_rpc; reset role");
});
it("does not grant access to an ambiguous mapped trainer", async () => {
  await db.query("insert into trainers(organization_id,display_name,email) values($1,'Coach','second@example.com')", [org]);
  await call("admin_trainer", [{ action: "assign", connectionId: connection, mode: "column" }]);
  await db.query("insert into sync_record_state(organization_id,source_connection_id,source_tab_id,domain,source_record_key,record) values($1,$2,$3,'member','keep',$4)", [org, connection, tab, JSON.stringify({ hints: { trainer_name: "Coach" } })]);
  expect((await db.query("select trainer_id,record_status from members where id=$1", [member])).rows[0]).toEqual({ trainer_id: null, record_status: "review_required" });
});
it("requires review again when an approved record has no unambiguous trainer assignment", async () => {
  await review(member, { action: "approve", domain: "member" });
  await call("admin_trainer", [{ action: "assign", connectionId: connection, mode: "column" }]);
  await db.query("insert into sync_record_state(organization_id,source_connection_id,source_tab_id,domain,source_record_key,record) values($1,$2,$3,'member','keep',$4)", [org, connection, tab, JSON.stringify({ record_status:"valid", hints: { trainer_name: "Unknown coach" } })]);
  expect((await db.query("select trainer_id,record_status from members where id=$1", [member])).rows[0]).toEqual({ trainer_id:null,record_status:"review_required" });
  await db.query("update sync_record_state set record=$1 where source_record_key='keep'", [JSON.stringify({ record_status:"valid", hints:{trainer_name:"Coach"} })]);
  expect((await db.query("select trainer_id,record_status from members where id=$1", [member])).rows[0]).toEqual({ trainer_id:trainer,record_status:"valid" });
});
it("returns a scoped review workspace and rejects trainer reads", async () => {
  const workspace = await call<{ records: { id: string }[]; connections: { id: string }[] }>("admin_workspace", []);
  expect(workspace.records.map(r => r.id)).toContain(duplicate);
  expect(workspace.connections.map(c => c.id)).toEqual([connection]);
  await db.query("select set_config('test.uid',$1,true)", [coach]);
  await expect(call("admin_workspace", [])).rejects.toThrow("admin_required");
});
it("audits mapping confirmation in the insertion transaction", async () => {
  await db.query("insert into mapping_versions(organization_id,source_connection_id,source_tab_id,version,mapping_fingerprint,mapping_confidence,confirmed_by) values($1,$2,$3,1,'map',1,$4)", [org, connection, tab, admin]);
  expect((await db.query("select action,actor_id,payload from audit_events")).rows[0]).toEqual({ action: "mapping_confirmation", actor_id: admin, payload: { version: 1 } });
});
it("requires disconnect before confirmed history deletion and retains operational records and audit", async () => {
  await db.query("insert into raw_snapshots(organization_id,source_connection_id,source_tab_id,snapshot_key,source_payload) values($1,$2,$3,'raw','{}')", [org, connection, tab]);
  await review(connection, { action: "disconnect" });
  await review(connection, { action: "delete_history", confirmation: "DELETE HISTORY" });
  expect((await db.query("select * from raw_snapshots")).rows).toHaveLength(0);
  expect((await db.query("select * from members")).rows).toHaveLength(2);
  expect((await db.query("select action from audit_events order by action")).rows).toEqual([{ action: "connection_disconnect" }, { action: "history_delete" }]);
});
it("refuses a stale worker snapshot after disconnect and history deletion", async () => {
  await review(connection, { action: "disconnect" });
  await review(connection, { action: "delete_history", confirmation: "DELETE HISTORY" });
  await expect(call("sync_insert_snapshot", [org,connection,tab,"late",new Date().toISOString(),{ rows: [] }])).rejects.toThrow("connection_inactive");
});
it("deletes only raw history without replaying assignments after a trainer is deactivated", async () => {
  const snapshot = await call<string>("sync_insert_snapshot", [org,connection,tab,"history",new Date().toISOString(),{rows:[]}]);
  await db.query("update members set raw_snapshot_id=$1 where id=$2",[snapshot,member]);
  await db.query("insert into classes(organization_id,source_connection_id,source_tab_id,source_record_key,raw_snapshot_id) values($1,$2,$3,'history-class',$4)",[org,connection,tab,snapshot]);
  for (const [domain,key] of [["member","keep"],["class","history-class"]]) await db.query("insert into sync_record_state(organization_id,source_connection_id,source_tab_id,domain,source_record_key,record) values($1,$2,$3,$4,$5,$6)",[org,connection,tab,domain,key,JSON.stringify({raw_snapshot_id:snapshot,record_status:"valid",hints:{trainer_name:"Coach",external_member_id:"M1"}})]);
  await call("admin_trainer",[{action:"assign",connectionId:connection,mode:"column"}]);
  await call("admin_trainer",[{action:"activate",trainerId:trainer,active:false}]);
  await review(connection,{action:"disconnect"});
  for(const table of ["members","classes"]) await db.exec(`alter table ${table} disable trigger set_updated_at; update ${table} set updated_at='2000-01-01T00:00:00Z'; alter table ${table} enable trigger set_updated_at;`);
  const business = async () => (await db.query("select * from (select to_jsonb(m)-'raw_snapshot_id' as row from members m union all select to_jsonb(c)-'raw_snapshot_id' from classes c) records order by row->>'id'")).rows;
  const before = await business();
  // Detect silent assignment/identity replay even if its resulting values happen
  // to be unchanged. Historical cleanup must not execute business UPDATEs.
  await db.exec("create function public.reject_business_replay() returns trigger language plpgsql as $$ begin raise exception 'business_replay'; end $$; create trigger reject_business_replay before update of trainer_id,member_id,record_status on classes for each row execute function public.reject_business_replay();");
  await review(connection,{action:"delete_history",confirmation:"DELETE HISTORY"});
  expect(await business()).toEqual(before);
  await review(connection,{action:"delete_history",confirmation:"DELETE HISTORY"});
  expect(await business()).toEqual(before);
  expect((await db.query("select * from raw_snapshots")).rows).toHaveLength(0);
  expect((await db.query("select record->>'raw_snapshot_id' as snapshot from sync_record_state")).rows).toEqual([{snapshot:null},{snapshot:null}]);
  expect((await db.query("select action from audit_events where action='history_delete'")).rows).toHaveLength(2);
});
