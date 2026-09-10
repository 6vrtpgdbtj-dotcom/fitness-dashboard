-- Remember previous owners as well as current column-assigned trainers. This
-- table carries routing identifiers only and is never exposed to the browser.
create table private.dashboard_sync_trainers (
  organization_id uuid not null,
  source_connection_id uuid not null,
  trainer_id uuid not null,
  primary key (organization_id,source_connection_id,trainer_id),
  foreign key (organization_id,source_connection_id) references public.sheet_connections(organization_id,id),
  foreign key (organization_id,trainer_id) references public.trainers(organization_id,id)
);
revoke all on private.dashboard_sync_trainers from public,anon,authenticated;

create function private.track_dashboard_sync_trainer() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op <> 'INSERT' and old.trainer_id is not null then
    insert into private.dashboard_sync_trainers values(old.organization_id,old.source_connection_id,old.trainer_id) on conflict do nothing;
  end if;
  if tg_op <> 'DELETE' and new.trainer_id is not null then
    insert into private.dashboard_sync_trainers values(new.organization_id,new.source_connection_id,new.trainer_id) on conflict do nothing;
  end if;
  return null;
end $$;
revoke all on function private.track_dashboard_sync_trainer() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['members','registrations','leads','classes'] loop
    execute format('create trigger track_dashboard_sync_trainer after insert or update or delete on public.%I for each row execute function private.track_dashboard_sync_trainer()',t);
  end loop;
end $$;

create or replace function private.broadcast_dashboard_sync() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_trainer uuid;
begin
  if new.status='succeeded' and new.last_successful_sync_at is distinct from old.last_successful_sync_at then
    perform realtime.send('{"status":"succeeded"}'::jsonb,'sync:succeeded','org:' || new.organization_id::text,true);
    for v_trainer in
      select distinct owner.trainer_id from (
        select new.trainer_id as trainer_id union select old.trainer_id
        union select trainer_id from private.dashboard_sync_trainers where organization_id=new.organization_id and source_connection_id=new.id
        union select trainer_id from public.members where organization_id=new.organization_id and source_connection_id=new.id
        union select trainer_id from public.registrations where organization_id=new.organization_id and source_connection_id=new.id
        union select trainer_id from public.leads where organization_id=new.organization_id and source_connection_id=new.id
        union select trainer_id from public.classes where organization_id=new.organization_id and source_connection_id=new.id
      ) owner where owner.trainer_id is not null
    loop
      perform realtime.send('{"status":"succeeded"}'::jsonb,'sync:succeeded','org:' || new.organization_id::text || ':trainer:' || v_trainer::text,true);
    end loop;
    delete from private.dashboard_sync_trainers where organization_id=new.organization_id and source_connection_id=new.id;
  end if;
  return new;
exception when others then
  raise warning 'dashboard_invalidation_unavailable';
  return new;
end $$;
