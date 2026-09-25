-- Run after game_archives_migration.sql, room_live_access_contract_migration.sql,
-- and bot_stats_migration.sql. Run this file once in the Supabase SQL editor.
-- Existing Aether rooms keep their keys and statistics unchanged.
begin;

set lock_timeout = '15s';

create or replace function public.mode_key_from_state(target_state jsonb)
returns text language sql immutable as $$
  select case
    when target_state ->> 'botSide' is not null
      and target_state ->> 'botEngine' = 'authur' then 'authur_strong'
    when target_state ->> 'botSide' is not null then
      'aether_' || coalesce(target_state ->> 'botDifficulty', 'medium')
    when coalesce(target_state ->> 'gameMode', 'versus') = 'solo' then 'solo_practice'
    when target_state ->> 'emailPlayMode' = 'direct' then 'online_versus'
    when target_state ->> 'emailPlayMode' = 'hosted'
      and (target_state #>> '{playerUserIds,A}' is not null
        or target_state #>> '{playerUserIds,B}' is not null) then 'hosted_versus'
    else 'local_versus'
  end
$$;

-- The lobby projection must reserve Authur's seat exactly as it reserves
-- Aether's. Keep the same access checks and result shape as the live-room
-- access contract migration; only the bot-family predicate changes.
create or replace function public.list_live_games(
  target_access_scope text,
  target_region_id uuid default null
)
returns table (
  room_id uuid,
  name text,
  player_a text,
  player_b text,
  status text,
  access_scope text,
  archive_policy text,
  join_policy text,
  region_id uuid,
  game_mode text,
  mode_key text,
  starting_side text,
  turn_number int,
  score_a int,
  score_b int,
  created_at timestamptz,
  updated_at timestamptz,
  owner_name text,
  viewer_role text,
  can_manage boolean,
  has_opponent boolean
)
language plpgsql stable security definer
set search_path = pg_catalog as $$
begin
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'approved membership required' using errcode = '42501';
  end if;
  if target_access_scope not in ('public', 'region', 'private') then
    raise exception 'invalid live game scope' using errcode = '22023';
  end if;
  if target_access_scope = 'region' then
    if target_region_id is null
      or (not public.is_admin() and target_region_id is distinct from public.my_region_id())
    then
      raise exception 'region access required' using errcode = '42501';
    end if;
  elsif target_region_id is not null then
    raise exception 'only region listings may specify a region' using errcode = '22023';
  end if;

  return query
  select
    l.room_id, l.name, l.player_a, l.player_b, l.status,
    l.access_scope, l.archive_policy, l.join_policy, l.region_id,
    l.game_mode, l.mode_key, l.starting_side, l.turn_number,
    l.score_a, l.score_b, l.created_at, l.updated_at, p.display_name,
    case
      when l.owner_id = auth.uid() then 'Owner'
      when public.is_admin() then 'Admin'
      when l.player_a_user_id = auth.uid() then 'Player A'
      when l.player_b_user_id = auth.uid() then 'Player B'
      else 'Spectator'
    end::text,
    (l.owner_id = auth.uid() or public.is_admin()),
    case
      when l.game_mode = 'solo' or left(l.mode_key, 7) = 'aether_'
        or left(l.mode_key, 7) = 'authur_' then true
      when l.creator_side = 'A' then l.player_b_user_id is not null
      when l.creator_side = 'B' then l.player_a_user_id is not null
      else l.player_a_user_id is not null and l.player_b_user_id is not null
    end
  from public.room_live l
  left join public.profiles p on p.id = l.owner_id
  where public.can_read_live_game(l.room_id)
    and (
      (target_access_scope = 'public' and l.access_scope = 'public')
      or (target_access_scope = 'region' and l.access_scope = 'region'
        and l.region_id = target_region_id)
      or (target_access_scope = 'private' and l.access_scope = 'private'
        and auth.uid() in (l.owner_id, l.player_a_user_id, l.player_b_user_id))
    )
  order by l.updated_at desc;
end; $$;

-- Preserve the restricted access contract of list_live_games when deploying
-- into databases with different default function privileges.
revoke all on function public.list_live_games(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_live_games(text, uuid) to authenticated;

alter table public.bot_stat_games
  add column if not exists bot_engine text not null default 'aether';
alter table public.bot_stat_games
  drop constraint if exists bot_stat_games_bot_engine_check;
alter table public.bot_stat_games
  add constraint bot_stat_games_bot_engine_check
    check (bot_engine in ('aether', 'authur'));

create or replace function public.record_bot_game_v2(
  p_game_id text,
  p_room_id uuid,
  p_player_name text,
  p_player_member_id text,
  p_bot_side text,
  p_bot_engine text,
  p_bot_difficulty text,
  p_bot_score int,
  p_opp_score int,
  p_outcome text,
  p_turns int,
  p_finished_at timestamptz
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  target uuid;
begin
  if not public.is_approved() then
    raise exception 'not approved';
  end if;
  if p_bot_engine not in ('aether', 'authur') then
    raise exception 'invalid bot engine';
  end if;
  select id into target from public.bot_stat_folders where is_open limit 1;
  if target is null then return null; end if;
  insert into public.bot_stat_games (
    folder_id, game_id, room_id, player_name, player_member_id,
    bot_side, bot_engine, bot_difficulty, bot_score, opp_score, outcome, turns,
    recorded_by, finished_at
  ) values (
    target, p_game_id, p_room_id,
    coalesce(nullif(trim(p_player_name), ''), 'Player'), p_player_member_id,
    p_bot_side, p_bot_engine, p_bot_difficulty,
    coalesce(p_bot_score, 0), coalesce(p_opp_score, 0), p_outcome,
    coalesce(p_turns, 0), auth.uid(), p_finished_at
  )
  on conflict (folder_id, game_id) do update
    set bot_engine = excluded.bot_engine,
        bot_score = excluded.bot_score,
        opp_score = excluded.opp_score,
        outcome = excluded.outcome,
        turns = excluded.turns,
        finished_at = excluded.finished_at;
  return target;
end;
$$;

revoke all on function public.record_bot_game_v2(
  text, uuid, text, text, text, text, text, int, int, text, int, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.record_bot_game_v2(
  text, uuid, text, text, text, text, text, int, int, text, int, timestamptz
) to authenticated;

do $$
begin
  if public.mode_key_from_state('{"botSide":"B","botEngine":"authur","botDifficulty":"super"}'::jsonb)
      is distinct from 'authur_strong'
    or public.mode_key_from_state('{"botSide":"B","botDifficulty":"super"}'::jsonb)
      is distinct from 'aether_super'
    or public.mode_key_from_state('{"gameMode":"solo"}'::jsonb)
      is distinct from 'solo_practice'
  then
    raise exception 'Authur mode migration self-check failed';
  end if;
  if has_function_privilege('anon', 'public.list_live_games(text,uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.list_live_games(text,uuid)', 'EXECUTE')
  then
    raise exception 'Authur live-game access self-check failed';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
