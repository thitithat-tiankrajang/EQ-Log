-- Local/staging-only smoke test for the live state/session write path.
-- Requires game_archives_migration.sql and always rolls back.

begin;

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'sync-owner@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'sync-player@example.test')
on conflict (id) do nothing;

update public.profiles
set status = 'approved',
    display_name = case id
      when '10000000-0000-4000-8000-000000000001' then 'Sync Owner'
      else 'Sync Player'
    end
where id in (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002'
);

do $smoke$
declare
  owner_id constant uuid := '10000000-0000-4000-8000-000000000001';
  player_id constant uuid := '10000000-0000-4000-8000-000000000002';
  bot_room record;
  versus_room record;
  joined record;
  next_state jsonb;
begin
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text,
    true
  );

  select * into bot_room
  from public.create_live_game(
    jsonb_build_object(
      'gameId', gen_random_uuid(),
      'name', 'Bot sync smoke test',
      'gameMode', 'versus',
      'roomStage', 'playing',
      'players', jsonb_build_object('A', 'Sync Owner', 'B', 'Aether'),
      'playerUserIds', jsonb_build_object('A', owner_id),
      'botSide', 'B',
      'botDifficulty', 'medium',
      'status', 'playing',
      'phase', 'choose_action',
      'activeSide', 'A',
      'scores', jsonb_build_object('A', 0, 'B', 0),
      'startingSide', 'A',
      'turnNumber', 1
    ),
    'public',
    'public',
    null,
    'invite_only',
    null
  );

  select state || jsonb_build_object(
    'activeSide', 'B',
    'turnNumber', 2,
    'lastSavedAt', now()
  ) into next_state
  from public.room_live
  where room_id = bot_room.room_id;

  perform public.sync_live_game_state(
    bot_room.room_id,
    next_state,
    jsonb_build_object(
      'version', 1,
      'actorId', owner_id,
      'gameId', next_state ->> 'gameId',
      'turnNumber', 2,
      'activeSide', 'B',
      'actionMode', 'none',
      'pendingPlacements', jsonb_build_array(),
      'updatedAt', now()
    )
  );

  select * into versus_room
  from public.create_live_game(
    jsonb_build_object(
      'gameId', gen_random_uuid(),
      'name', 'Player sync smoke test',
      'gameMode', 'versus',
      'roomStage', 'playing',
      'players', jsonb_build_object('A', 'Sync Owner', 'B', 'Open seat'),
      'playerUserIds', jsonb_build_object('A', owner_id),
      'status', 'playing',
      'phase', 'choose_action',
      'activeSide', 'A',
      'scores', jsonb_build_object('A', 0, 'B', 0),
      'startingSide', 'A',
      'turnNumber', 1
    ),
    'public',
    'public',
    null,
    'open',
    null
  );

  perform set_config('request.jwt.claim.sub', player_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', player_id, 'role', 'authenticated')::text,
    true
  );

  select * into joined
  from public.join_live_game(null, versus_room.room_id);

  if joined.claimed_side is distinct from 'B' then
    raise exception 'open-game join did not claim side B';
  end if;

  select state || jsonb_build_object(
    'activeSide', 'B',
    'turnNumber', 2,
    'lastSavedAt', now()
  ) into next_state
  from public.room_live
  where room_id = versus_room.room_id;

  perform public.sync_live_game_state(
    versus_room.room_id,
    next_state,
    jsonb_build_object(
      'version', 1,
      'actorId', player_id,
      'gameId', next_state ->> 'gameId',
      'turnNumber', 2,
      'activeSide', 'B',
      'actionMode', 'none',
      'pendingPlacements', jsonb_build_array(),
      'updatedAt', now()
    )
  );

  if not exists (
    select 1
    from public.room_live
    where room_id = versus_room.room_id
      and turn_number = 2
      and session ->> 'turnNumber' = '2'
  ) then
    raise exception 'player state/session sync did not persist';
  end if;

  -- A delayed draft must not replace the newer session committed with state.
  perform public.update_live_game_session(
    versus_room.room_id,
    jsonb_build_object(
      'version', 1,
      'actorId', player_id,
      'gameId', next_state ->> 'gameId',
      'turnNumber', 1,
      'activeSide', 'A',
      'actionMode', 'place_equation',
      'pendingPlacements', jsonb_build_array(),
      'updatedAt', '2000-01-01T00:00:00.000Z'
    )
  );

  if exists (
    select 1
    from public.room_live
    where room_id = versus_room.room_id
      and session ->> 'actionMode' = 'place_equation'
  ) then
    raise exception 'a stale draft replaced the committed session';
  end if;
end;
$smoke$;

rollback;
