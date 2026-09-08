-- Private, payload-minimal invalidations. Browser clients may receive their
-- permitted topic, but this policy grants no ability to publish messages.
create policy dashboard_sync_receive on realtime.messages for select to authenticated
  using (extension = 'broadcast' and (
    ((select private.current_app_role()) = 'admin'
      and (select realtime.topic()) = 'org:' || (select private.current_organization_id())::text)
    or ((select private.current_app_role()) = 'trainer'
      and (select realtime.topic()) = 'org:' || (select private.current_organization_id())::text
        || ':trainer:' || (select private.current_trainer_id())::text)
  ));

create function private.broadcast_dashboard_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'succeeded' and new.last_successful_sync_at is distinct from old.last_successful_sync_at then
    perform realtime.send('{"status":"succeeded"}'::jsonb, 'sync:succeeded', 'org:' || new.organization_id::text, true);
    if new.trainer_id is not null then
      perform realtime.send('{"status":"succeeded"}'::jsonb, 'sync:succeeded', 'org:' || new.organization_id::text || ':trainer:' || new.trainer_id::text, true);
    end if;
  end if;
  return new;
exception when others then
  -- Realtime availability must never roll back the successful sync itself.
  raise warning 'dashboard_invalidation_unavailable';
  return new;
end $$;
revoke all on function private.broadcast_dashboard_sync() from public, anon, authenticated;
create trigger dashboard_sync_succeeded after update of last_successful_sync_at on public.sheet_connections
  for each row execute function private.broadcast_dashboard_sync();
