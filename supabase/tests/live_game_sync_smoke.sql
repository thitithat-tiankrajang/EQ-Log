-- Local/staging-only smoke test for the live state/session write path.
-- Requires game_archives_migration.sql then canonical_revision_migration.sql,
-- and always rolls back.
--
-- Covers room creation, joining an open seat, and draft-session ordering. The
-- commit protocol itself (conditional revisions, idempotency, immutability) is
-- covered by canonical_revision_smoke.sql.

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
  waiting_room record;
  joined record;
  next_state jsonb;
begin
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text,
    true
  );

  -- A waiting room's initial canonical commit must not turn it into a paused
  -- game. The invited side must still be able to use set_room_ready afterward.
  select * into waiting_room
  from public.create_live_game(
    jsonb_build_object(
      'gameId', gen_random_uuid(),
      'name', 'Waiting room ready smoke test',
      'gameMode', 'versus',
      'roomStage', 'waiting',
      'players', jsonb_build_object('A', 'Sync Owner', 'B', 'Sync Player'),
      'playerUserIds', jsonb_build_object('A', owner_id, 'B', player_id),
      'lobbyReadyBySide', jsonb_build_object('A', true),
      'status', 'draft',
      'phase', 'setup',
      'activeSide', 'A',
      'scores', jsonb_build_object('A', 0, 'B', 0),
      'startingSide', 'A',
      'turnNumber', 1
    ),
    'public', 'public', null, 'invite_only', null
  );

  perform public.commit_live_game_command(
    waiting_room.room_id,
    0,
    'smoke-waiting-create',
    'host',
    jsonb_build_object('kind', 'create'),
    jsonb_build_object(
      'turnNumber', 1,
      'activeSide', 'A',
      'status', 'draft',
      'scores', jsonb_build_object('A', 0, 'B', 0)
    ),
    'smoke-digest-waiting',
    (select state from public.room_live where room_id = waiting_room.room_id),
    jsonb_build_object('version', 1, 'actionMode', 'none')
  );

  if (select status from public.room_live where room_id = waiting_room.room_id) <> 'waiting' then
    raise exception 'the initial canonical commit moved a waiting room out of waiting';
  end if;

  perform set_config('request.jwt.claim.sub', player_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', player_id, 'role', 'authenticated')::text,
    true
  );
  perform public.set_room_ready(waiting_room.room_id, 'B', true);
  if not coalesce(
    (select (state #>> '{lobbyReadyBySide,B}')::boolean
     from public.room_live where room_id = waiting_room.room_id),
    false
  ) then
    raise exception 'the invited side could not mark the waiting room ready';
  end if;

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

  perform public.commit_live_game_command(
    bot_room.room_id,
    (select revision from public.room_live where room_id = bot_room.room_id),
    'smoke-bot-turn-2',
    'A',
    jsonb_build_object('kind', 'submit_action'),
    jsonb_build_object('turnNumber', 2, 'activeSide', 'B', 'status', 'playing'),
    'smoke-digest-bot',
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

  perform public.commit_live_game_command(
    versus_room.room_id,
    (select revision from public.room_live where room_id = versus_room.room_id),
    'smoke-player-turn-2',
    'B',
    jsonb_build_object('kind', 'submit_action'),
    jsonb_build_object('turnNumber', 2, 'activeSide', 'B', 'status', 'playing'),
    'smoke-digest-player',
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
