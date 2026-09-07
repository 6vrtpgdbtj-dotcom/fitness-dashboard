// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRpcSyncRepository } from "../supabase-repository";
import { applySync } from "../apply-sync";
import { mapColumns } from "../../mapping/map-columns";

const db = new PGlite();
const org = "00000000-0000-4000-8000-000000000001", profile = "00000000-0000-4000-8000-000000000002", connection = "00000000-0000-4000-8000-000000000003", tab = "00000000-0000-4000-8000-000000000004", mapping = "00000000-0000-4000-8000-000000000005";
async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const entries = Object.entries(args);
  const result = await db.query<{ value: T }>(`select public.${name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(",")}) as value`, entries.map(([, value]) => value && typeof value === "object" ? JSON.stringify(value) : value));
  return result.rows[0].value;
}
const client = { async rpc(name: string, args: Record<string, unknown>) { try { return { data: await call(name, args), error: null }; } catch (error) { return { data: null, error: { message: (error as Error).message } }; } } };
beforeAll(async () => {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;");
  await db.exec(await readFile(resolve("supabase/migrations/202609050001_initial_schema.sql"), "utf8"));
  await db.exec(await readFile(resolve("supabase/migrations/202609060001_sync_orchestration.sql"), "utf8"));
  await db.exec(await readFile(resolve("supabase/migrations/202609080001_fence_sync_metadata.sql"), "utf8"));
  await db.exec(await readFile(resolve("supabase/migrations/202609080002_notification_lock_order.sql"), "utf8"));
  await db.query("insert into auth.users(id) values ($1)", [profile]);
  await db.query("insert into profiles(id,organization_id,role,is_active) values ($1,$2,'admin',true)", [profile, org]);
  await db.query("insert into sheet_connections(id,organization_id,spreadsheet_id,display_name,connected_by) values ($1,$2,'sheet','Sheet',$3)", [connection, org, profile]);
  await db.query("insert into sheet_tabs(id,organization_id,source_connection_id,google_sheet_id,title,domain) values ($1,$2,$3,0,'회원','member')", [tab, org, connection]);
  await db.query("insert into mapping_versions(id,organization_id,source_connection_id,source_tab_id,version,mapping_fingerprint,mapping_confidence) values ($1,$2,$3,$4,1,'test',1)", [mapping, org, connection, tab]);
}, 30000);
afterAll(async () => { await db.close(); });

describe("sync migration on PostgreSQL", () => {
  it("locks sheet_connections before watch activation and notification cursor mutation", async () => {
    const lease = await call<string>("sync_acquire", { p_connection_id: connection, p_reason: "watch" });
    // This test-only trigger observes the real statement's held relation locks,
    // rather than grepping the function text. FOR UPDATE takes RowShareLock.
    await db.exec(`create function public.assert_notification_lock_order() returns trigger language plpgsql as $$
      begin
        if new.channel_id='lock-order' and not exists (
          select 1 from pg_locks where pid=pg_backend_pid() and relation='public.sheet_connections'::regclass
            and mode='RowShareLock' and granted
        ) then raise exception 'connection_must_be_locked_first'; end if;
        return new;
      end $$;
      create trigger assert_notification_lock_order before update on sync_watches for each row execute function public.assert_notification_lock_order();`);
    try {
      const watch = { p_connection_id: connection, p_lease: lease, p_channel_id: "lock-order", p_resource_id: null, p_expires_at: new Date(Date.now() + 86400000).toISOString() };
      await call("sync_save_watch", watch);
      await call("sync_save_watch", { ...watch, p_resource_id: "resource" });
      expect(await call("sync_accept_notification", { p_channel_id: "lock-order", p_resource_id: "resource", p_message_number: "2" })).toBe(true);
    } finally {
      await db.exec("drop trigger assert_notification_lock_order on sync_watches; drop function public.assert_notification_lock_order(); delete from sync_jobs where idempotency_key like 'notification:lock-order:%'; delete from sync_watches where channel_id='lock-order';");
      await db.query("update sheet_connections set watch_channel_id=null,watch_resource_id=null,watch_expires_at=null,last_message_number=null where id=$1", [connection]);
      await call("sync_release", { p_connection_id: connection, p_lease: lease });
    }
  });
  it("rolls back both message cursors when notification job insertion fails", async () => {
    await db.query("insert into sync_watches(channel_id,source_connection_id,resource_id,expires_at) values('atomic-notification',$1,'resource',now() + interval '1 day')", [connection]);
    await db.query("update sheet_connections set watch_channel_id='atomic-notification',last_message_number=1 where id=$1", [connection]);
    await db.exec("create function public.reject_notification_job() returns trigger language plpgsql as $$ begin raise exception 'job_insert_failed'; end $$; create trigger reject_notification_job before insert on sync_jobs for each row execute function public.reject_notification_job();");
    try {
      await expect(call("sync_accept_notification", { p_channel_id: "atomic-notification", p_resource_id: "resource", p_message_number: "2" })).rejects.toThrow("job_insert_failed");
      expect((await db.query<{ cursor: string }>("select last_message_number::text as cursor from sync_watches where channel_id='atomic-notification'")).rows[0].cursor).toBe("0");
      expect((await db.query<{ cursor: string }>("select last_message_number::text as cursor from sheet_connections where id=$1", [connection])).rows[0].cursor).toBe("1");
      expect((await db.query("select * from sync_jobs where idempotency_key='notification:atomic-notification:2'")).rows).toEqual([]);
    } finally {
      await db.exec("drop trigger reject_notification_job on sync_jobs; drop function public.reject_notification_job(); delete from sync_watches where channel_id='atomic-notification';");
      await db.query("update sheet_connections set watch_channel_id=null,last_message_number=null where id=$1", [connection]);
    }
  });
  it("resolves a scoped confirmed domain on an ambiguous tab before deciding whether to ingest", async () => {
    const lease = await call<string>("sync_acquire", { p_connection_id: connection, p_reason: "manual" });
    try {
      await db.query("insert into sheet_tabs(organization_id,source_connection_id,google_sheet_id,title) values($1,$2,99,'기타')", [org, connection]);
      const ambiguous = (await db.query<{ id: string }>("select id from sheet_tabs where google_sheet_id=99")).rows[0].id;
      await db.query("insert into mapping_versions(organization_id,source_connection_id,source_tab_id,version,mapping_fingerprint,mapping_confidence,confirmed_by,columns) values($1,$2,$3,1,'older',1,$4,'{\"domain\":\"lead\"}'),($1,$2,$3,2,'confirmed',1,$4,$5)", [org, connection, ambiguous, profile, JSON.stringify({ domain: "member", headerRowIndex: 0, fields: [{ sourceHeader: "별명", field: "name" }] })]);
      const stored = await call<{ id: string; domain: string }>("sync_upsert_tab", { p_organization_id: org, p_connection_id: connection, p_lease: lease, p_google_sheet_id: 99, p_title: "기타", p_domain: null });
      expect(stored).toMatchObject({ id: ambiguous, domain: "member" });
      const unrelated = await call<{ domain: string | null }>("sync_upsert_tab", { p_organization_id: org, p_connection_id: connection, p_lease: lease, p_google_sheet_id: 100, p_title: "기타", p_domain: null });
      expect(unrelated.domain).toBeNull();
    } finally { await call("sync_release", { p_connection_id: connection, p_lease: lease }); }
  });
  it("fences tab titles, domains, and header metadata after a lease takeover", async () => {
    const oldLease = await call<string>("sync_acquire", { p_connection_id: connection, p_reason: "manual" });
    await db.exec("update sync_leases set expires_at=now() - interval '1 second'");
    const currentLease = await call<string>("sync_acquire", { p_connection_id: connection, p_reason: "manual" });
    const args = { p_organization_id: org, p_connection_id: connection, p_lease: currentLease, p_google_sheet_id: 0, p_title: "Current", p_domain: "member" };
    try {
      await call("sync_upsert_tab", args);
      await call("sync_update_tab_mapping", { p_organization_id: org, p_connection_id: connection, p_lease: currentLease, p_tab_id: tab, p_header_row: 61, p_headers: ["별명"] });
      await expect(call("sync_upsert_tab", { ...args, p_lease: oldLease, p_title: "STALE", p_domain: "lead" })).rejects.toThrow("lease_lost");
      await expect(call("sync_update_tab_mapping", { p_organization_id: org, p_connection_id: connection, p_lease: oldLease, p_tab_id: tab, p_header_row: 1, p_headers: ["STALE"] })).rejects.toThrow("lease_lost");
      expect((await db.query("select title,domain,header_row,headers from sheet_tabs where id=$1", [tab])).rows[0]).toEqual({ title: "Current", domain: "member", header_row: 61, headers: ["별명"] });
    } finally { await call("sync_release", { p_connection_id: connection, p_lease: currentLease }); }
  });
  it("atomically activates watches and authorizes cleanup of only the selected predecessor", async () => {
    const oldLease = await call<string>("sync_acquire", { p_connection_id: connection, p_reason: "watch" });
    const save = (lease: string, channel: string, resource: string | null) => call<{ channelId: string } | null>("sync_save_watch", { p_connection_id: connection, p_lease: lease, p_channel_id: channel, p_resource_id: resource, p_expires_at: new Date(Date.now() + 86400000).toISOString() });
    await save(oldLease, "old-worker", null);
    await db.exec("update sync_leases set expires_at=now() - interval '1 second'");
    const lease = await call<string>("sync_acquire", { p_connection_id: connection, p_reason: "watch" });
    try {
      await save(lease, "current-worker", null);
      expect(await save(lease, "current-worker", "current-resource")).toBeNull();
      await expect(save(oldLease, "old-worker", "old-resource")).rejects.toThrow("lease_lost");
      const cleanup = { p_connection_id: connection, p_lease: oldLease, p_channel_id: "current-worker", p_remove: false };
      await expect(call("sync_watch_cleanup", cleanup)).rejects.toThrow("lease_lost");
      expect((await db.query<{ watch_channel_id: string }>("select watch_channel_id from sheet_connections where id=$1", [connection])).rows[0].watch_channel_id).toBe("current-worker");
      await save(lease, "renewed-worker", null);
      expect(await save(lease, "renewed-worker", "renewed-resource")).toMatchObject({ channelId: "current-worker" });
      expect(await call("sync_watch_cleanup", { ...cleanup, p_lease: lease })).toMatchObject({ channelId: "current-worker", resourceId: "current-resource" });
      await expect(call("sync_watch_cleanup", { ...cleanup, p_lease: lease, p_channel_id: "old-worker" })).rejects.toThrow("watch_cleanup_forbidden");
      await expect(call("sync_watch_cleanup", { ...cleanup, p_lease: lease, p_channel_id: "renewed-worker" })).rejects.toThrow("watch_cleanup_forbidden");
      await expect(save(lease, "current-worker", "current-resource")).rejects.toThrow("watch_retired");
      await call("sync_watch_cleanup", { ...cleanup, p_lease: lease, p_remove: true });
      await expect(save(lease, "current-worker", null)).rejects.toThrow("watch_retired");
      expect(await call("sync_accept_notification", { p_channel_id: "current-worker", p_resource_id: "current-resource", p_message_number: "2" })).toBe(false);
    } finally { await call("sync_release", { p_connection_id: connection, p_lease: lease }); await db.query("update sheet_connections set watch_channel_id=null,watch_resource_id=null,watch_expires_at=null where id=$1", [connection]); }
  });
  it("serializes connections, applies atomic record history, and refuses a stale fencing token", async () => {
    const lease = await call<string>("sync_acquire", { p_connection_id: connection, p_reason: "manual" });
    expect(lease).toMatch(/^[a-f0-9-]+$/);
    expect(await call("sync_acquire", { p_connection_id: connection, p_reason: "manual" })).toBeNull();
    const scope = { organizationId: org, sourceConnectionId: connection, sourceTabId: tab };
    const rows = [["회원명", "회원ID", "메모"], ["민수", "M1", "first"]];
    const input = { ...scope, rows, mappingVersionId: mapping, capturedAt: "2026-09-06T00:00:00Z", mapping: mapColumns({ ...scope, rows, domain: "member", tabTitle: "회원" }) };
    const repository = createRpcSyncRepository(client, lease);
    expect((await applySync(input, repository)).member.inserted).toBe(1);
    expect((await applySync(input, repository)).member.unchanged).toBe(1);
    expect((await db.query("select * from raw_snapshots")).rows).toHaveLength(1);
    expect((await db.query("select * from audit_events")).rows).toHaveLength(1);
    input.rows[1][2] = "updated";
    expect((await applySync(input, repository)).member.updated).toBe(1);
    expect((await db.query<{ notes: string }>("select notes from members")).rows[0].notes).toBe("updated");
    expect((await db.query("select * from audit_events")).rows).toHaveLength(2);
    await db.exec("update sync_leases set expires_at = now() - interval '1 second'");
    const replacement = await call<string>("sync_acquire", { p_connection_id: connection, p_reason: "manual" });
    expect(replacement).not.toBe(lease);
    await expect(applySync(input, repository)).rejects.toThrow("lease_lost");
    await call("sync_release", { p_connection_id: connection, p_lease: lease });
    expect((await db.query("select * from sync_leases")).rows).toHaveLength(1);
    await call("sync_release", { p_connection_id: connection, p_lease: replacement });
  });
  it("rolls back canonical writes and metadata when an audit insert fails", async () => {
    const lease = await call<string>("sync_acquire", { p_connection_id: connection, p_reason: "manual" });
    const state = (await db.query<{ record: Record<string, unknown> }>("select record from sync_record_state")).rows[0].record;
    await expect(call("sync_commit_records", { p_organization_id: org, p_connection_id: connection, p_tab_id: tab, p_lease: lease, p_records: [{ ...state, values: { name: "CORRUPTED" } }], p_audits: [{ action: null, domain: "member", sourceRecordKey: "bad" }] })).rejects.toThrow();
    expect((await db.query<{ name: string }>("select name from members")).rows[0].name).toBe("민수");
    await call("sync_release", { p_connection_id: connection, p_lease: lease });
  });
  it("atomically deduplicates notifications, including numbers beyond JS safe integer", async () => {
    await db.query("insert into sync_watches(channel_id,source_connection_id,resource_id,expires_at) values ('channel',$1,'resource',now() + interval '1 day')", [connection]);
    const args = { p_channel_id: "channel", p_resource_id: "resource", p_message_number: "9007199254740993" };
    expect(await call("sync_accept_notification", args)).toBe(true);
    expect(await call("sync_accept_notification", args)).toBe(false);
    expect(await call("sync_accept_notification", { ...args, p_message_number: "9007199254740992" })).toBe(false);
    expect((await db.query("select * from sync_jobs where reason = 'notification'")).rows).toHaveLength(1);
    expect(await call("sync_accept_notification", { ...args, p_resource_id: "wrong", p_message_number: "9007199254740994" })).toBe(false);
  });
  it("denies untrusted roles access to ingestion RPCs and private state", async () => {
    await db.exec("set role authenticated");
    try { await expect(call("sync_acquire", { p_connection_id: connection, p_reason: "manual" })).rejects.toThrow(/permission denied/); await expect(db.query("select * from sync_record_state")).rejects.toThrow(/permission denied/); }
    finally { await db.exec("reset role"); }
  });
  it("renews aging watches within 24 hours without renewing a newly created watch every cron run", async () => {
    await db.query("update sheet_connections set watch_channel_id='channel',watch_expires_at=now() + interval '23 hours',status='succeeded',last_successful_sync_at=now() where id=$1", [connection]);
    await db.exec("update sync_jobs set status='succeeded',next_retry_at=null");
    expect(await call("sync_candidates", { p_now: new Date().toISOString() })).toEqual([]);
    await db.exec("update sync_watches set created_at=now() - interval '13 hours'");
    expect(await call("sync_candidates", { p_now: new Date().toISOString() })).toEqual([{ connectionId: connection, sync: false, renew: true }]);
  });
  it("reconciles an orphaned running job after final status persistence fails and the lease was released", async () => {
    const lease = await call<string>("sync_acquire", { p_connection_id: connection, p_reason: "manual" });
    await call("sync_release", { p_connection_id: connection, p_lease: lease });
    expect(await call("sync_candidates", { p_now: new Date().toISOString() })).toEqual([{ connectionId: connection, sync: true, renew: true }]);
  });
  it("persists retryable failures, and a completed run does not consume notifications received after it started", async () => {
    let lease = await call<string>("sync_acquire", { p_connection_id: connection, p_reason: "manual" });
    await call("sync_finish", { p_connection_id: connection, p_lease: lease, p_ok: false, p_result: {}, p_code: "google_429", p_retryable: true });
    await call("sync_release", { p_connection_id: connection, p_lease: lease });
    expect((await db.query<{ status: string; last_error_code: string }>("select status,last_error_code from sheet_connections")).rows[0]).toEqual({ status: "failed", last_error_code: "google_429" });
    expect((await db.query("select * from sync_jobs where status='retrying' and next_retry_at is not null")).rows.length).toBeGreaterThan(0);
    lease = await call<string>("sync_acquire", { p_connection_id: connection, p_reason: "reconciliation" });
    await db.query("insert into sync_jobs(organization_id,source_connection_id,idempotency_key,reason,created_at) values($1,$2,'late-message','notification',clock_timestamp() + interval '1 second')", [org, connection]);
    await call("sync_finish", { p_connection_id: connection, p_lease: lease, p_ok: true, p_result: { test: true }, p_code: null, p_retryable: false });
    await call("sync_release", { p_connection_id: connection, p_lease: lease });
    expect((await db.query<{ status: string }>("select status from sync_jobs where idempotency_key='late-message'")).rows[0].status).toBe("pending");
    expect((await db.query<{ status: string }>("select status from sheet_connections")).rows[0].status).toBe("succeeded");
  });
});
