-- Follow-up for deployments that already applied game_archives_migration.sql.
-- Makes state + session commits atomic and rejects delayed draft writes.

begin;

set lock_timeout = '15s';

create or replace function public.sync_live_game_state(
  target_game_id uuid,
  target_state jsonb,
  target_session jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  live public.room_live%rowtype;
  caller_can_configure boolean;
  next_game_mode text := coalesce(target_state ->> 'gameMode', 'versus');
  clean_session jsonb;
begin
  if target_state is null or jsonb_typeof(target_state) <> 'object' then
    raise exception 'live game state must be an object' using errcode = '22023';
  end if;
  if target_session is null or jsonb_typeof(target_session) <> 'object' then
    raise exception 'live game session must be an object' using errcode = '22023';
  end if;
  select * into live from public.room_live where room_id = target_game_id for update;
  if not found or not public.can_write_live_game(target_game_id) then
    raise exception 'live game write access required' using errcode = '42501';
  end if;
  if coalesce(target_state ->> 'status', '') = 'finished' then
    raise exception 'finished games must use finalize_live_game' using errcode = '22023';
  end if;

  caller_can_configure := public.is_admin() or live.owner_id = auth.uid();
  if not caller_can_configure and (
    target_state -> 'name' is distinct from live.state -> 'name'
    or target_state -> 'players' is distinct from live.state -> 'players'
    or target_state -> 'playerMembers' is distinct from live.state -> 'playerMembers'
    or target_state -> 'playerUserIds' is distinct from live.state -> 'playerUserIds'
    or target_state -> 'startingSide' is distinct from live.state -> 'startingSide'
    or target_state -> 'gameMode' is distinct from live.state -> 'gameMode'
    or target_state -> 'botSide' is distinct from live.state -> 'botSide'
    or target_state -> 'botDifficulty' is distinct from live.state -> 'botDifficulty'
  ) then
    raise exception 'players cannot change live game configuration' using errcode = '42501';
  end if;

  clean_session := jsonb_set(
    coalesce(public.sanitize_game_snapshot(target_session), '{}'::jsonb),
    '{actorId}',
    to_jsonb(auth.uid()::text),
    true
  );

  update public.room_live
  set name = case when caller_can_configure
        then coalesce(nullif(btrim(target_state ->> 'name'), ''), name) else name end,
      player_a = case when caller_can_configure
        then coalesce(target_state #>> '{players,A}', player_a) else player_a end,
      player_b = case when caller_can_configure
        then coalesce(target_state #>> '{players,B}', player_b) else player_b end,
      status = case
        when coalesce(target_state ->> 'roomStage', '') = 'waiting' then 'waiting'
        when coalesce(target_state ->> 'status', '') = 'draft' then 'paused'
        else 'playing'
      end,
      game_mode = case when caller_can_configure then next_game_mode else game_mode end,
      mode_key = case when caller_can_configure
        then public.mode_key_from_state(target_state) else mode_key end,
      member_a_id = case when caller_can_configure
        then nullif(target_state #>> '{playerMembers,A}', '') else member_a_id end,
      member_b_id = case when caller_can_configure
        then nullif(target_state #>> '{playerMembers,B}', '') else member_b_id end,
      player_a_user_id = case when caller_can_configure
        then nullif(target_state #>> '{playerUserIds,A}', '')::uuid else player_a_user_id end,
      player_b_user_id = case when caller_can_configure
        then nullif(target_state #>> '{playerUserIds,B}', '')::uuid else player_b_user_id end,
      starting_side = case when caller_can_configure
        then coalesce(target_state ->> 'startingSide', starting_side) else starting_side end,
      turn_number = coalesce((target_state ->> 'turnNumber')::int, turn_number),
      score_a = coalesce((target_state #>> '{scores,A}')::int, score_a),
      score_b = coalesce((target_state #>> '{scores,B}')::int, score_b),
      state = public.sanitize_game_snapshot(target_state),
      actor_id = auth.uid(),
      session = clean_session,
      last_activity_at = now(),
      expires_at = case
        when coalesce(target_state ->> 'roomStage', '') = 'waiting' then now() + interval '24 hours'
        when coalesce(target_state ->> 'status', '') = 'draft' then now() + interval '30 days'
        else null
      end
  where room_id = target_game_id;
end; $$;

revoke all on function public.sync_live_game_state(uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sync_live_game_state(uuid, jsonb, jsonb) to authenticated;

create or replace function public.update_live_game_session(
  target_game_id uuid,
  target_session jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  clean_session jsonb;
begin
  if target_session is null or jsonb_typeof(target_session) <> 'object' then
    raise exception 'live game session must be an object' using errcode = '22023';
  end if;
  if not public.can_write_live_game(target_game_id) then
    raise exception 'live game write access required' using errcode = '42501';
  end if;
  clean_session := jsonb_set(
    coalesce(public.sanitize_game_snapshot(target_session), '{}'::jsonb),
    '{actorId}',
    to_jsonb(auth.uid()::text),
    true
  );
  update public.room_live
  set actor_id = auth.uid(),
      session = clean_session,
      last_activity_at = now()
  where room_id = target_game_id
    and coalesce(session ->> 'updatedAt', '') <= coalesce(clean_session ->> 'updatedAt', '');
  if not found and not exists (
    select 1 from public.room_live where room_id = target_game_id
  ) then
    raise exception 'live game not found' using errcode = 'P0002';
  end if;
end; $$;

revoke all on function public.update_live_game_session(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.update_live_game_session(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
