-- Financial truth and access assignment are separate concerns. A valid sale
-- remains in branch totals even when its trainer cannot yet be resolved.
create or replace function private.preserve_admin_review() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_override public.record_overrides; v_id uuid; v_domain text;
begin
  v_domain:=case tg_table_name when 'members' then 'member' when 'registrations' then 'registration' when 'leads' then 'lead' when 'classes' then 'class' end;
  execute format('select id from public.%I where organization_id=$1 and source_connection_id=$2 and source_tab_id=$3 and source_record_key=$4',tg_table_name)
    into v_id using new.organization_id,new.source_connection_id,new.source_tab_id,new.source_record_key;
  select * into v_override from public.record_overrides where organization_id=new.organization_id and domain=v_domain and record_id=coalesce(v_id,new.id);
  if found then
    new:=jsonb_populate_record(new,v_override.fields);
    if v_override.record_status is not null then new.record_status:=v_override.record_status; end if;
  end if;
  if tg_table_name='members' then
    if exists(select 1 from public.member_aliases where organization_id=new.organization_id and alias_member_id=coalesce(v_id,new.id)) then new.record_status:='archived'; end if;
  else
    select retained_member_id into v_id from public.member_aliases where organization_id=new.organization_id and alias_member_id=new.member_id;
    if found then new.member_id:=v_id; end if;
  end if;
  if new.record_status='valid' and new.trainer_id is null
    and tg_table_name<>'registrations'
    and exists(select 1 from public.sheet_connections where id=new.source_connection_id and organization_id=new.organization_id and trainer_assignment_mode='column') then
    new.record_status:='review_required';
  end if;
  return new;
end $$;

create or replace function private.apply_admin_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  v_table text; v_mode text; v_trainer uuid; v_count bigint; v_member uuid;
  v_name text; v_external text; v_valid boolean; v_trainer_hint text;
begin
  v_table:=case new.domain when 'member' then 'members' when 'registration' then 'registrations' when 'lead' then 'leads' when 'class' then 'classes' end;
  select trainer_assignment_mode into v_mode from public.sheet_connections where id=new.source_connection_id and organization_id=new.organization_id;
  if v_mode='column' then
    v_trainer_hint:=coalesce(nullif(new.record#>>'{hints,sales_trainer_name}',''),nullif(new.record#>>'{hints,trainer_name}',''));
    select count(*),(array_agg(id))[1] into v_count,v_trainer from public.trainers where organization_id=new.organization_id and is_active
      and v_trainer_hint is not null
      and (lower(trim(display_name))=lower(trim(v_trainer_hint)) or lower(email)=lower(trim(v_trainer_hint)));
    if new.domain='registration' then
      execute format('update public.%I set trainer_id=$1,record_status=coalesce($2::public.record_review_status,record_status) where organization_id=$3 and source_connection_id=$4 and source_tab_id=$5 and source_record_key=$6',v_table)
        using case when v_count=1 then v_trainer else null end,new.record->>'record_status',new.organization_id,new.source_connection_id,new.source_tab_id,new.source_record_key;
    else
      execute format('update public.%I set trainer_id=$1,record_status=case when $2 then coalesce($7::public.record_review_status,record_status) else ''review_required''::public.record_review_status end where organization_id=$3 and source_connection_id=$4 and source_tab_id=$5 and source_record_key=$6',v_table)
        using case when v_count=1 then v_trainer else null end,v_count=1,new.organization_id,new.source_connection_id,new.source_tab_id,new.source_record_key,new.record->>'record_status';
    end if;
  end if;
  if new.domain<>'member' then
    v_name:=nullif(new.record#>>'{hints,name}',''); v_external:=nullif(new.record#>>'{hints,external_member_id}','');
    select count(distinct coalesce(a.retained_member_id,m.id)),(array_agg(distinct coalesce(a.retained_member_id,m.id)))[1],bool_and(retained.record_status='valid') into v_count,v_member,v_valid
      from public.members m left join public.member_aliases a on a.organization_id=m.organization_id and a.alias_member_id=m.id
      join public.members retained on retained.organization_id=m.organization_id and retained.id=coalesce(a.retained_member_id,m.id)
      where m.organization_id=new.organization_id and (m.record_status in ('valid','review_required') or a.alias_member_id is not null)
        and (case when v_external is not null then m.external_member_id=v_external or a.alias_external_member_id=v_external else m.name=v_name or a.alias_name=v_name end);
    execute format('update public.%I set member_id=$1 where organization_id=$2 and source_connection_id=$3 and source_tab_id=$4 and source_record_key=$5',v_table)
      using case when v_count=1 and v_valid then v_member else null end,new.organization_id,new.source_connection_id,new.source_tab_id,new.source_record_key;
  end if;
  return new;
end $$;

-- Re-evaluate stored hints whenever the administrator adds, renames,
-- activates, or deactivates a trainer. This makes past rows self-healing.
create or replace function private.replay_assignment_after_trainer_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.sync_record_state s set record=s.record
  where s.organization_id=new.organization_id
    and exists(select 1 from public.sheet_connections c
      where c.id=s.source_connection_id and c.organization_id=new.organization_id
        and c.trainer_assignment_mode='column');
  return new;
end $$;

create trigger replay_assignment_after_trainer_change
after insert or update of display_name,email,is_active on public.trainers
for each row execute function private.replay_assignment_after_trainer_change();

revoke all on function private.replay_assignment_after_trainer_change() from public,anon,authenticated;
