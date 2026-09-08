// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
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
  await db.exec(
    await readFile(
      resolve("supabase/migrations/202609050001_initial_schema.sql"),
      "utf8",
    ),
  );
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
  await db.exec(
    await readFile(
      resolve("supabase/migrations/202609080003_dashboard_realtime.sql"),
      "utf8",
    ),
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
