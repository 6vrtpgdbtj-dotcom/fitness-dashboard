-- Source keys remain source-specific. Cross-source similarity never changes
-- provenance or merges people automatically; it creates a scored review issue.
create table private.member_distinct_pairs (
  organization_id uuid not null,
  first_member_id uuid not null,
  second_member_id uuid not null,
  primary key(organization_id,first_member_id,second_member_id),
  foreign key(organization_id,first_member_id) references public.members(organization_id,id),
  foreign key(organization_id,second_member_id) references public.members(organization_id,id),
  check(first_member_id < second_member_id)
);
revoke all on private.member_distinct_pairs from public,anon,authenticated;

create function private.remember_distinct_members() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_candidate jsonb;
begin
  if new.domain='member' and new.record_status='valid' then
    for v_candidate in
      select candidate from public.members m join public.sync_record_state s on s.organization_id=m.organization_id
        and s.source_connection_id=m.source_connection_id and s.source_tab_id=m.source_tab_id and s.source_record_key=m.source_record_key and s.domain='member',
        lateral jsonb_array_elements(coalesce(s.record->'issues','[]')) issue,
        lateral jsonb_array_elements(coalesce(issue->'candidates','[]')) candidate
      where m.organization_id=new.organization_id and m.id=new.record_id and issue->>'code'='duplicate_member_candidate'
    loop
      insert into private.member_distinct_pairs values(new.organization_id,least(new.record_id,(v_candidate->>'memberId')::uuid),greatest(new.record_id,(v_candidate->>'memberId')::uuid)) on conflict do nothing;
    end loop;
  end if;
  return null;
end $$;
create trigger remember_distinct_members after insert or update of record_status on public.record_overrides for each row execute function private.remember_distinct_members();
revoke all on function private.remember_distinct_members() from public,anon,authenticated;

create function private.member_duplicate_candidates(p_org uuid,p_values jsonb,p_member uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('memberId',id,'score',score,'reasons',reasons) order by score desc,id),'[]') from (
    select id,least(100,(case when external_match then 90 else 0 end)+(case when name_match then 40 else 0 end)+(case when phone_match then 25 else 0 end)+(case when birth_match then 35 else 0 end)) score,
      to_jsonb(array_remove(array[case when external_match then 'external_member_id' end,case when name_match then 'name' end,case when phone_match then 'phone_last4' end,case when birth_match then 'birth_date' end],null)) reasons
    from (
      select m.id,
        coalesce(nullif(m.external_member_id,'')=nullif(p_values->>'external_member_id',''),false) external_match,
        coalesce(nullif(lower(regexp_replace(m.name,'\s+','','g')),'')=nullif(lower(regexp_replace(p_values->>'name','\s+','','g')),''),false) name_match,
        coalesce(m.phone_last4=nullif(p_values->>'phone_last4',''),false) phone_match,
        coalesce(m.birth_date::text=nullif(p_values->>'birth_date',''),false) birth_match
      from public.members m where m.organization_id=p_org and m.record_status='valid' and m.id is distinct from p_member
        and not exists(select 1 from private.member_distinct_pairs p where p.organization_id=p_org and p.first_member_id=least(m.id,p_member) and p.second_member_id=greatest(m.id,p_member))
    ) matches
  ) scored where score>=40;
$$;
revoke all on function private.member_duplicate_candidates(uuid,jsonb,uuid) from public,anon,authenticated;

-- All member commits and administrator source mutations share an organization
-- lock before taking lease/connection locks. Separate connections cannot both
-- commit an unchecked candidate based on an earlier read.
create or replace function private.lock_admin_sources(p_org uuid,p_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('member-review:' || p_org::text,0));
  perform 1 from public.sync_leases where source_connection_id=any(p_ids) order by source_connection_id for update;
  perform 1 from public.sheet_connections where organization_id=p_org and id=any(p_ids) order by id for update;
end $$;

-- Preserve the existing ingestion implementation, including all later table
-- triggers for overrides, assignment, aliases, snapshots and history.
alter function public.sync_commit_records(uuid,uuid,uuid,uuid,jsonb,jsonb) rename to sync_commit_records_base;
alter function public.sync_commit_records_base(uuid,uuid,uuid,uuid,jsonb,jsonb) set schema private;
revoke all on function private.sync_commit_records_base(uuid,uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.sync_commit_records(p_organization_id uuid,p_connection_id uuid,p_tab_id uuid,p_lease uuid,p_records jsonb,p_audits jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_record jsonb; v_previous jsonb; v_member uuid; v_override public.record_overrides; v_candidates jsonb;
  v_event jsonb; v_events jsonb:='[]'; v_changes jsonb; v_table text; v_status text; v_outcomes jsonb:='[]';
begin
  perform pg_advisory_xact_lock(hashtextextended('member-review:' || p_organization_id::text,0));
  perform public.sync_assert_lease(p_connection_id,p_lease);
  if not exists(select 1 from public.sheet_connections where organization_id=p_organization_id and id=p_connection_id and is_active) then raise exception 'connection_not_found'; end if;
  if not exists(select 1 from public.sheet_tabs where organization_id=p_organization_id and source_connection_id=p_connection_id and id=p_tab_id) then raise exception 'tab_not_found'; end if;
  -- Keep unmatched audit requests subject to the same original validation.
  select coalesce(jsonb_agg(e),'[]') into v_events from jsonb_array_elements(p_audits) e
    where not exists(select 1 from jsonb_array_elements(p_records) r where r->>'source_record_key'=e->>'sourceRecordKey' and r->>'domain'=e->>'domain');
  for v_record in select value from jsonb_array_elements(p_records) loop
    if v_record->>'organization_id' is distinct from p_organization_id::text or v_record->>'source_connection_id' is distinct from p_connection_id::text or v_record->>'source_tab_id' is distinct from p_tab_id::text then raise exception 'scope_mismatch'; end if;
    select record into v_previous from public.sync_record_state where organization_id=p_organization_id and source_connection_id=p_connection_id and source_tab_id=p_tab_id and domain=v_record->>'domain' and source_record_key=v_record->>'source_record_key';
    v_candidates:='[]';
    if v_record->>'domain'='member' then
      select id into v_member from public.members where organization_id=p_organization_id and source_connection_id=p_connection_id and source_tab_id=p_tab_id and source_record_key=v_record->>'source_record_key';
      select * into v_override from public.record_overrides where organization_id=p_organization_id and domain='member' and record_id=v_member;
      if v_override.record_status is null and not exists(select 1 from public.member_aliases where organization_id=p_organization_id and alias_member_id=v_member) then
        v_candidates:=private.member_duplicate_candidates(p_organization_id,(v_record->'values') || coalesce(v_override.fields,'{}'),v_member);
      end if;
      v_record:=jsonb_set(v_record,'{issues}',(select coalesce(jsonb_agg(i),'[]') from jsonb_array_elements(coalesce(v_record->'issues','[]')) i where i->>'code'<>'duplicate_member_candidate'));
      if jsonb_array_length(v_candidates)>0 then
        v_record:=jsonb_set(jsonb_set(v_record,'{record_status}','"review_required"'),'{issues}',(v_record->'issues') || jsonb_build_array(jsonb_build_object('field','identity','code','duplicate_member_candidate','message','Possible organization member match. Confirm distinct people or merge after review.','candidates',v_candidates)));
      end if;
    end if;
    perform private.sync_commit_records_base(p_organization_id,p_connection_id,p_tab_id,p_lease,jsonb_build_array(v_record),'[]');
    v_table:=case v_record->>'domain' when 'member' then 'members' when 'registration' then 'registrations' when 'lead' then 'leads' when 'class' then 'classes' end;
    execute format('select record_status::text from public.%I where organization_id=$1 and source_connection_id=$2 and source_tab_id=$3 and source_record_key=$4',v_table) into v_status using p_organization_id,p_connection_id,p_tab_id,v_record->>'source_record_key';
    v_outcomes:=v_outcomes || jsonb_build_array(jsonb_build_object('domain',v_record->>'domain','sourceRecordKey',v_record->>'source_record_key','recordStatus',v_status));
    if v_previous is null or jsonb_build_array(v_previous->'values',v_previous->'hints',v_previous->'record_status',v_previous->'trainer_id',v_previous->'issues') is distinct from jsonb_build_array(v_record->'values',v_record->'hints',v_record->'record_status',v_record->'trainer_id',v_record->'issues') then
      select e into v_event from jsonb_array_elements(p_audits) e where e->>'sourceRecordKey'=v_record->>'source_record_key' and e->>'domain'=v_record->>'domain' limit 1;
      if v_event is null and jsonb_array_length(v_candidates)>0 then
        v_event:=jsonb_build_object('action',case when v_previous is null then 'insert' else 'update' end,'domain',v_record->>'domain','sourceRecordKey',v_record->>'source_record_key','rawSnapshotId',v_record->>'raw_snapshot_id','previousRawSnapshotId',v_previous->>'raw_snapshot_id','mappingVersionId',v_record->>'mapping_version_id','changes','{}'::jsonb);
      end if;
      if v_event is not null then
        v_changes:=coalesce(v_event->'changes','{}');
        if v_previous->'record_status' is distinct from v_record->'record_status' then v_changes:=v_changes || jsonb_build_object('record_status',jsonb_build_object('before',v_previous->'record_status','after',v_record->'record_status')); end if;
        if v_previous->'issues' is distinct from v_record->'issues' then
          v_changes:=v_changes || jsonb_build_object('issues',jsonb_build_object('before',coalesce(v_event#>'{changes,issues,before}',(select jsonb_agg(jsonb_build_object('field',i->>'field','code',i->>'code')) from jsonb_array_elements(coalesce(v_previous->'issues','[]')) i)),'after',v_record->'issues'));
        end if;
        -- Candidate issue metadata contains identifiers/scores only. Existing
        -- business deltas retain the application's phone-redacted values.
        v_event:=v_event || jsonb_build_object('issues',v_record->'issues','changes',v_changes);
        v_events:=v_events || jsonb_build_array(v_event);
      end if;
    end if;
  end loop;
  perform private.sync_commit_records_base(p_organization_id,p_connection_id,p_tab_id,p_lease,'[]',v_events);
  return v_outcomes;
end $$;
revoke all on function public.sync_commit_records(uuid,uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.sync_commit_records(uuid,uuid,uuid,uuid,jsonb,jsonb) to service_role;

-- A review candidate still participates in identity ambiguity. Dropping it
-- before counting would silently link a name-only registration to someone else.
create or replace function private.apply_admin_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_table text; v_mode text; v_trainer uuid; v_count bigint; v_member uuid; v_name text; v_external text; v_valid boolean;
begin
  v_table:=case new.domain when 'member' then 'members' when 'registration' then 'registrations' when 'lead' then 'leads' when 'class' then 'classes' end;
  select trainer_assignment_mode into v_mode from public.sheet_connections where id=new.source_connection_id and organization_id=new.organization_id;
  if v_mode='column' then
    select count(*),(array_agg(id))[1] into v_count,v_trainer from public.trainers where organization_id=new.organization_id and is_active
      and (lower(trim(display_name))=lower(trim(new.record#>>'{hints,trainer_name}')) or lower(email)=lower(trim(new.record#>>'{hints,trainer_name}')));
    execute format('update public.%I set trainer_id=$1,record_status=case when $2 then coalesce($7::public.record_review_status,record_status) else ''review_required''::public.record_review_status end where organization_id=$3 and source_connection_id=$4 and source_tab_id=$5 and source_record_key=$6',v_table)
      using case when v_count=1 then v_trainer else null end,v_count=1,new.organization_id,new.source_connection_id,new.source_tab_id,new.source_record_key,new.record->>'record_status';
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

-- Review candidates remain selectable even outside the initial roster page.
alter function public.admin_workspace() rename to admin_workspace_base;
alter function public.admin_workspace_base() set schema private;
revoke all on function private.admin_workspace_base() from public,anon,authenticated,service_role;
create function public.admin_workspace() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid:=private.require_admin(); v_workspace jsonb; v_extra jsonb;
begin
  v_workspace:=private.admin_workspace_base();
  select coalesce(jsonb_agg(to_jsonb(m)),'[]') into v_extra from (
    select id,name,external_member_id,source_record_key from public.members m
    where m.organization_id=v_org and m.record_status='valid'
      and not exists(select 1 from jsonb_array_elements(v_workspace->'members') shown where shown->>'id'=m.id::text)
      and exists(select 1 from jsonb_array_elements(v_workspace->'records') r,
        lateral jsonb_array_elements(r->'issues') issue,
        lateral jsonb_array_elements(coalesce(issue->'candidates','[]')) candidate where candidate->>'memberId'=m.id::text)
    order by name,id
  ) m;
  return jsonb_set(v_workspace,'{members}',(v_workspace->'members') || v_extra);
end $$;
revoke all on function public.admin_workspace() from public,anon,authenticated;
grant execute on function public.admin_workspace() to authenticated;
