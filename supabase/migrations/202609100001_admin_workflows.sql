-- All operations derive tenant and actor from verified auth.uid(). Mutations and
-- audit writes share a transaction; callers never supply an organization.
create table public.member_aliases (
  organization_id uuid not null,
  alias_member_id uuid primary key,
  retained_member_id uuid not null,
  alias_name text,
  alias_external_member_id text,
  source_provenance jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id,alias_member_id) references public.members(organization_id,id),
  foreign key (organization_id,retained_member_id) references public.members(organization_id,id),
  check (alias_member_id <> retained_member_id)
);
create table public.record_overrides (
  organization_id uuid not null,
  domain text not null check (domain in ('member','registration','lead','class')),
  record_id uuid not null,
  fields jsonb not null default '{}',
  record_status public.record_review_status,
  primary key(organization_id,domain,record_id)
);
create table public.trainer_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  trainer_id uuid not null,
  email text not null,
  claimed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key(organization_id,trainer_id) references public.trainers(organization_id,id),
  unique(organization_id,trainer_id)
);
-- One email has one pending tenant invitation, avoiding ambiguous first login.
create unique index trainer_invitation_pending_email on public.trainer_invitations(lower(email)) where claimed_by is null;
alter table public.sheet_connections add column trainer_assignment_mode text not null default 'direct' check(trainer_assignment_mode in ('direct','column'));
do $$ declare t text; begin
  foreach t in array array['member_aliases','record_overrides','trainer_invitations'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy admin_select on public.%I for select to authenticated using (organization_id=(select private.current_organization_id()) and (select private.current_app_role())=''admin'')',t);
  end loop;
end $$;

create function private.require_admin() returns uuid
language plpgsql security definer set search_path='' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.profiles where id=auth.uid() and is_active and role='admin';
  if v_org is null then raise exception 'admin_required'; end if;
  return v_org;
end $$;

-- Locks follow ingestion's lease -> connection order. This also fences active
-- workers before disconnect and deletion. Multi-source merges use sorted locks.
create function private.lock_admin_sources(p_org uuid,p_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.sync_leases where source_connection_id=any(p_ids) order by source_connection_id for update;
  perform 1 from public.sheet_connections where organization_id=p_org and id=any(p_ids) order by id for update;
end $$;

create function private.preserve_admin_review() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_override public.record_overrides; v_id uuid; v_domain text;
begin
  v_domain:=case tg_table_name when 'members' then 'member' when 'registrations' then 'registration' when 'leads' then 'lead' when 'classes' then 'class' end;
  -- INSERT ... ON CONFLICT initially carries a fresh UUID: find the persisted ID.
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
  if new.record_status='valid' and new.trainer_id is null and exists(select 1 from public.sheet_connections where id=new.source_connection_id and organization_id=new.organization_id and trainer_assignment_mode='column') then
    new.record_status:='review_required';
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['members','registrations','leads','classes'] loop
    execute format('create trigger preserve_admin_review before insert or update on public.%I for each row execute function private.preserve_admin_review()',t);
  end loop;
end $$;

create function public.admin_review(p_id uuid,p_command jsonb) returns jsonb
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
        execute format('update public.%I set raw_snapshot_id=null where organization_id=$1 and source_connection_id=$2',v_table) using v_org,p_id;
      end loop;
      update public.sync_record_state set record=jsonb_set(record,'{raw_snapshot_id}','null') where organization_id=v_org and source_connection_id=p_id;
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

create function public.admin_trainer(p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid:=private.require_admin(); v_action text:=p_command->>'action'; v_id uuid; v_connection uuid; v_email text; v_active boolean; v_name text; v_table text;
begin
  if v_action='invite' then
    v_email:=lower(trim(p_command->>'email')); v_name:=trim(p_command->>'displayName'); v_active:=(p_command->>'active')::boolean;
    if v_email is null or v_email !~ '^[^ @]+@[^ @]+\.[^ @]+$' or length(v_email)>254 or coalesce(length(v_name),0) not between 1 and 100 or v_active is null then raise exception 'invalid_invitation'; end if;
    insert into public.trainers(organization_id,email,display_name,is_active) values(v_org,v_email,v_name,v_active) returning id into v_id;
    insert into public.trainer_invitations(organization_id,trainer_id,email) values(v_org,v_id,v_email);
  elsif v_action='activate' then
    v_id:=(p_command->>'trainerId')::uuid; v_active:=(p_command->>'active')::boolean;
    if v_active is null then raise exception 'invalid_active_state'; end if;
    update public.trainers set is_active=v_active where organization_id=v_org and id=v_id;
    if not found then raise exception 'target_not_found'; end if;
    update public.profiles set is_active=v_active where organization_id=v_org and trainer_id=v_id and role='trainer';
  elsif v_action='assign' then
    v_connection:=(p_command->>'connectionId')::uuid; v_id:=(p_command->>'trainerId')::uuid;
    perform private.lock_admin_sources(v_org,array[v_connection]);
    if p_command->>'mode'='direct' then
      perform 1 from public.trainers where id=v_id and organization_id=v_org and is_active for update;
      if not found then raise exception 'trainer_not_found'; end if;
    elsif p_command->>'mode'='column' and v_id is null then null;
    else raise exception 'invalid_assignment'; end if;
    update public.sheet_connections set trainer_id=v_id,trainer_assignment_mode=p_command->>'mode' where id=v_connection and organization_id=v_org;
    if not found then raise exception 'target_not_found'; end if;
    foreach v_table in array array['members','registrations','leads','classes'] loop
      execute format('update public.%I set trainer_id=$1 where organization_id=$2 and source_connection_id=$3',v_table) using v_id,v_org,v_connection;
    end loop;
    -- Replay trusted stored hints so a column assignment applies immediately.
    update public.sync_record_state set record=record where organization_id=v_org and source_connection_id=v_connection;
  else raise exception 'invalid_action'; end if;
  insert into public.audit_events(organization_id,actor_id,source_connection_id,action,entity_type,entity_id,payload)
    values(v_org,auth.uid(),v_connection,case when v_action='assign' then 'trainer_assignment' else 'trainer_' || v_action end,'trainer',v_id,jsonb_build_object('trainerId',v_id,'active',v_active,'mode',p_command->>'mode'));
  return jsonb_build_object('id',v_id);
end $$;

create function public.claim_trainer_invitation() returns boolean
language plpgsql security definer set search_path='' as $$
declare v_email text; v_invite public.trainer_invitations; v_trainer public.trainers;
begin
  if auth.uid() is null or exists(select 1 from public.profiles where id=auth.uid()) then return false; end if;
  select lower(email) into v_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if v_email is null or not exists(select 1 from auth.identities where user_id=auth.uid() and provider='google') then return false; end if;
  select * into v_invite from public.trainer_invitations where lower(email)=v_email and claimed_by is null for update;
  if not found then return false; end if;
  select * into v_trainer from public.trainers where id=v_invite.trainer_id and organization_id=v_invite.organization_id and is_active for update;
  if not found then return false; end if;
  insert into public.profiles(id,organization_id,role,trainer_id,display_name,is_active) values(auth.uid(),v_invite.organization_id,'trainer',v_invite.trainer_id,v_trainer.display_name,true) on conflict(id) do nothing;
  if not found then return false; end if;
  update public.trainer_invitations set claimed_by=auth.uid() where id=v_invite.id;
  insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id) values(v_invite.organization_id,auth.uid(),'trainer_invitation_claim','trainer',v_invite.trainer_id);
  return true;
end $$;

create function private.audit_mapping_confirmation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.confirmed_by is not null then
    insert into public.audit_events(organization_id,actor_id,source_connection_id,source_tab_id,action,entity_type,entity_id,payload)
      values(new.organization_id,new.confirmed_by,new.source_connection_id,new.source_tab_id,'mapping_confirmation','mapping',new.id,jsonb_build_object('version',new.version));
  end if;
  return new;
end $$;
create trigger audit_mapping_confirmation after insert on public.mapping_versions for each row execute function private.audit_mapping_confirmation();

create function private.require_active_snapshot_source() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.sheet_connections where id=new.source_connection_id and organization_id=new.organization_id and is_active for share;
  if not found then raise exception 'connection_inactive'; end if;
  return new;
end $$;
create trigger require_active_snapshot_source before insert on public.raw_snapshots for each row execute function private.require_active_snapshot_source();
revoke all on function private.require_active_snapshot_source() from public,anon,authenticated;

-- Resolve merged member identities and mapped trainer names after ingestion has
-- stored its hints. Ambiguous names never grant a trainer access to a record.
create function private.apply_admin_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_table text; v_mode text; v_trainer uuid; v_count bigint; v_member uuid; v_name text; v_external text;
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
    select count(distinct coalesce(a.retained_member_id,m.id)),(array_agg(distinct coalesce(a.retained_member_id,m.id)))[1] into v_count,v_member
      from public.members m left join public.member_aliases a on a.organization_id=m.organization_id and a.alias_member_id=m.id
      join public.members retained on retained.organization_id=m.organization_id and retained.id=coalesce(a.retained_member_id,m.id) and retained.record_status='valid'
      where m.organization_id=new.organization_id and (case when v_external is not null then m.external_member_id=v_external or a.alias_external_member_id=v_external else m.name=v_name or a.alias_name=v_name end);
    execute format('update public.%I set member_id=$1 where organization_id=$2 and source_connection_id=$3 and source_tab_id=$4 and source_record_key=$5',v_table)
      using case when v_count=1 then v_member else null end,new.organization_id,new.source_connection_id,new.source_tab_id,new.source_record_key;
  end if;
  return new;
end $$;
create trigger apply_admin_assignment after insert or update on public.sync_record_state for each row execute function private.apply_admin_assignment();

revoke all on function private.require_admin(),private.lock_admin_sources(uuid,uuid[]),private.preserve_admin_review(),private.audit_mapping_confirmation(),private.apply_admin_assignment() from public,anon,authenticated;
revoke all on function public.admin_review(uuid,jsonb),public.admin_trainer(jsonb),public.claim_trainer_invitation() from public,anon,authenticated;
grant execute on function public.admin_review(uuid,jsonb),public.admin_trainer(jsonb),public.claim_trainer_invitation() to authenticated;

create function public.admin_workspace() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid:=private.require_admin(); v_records jsonb:='[]'; v_table text; v_domain text; v_part jsonb;
begin
  foreach v_table in array array['members','registrations','leads','classes'] loop
    v_domain:=case v_table when 'members' then 'member' when 'registrations' then 'registration' when 'leads' then 'lead' else 'class' end;
    execute format('select coalesce(jsonb_agg(item),''[]'') from (select to_jsonb(r) || jsonb_build_object(''domain'',$2,''tab_title'',t.title,''issues'',coalesce(s.record->''issues'',''[]''::jsonb),''source_fields'',coalesce(m.columns->''fields'',''[]''::jsonb)) item from public.%I r join public.sheet_tabs t on t.id=r.source_tab_id left join public.sync_record_state s on s.organization_id=r.organization_id and s.source_connection_id=r.source_connection_id and s.source_tab_id=r.source_tab_id and s.source_record_key=r.source_record_key and s.domain=$2 left join public.mapping_versions m on m.id=r.mapping_version_id where r.organization_id=$1 and r.record_status in (''review_required'',''rejected'') order by r.updated_at desc,r.id limit 100) q',v_table) into v_part using v_org,v_domain;
    v_records:=v_records || v_part;
  end loop;
  return jsonb_build_object('records',v_records,
    'members',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from (select id,name,external_member_id,source_record_key from public.members where organization_id=v_org and record_status='valid' order by name,id limit 500) m),
    'trainers',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select t.id,t.display_name,t.email,t.is_active,i.claimed_by is not null as claimed from public.trainers t left join public.trainer_invitations i on i.trainer_id=t.id where t.organization_id=v_org order by t.display_name,t.id) t),
    'connections',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from (select id,display_name,is_active,trainer_id,trainer_assignment_mode from public.sheet_connections where organization_id=v_org order by display_name,id) c),
    'tabs',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select t.id,t.organization_id,t.source_connection_id,t.title,t.domain,t.header_row,t.headers,
      (select m.columns from public.mapping_versions m where m.organization_id=v_org and m.source_tab_id=t.id and m.confirmed_by is not null order by m.version desc limit 1) as mapping,
      (select r.source_payload->'rows' from public.raw_snapshots r where r.organization_id=v_org and r.source_tab_id=t.id order by r.captured_at desc,r.id limit 1) as rows
      from public.sheet_tabs t where t.organization_id=v_org and t.is_active order by t.title,t.id limit 100) t),
    -- Audit views intentionally expose metadata only, never arbitrary historical payloads.
    'audits',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (select id,created_at,actor_id,action,entity_type,entity_id from public.audit_events where organization_id=v_org order by created_at desc,id desc limit 100) a));
end $$;
revoke all on function public.admin_workspace() from public,anon,authenticated;
grant execute on function public.admin_workspace() to authenticated;
