-- Server-only coordination. Leases are durable across processes and have a
-- fencing token, so a timed-out worker cannot commit after another takes over.
create table public.sync_leases (
  source_connection_id uuid primary key references public.sheet_connections(id),
  token uuid not null,
  expires_at timestamptz not null,
  job_id uuid references public.sync_jobs(id)
);
create table public.sync_watches (
  channel_id text primary key,
  source_connection_id uuid not null references public.sheet_connections(id),
  resource_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_message_number numeric(20,0) not null default 0
);
create index sync_watches_connection_idx on public.sync_watches(source_connection_id);
create table public.sync_record_state (
  organization_id uuid not null,
  source_connection_id uuid not null,
  source_tab_id uuid not null,
  domain text not null check (domain in ('member','registration','lead','class')),
  source_record_key text not null,
  record jsonb not null,
  primary key (organization_id, source_connection_id, source_tab_id, domain, source_record_key),
  foreign key (organization_id,source_connection_id,source_tab_id) references public.sheet_tabs(organization_id,source_connection_id,id)
);
alter table public.sync_leases enable row level security;
alter table public.sync_watches enable row level security;
alter table public.sync_record_state enable row level security;
revoke all on public.sync_leases, public.sync_watches, public.sync_record_state from public, anon, authenticated;
grant all on public.sync_leases, public.sync_watches, public.sync_record_state to service_role;

create function public.sync_acquire(p_connection_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_token uuid := gen_random_uuid(); v_org uuid; v_job uuid; v_acquired uuid;
begin
  select organization_id into v_org from public.sheet_connections where id = p_connection_id and is_active;
  if v_org is null then raise exception 'connection_not_found'; end if;
  insert into public.sync_leases(source_connection_id,token,expires_at)
    values(p_connection_id,v_token,clock_timestamp() + interval '5 minutes')
    on conflict(source_connection_id) do update set token=excluded.token, expires_at=excluded.expires_at, job_id=null
    where public.sync_leases.expires_at < clock_timestamp()
    returning token into v_acquired;
  if v_acquired is null then return null; end if;
  -- A dead worker may leave its old running job behind.
  update public.sync_jobs set status='retrying', error_code='worker_expired', next_retry_at=now()
    where source_connection_id=p_connection_id and status='running';
  if p_reason <> 'watch' then
    insert into public.sync_jobs(organization_id,source_connection_id,idempotency_key,reason,status,attempts,started_at)
      values(v_org,p_connection_id,'run:' || v_token,p_reason,'running',1,clock_timestamp()) returning id into v_job;
    update public.sync_leases set job_id=v_job where source_connection_id=p_connection_id and token=v_token;
    update public.sheet_connections set status='running' where id=p_connection_id;
  end if;
  return v_token;
end $$;

create function public.sync_assert_lease(p_connection_id uuid,p_lease uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.sync_leases where source_connection_id=p_connection_id and token=p_lease and expires_at > clock_timestamp() for update;
  if not found then raise exception 'lease_lost'; end if;
end $$;
create function public.sync_release(p_connection_id uuid,p_lease uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.sync_leases where source_connection_id=p_connection_id and token=p_lease;
$$;
create function public.sync_finish(p_connection_id uuid,p_lease uuid,p_ok boolean,p_result jsonb,p_code text,p_retryable boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_started timestamptz; v_job uuid;
begin
  perform public.sync_assert_lease(p_connection_id,p_lease);
  select job_id into v_job from public.sync_leases where source_connection_id=p_connection_id;
  select started_at into v_started from public.sync_jobs where id=v_job;
  update public.sync_jobs set status=case when p_ok then 'succeeded'::public.sync_status when p_retryable then 'retrying'::public.sync_status else 'failed'::public.sync_status end,
    completed_at=clock_timestamp(), result=coalesce(p_result,'{}'), error_code=p_code,
    next_retry_at=case when not p_ok and p_retryable then now() + interval '5 minutes' else null end
    where source_connection_id=p_connection_id and (id=v_job or (status in ('pending','retrying','failed') and created_at <= v_started));
  update public.sheet_connections set status=case when p_ok then 'succeeded'::public.sync_status else 'failed'::public.sync_status end,
    last_successful_sync_at=case when p_ok then clock_timestamp() else last_successful_sync_at end,last_error_code=p_code where id=p_connection_id;
end $$;

create function public.sync_insert_snapshot(p_organization_id uuid,p_connection_id uuid,p_tab_id uuid,p_snapshot_key text,p_captured_at timestamptz,p_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.raw_snapshots(organization_id,source_connection_id,source_tab_id,snapshot_key,captured_at,source_payload)
    values(p_organization_id,p_connection_id,p_tab_id,p_snapshot_key,p_captured_at,p_payload)
    on conflict(organization_id,source_connection_id,source_tab_id,snapshot_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.raw_snapshots where organization_id=p_organization_id and source_connection_id=p_connection_id and source_tab_id=p_tab_id and snapshot_key=p_snapshot_key; end if;
  return v_id;
end $$;
create function public.sync_read_records(p_organization_id uuid,p_connection_id uuid,p_tab_id uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.sync_assert_lease(p_connection_id,p_lease);
  return (select coalesce(jsonb_agg(record),'[]'::jsonb) from public.sync_record_state where organization_id=p_organization_id and source_connection_id=p_connection_id and source_tab_id=p_tab_id);
end $$;

create function public.sync_commit_records(p_organization_id uuid,p_connection_id uuid,p_tab_id uuid,p_lease uuid,p_records jsonb,p_audits jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_record jsonb; v_event jsonb; v_table text; v_columns text; v_updates text; v_payload jsonb; v_trainer uuid; v_member uuid; v_count bigint;
begin
  perform public.sync_assert_lease(p_connection_id,p_lease);
  select trainer_id into v_trainer from public.sheet_connections where id=p_connection_id and organization_id=p_organization_id and is_active;
  if not found then raise exception 'connection_not_found'; end if;
  perform 1 from public.sheet_tabs where id=p_tab_id and organization_id=p_organization_id and source_connection_id=p_connection_id;
  if not found then raise exception 'tab_not_found'; end if;
  for v_record in select value from jsonb_array_elements(p_records) loop
    if v_record->>'organization_id' <> p_organization_id::text or v_record->>'source_connection_id' <> p_connection_id::text or v_record->>'source_tab_id' <> p_tab_id::text then raise exception 'scope_mismatch'; end if;
    v_table := case v_record->>'domain' when 'member' then 'members' when 'registration' then 'registrations' when 'lead' then 'leads' when 'class' then 'classes' end;
    if v_table is null then raise exception 'invalid_domain'; end if;
    v_record := jsonb_set(v_record,'{trainer_id}',coalesce(to_jsonb(v_trainer),'null'::jsonb));
    v_payload := (v_record->'values') || jsonb_build_object(
      'organization_id',p_organization_id,'source_connection_id',p_connection_id,'source_tab_id',p_tab_id,
      'trainer_id',v_trainer,'source_record_key',v_record->>'source_record_key',
      'raw_snapshot_id',v_record->>'raw_snapshot_id','mapping_version_id',v_record->>'mapping_version_id',
      'mapping_confidence',v_record->'mapping_confidence','record_status',v_record->>'record_status');
    if v_table <> 'members' then
      -- Only an unambiguous match within the trusted organization may join.
      select count(*), (array_agg(id))[1] into v_count,v_member from public.members where organization_id=p_organization_id and record_status='valid' and
        (case when nullif(v_record#>>'{hints,external_member_id}','') is not null then external_member_id=v_record#>>'{hints,external_member_id}' else name=v_record#>>'{hints,name}' end);
      v_payload := v_payload || jsonb_build_object('member_id',case when v_count=1 then v_member else null end);
    end if;
    -- Enumerate actual schema columns, preserving defaults/identity timestamps.
    -- Populate all business columns so removed mappings clear old values.
    select string_agg(format('%I',column_name),',' order by ordinal_position),
      string_agg(format('%I=excluded.%I',column_name,column_name),',' order by ordinal_position)
      into v_columns,v_updates from information_schema.columns
      where table_schema='public' and table_name=v_table and column_name not in ('id','created_at','updated_at');
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) on conflict(organization_id,source_connection_id,source_tab_id,source_record_key) do update set %s',v_table,v_columns,v_columns,v_table,v_updates) using v_payload;
    insert into public.sync_record_state(organization_id,source_connection_id,source_tab_id,domain,source_record_key,record)
      values(p_organization_id,p_connection_id,p_tab_id,v_record->>'domain',v_record->>'source_record_key',v_record)
      on conflict(organization_id,source_connection_id,source_tab_id,domain,source_record_key) do update set record=excluded.record;
  end loop;
  for v_event in select value from jsonb_array_elements(p_audits) loop
    insert into public.audit_events(organization_id,source_connection_id,source_tab_id,source_record_key,action,entity_type,payload)
      values(p_organization_id,p_connection_id,p_tab_id,v_event->>'sourceRecordKey',v_event->>'action',v_event->>'domain',v_event);
  end loop;
end $$;

create function public.sync_accept_notification(p_channel_id text,p_resource_id text,p_message_number numeric) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_connection uuid; v_org uuid;
begin
  update public.sync_watches set last_message_number=p_message_number where channel_id=p_channel_id and resource_id=p_resource_id and expires_at > clock_timestamp() and last_message_number < p_message_number
    returning source_connection_id into v_connection;
  if v_connection is null then return false; end if;
  select organization_id into v_org from public.sheet_connections where id=v_connection and is_active;
  if v_org is null then return false; end if;
  insert into public.sync_jobs(organization_id,source_connection_id,idempotency_key,reason,status)
    values(v_org,v_connection,'notification:' || p_channel_id || ':' || p_message_number,'notification','pending') on conflict do nothing;
  update public.sheet_connections set last_message_number=p_message_number where id=v_connection and watch_channel_id=p_channel_id;
  return true;
end $$;

create function public.sync_candidates(p_now timestamptz) returns jsonb
language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('connectionId',id,'sync',needs_sync,'renew',needs_watch)),'[]'::jsonb) from (
    select c.id,
      (c.status='succeeded' and coalesce(c.last_successful_sync_at,'epoch'::timestamptz) <= p_now - interval '5 minutes'
       or c.status='pending'
       or exists(select 1 from public.sync_jobs j where j.source_connection_id=c.id and (j.status='pending' or (j.status in ('retrying','failed') and j.next_retry_at <= p_now)))
       or (c.status='running' and not exists(select 1 from public.sync_leases l where l.source_connection_id=c.id and l.expires_at > p_now))
       or exists(select 1 from public.sync_leases l where l.source_connection_id=c.id and l.expires_at <= p_now)) as needs_sync,
      -- files.watch has a 24-hour maximum. Renew aging channels within the
      -- requested 24-hour window, with a 12-hour cooldown to avoid cron churn.
      (c.watch_expires_at is null or c.watch_expires_at <= p_now + interval '1 hour'
       or (c.watch_expires_at <= p_now + interval '24 hours' and not exists(select 1 from public.sync_watches w where w.channel_id=c.watch_channel_id and w.created_at > p_now - interval '12 hours'))) as needs_watch
    from public.sheet_connections c where c.is_active
  ) candidates where needs_sync or needs_watch;
$$;

-- Functions default to executable by PUBLIC in PostgreSQL; revoke explicitly.
do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('sync_acquire','sync_assert_lease','sync_release','sync_finish','sync_insert_snapshot','sync_read_records','sync_commit_records','sync_accept_notification','sync_candidates') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end $$;
