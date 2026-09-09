-- A normal sync rewrites canonical rows before updating sync_record_state.
-- Replay assignment/identity resolution even when only its snapshot changed.
-- Suppress replay solely for metadata-only raw-history pointer removal.
drop trigger apply_admin_assignment_update on public.sync_record_state;
create trigger apply_admin_assignment_update after update on public.sync_record_state
  for each row when (not (
    old.record->>'raw_snapshot_id' is not null
    and new.record->>'raw_snapshot_id' is null
    and old.record - 'raw_snapshot_id' is not distinct from new.record - 'raw_snapshot_id'
  )) execute function private.apply_admin_assignment();
