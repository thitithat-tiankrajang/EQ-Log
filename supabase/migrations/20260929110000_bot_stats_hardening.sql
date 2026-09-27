-- Phase 3: bot statistics become admin-only and server-recorded.
--
-- Before: every API role held every privilege on bot_stat_*; approved users
-- read everyone's rows; a direct insert could claim any recorded_by and any
-- values; record_bot_game(_v2) stored whatever the client reported and its
-- upsert could overwrite another user's row sharing a game id.
--
-- After:
--   * no API role has any table privilege; admins read through admin RPCs;
--   * finalize_live_game records a finished bot game itself, from the room's
--     frozen bot columns and the catalog (bot key, engine, difficulty, side);
--   * record_bot_game / record_bot_game_v2 remain only as no-ops so old
--     clients do not error, and record nothing.
--
-- Scores, outcome and turn count are still whatever the finished game says:
-- the server does not validate A-Math moves, so those fields are ADVISORY and
-- client-derived. Bot statistics must never feed allowance, the weekly cap,
-- credits, entitlement, billing, EXP or Stage economy (tested).
-- Idempotent.
begin;

revoke all on table public.bot_stat_folders, public.bot_stat_games
  from public, anon, authenticated, service_role;

alter table public.bot_stat_games add column if not exists bot_key text;
alter table public.bot_stat_games add column if not exists recorded_by_server boolean not null default false;
alter table public.bot_stat_games add column if not exists completion_kind text;
alter table public.bot_stat_games add column if not exists completion_reason text;
alter table public.bot_stat_games drop constraint if exists bot_stat_games_bot_engine_check;
alter table public.bot_stat_games add constraint bot_stat_games_bot_engine_check
  check (bot_engine in ('aether', 'authur', 'stage5b'));
comment on column public.bot_stat_games.bot_score is
  'Advisory: from the finished game state, which the client computes. Never an economy input.';
comment on column public.bot_stat_games.recorded_by_server is
  'true = recorded by finalize_live_game from frozen room columns; false = legacy client-reported row.';

-- Called only by finalize_live_game (it runs as the owner; no API grant).
create or replace function public.record_bot_stat_from_room(
  live public.room_live, target_completion_kind text, target_completion_reason text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  folder uuid;
  bot public.bot_catalog%rowtype;
  human_side text;
  bot_points integer;
  human_points integer;
begin
  select id into folder from public.bot_stat_folders where is_open limit 1;
  -- Only whole games against a bot: a Stage attempt starts from a sealed
  -- mid-game position and would skew the bot's averages. (room_purpose is
  -- added by 20260929140000; read through jsonb so this compiles either way.)
  if folder is null or live.bot_key is null
     or coalesce(to_jsonb(live) ->> 'room_purpose', 'normal') <> 'normal' then
    return;
  end if;
  select * into bot from public.bot_catalog where bot_key = live.bot_key;
  human_side := case live.bot_side when 'A' then 'B' else 'A' end;
  bot_points := case live.bot_side when 'A' then live.score_a else live.score_b end;
  human_points := case live.bot_side when 'A' then live.score_b else live.score_a end;
  insert into public.bot_stat_games (
    folder_id, game_id, room_id, player_name, player_member_id,
    bot_side, bot_engine, bot_difficulty, bot_key, bot_score, opp_score, outcome, turns,
    recorded_by, finished_at, recorded_by_server, completion_kind, completion_reason
  ) values (
    folder, live.room_id::text, live.room_id,
    coalesce(nullif(btrim(case human_side when 'A' then live.player_a else live.player_b end), ''), 'Player'),
    case human_side when 'A' then live.member_a_id else live.member_b_id end,
    live.bot_side, coalesce(bot.engine_family, 'aether'), live.bot_difficulty, live.bot_key,
    coalesce(bot_points, 0), coalesce(human_points, 0),
    case when coalesce(bot_points, 0) = coalesce(human_points, 0) then 'draw'
         when coalesce(bot_points, 0) > coalesce(human_points, 0) then 'bot_win'
         else 'bot_loss' end,
    coalesce(live.turn_number, 0),
    live.owner_id, now(), true, target_completion_kind, target_completion_reason
  )
  on conflict (folder_id, game_id) do nothing;
end; $$;

create or replace function public.finalize_live_game(target_game_id uuid, target_state jsonb, target_completion_kind text, target_completion_reason text, target_surrendered_side text DEFAULT NULL::text)
 RETURNS TABLE(archive_scope text, archive_game_id uuid, private_item_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  live public.room_live%rowtype;
  finished_at timestamptz := now();
  saved_private_id uuid;
  state_completion_reason text;
begin
  if target_completion_kind not in ('natural', 'terminated') then
    raise exception 'invalid completion kind' using errcode = '22023';
  end if;
  if target_completion_kind = 'natural'
    and target_completion_reason not in ('rack_out', 'no_score_streak', 'perfect_game')
  then
    raise exception 'natural completion requires a natural rule reason' using errcode = '22023';
  end if;
  if target_completion_kind = 'terminated'
    and target_completion_reason not in (
      'surrender', 'manual', 'admin', 'timeout', 'disconnect', 'legacy_finished', 'other'
    )
  then
    raise exception 'invalid termination reason' using errcode = '22023';
  end if;
  if target_surrendered_side is not null and target_surrendered_side not in ('A', 'B') then
    raise exception 'invalid surrendered side' using errcode = '22023';
  end if;
  if (target_completion_reason = 'surrender') <> (target_surrendered_side is not null) then
    raise exception 'surrender reason and side must be provided together' using errcode = '22023';
  end if;

  select * into live from public.room_live where room_id = target_game_id for update;
  if not found then
    -- Idempotent retry: return the already-created destination if retained.
    if exists (select 1 from public.public_game_snapshots where game_id = target_game_id) then
      return query select 'public'::text, target_game_id, null::uuid;
      return;
    end if;
    if exists (select 1 from public.region_game_snapshots where game_id = target_game_id) then
      return query select 'region'::text, target_game_id, null::uuid;
      return;
    end if;
    select id into saved_private_id from public.private_library_items
      where source_game_id = target_game_id and source_scope = 'private' limit 1;
    if saved_private_id is not null then
      return query select 'private'::text, target_game_id, saved_private_id;
      return;
    end if;
    raise exception 'live game not found' using errcode = 'P0002';
  end if;
  if not public.can_write_live_game(target_game_id) then
    raise exception 'game access required' using errcode = '42501';
  end if;
  if coalesce(target_state ->> 'status', '') <> 'finished' then
    raise exception 'final state must be finished' using errcode = '22023';
  end if;
  state_completion_reason := public.snapshot_completion_reason(target_state);
  if target_completion_kind = 'natural' and state_completion_reason <> target_completion_reason then
    raise exception 'natural completion does not match the final game log' using errcode = '22023';
  end if;
  if target_completion_reason = 'surrender' and
    nullif(target_state #>> '{matchControl,surrenderedSide}', '') is distinct from target_surrendered_side
  then
    raise exception 'surrender side does not match the final game state' using errcode = '22023';
  end if;

  live.state := public.sanitize_game_snapshot(target_state);
  live.turn_number := coalesce((target_state ->> 'turnNumber')::int, live.turn_number);
  live.score_a := coalesce((target_state #>> '{scores,A}')::int, live.score_a);
  live.score_b := coalesce((target_state #>> '{scores,B}')::int, live.score_b);

  if live.archive_policy = 'public' then
    insert into public.public_game_snapshots (
      game_id, source_owner_id, name, player_a, player_b, game_mode, mode_key,
      turn_number, score_a, score_b, completion_kind, completion_reason,
      surrendered_side, creator_side, player_a_user_id, player_b_user_id,
      snapshot, created_at, finished_at
    ) values (
      live.room_id, live.owner_id, live.name, live.player_a, live.player_b,
      live.game_mode, live.mode_key, live.turn_number, live.score_a, live.score_b,
      target_completion_kind, target_completion_reason, target_surrendered_side,
      live.creator_side, live.player_a_user_id, live.player_b_user_id,
      live.state, live.created_at, finished_at
    ) on conflict (game_id) do nothing;
    perform public.prune_public_game_snapshots();
  elsif live.archive_policy = 'region' then
    insert into public.region_game_snapshots (
      game_id, region_id, source_owner_id, name, player_a, player_b, game_mode, mode_key,
      turn_number, score_a, score_b, completion_kind, completion_reason,
      surrendered_side, creator_side, player_a_user_id, player_b_user_id,
      snapshot, created_at, finished_at
    ) values (
      live.room_id, live.region_id, live.owner_id, live.name, live.player_a, live.player_b,
      live.game_mode, live.mode_key, live.turn_number, live.score_a, live.score_b,
      target_completion_kind, target_completion_reason, target_surrendered_side,
      live.creator_side, live.player_a_user_id, live.player_b_user_id,
      live.state, live.created_at, finished_at
    ) on conflict (game_id) do nothing;
    perform public.prune_region_game_snapshots(live.region_id);
  elsif live.archive_policy = 'private' then
    insert into public.private_library_items (
      owner_id, item_type, parent_id, name, source_scope, source_game_id,
      game_id, game_mode, mode_key, completion_kind, completion_reason,
      turn_number, score_a, score_b, snapshot
    ) values (
      live.owner_id, 'game', live.private_parent_id, live.name, 'private', live.room_id,
      live.room_id, live.game_mode, live.mode_key, target_completion_kind,
      target_completion_reason, live.turn_number, live.score_a, live.score_b, live.state
    ) returning id into saved_private_id;
  end if;

  perform public.record_player_result(
    live.player_a_user_id, live.mode_key, live.game_mode, 'A',
    live.score_a, live.score_b, finished_at, target_surrendered_side
  );
  if live.game_mode = 'versus' then
    perform public.record_player_result(
      live.player_b_user_id, live.mode_key, live.game_mode, 'B',
      live.score_a, live.score_b, finished_at, target_surrendered_side
    );
  end if;

  -- Bot statistics are recorded here, by the server, while the room and its
  -- frozen bot identity still exist (Phase 3). Never from the client.
  if live.bot_key is not null then
    perform public.record_bot_stat_from_room(live, target_completion_kind, target_completion_reason);
  end if;

  delete from public.room_live where room_id = target_game_id;
  return query select live.archive_policy, live.room_id, saved_private_id;
end; $function$;

-- The old client paths: kept callable so a stale client does not break, but
-- they record nothing and trust nothing.
create or replace function public.record_bot_game(
  p_game_id text, p_room_id uuid, p_player_name text, p_player_member_id text,
  p_bot_side text, p_bot_difficulty text, p_bot_score integer, p_opp_score integer,
  p_outcome text, p_turns integer, p_finished_at timestamptz
) returns uuid
language sql stable set search_path = pg_catalog, pg_temp as $$
  select null::uuid
$$;
create or replace function public.record_bot_game_v2(
  p_game_id text, p_room_id uuid, p_player_name text, p_player_member_id text,
  p_bot_side text, p_bot_engine text, p_bot_difficulty text, p_bot_score integer,
  p_opp_score integer, p_outcome text, p_turns integer, p_finished_at timestamptz
) returns uuid
language sql stable set search_path = pg_catalog, pg_temp as $$
  select null::uuid
$$;
alter function public.record_bot_game(text, uuid, text, text, text, text, integer, integer, text, integer, timestamptz)
  security invoker;
alter function public.record_bot_game_v2(text, uuid, text, text, text, text, text, integer, integer, text, integer, timestamptz)
  security invoker;

-- ── Admin reads and folder management ───────────────────────────────────────

create or replace function public.admin_list_bot_stat_folders()
returns table (id uuid, name text, is_open boolean, created_at timestamptz,
               opened_at timestamptz, closed_at timestamptz, games bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  return query
    select f.id, f.name, f.is_open, f.created_at, f.opened_at, f.closed_at,
           (select count(*) from public.bot_stat_games g where g.folder_id = f.id)
      from public.bot_stat_folders f
     order by f.created_at desc;
end; $$;

create or replace function public.admin_list_bot_stat_games(target_folder uuid)
returns table (id uuid, folder_id uuid, game_id text, room_id uuid, player_name text,
               bot_side text, bot_engine text, bot_difficulty text, bot_key text,
               bot_score integer, opp_score integer, outcome text, turns integer,
               finished_at timestamptz, created_at timestamptz, recorded_by_server boolean,
               completion_kind text, completion_reason text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  return query
    select g.id, g.folder_id, g.game_id, g.room_id, g.player_name, g.bot_side, g.bot_engine,
           g.bot_difficulty, g.bot_key, g.bot_score, g.opp_score, g.outcome, g.turns,
           g.finished_at, g.created_at, g.recorded_by_server, g.completion_kind, g.completion_reason
      from public.bot_stat_games g
     where g.folder_id = target_folder
     order by g.finished_at desc nulls last, g.created_at desc;
end; $$;

create or replace function public.admin_delete_bot_stat_folder(target_folder uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  delete from public.bot_stat_folders where id = target_folder;
end; $$;

alter function public.create_bot_folder(text, boolean) set search_path = public, pg_temp;
alter function public.open_bot_folder(uuid) set search_path = public, pg_temp;
alter function public.close_bot_folder(uuid) set search_path = public, pg_temp;

revoke all on function public.record_bot_stat_from_room(public.room_live, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_live_game(uuid, jsonb, text, text, text) from public, anon;
revoke all on function public.record_bot_game(text, uuid, text, text, text, text, integer, integer, text, integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.record_bot_game_v2(text, uuid, text, text, text, text, text, integer, integer, text, integer, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.record_bot_game(text, uuid, text, text, text, text, integer, integer, text, integer, timestamptz)
  to authenticated;
grant execute on function public.record_bot_game_v2(text, uuid, text, text, text, text, text, integer, integer, text, integer, timestamptz)
  to authenticated;
revoke all on function public.bot_folder_open_id() from public, anon, authenticated, service_role;
revoke all on function public.create_bot_folder(text, boolean) from public, anon, service_role;
revoke all on function public.open_bot_folder(uuid) from public, anon, service_role;
revoke all on function public.close_bot_folder(uuid) from public, anon, service_role;
grant execute on function public.create_bot_folder(text, boolean) to authenticated;
grant execute on function public.open_bot_folder(uuid) to authenticated;
grant execute on function public.close_bot_folder(uuid) to authenticated;
revoke all on function public.admin_list_bot_stat_folders() from public, anon, authenticated, service_role;
revoke all on function public.admin_list_bot_stat_games(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_delete_bot_stat_folder(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_bot_stat_folders() to authenticated;
grant execute on function public.admin_list_bot_stat_games(uuid) to authenticated;
grant execute on function public.admin_delete_bot_stat_folder(uuid) to authenticated;

-- Definer helper from the original bot-stats migration: pin its search path.
alter function public.bot_folder_open_id() set search_path = public, pg_temp;

commit;
