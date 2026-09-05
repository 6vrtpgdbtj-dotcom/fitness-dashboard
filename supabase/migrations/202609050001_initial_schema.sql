-- Tenant IDs are assigned by a trusted bootstrap/admin workflow, never auth metadata.
create type public.app_role as enum ('admin', 'trainer');
create type public.sync_status as enum ('pending', 'running', 'succeeded', 'failed', 'retrying');
create type public.record_review_status as enum ('valid', 'review_required', 'rejected', 'archived');

create table public.trainers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  display_name text not null,
  email text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index trainers_organization_email_idx on public.trainers (organization_id, lower(email));

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null,
  role public.app_role not null default 'trainer',
  trainer_id uuid,
  display_name text not null default '',
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, trainer_id) references public.trainers (organization_id, id),
  check ((role = 'admin' and trainer_id is null) or (role = 'trainer' and trainer_id is not null))
);
create index profiles_organization_trainer_idx on public.profiles (organization_id, trainer_id);

create table public.sheet_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  spreadsheet_id text not null,
  display_name text not null,
  branch_name text,
  connected_by uuid not null,
  trainer_id uuid,
  is_active boolean not null default true,
  status public.sync_status not null default 'pending',
  last_successful_sync_at timestamptz,
  last_error_code text,
  watch_channel_id text,
  watch_resource_id text,
  watch_expires_at timestamptz,
  last_message_number numeric(20,0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, spreadsheet_id),
  foreign key (organization_id, connected_by) references public.profiles (organization_id, id),
  foreign key (organization_id, trainer_id) references public.trainers (organization_id, id)
);

-- Only trusted server code using the service role may read encrypted credentials.
-- No token columns exist on browser-readable connections or profiles.
create table public.oauth_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  profile_id uuid not null,
  provider text not null default 'google' check (provider = 'google'),
  encrypted_refresh_token text not null,
  encrypted_access_token text,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, profile_id, provider),
  foreign key (organization_id, profile_id) references public.profiles (organization_id, id)
);

create table public.sheet_tabs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  source_connection_id uuid not null,
  google_sheet_id bigint not null,
  title text not null,
  domain text check (domain in ('member', 'registration', 'lead', 'class')),
  header_row integer check (header_row > 0),
  headers jsonb not null default '[]',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_connection_id, id),
  unique (organization_id, source_connection_id, google_sheet_id),
  foreign key (organization_id, source_connection_id) references public.sheet_connections (organization_id, id)
);

create table public.mapping_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  source_connection_id uuid not null,
  source_tab_id uuid not null,
  version integer not null check (version > 0),
  mapping_fingerprint text not null,
  columns jsonb not null default '{}',
  missing_required_fields jsonb not null default '[]',
  mapping_confidence numeric(4,3) not null check (mapping_confidence between 0 and 1),
  confirmed_by uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, source_connection_id, source_tab_id, id),
  unique (organization_id, source_connection_id, source_tab_id, version),
  foreign key (organization_id, source_connection_id, source_tab_id) references public.sheet_tabs (organization_id, source_connection_id, id),
  foreign key (organization_id, confirmed_by) references public.profiles (organization_id, id)
);
create index mapping_versions_fingerprint_idx on public.mapping_versions (organization_id, mapping_fingerprint);

create table public.raw_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  source_connection_id uuid not null,
  source_tab_id uuid not null,
  snapshot_key text not null,
  source_payload jsonb not null,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, source_connection_id, source_tab_id, id),
  unique (organization_id, source_connection_id, source_tab_id, snapshot_key),
  foreign key (organization_id, source_connection_id, source_tab_id) references public.sheet_tabs (organization_id, source_connection_id, id)
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  trainer_id uuid,
  external_member_id text,
  name text,
  gender text,
  birth_date date,
  phone_last4 text check (phone_last4 ~ '^[0-9]{4}$'),
  exercise_goal text,
  acquisition_source text,
  first_consultation_date date,
  first_registration_date date,
  status text,
  remaining_sessions numeric(10,2),
  total_registered_sessions numeric(10,2),
  total_paid_amount numeric(14,2),
  latest_registration_date date,
  expected_end_date date,
  referrer text,
  notes text,
  source_connection_id uuid not null,
  source_tab_id uuid not null,
  source_record_key text not null check (length(source_record_key) > 0),
  raw_snapshot_id uuid,
  mapping_version_id uuid,
  mapping_confidence numeric(4,3) not null default 0 check (mapping_confidence between 0 and 1),
  record_status public.record_review_status not null default 'review_required',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, source_connection_id, source_tab_id, source_record_key),
  foreign key (organization_id, trainer_id) references public.trainers (organization_id, id),
  foreign key (organization_id, source_connection_id, source_tab_id) references public.sheet_tabs (organization_id, source_connection_id, id),
  foreign key (organization_id, source_connection_id, source_tab_id, raw_snapshot_id) references public.raw_snapshots (organization_id, source_connection_id, source_tab_id, id),
  foreign key (organization_id, source_connection_id, source_tab_id, mapping_version_id) references public.mapping_versions (organization_id, source_connection_id, source_tab_id, id)
);
create index members_organization_trainer_idx on public.members (organization_id, trainer_id);
create index members_source_key_idx on public.members (organization_id, source_record_key);

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  trainer_id uuid,
  member_id uuid,
  external_registration_id text,
  registration_date date,
  registration_type text,
  acquisition_source text,
  product text,
  registered_sessions numeric(10,2),
  list_amount numeric(14,2),
  paid_amount numeric(14,2),
  price_per_session numeric(14,2),
  discount_amount numeric(14,2),
  payment_method text,
  sales_trainer_id uuid,
  expected_end_date date,
  status text,
  source_connection_id uuid not null,
  source_tab_id uuid not null,
  source_record_key text not null check (length(source_record_key) > 0),
  raw_snapshot_id uuid,
  mapping_version_id uuid,
  mapping_confidence numeric(4,3) not null default 0 check (mapping_confidence between 0 and 1),
  record_status public.record_review_status not null default 'review_required',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, source_connection_id, source_tab_id, source_record_key),
  foreign key (organization_id, trainer_id) references public.trainers (organization_id, id),
  foreign key (organization_id, member_id) references public.members (organization_id, id),
  foreign key (organization_id, sales_trainer_id) references public.trainers (organization_id, id),
  foreign key (organization_id, source_connection_id, source_tab_id) references public.sheet_tabs (organization_id, source_connection_id, id),
  foreign key (organization_id, source_connection_id, source_tab_id, raw_snapshot_id) references public.raw_snapshots (organization_id, source_connection_id, source_tab_id, id),
  foreign key (organization_id, source_connection_id, source_tab_id, mapping_version_id) references public.mapping_versions (organization_id, source_connection_id, source_tab_id, id)
);
create index registrations_organization_trainer_idx on public.registrations (organization_id, trainer_id);
create index registrations_source_key_idx on public.registrations (organization_id, source_record_key);
create index registrations_member_idx on public.registrations (organization_id, member_id);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  trainer_id uuid,
  member_id uuid,
  external_lead_id text,
  lead_date date,
  consultation_date date,
  acquisition_source text,
  exercise_goal text,
  status text,
  is_registered boolean,
  registration_date date,
  registered_sessions numeric(10,2),
  paid_amount numeric(14,2),
  non_registration_reason text,
  source_connection_id uuid not null,
  source_tab_id uuid not null,
  source_record_key text not null check (length(source_record_key) > 0),
  raw_snapshot_id uuid,
  mapping_version_id uuid,
  mapping_confidence numeric(4,3) not null default 0 check (mapping_confidence between 0 and 1),
  record_status public.record_review_status not null default 'review_required',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, source_connection_id, source_tab_id, source_record_key),
  foreign key (organization_id, trainer_id) references public.trainers (organization_id, id),
  foreign key (organization_id, member_id) references public.members (organization_id, id),
  foreign key (organization_id, source_connection_id, source_tab_id) references public.sheet_tabs (organization_id, source_connection_id, id),
  foreign key (organization_id, source_connection_id, source_tab_id, raw_snapshot_id) references public.raw_snapshots (organization_id, source_connection_id, source_tab_id, id),
  foreign key (organization_id, source_connection_id, source_tab_id, mapping_version_id) references public.mapping_versions (organization_id, source_connection_id, source_tab_id, id)
);
create index leads_organization_trainer_idx on public.leads (organization_id, trainer_id);
create index leads_source_key_idx on public.leads (organization_id, source_record_key);
create index leads_member_idx on public.leads (organization_id, member_id);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  trainer_id uuid,
  member_id uuid,
  external_class_id text,
  class_date date,
  starts_at timestamptz,
  deducted_sessions numeric(10,2),
  remaining_sessions numeric(10,2),
  status text,
  source_connection_id uuid not null,
  source_tab_id uuid not null,
  source_record_key text not null check (length(source_record_key) > 0),
  raw_snapshot_id uuid,
  mapping_version_id uuid,
  mapping_confidence numeric(4,3) not null default 0 check (mapping_confidence between 0 and 1),
  record_status public.record_review_status not null default 'review_required',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, source_connection_id, source_tab_id, source_record_key),
  foreign key (organization_id, trainer_id) references public.trainers (organization_id, id),
  foreign key (organization_id, member_id) references public.members (organization_id, id),
  foreign key (organization_id, source_connection_id, source_tab_id) references public.sheet_tabs (organization_id, source_connection_id, id),
  foreign key (organization_id, source_connection_id, source_tab_id, raw_snapshot_id) references public.raw_snapshots (organization_id, source_connection_id, source_tab_id, id),
  foreign key (organization_id, source_connection_id, source_tab_id, mapping_version_id) references public.mapping_versions (organization_id, source_connection_id, source_tab_id, id)
);
create index classes_organization_trainer_idx on public.classes (organization_id, trainer_id);
create index classes_source_key_idx on public.classes (organization_id, source_record_key);
create index classes_member_idx on public.classes (organization_id, member_id);

create index members_registration_date_idx on public.members (organization_id, first_registration_date);
create index registrations_date_idx on public.registrations (organization_id, registration_date);
create index leads_date_idx on public.leads (organization_id, lead_date);
create index classes_date_idx on public.classes (organization_id, class_date);

create table public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  source_connection_id uuid not null,
  source_tab_id uuid,
  idempotency_key text not null,
  reason text not null,
  status public.sync_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  next_retry_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  result jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, source_connection_id, idempotency_key),
  foreign key (organization_id, source_connection_id) references public.sheet_connections (organization_id, id),
  foreign key (organization_id, source_connection_id, source_tab_id) references public.sheet_tabs (organization_id, source_connection_id, id)
);
create index sync_jobs_retry_idx on public.sync_jobs (organization_id, status, next_retry_at);
create unique index sync_jobs_running_connection_idx on public.sync_jobs (organization_id, source_connection_id) where status = 'running';

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  actor_id uuid,
  source_connection_id uuid,
  source_tab_id uuid,
  source_record_key text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (organization_id, actor_id) references public.profiles (organization_id, id),
  foreign key (organization_id, source_connection_id) references public.sheet_connections (organization_id, id),
  foreign key (organization_id, source_connection_id, source_tab_id) references public.sheet_tabs (organization_id, source_connection_id, id),
  check (source_tab_id is null or source_connection_id is not null)
);
create index audit_events_organization_created_idx on public.audit_events (organization_id, created_at desc);
create index audit_events_source_key_idx on public.audit_events (organization_id, source_record_key);

-- SECURITY DEFINER avoids recursive profiles RLS. Each helper takes no user
-- arguments, trusts only auth.uid(), and has a fixed empty search path.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.current_organization_id() returns uuid
language sql stable security definer set search_path = ''
as $$ select organization_id from public.profiles where id = (select auth.uid()) and is_active = true $$;

create function private.current_app_role() returns public.app_role
language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = (select auth.uid()) and is_active = true $$;

create function private.current_trainer_id() returns uuid
language sql stable security definer set search_path = ''
as $$ select trainer_id from public.profiles where id = (select auth.uid()) and is_active = true and role = 'trainer' $$;

revoke all on function private.current_organization_id() from public, anon;
revoke all on function private.current_app_role() from public, anon;
revoke all on function private.current_trainer_id() from public, anon;
grant execute on function private.current_organization_id() to authenticated;
grant execute on function private.current_app_role() to authenticated;
grant execute on function private.current_trainer_id() to authenticated;

create function private.set_updated_at() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end $$;
revoke all on function private.set_updated_at() from public, anon, authenticated;

-- Explicit grants replace Supabase's permissive default table privileges.
revoke all on all tables in schema public from anon, authenticated;

alter table public.profiles enable row level security;
grant all on public.profiles to service_role;
grant select, insert, update, delete on public.profiles to authenticated;
create policy admin_all on public.profiles for all to authenticated
  using (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin')
  with check (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin');
create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create policy own_profile_select on public.profiles for select to authenticated
  using (id = (select auth.uid()));

alter table public.trainers enable row level security;
grant all on public.trainers to service_role;
grant select, insert, update, delete on public.trainers to authenticated;
create policy admin_all on public.trainers for all to authenticated
  using (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin')
  with check (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin');
create trigger set_updated_at before update on public.trainers
  for each row execute function private.set_updated_at();
create policy trainer_select on public.trainers for select to authenticated
  using (organization_id = (select private.current_organization_id())
    and (select private.current_app_role()) = 'trainer'
    and id = (select private.current_trainer_id()));

alter table public.sheet_connections enable row level security;
grant all on public.sheet_connections to service_role;
grant select, insert, update, delete on public.sheet_connections to authenticated;
create policy admin_all on public.sheet_connections for all to authenticated
  using (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin')
  with check (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin');
create trigger set_updated_at before update on public.sheet_connections
  for each row execute function private.set_updated_at();

alter table public.sheet_tabs enable row level security;
grant all on public.sheet_tabs to service_role;
grant select, insert, update, delete on public.sheet_tabs to authenticated;
create policy admin_all on public.sheet_tabs for all to authenticated
  using (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin')
  with check (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin');
create trigger set_updated_at before update on public.sheet_tabs
  for each row execute function private.set_updated_at();

alter table public.mapping_versions enable row level security;
grant all on public.mapping_versions to service_role;
grant select, insert on public.mapping_versions to authenticated;
create policy admin_select on public.mapping_versions for select to authenticated
  using (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin');
create policy admin_insert on public.mapping_versions for insert to authenticated
  with check (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin');

alter table public.raw_snapshots enable row level security;
grant all on public.raw_snapshots to service_role;
grant select, insert on public.raw_snapshots to authenticated;
create policy admin_select on public.raw_snapshots for select to authenticated
  using (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin');
create policy admin_insert on public.raw_snapshots for insert to authenticated
  with check (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin');

alter table public.members enable row level security;
grant all on public.members to service_role;
grant select, insert, update, delete on public.members to authenticated;
create policy admin_all on public.members for all to authenticated
  using (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin')
  with check (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin');
create trigger set_updated_at before update on public.members
  for each row execute function private.set_updated_at();
create policy trainer_select on public.members for select to authenticated
  using (organization_id = (select private.current_organization_id())
    and (select private.current_app_role()) = 'trainer'
    and trainer_id = (select private.current_trainer_id()));

alter table public.registrations enable row level security;
grant all on public.registrations to service_role;
grant select, insert, update, delete on public.registrations to authenticated;
create policy admin_all on public.registrations for all to authenticated
  using (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin')
  with check (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin');
create trigger set_updated_at before update on public.registrations
  for each row execute function private.set_updated_at();
create policy trainer_select on public.registrations for select to authenticated
  using (organization_id = (select private.current_organization_id())
    and (select private.current_app_role()) = 'trainer'
    and trainer_id = (select private.current_trainer_id()));

alter table public.leads enable row level security;
grant all on public.leads to service_role;
grant select, insert, update, delete on public.leads to authenticated;
create policy admin_all on public.leads for all to authenticated
  using (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin')
  with check (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin');
create trigger set_updated_at before update on public.leads
  for each row execute function private.set_updated_at();
create policy trainer_select on public.leads for select to authenticated
  using (organization_id = (select private.current_organization_id())
    and (select private.current_app_role()) = 'trainer'
    and trainer_id = (select private.current_trainer_id()));

alter table public.classes enable row level security;
grant all on public.classes to service_role;
grant select, insert, update, delete on public.classes to authenticated;
create policy admin_all on public.classes for all to authenticated
  using (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin')
  with check (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin');
create trigger set_updated_at before update on public.classes
  for each row execute function private.set_updated_at();
create policy trainer_select on public.classes for select to authenticated
  using (organization_id = (select private.current_organization_id())
    and (select private.current_app_role()) = 'trainer'
    and trainer_id = (select private.current_trainer_id()));

alter table public.sync_jobs enable row level security;
grant all on public.sync_jobs to service_role;
grant select, insert, update, delete on public.sync_jobs to authenticated;
create policy admin_all on public.sync_jobs for all to authenticated
  using (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin')
  with check (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin');
create trigger set_updated_at before update on public.sync_jobs
  for each row execute function private.set_updated_at();

alter table public.audit_events enable row level security;
grant all on public.audit_events to service_role;
grant select, insert on public.audit_events to authenticated;
create policy admin_select on public.audit_events for select to authenticated
  using (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin');
create policy admin_insert on public.audit_events for insert to authenticated
  with check (organization_id = (select private.current_organization_id()) and (select private.current_app_role()) = 'admin');

alter table public.oauth_credentials enable row level security;
grant all on public.oauth_credentials to service_role;

create trigger set_updated_at before update on public.oauth_credentials
  for each row execute function private.set_updated_at();
-- No authenticated policies/grants for oauth_credentials. Raw snapshots,
-- mappings and audit events are append-only for authenticated administrators.
-- History deletion is an explicit, audited service-role workflow.
