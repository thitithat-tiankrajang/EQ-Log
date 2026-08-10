-- Allows approved archive readers to resolve the account that originally
-- created each game record. Profile access remains limited to id/display_name.

begin;

set lock_timeout = '15s';

grant select (source_owner_id)
  on table public.public_game_snapshots to authenticated;
grant select (source_owner_id)
  on table public.region_game_snapshots to authenticated;

do $verify$
begin
  if not has_column_privilege(
    'authenticated', 'public.public_game_snapshots', 'source_owner_id', 'SELECT'
  ) then
    raise exception 'authenticated cannot read public archive creator ids';
  end if;
  if not has_column_privilege(
    'authenticated', 'public.region_game_snapshots', 'source_owner_id', 'SELECT'
  ) then
    raise exception 'authenticated cannot read region archive creator ids';
  end if;
end;
$verify$;

notify pgrst, 'reload schema';

commit;
