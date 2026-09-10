// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
const db = new PGlite();
const org = "00000000-0000-4000-8000-000000000001",
  trainer = "00000000-0000-4000-8000-000000000002",
  admin = "00000000-0000-4000-8000-000000000003",
  user = "00000000-0000-4000-8000-000000000004",
  connection = "00000000-0000-4000-8000-000000000005";
beforeAll(async () => {
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$; create schema realtime; create table realtime.messages(extension text); alter table realtime.messages enable row level security; grant usage on schema realtime to authenticated; grant select on realtime.messages to authenticated; create function realtime.topic() returns text language sql stable as $$ select current_setting('test.topic',true) $$; create table public.test_broadcasts(payload jsonb,event text,topic text,private boolean); create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$ insert into public.test_broadcasts values(payload,event,topic,private) $$;",
  );
  for (const name of (await readdir("supabase/migrations")).filter(name => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(resolve("supabase/migrations", name), "utf8"));
  }
  await db.query("insert into auth.users values ($1),($2)", [admin, user]);
  await db.query(
    "insert into trainers(id,organization_id,display_name,email) values($1,$2,'A','a@example.test')",
    [trainer, org],
  );
  await db.query(
    "insert into profiles(id,organization_id,role,trainer_id,is_active) values($1,$3,'admin',null,true),($2,$3,'trainer',$4,true)",
    [admin, user, org, trainer],
  );
  await db.query(
    "insert into sheet_connections(id,organization_id,trainer_id,spreadsheet_id,display_name,connected_by) values($1,$2,$3,'sheet','A',$4)",
    [connection, org, trainer, admin],
  );
  await db.exec("insert into realtime.messages values('broadcast');");
}, 30000);
afterAll(() => db.close());
it("broadcasts only safe success invalidations to the owning organization and trainer", async () => {
  await db.query("update sheet_connections set status='failed' where id=$1", [
    connection,
  ]);
  expect((await db.query("select * from test_broadcasts")).rows).toHaveLength(
    0,
  );
  await db.query(
    "update sheet_connections set status='succeeded',last_successful_sync_at='2026-09-08T01:00:00Z' where id=$1",
    [connection],
  );
  const messages = (
    await db.query("select * from test_broadcasts order by topic")
  ).rows;
  expect(messages).toEqual([
    {
      payload: { status: "succeeded" },
      event: "sync:succeeded",
      topic: `org:${org}`,
      private: true,
    },
    {
      payload: { status: "succeeded" },
      event: "sync:succeeded",
      topic: `org:${org}:trainer:${trainer}`,
      private: true,
    },
  ]);
});
it("invalidates each affected trainer after column assignment, including a previous owner", async () => {
  const otherTrainer = "00000000-0000-4000-8000-000000000006", unrelatedTrainer = "00000000-0000-4000-8000-000000000007";
  const tab = "00000000-0000-4000-8000-000000000008";
  await db.query("insert into trainers(id,organization_id,display_name,email) values($1,$3,'B','b@example.test'),($2,$3,'C','c@example.test')", [otherTrainer, unrelatedTrainer, org]);
  await db.query("insert into sheet_tabs(id,organization_id,source_connection_id,google_sheet_id,title,domain) values($1,$2,$3,0,'members','member')", [tab, org, connection]);
  await db.query("update sheet_connections set trainer_id=null,trainer_assignment_mode='column' where id=$1", [connection]);
  for (const [table, key] of [["members", "m"], ["registrations", "r"], ["leads", "l"], ["classes", "c"]]) {
    await db.query(`insert into ${table}(organization_id,source_connection_id,source_tab_id,source_record_key,trainer_id,record_status) values($1,$2,$3,$4,$5,'valid')`, [org, connection, tab, key, trainer]);
    await db.query(`update ${table} set trainer_id=$1 where source_record_key=$2`, [otherTrainer, key]);
  }
  await db.exec("delete from test_broadcasts");
  await db.query("update sheet_connections set status='succeeded',last_successful_sync_at='2026-09-10T01:00:00Z' where id=$1", [connection]);
  const messages = (await db.query("select * from test_broadcasts order by topic")).rows;
  expect(messages).toEqual([org, `${org}:trainer:${trainer}`, `${org}:trainer:${otherTrainer}`].map(scope => ({ payload: { status: "succeeded" }, event: "sync:succeeded", topic: `org:${scope}`, private: true })));
  await db.exec("delete from test_broadcasts");
  await db.query("update sheet_connections set last_successful_sync_at='2026-09-10T02:00:00Z' where id=$1", [connection]);
  expect((await db.query<{ topic: string }>("select topic from test_broadcasts order by topic")).rows.map(row => row.topic)).toEqual([`org:${org}`, `org:${org}:trainer:${otherTrainer}`]);
});
it("denies trainer organization-wide and other-trainer subscriptions while allowing own topic", async () => {
  const read = async (uid: string, topic: string) => {
    await db.query(
      "select set_config('test.uid',$1,false),set_config('test.topic',$2,false)",
      [uid, topic],
    );
    await db.exec("set role authenticated");
    try {
      return (await db.query("select * from realtime.messages")).rows.length;
    } finally {
      await db.exec("reset role");
    }
  };
  expect(await read(user, `org:${org}`)).toBe(0);
  expect(await read(user, `org:${org}:trainer:someone-else`)).toBe(0);
  expect(await read(user, `org:${org}:trainer:${trainer}`)).toBe(1);
  expect(await read(admin, "org:other")).toBe(0);
  expect(await read(admin, `org:${org}`)).toBe(1);
});
