-- Extend the ingestion fence to authoritative discovery and watch metadata.
alter table public.sync_watches add column created_by_lease uuid;
alter table public.sync_watches add column retired_by_lease uuid;
alter table public.sync_watches add column stopped_at timestamptz;

create function public.sync_upsert_tab(p_organization_id uuid,p_connection_id uuid,p_lease uuid,p_google_sheet_id bigint,p_title text,p_domain text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_tab public.sheet_tabs; v_confirmed_domain text;
begin
  perform public.sync_assert_lease(p_connection_id,p_lease);
  perform 1 from public.sheet_connections where id=p_connection_id and organization_id=p_organization_id and is_active;
  if not found then raise exception 'connection_not_found'; end if;
  insert into public.sheet_tabs(organization_id,source_connection_id,google_sheet_id,title,domain)
    values(p_organization_id,p_connection_id,p_google_sheet_id,p_title,p_domain)
    on conflict(organization_id,source_connection_id,google_sheet_id) do update
      set title=case when public.sheet_tabs.is_active then excluded.title else public.sheet_tabs.title end
    returning * into v_tab;
  if not v_tab.is_active then return to_jsonb(v_tab); end if;
  -- A confirmed ambiguous tab must acquire its domain before runtime decides
  -- whether to skip it. Never borrow another source/tab/organization's history.
  select columns->>'domain' into v_confirmed_domain from public.mapping_versions
    where organization_id=p_organization_id and source_connection_id=p_connection_id and source_tab_id=v_tab.id
      and confirmed_by is not null and columns->>'domain' in ('member','registration','lead','class')
    order by version desc limit 1;
  update public.sheet_tabs set domain=coalesce(v_confirmed_domain,v_tab.domain,p_domain)
    where id=v_tab.id returning * into v_tab;
  return to_jsonb(v_tab);
end $$;

create function public.sync_update_tab_mapping(p_organization_id uuid,p_connection_id uuid,p_lease uuid,p_tab_id uuid,p_header_row integer,p_headers jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.sync_assert_lease(p_connection_id,p_lease);
  update public.sheet_tabs set header_row=p_header_row,headers=p_headers
    where id=p_tab_id and organization_id=p_organization_id and source_connection_id=p_connection_id and is_active;
  if not found then raise exception 'tab_not_found'; end if;
end $$;

create function public.sync_save_watch(p_connection_id uuid,p_lease uuid,p_channel_id text,p_resource_id text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_watch public.sync_watches; v_previous public.sync_watches; v_prior_id text;
begin
  perform public.sync_assert_lease(p_connection_id,p_lease);
  select watch_channel_id into v_prior_id from public.sheet_connections where id=p_connection_id and is_active for update;
  if not found then raise exception 'connection_not_found'; end if;
  if p_expires_at <= clock_timestamp() then raise exception 'watch_expired'; end if;
  if p_resource_id is null then
    insert into public.sync_watches(channel_id,source_connection_id,expires_at,created_by_lease)
      values(p_channel_id,p_connection_id,p_expires_at,p_lease) on conflict(channel_id) do nothing;
  end if;
  select * into v_watch from public.sync_watches where channel_id=p_channel_id and source_connection_id=p_connection_id for update;
  if not found or v_watch.created_by_lease is distinct from p_lease then raise exception 'watch_owner_mismatch'; end if;
  if v_watch.retired_by_lease is not null or v_watch.stopped_at is not null then raise exception 'watch_retired'; end if;
  if p_resource_id is null then return null; end if;
  if v_watch.resource_id is not null then
    if v_prior_id=p_channel_id and v_watch.resource_id=p_resource_id then return null; end if;
    raise exception 'watch_already_activated';
  end if;
  update public.sync_watches set resource_id=p_resource_id,expires_at=p_expires_at where channel_id=p_channel_id;
  update public.sheet_connections set watch_channel_id=p_channel_id,watch_resource_id=p_resource_id,watch_expires_at=p_expires_at,last_message_number=null where id=p_connection_id;
  -- Select exactly one predecessor in the same fenced activation transaction.
  -- A resumed worker must never scan for "all channels except mine".
  update public.sync_watches set retired_by_lease=p_lease
    where channel_id=v_prior_id and source_connection_id=p_connection_id and channel_id<>p_channel_id
    returning * into v_previous;
  if v_previous.channel_id is null then return null; end if;
  return jsonb_build_object('channelId',v_previous.channel_id,'connectionId',p_connection_id,'resourceId',v_previous.resource_id,'expiration',v_previous.expires_at,'lastMessageNumber',v_previous.last_message_number::text,'token','');
end $$;

create function public.sync_watch_cleanup(p_connection_id uuid,p_lease uuid,p_channel_id text,p_remove boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_watch public.sync_watches;
begin
  perform public.sync_assert_lease(p_connection_id,p_lease);
  select * into v_watch from public.sync_watches where channel_id=p_channel_id and source_connection_id=p_connection_id for update;
  if not found or exists(select 1 from public.sheet_connections where id=p_connection_id and watch_channel_id=p_channel_id)
    or not (v_watch.retired_by_lease is not distinct from p_lease or (v_watch.created_by_lease is not distinct from p_lease and v_watch.resource_id is null))
    then raise exception 'watch_cleanup_forbidden'; end if;
  -- Tombstones prevent channel reactivation even if a network stop finishes
  -- after this worker loses its lease. A successor always creates a fresh UUID.
  update public.sync_watches set retired_by_lease=p_lease,stopped_at=case when p_remove then clock_timestamp() else stopped_at end where channel_id=p_channel_id;
  return jsonb_build_object('channelId',v_watch.channel_id,'connectionId',p_connection_id,'resourceId',v_watch.resource_id,'expiration',v_watch.expires_at,'lastMessageNumber',v_watch.last_message_number::text,'token','');
end $$;

create or replace function public.sync_accept_notification(p_channel_id text,p_resource_id text,p_message_number numeric) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_connection uuid; v_org uuid;
begin
  update public.sync_watches set last_message_number=p_message_number where channel_id=p_channel_id and resource_id=p_resource_id and stopped_at is null and expires_at > clock_timestamp() and last_message_number < p_message_number
    returning source_connection_id into v_connection;
  if v_connection is null then return false; end if;
  select organization_id into v_org from public.sheet_connections where id=v_connection and is_active;
  if v_org is null then return false; end if;
  insert into public.sync_jobs(organization_id,source_connection_id,idempotency_key,reason,status)
    values(v_org,v_connection,'notification:' || p_channel_id || ':' || p_message_number,'notification','pending') on conflict do nothing;
  update public.sheet_connections set last_message_number=p_message_number where id=v_connection and watch_channel_id=p_channel_id;
  return true;
end $$;

do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('sync_upsert_tab','sync_update_tab_mapping','sync_save_watch','sync_watch_cleanup') loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
