// @vitest-environment node
// Static regression checks only. Run supabase/tests/rls.sql against Postgres
// for actual policy execution; text assertions are not proof of RLS isolation.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const path = resolve("supabase/migrations/202609050001_initial_schema.sql");
const sql = existsSync(path) ? readFileSync(path, "utf8") : "";
const tables = ["profiles", "trainers", "sheet_connections", "sheet_tabs", "mapping_versions", "raw_snapshots", "members", "registrations", "leads", "classes", "sync_jobs", "audit_events"];

describe("migration structural safeguards (not live RLS verification)", () => {
  it.each(tables)("enables RLS and organization ownership on %s", (table) => {
    expect(sql).toContain(`create table public.${table} (`);
    const definition = sql.split(`create table public.${table} (`)[1]?.split("\n);")[0];
    expect(definition).toContain("organization_id uuid not null");
    expect(sql).toContain(`alter table public.${table} enable row level security;`);
  });
  it.each(["members", "registrations", "leads", "classes"])("deduplicates source records and scopes trainer reads on %s", (table) => {
    const definition = sql.split(`create table public.${table} (`)[1]?.split("\n);")[0];
    expect(definition).toContain("unique (organization_id, source_connection_id, source_tab_id, source_record_key)");
    expect(sql).toContain(`create policy trainer_select on public.${table} for select to authenticated`);
  });
  it("keeps privileged helpers out of the public API and revokes default access", () => {
    expect(sql).toContain("create schema if not exists private;");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("revoke all on all tables in schema public from anon, authenticated;");
    expect(sql).toContain("is_active = true");
  });
});
