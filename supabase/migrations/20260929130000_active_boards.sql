-- Phase 3: at most N active boards per user (N = system_settings
-- 'max_active_boards_per_user', initially 3).
--
-- A board is ACTIVE for a user while the user is a SEATED player on it and it
-- has not ended:
--   room_live       player_a_user_id / player_b_user_id; status waiting,
--                   playing or paused; not past its own expires_at (waiting
--                   rooms 24 h, drafts 30 days; playing rooms never expire).
--                   A Host who is not seated, and spectators, are not counted.
--                   Finished and cancelled rooms are deleted, so never count.
--   ranked_matches  player_a_id / player_b_id; status matched or playing, or
--                   waiting and still claimable (created within 24 h — the
--                   rule ranked_claim_match enforces). Finished never counts.
-- There is deliberately no inactivity exemption: a playing board counts until
-- its lifecycle ends.
--
-- Enforcement is on the ROWS, not on each entry point: whenever an insert or
-- update would make a board count for a user it did not count for before —
-- creating, joining, being seated by someone else, a waiting room being
-- re-opened, a Ranked claim — that user is locked (per-user advisory lock,
-- users in UUID order) and recounted, and the change is refused at the limit.
-- Reading, reconnecting and playing moves change no seat and are never gated;
-- a user already above the limit keeps every existing board. Reviving an
-- EXPIRED lobby or draft is a new board and is checked. The human seat of a
-- bot room cannot be vacated (other than by account deletion).
-- Idempotent.
begin;

insert into public.system_settings (key, value_int, updated_at)
values ('max_active_boards_per_user', 3, now())
on conflict (key) do nothing;

-- Browser roles read settings through RLS; nothing but the owner writes them.
revoke insert, update, delete, truncate, references, trigger on table public.system_settings
  from public, anon, authenticated, service_role;

-- The configured limit. Missing configuration refuses every new board rather
-- than allowing unlimited ones.
create or replace function public.active_board_limit()
returns integer
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  configured bigint;
begin
  select value_int into configured from public.system_settings where key = 'max_active_boards_per_user';
  if configured is null or configured < 1 then
    raise exception 'active_board_limit_unconfigured: the active board limit is not configured'
      using errcode = 'P0001';
  end if;
  return configured::integer;
end; $$;

create or replace function public.room_counts_as_board(target_status text, target_expires timestamptz, t timestamptz)
returns boolean
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select target_status in ('waiting', 'playing', 'paused')
     and (target_expires is null or target_expires > t)
$$;

create or replace function public.ranked_counts_as_board(target_status text, target_created timestamptz, t timestamptz)
returns boolean
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select target_status in ('matched', 'playing')
      or (target_status = 'waiting' and target_created > t - interval '24 hours')
$$;

-- The one definition of a user's active boards. The excluded row is the one
-- being changed, counted separately by the caller.
create or replace function public.active_board_count(
  target_user uuid, t timestamptz, exclude_room uuid default null, exclude_match uuid default null
) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select (
    (select count(*) from public.room_live l
      where target_user in (l.player_a_user_id, l.player_b_user_id)
        and public.room_counts_as_board(l.status, l.expires_at, t)
        and l.room_id is distinct from exclude_room)
    +
    (select count(*) from public.ranked_matches m
      where target_user in (m.player_a_id, m.player_b_id)
        and public.ranked_counts_as_board(m.status, m.created_at, t)
        and m.id is distinct from exclude_match)
  )::integer
$$;

-- Take the per-user lock (the same key every plan-sensitive write uses) for
-- each distinct user, in UUID order, so two operations over the same users
-- cannot deadlock by locking them in opposite orders.
create or replace function public.lock_board_users(target_users uuid[])
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid;
begin
  for u in select distinct x from unnest(target_users) x where x is not null order by x loop
    perform pg_advisory_xact_lock(hashtextextended(u::text, 41));
  end loop;
end; $$;

-- Refuse when any user in `newly` would exceed the limit by gaining this board.
create or replace function public.assert_board_capacity(
  newly uuid[], t timestamptz, exclude_room uuid, exclude_match uuid
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid;
  cap integer;
  held integer;
begin
  if newly is null or cardinality(newly) = 0 then
    return;
  end if;
  perform public.lock_board_users(newly);
  cap := public.active_board_limit();
  for u in select distinct x from unnest(newly) x where x is not null order by x loop
    held := public.active_board_count(u, t, exclude_room, exclude_match);
    if held >= cap then
      raise exception 'active_board_limit: % % active boards already (limit %)',
        case when u = auth.uid() then 'you have' else 'a seated player has' end, held, cap
        using errcode = 'P0001';
    end if;
  end loop;
end; $$;

create or replace function public.enforce_room_board_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
-- Seat comparisons must be null-safe: `x in (a, null)` is NULL, not false,
-- which would silently skip a user taking an empty seat.
declare
  t timestamptz := clock_timestamp();
  now_counts boolean;
  was_counting boolean;
  newly uuid[] := '{}';
begin
  -- A write that leaves a room live makes it live: a playing room never
  -- expires, and a waiting or draft room that had ALREADY expired and is
  -- written to again gets a fresh window (setting a live room's expiry in the
  -- past is respected). Without this, a lobby played after its expiry
  -- (commit_live_game_command sets the status, not the expiry) would be a
  -- board that no longer counts.
  if new.status = 'playing' then
    new.expires_at := null;
  elsif tg_op = 'UPDATE' and old.expires_at <= t and new.expires_at <= t then
    new.expires_at := t + case when new.status = 'waiting' then interval '24 hours' else interval '30 days' end;
  end if;
  now_counts := public.room_counts_as_board(new.status, new.expires_at, t);
  was_counting := tg_op = 'UPDATE' and public.room_counts_as_board(old.status, old.expires_at, t);
  if not now_counts then
    return new;
  end if;
  if new.player_a_user_id is not null and not (was_counting
       and new.player_a_user_id = any (array_remove(array[old.player_a_user_id, old.player_b_user_id], null))) then
    newly := newly || new.player_a_user_id;
  end if;
  if new.player_b_user_id is not null and not (was_counting
       and new.player_b_user_id = any (array_remove(array[old.player_a_user_id, old.player_b_user_id], null))) then
    newly := newly || new.player_b_user_id;
  end if;
  perform public.assert_board_capacity(newly, t, new.room_id, null);
  return new;
end; $$;

-- The human seat of a bot room (and so of every Stage attempt) is fixed once
-- taken: clearing it would stop the board counting while its owner keeps
-- playing the bot. Only account deletion (ON DELETE SET NULL) may clear it.
create or replace function public.freeze_bot_room_seats()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.bot_key is null then
    return new;
  end if;
  if (old.player_a_user_id is not null and new.player_a_user_id is distinct from old.player_a_user_id
        and not (new.player_a_user_id is null
                 and not exists (select 1 from public.profiles p where p.id = old.player_a_user_id)))
     or (old.player_b_user_id is not null and new.player_b_user_id is distinct from old.player_b_user_id
        and not (new.player_b_user_id is null
                 and not exists (select 1 from public.profiles p where p.id = old.player_b_user_id))) then
    raise exception 'bot_room_seat_fixed: the player of a bot room cannot be changed' using errcode = '42501';
  end if;
  return new;
end; $$;

drop trigger if exists room_live_bot_seats_frozen on public.room_live;
create trigger room_live_bot_seats_frozen
  before update of player_a_user_id, player_b_user_id on public.room_live
  for each row execute function public.freeze_bot_room_seats();

drop trigger if exists room_live_board_limit on public.room_live;
create trigger room_live_board_limit
  before insert or update of player_a_user_id, player_b_user_id, status, expires_at
  on public.room_live
  for each row execute function public.enforce_room_board_limit();

create or replace function public.enforce_ranked_board_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t timestamptz := clock_timestamp();
  now_counts boolean := public.ranked_counts_as_board(new.status, new.created_at, t);
  was_counting boolean := tg_op = 'UPDATE' and public.ranked_counts_as_board(old.status, old.created_at, t);
  newly uuid[] := '{}';
begin
  if not now_counts then
    return new;
  end if;
  if new.player_a_id is not null and not (was_counting
       and new.player_a_id = any (array_remove(array[old.player_a_id, old.player_b_id], null))) then
    newly := newly || new.player_a_id;
  end if;
  if new.player_b_id is not null and not (was_counting
       and new.player_b_id = any (array_remove(array[old.player_a_id, old.player_b_id], null))) then
    newly := newly || new.player_b_id;
  end if;
  perform public.assert_board_capacity(newly, t, null, new.id);
  return new;
end; $$;

drop trigger if exists ranked_matches_board_limit on public.ranked_matches;
create trigger ranked_matches_board_limit
  before insert or update of player_a_id, player_b_id, status
  on public.ranked_matches
  for each row execute function public.enforce_ranked_board_limit();

create or replace function public.admin_set_active_board_limit(target_limit integer, target_reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if target_limit is null or target_limit < 1 then
    raise exception 'the limit must be at least 1' using errcode = '22023';
  end if;
  if coalesce(btrim(target_reason), '') = '' then
    raise exception 'a change needs a reason' using errcode = '22023';
  end if;
  insert into public.system_settings (key, value_int, updated_at, updated_by)
  values ('max_active_boards_per_user', target_limit, now(), auth.uid())
  on conflict (key) do update
    set value_int = excluded.value_int, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
end; $$;

revoke all on function public.active_board_limit() from public, anon, authenticated, service_role;
revoke all on function public.room_counts_as_board(text, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.ranked_counts_as_board(text, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.active_board_count(uuid, timestamptz, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.lock_board_users(uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.assert_board_capacity(uuid[], timestamptz, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.enforce_room_board_limit() from public, anon, authenticated, service_role;
revoke all on function public.enforce_ranked_board_limit() from public, anon, authenticated, service_role;
revoke all on function public.freeze_bot_room_seats() from public, anon, authenticated, service_role;
revoke all on function public.admin_set_active_board_limit(integer, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_active_board_limit(integer, text) to authenticated;

commit;
