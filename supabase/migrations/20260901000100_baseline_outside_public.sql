-- The parts of production's schema that live outside `public` and so are not in
-- the schema dump (20260901000000_production_baseline.sql), which covers the
-- application schemas only. Both exist in production exactly as written here;
-- this file is idempotent, so applying it there changes nothing.
--
-- Without it a database built from this directory gives new accounts no profile
-- row (nothing inserts one) and refuses every subscription to a game's private
-- broadcast channel.
begin;

-- Every new auth user gets a public.profiles row (status 'pending').
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Readers of a live game may subscribe to its private broadcast topic `game:<id>`
-- (commit notifications from public.broadcast_live_game_commit). Supabase owns
-- realtime.messages and already enables RLS on it.
drop policy if exists live_game_broadcast_read on realtime.messages;
create policy live_game_broadcast_read on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and topic like 'game:%'
    and public.can_read_live_game(nullif(split_part(topic, ':', 2), '')::uuid)
  );

commit;
