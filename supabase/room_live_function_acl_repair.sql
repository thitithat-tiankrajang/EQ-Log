-- One-time repair for deployments that already applied
-- room_live_access_contract_migration.sql before its explicit role revokes.

begin;

set lock_timeout = '15s';

revoke all on function public.list_live_games(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_live_games(text, uuid) to authenticated;

do $verify$
begin
  if has_function_privilege(
    'anon',
    'public.list_live_games(text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'anon still has EXECUTE on list_live_games';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.list_live_games(text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated lacks EXECUTE on list_live_games';
  end if;
  if has_function_privilege(
    'service_role',
    'public.list_live_games(text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'service_role still has EXECUTE on list_live_games';
  end if;
end;
$verify$;

notify pgrst, 'reload schema';

commit;
