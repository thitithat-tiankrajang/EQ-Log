-- The parts of production's schema that live outside `public` and so are not in
-- the schema dump (20260901000000_production_baseline.sql), which covers the
-- application schemas only. Both exist in production exactly as written here.
--
-- Without them a database built from this directory gives new accounts no
-- profile row (nothing inserts one) and refuses every subscription to a game's
-- private broadcast channel.
--
-- Each object is created only when it is missing. auth.users and
-- realtime.messages belong to Supabase's own roles, so dropping and recreating
-- them could need ownership a migration role may not have; creating what is
-- absent does not, and on production (where both exist) this file is a no-op.
begin;

-- Every new auth user gets a public.profiles row (status 'pending').
do $outside_public$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created' and not tgisinternal
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;

  -- Readers of a live game may subscribe to its private broadcast topic
  -- `game:<id>` (commit notifications from public.broadcast_live_game_commit).
  -- Supabase enables RLS on realtime.messages itself.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'realtime' and tablename = 'messages' and policyname = 'live_game_broadcast_read'
  ) then
    create policy live_game_broadcast_read on realtime.messages
      for select to authenticated
      using (
        extension = 'broadcast'
        and topic like 'game:%'
        and public.can_read_live_game(nullif(split_part(topic, ':', 2), '')::uuid)
      );
  end if;
end
$outside_public$;

commit;
