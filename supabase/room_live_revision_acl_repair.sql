-- One-time repair for deployments that applied canonical_revision_migration.sql
-- before its opened-game SELECT grant included the revision column.

begin;

set lock_timeout = '15s';

grant select (revision) on table public.room_live to authenticated;

do $verify$
begin
  if not has_column_privilege(
    'authenticated',
    'public.room_live',
    'revision',
    'SELECT'
  ) then
    raise exception 'authenticated lacks SELECT on room_live.revision';
  end if;
end;
$verify$;

notify pgrst, 'reload schema';

commit;
