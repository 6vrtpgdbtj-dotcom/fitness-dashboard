-- Snapshot retention cleanup is metadata-only. Do not replay overrides,
-- assignment/identity resolution, or freshness timestamps for a removed pointer.
do $$ declare t text; v_guard text; begin
  foreach t in array array['members','registrations','leads','classes'] loop
    v_guard := 'not (old.raw_snapshot_id is not null and new.raw_snapshot_id is null and (to_jsonb(old)-''raw_snapshot_id''-''updated_at'') is not distinct from (to_jsonb(new)-''raw_snapshot_id''-''updated_at''))';
    execute format('drop trigger preserve_admin_review on public.%I',t);
    execute format('create trigger preserve_admin_review_insert before insert on public.%I for each row execute function private.preserve_admin_review()',t);
    execute format('create trigger preserve_admin_review before update on public.%I for each row when (%s) execute function private.preserve_admin_review()',t,v_guard);
    execute format('drop trigger set_updated_at on public.%I',t);
    execute format('create trigger set_updated_at before update on public.%I for each row when (%s) execute function private.set_updated_at()',t,v_guard);
  end loop;
end $$;
drop trigger apply_admin_assignment on public.sync_record_state;
create trigger apply_admin_assignment_insert after insert on public.sync_record_state
  for each row execute function private.apply_admin_assignment();
create trigger apply_admin_assignment_update after update on public.sync_record_state
  for each row when (
    old.record - 'raw_snapshot_id' is distinct from new.record - 'raw_snapshot_id'
    or old.record->'raw_snapshot_id' is not distinct from new.record->'raw_snapshot_id'
  ) execute function private.apply_admin_assignment();

-- Keep explicit record=record replay for a requested trainer reassignment.
-- Only non-null snapshot references need updating during historical deletion.
create or replace function public.admin_review(p_id uuid,p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid:=private.require_admin(); v_action text:=p_command->>'action'; v_domain text:=p_command->>'domain';
  v_table text; v_row jsonb; v_other jsonb; v_fields jsonb; v_allowed text[]; v_columns text; v_sources uuid[]; v_retained uuid;
  v_event text; v_payload jsonb:='{}'; v_count bigint; v_connection public.sheet_connections;
begin
  if v_action in ('disconnect','delete_history') then
    perform private.lock_admin_sources(v_org,array[p_id]);
    select * into v_connection from public.sheet_connections where id=p_id and organization_id=v_org for update;
    if not found then raise exception 'target_not_found'; end if;
    if v_action='disconnect' then
      update public.sheet_connections set is_active=false where id=p_id;
      delete from public.sync_leases where source_connection_id=p_id;
      update public.sync_jobs set status='failed',error_code='connection_disconnected',next_retry_at=null where source_connection_id=p_id and status in ('pending','running','retrying');
      v_event:='connection_disconnect';
    else
      if v_connection.is_active or p_command->>'confirmation' is distinct from 'DELETE HISTORY' then raise exception 'confirmation_required'; end if;
      -- Explicitly scoped raw snapshot deletion. Canonical business records,
      -- mapping history, aliases, and audit events remain available.
      foreach v_table in array array['members','registrations','leads','classes'] loop
        execute format('update public.%I set raw_snapshot_id=null where organization_id=$1 and source_connection_id=$2 and raw_snapshot_id is not null',v_table) using v_org,p_id;
      end loop;
      update public.sync_record_state set record=jsonb_set(record,'{raw_snapshot_id}','null') where organization_id=v_org and source_connection_id=p_id and record->>'raw_snapshot_id' is not null;
      delete from public.raw_snapshots where organization_id=v_org and source_connection_id=p_id;
      get diagnostics v_count=row_count;
      v_event:='history_delete'; v_payload:=jsonb_build_object('deletedSnapshots',v_count);
    end if;
    insert into public.audit_events(organization_id,actor_id,source_connection_id,action,entity_type,entity_id,payload) values(v_org,auth.uid(),p_id,v_event,'connection',p_id,v_payload);
    return jsonb_build_object('id',p_id);
  end if;
  if v_action='merge' then v_domain:='member'; end if;
  v_table:=case v_domain when 'member' then 'members' when 'registration' then 'registrations' when 'lead' then 'leads' when 'class' then 'classes' end;
  if v_table is null then raise exception 'invalid_domain'; end if;
  execute format('select to_jsonb(t) from public.%I t where id=$1 and organization_id=$2',v_table) into v_row using p_id,v_org;
  if v_row is null then raise exception 'target_not_found'; end if;
  v_sources:=array[(v_row->>'source_connection_id')::uuid];
  if v_action='merge' then
    v_retained:=(p_command->>'retainedId')::uuid;
    select to_jsonb(m) into v_other from public.members m where id=v_retained and organization_id=v_org;
    if v_other is null then raise exception 'target_not_found'; end if;
    v_sources:=v_sources || (v_other->>'source_connection_id')::uuid;
  end if;
  perform private.lock_admin_sources(v_org,v_sources);
  if v_action='merge' then
    perform 1 from public.members where organization_id=v_org and id in(p_id,v_retained) order by id for update;
    if p_id=v_retained or exists(select 1 from public.member_aliases where organization_id=v_org and alias_member_id in(p_id,v_retained)) then raise exception 'invalid_merge'; end if;
    if not exists(select 1 from public.members where id=v_retained and record_status='valid') then raise exception 'retained_member_not_valid'; end if;
    update public.member_aliases set retained_member_id=v_retained where organization_id=v_org and retained_member_id=p_id;
    select to_jsonb(m) into v_row from public.members m where id=p_id and organization_id=v_org;
    insert into public.member_aliases(organization_id,alias_member_id,retained_member_id,alias_name,alias_external_member_id,source_provenance)
      values(v_org,p_id,v_retained,v_row->>'name',v_row->>'external_member_id',jsonb_build_object('source_connection_id',v_row->>'source_connection_id','source_tab_id',v_row->>'source_tab_id','source_record_key',v_row->>'source_record_key','raw_snapshot_id',v_row->>'raw_snapshot_id','mapping_version_id',v_row->>'mapping_version_id'));
    foreach v_table in array array['registrations','leads','classes'] loop
      execute format('update public.%I set member_id=$1 where organization_id=$2 and member_id=$3',v_table) using v_retained,v_org,p_id;
    end loop;
    update public.members set record_status='archived' where id=p_id and organization_id=v_org;
    v_event:='member_merge'; v_payload:=jsonb_build_object('beforeId',p_id,'afterId',v_retained);
  elsif v_action in ('correct','approve','reject') then
    execute format('select to_jsonb(t) from public.%I t where id=$1 and organization_id=$2 for update',v_table) into v_row using p_id,v_org;
    if v_row->>'record_status'='archived' then raise exception 'record_archived'; end if;
    if v_action='correct' then
      v_fields:=p_command->'fields';
      select array_agg(column_name) into v_allowed from information_schema.columns where table_schema='public' and table_name=v_table
        and column_name not in ('id','organization_id','trainer_id','member_id','sales_trainer_id','source_connection_id','source_tab_id','source_record_key','raw_snapshot_id','mapping_version_id','mapping_confidence','record_status','created_at','updated_at');
      if jsonb_typeof(v_fields) is distinct from 'object' or v_fields='{}' or exists(select 1 from jsonb_object_keys(v_fields) k where not(k=any(v_allowed))) then raise exception 'invalid_fields'; end if;
      -- Reject full phone strings even for direct RPC callers. Audit contains
      -- field names only; no submitted personal values are copied into history.
      if exists(select 1 from jsonb_each_text(v_fields) f where f.value ~ '(0[1-9][0-9 -]{7,}|\+82)' and f.key not like '%amount' and f.key not like '%date') then raise exception 'full_phone_forbidden'; end if;
      insert into public.record_overrides(organization_id,domain,record_id,fields) values(v_org,v_domain,p_id,v_fields)
        on conflict(organization_id,domain,record_id) do update set fields=public.record_overrides.fields || excluded.fields;
      select string_agg(format('%I=v.%I',key,key),',') into v_columns from jsonb_object_keys(v_fields) key;
      execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) v where t.id=$2 and t.organization_id=$3',v_table,v_columns,v_table) using v_fields,p_id,v_org;
      v_event:='record_correct'; v_payload:=jsonb_build_object('fields',(select jsonb_agg(key) from jsonb_object_keys(v_fields) key));
    else
      if v_action='approve' and (v_domain='member' and coalesce(nullif(v_row->>'name',''),nullif(v_row->>'external_member_id','')) is null
        or v_domain='registration' and (v_row->>'registration_date' is null or v_row->>'paid_amount' is null)
        or v_domain='class' and v_row->>'class_date' is null) then raise exception 'required_fields_missing'; end if;
      insert into public.record_overrides(organization_id,domain,record_id,record_status) values(v_org,v_domain,p_id,case when v_action='approve' then 'valid'::public.record_review_status else 'rejected'::public.record_review_status end)
        on conflict(organization_id,domain,record_id) do update set record_status=excluded.record_status;
      execute format('update public.%I set record_status=record_status where id=$1 and organization_id=$2',v_table) using p_id,v_org;
      v_event:='record_' || v_action;
    end if;
  else raise exception 'invalid_action'; end if;
  insert into public.audit_events(organization_id,actor_id,source_connection_id,source_tab_id,source_record_key,action,entity_type,entity_id,payload)
    values(v_org,auth.uid(),(v_row->>'source_connection_id')::uuid,(v_row->>'source_tab_id')::uuid,v_row->>'source_record_key',v_event,v_domain,p_id,v_payload);
  return jsonb_build_object('id',p_id);
end $$;

