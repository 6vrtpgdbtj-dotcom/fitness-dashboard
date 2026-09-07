-- Match sync_save_watch: connection row first, then watch row. Looking up the
-- immutable channel owner does not lock the watch; all mutable predicates are
-- checked again after the connection lock has been obtained.
create or replace function public.sync_accept_notification(p_channel_id text,p_resource_id text,p_message_number numeric) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_connection uuid; v_org uuid;
begin
  select source_connection_id into v_connection from public.sync_watches where channel_id=p_channel_id;
  if v_connection is null then return false; end if;
  select organization_id into v_org from public.sheet_connections where id=v_connection and is_active for update;
  if v_org is null then return false; end if;
  update public.sync_watches set last_message_number=p_message_number
    where channel_id=p_channel_id and source_connection_id=v_connection and resource_id=p_resource_id
      and stopped_at is null and expires_at > clock_timestamp() and last_message_number < p_message_number;
  if not found then return false; end if;
  -- Cursor advancement and durable job insertion remain one transaction. Any
  -- insert/update failure rolls everything back, allowing Google to retry.
  insert into public.sync_jobs(organization_id,source_connection_id,idempotency_key,reason,status)
    values(v_org,v_connection,'notification:' || p_channel_id || ':' || p_message_number,'notification','pending') on conflict do nothing;
  update public.sheet_connections set last_message_number=p_message_number where id=v_connection and watch_channel_id=p_channel_id;
  return true;
end $$;
revoke all on function public.sync_accept_notification(text,text,numeric) from public,anon,authenticated;
grant execute on function public.sync_accept_notification(text,text,numeric) to service_role;
