-- Repair for deployments where the immutable-event trigger blocks the
-- ON DELETE CASCADE used to finalize, cancel or expire a Live Game.

begin;

set lock_timeout = '15s';

-- Browser and service roles cannot mutate the event table directly. Deletion
-- is intentionally left to the room_live foreign-key cascade, executed by the
-- trusted lifecycle functions as the table owner.
revoke all on table public.live_game_events from anon, authenticated, service_role;
grant select on table public.live_game_events to authenticated;

create or replace function public.reject_live_event_rewrite()
returns trigger language plpgsql as $$
begin
  raise exception 'committed game events are immutable' using errcode = '42501';
end; $$;

-- UPDATE is never part of lifecycle cleanup and remains trigger-protected.
-- DELETE is protected by ACL/RLS instead, so every parent cascade can finish.
drop trigger if exists live_game_events_immutable on public.live_game_events;
create trigger live_game_events_immutable
  before update on public.live_game_events
  for each row execute function public.reject_live_event_rewrite();

do $verify$
begin
  if has_table_privilege('anon', 'public.live_game_events', 'DELETE')
    or has_table_privilege('authenticated', 'public.live_game_events', 'DELETE')
    or has_table_privilege('service_role', 'public.live_game_events', 'DELETE')
  then
    raise exception 'an API role can delete live_game_events directly';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.live_game_events'::regclass
      and not t.tgisinternal
      and pg_catalog.pg_get_triggerdef(t.oid) ~* '\mDELETE\M'
  ) then
    raise exception 'a user trigger still intercepts live_game_events DELETE';
  end if;
end;
$verify$;

notify pgrst, 'reload schema';

commit;
