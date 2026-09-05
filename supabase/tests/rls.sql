-- Run with psql -v ON_ERROR_STOP=1 on an isolated local Supabase database.
-- Fixtures and all mutations are rolled back. Any failed assertion exits nonzero.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'admin1@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'trainer1@example.test'),
  ('00000000-0000-0000-0000-000000000003', 'trainer2@example.test'),
  ('00000000-0000-0000-0000-000000000004', 'admin2@example.test'),
  ('00000000-0000-0000-0000-000000000005', 'inactive@example.test');

insert into public.trainers (id, organization_id, display_name, email) values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Trainer One', 'trainer1@example.test'),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Trainer Two', 'trainer2@example.test'),
  ('10000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'Other Organization', 'trainer3@example.test');

insert into public.profiles (id, organization_id, role, trainer_id, is_active) values
  ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'admin', null, true),
  ('00000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'trainer', '10000000-0000-0000-0000-000000000001', true),
  ('00000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'trainer', '10000000-0000-0000-0000-000000000002', true),
  ('00000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'admin', null, true),
  ('00000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'trainer', '10000000-0000-0000-0000-000000000001', false);

insert into public.sheet_connections (id, organization_id, spreadsheet_id, display_name, connected_by) values
  ('20000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'sheet-one', 'Sheet One', '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'sheet-two', 'Sheet Two', '00000000-0000-0000-0000-000000000004');

insert into public.sheet_tabs (id, organization_id, source_connection_id, google_sheet_id, title) values
  ('30000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 0, 'Data'),
  ('30000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 0, 'Other Data');

insert into public.raw_snapshots (organization_id, source_connection_id, source_tab_id, snapshot_key, source_payload)
  select organization_id, source_connection_id, id, 'snapshot-one', '{"private":"raw-source"}'::jsonb from public.sheet_tabs;
insert into public.mapping_versions (organization_id, source_connection_id, source_tab_id, version, mapping_fingerprint, mapping_confidence)
  select organization_id, source_connection_id, id, 1, 'mapping-one', 1 from public.sheet_tabs;
insert into public.sync_jobs (organization_id, source_connection_id, idempotency_key, reason)
  select organization_id, id, 'job-one', 'manual' from public.sheet_connections;
insert into public.audit_events (organization_id, action, entity_type, payload)
  select organization_id, 'sync', 'connection', '{"private":"audit-payload"}'::jsonb from public.sheet_connections;
insert into public.oauth_credentials (organization_id, profile_id, encrypted_refresh_token)
  select organization_id, id, 'test-ciphertext' from public.profiles where role = 'admin';

-- One record for each trainer across two organizations in every normalized table.
do $$
declare tablename text;
begin
  foreach tablename in array array['members', 'registrations', 'leads', 'classes'] loop
    execute format('insert into public.%I (organization_id, trainer_id, source_connection_id, source_tab_id, source_record_key, record_status)
      select t.organization_id, t.id, s.source_connection_id, s.id, t.id::text, ''valid''
      from public.trainers t join public.sheet_tabs s using (organization_id)', tablename);
  end loop;
end $$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$
declare tablename text; row_count integer; invalid_count integer;
begin
  foreach tablename in array array['members', 'registrations', 'leads', 'classes'] loop
    execute format('select count(*), count(*) filter (where trainer_id <> ''10000000-0000-0000-0000-000000000001'') from public.%I', tablename)
      into row_count, invalid_count;
    if row_count <> 1 or invalid_count <> 0 then raise exception 'Trainer row isolation failed: %', tablename; end if;
  end loop;
  foreach tablename in array array['sheet_connections', 'sheet_tabs', 'mapping_versions', 'raw_snapshots', 'sync_jobs', 'audit_events'] loop
    execute format('select count(*) from public.%I', tablename) into row_count;
    if row_count <> 0 then raise exception 'Trainer privileged data leak: %', tablename; end if;
  end loop;
  begin
    perform * from public.oauth_credentials;
    raise exception 'Trainer read OAuth credentials';
  exception when insufficient_privilege then null;
  end;
  update public.profiles set role = 'admin', trainer_id = null where id = '00000000-0000-0000-0000-000000000002';
  get diagnostics row_count = row_count;
  if row_count <> 0 then raise exception 'Trainer promoted own profile'; end if;
  update public.members set name = 'unauthorized edit';
  get diagnostics row_count = row_count;
  if row_count <> 0 then raise exception 'Trainer wrote normalized records'; end if;
end $$;

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare tablename text; row_count integer; invalid_count integer;
begin
  foreach tablename in array array['members', 'registrations', 'leads', 'classes'] loop
    execute format('select count(*), count(*) filter (where organization_id <> ''a0000000-0000-0000-0000-000000000001'') from public.%I', tablename)
      into row_count, invalid_count;
    if row_count <> 2 or invalid_count <> 0 then raise exception 'Admin organization isolation failed: %', tablename; end if;
  end loop;
  foreach tablename in array array['sheet_connections', 'sheet_tabs', 'mapping_versions', 'raw_snapshots', 'sync_jobs', 'audit_events'] loop
    execute format('select count(*) from public.%I', tablename) into row_count;
    if row_count <> 1 then raise exception 'Admin metadata isolation failed: %', tablename; end if;
  end loop;
  begin
    perform * from public.oauth_credentials;
    raise exception 'Browser admin read OAuth credentials';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.members (organization_id, trainer_id, source_connection_id, source_tab_id, source_record_key)
      values ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'cross-tenant');
    raise exception 'Cross-tenant foreign key accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.members (organization_id, source_connection_id, source_tab_id, source_record_key)
      values ('a0000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'wrong-organization');
    raise exception 'Admin wrote another organization';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.members (organization_id, trainer_id, source_connection_id, source_tab_id, source_record_key)
      values ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
    raise exception 'Duplicate source record accepted';
  exception when unique_violation then null;
  end;
end $$;

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
do $$ begin
  if exists (select 1 from public.members) then raise exception 'Inactive profile can read members'; end if;
end $$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000099';
do $$ begin
  if exists (select 1 from public.members) then raise exception 'Missing profile can read members'; end if;
end $$;

set local role anon;
do $$ begin
  begin
    perform * from public.members;
    raise exception 'Anonymous user can read members';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
