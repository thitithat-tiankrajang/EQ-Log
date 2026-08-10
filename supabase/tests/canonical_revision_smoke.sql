-- Local/staging-only smoke test for the conditional commit protocol.
-- Requires game_archives_migration.sql then canonical_revision_migration.sql.
-- Always rolls back.
--
-- Proves against a real Postgres what the TypeScript tests prove against the
-- pure reducer: a commit applies only against the revision it was composed on,
-- a retried command id cannot apply twice, the head and the event log move
-- together, history cannot be rewritten, and a reader cannot write.

begin;

insert into auth.users (id, email)
values
  ('20000000-0000-4000-8000-000000000001', 'rev-owner@example.test'),
  ('20000000-0000-4000-8000-000000000002', 'rev-player@example.test'),
  ('20000000-0000-4000-8000-000000000003', 'rev-watcher@example.test')
on conflict (id) do nothing;

update public.profiles
set status = 'approved',
    display_name = 'Revision Tester'
where id in (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003'
);

do $smoke$
declare
  owner_id constant uuid := '20000000-0000-4000-8000-000000000001';
  watcher_id constant uuid := '20000000-0000-4000-8000-000000000003';
  room record;
  result record;
  head record;
  canonical jsonb;
  refused boolean;
begin
  -- Minimal canonical payload: every one of the 100 tiles sitting in the bag.
  select jsonb_build_object(
    'v', 1,
    'revision', 1,
    'turnNumber', 1,
    'activeSide', 'A',
    'phase', 'refill',
    'status', 'playing',
    'scores', jsonb_build_object('A', 0, 'B', 0),
    'inventory', jsonb_agg(jsonb_build_object('at', 'bag', 'seq', seq) order by seq)
  ) into canonical
  from generate_series(0, 99) as seq;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text,
    true
  );

  select * into room
  from public.create_live_game(
    jsonb_build_object(
      'gameId', gen_random_uuid(),
      'name', 'Revision smoke test',
      'gameMode', 'versus',
      'roomStage', 'playing',
      'players', jsonb_build_object('A', 'Revision Tester', 'B', 'Open seat'),
      'playerUserIds', jsonb_build_object('A', owner_id),
      'status', 'playing',
      'phase', 'refill',
      'activeSide', 'A',
      'scores', jsonb_build_object('A', 0, 'B', 0),
      'startingSide', 'A',
      'turnNumber', 1
    ),
    'public', 'public', null, 'open', null
  );

  -- A new game sits at revision 0.
  select * into head from public.room_live where room_id = room.room_id;
  if head.revision <> 0 then
    raise exception 'a new live game should start at revision 0, found %', head.revision;
  end if;

  -- 1) A commit against the current revision is accepted and advances by one.
  select * into result from public.commit_live_game_command(
    room.room_id, 0, 'intent-1', 'A', jsonb_build_object('kind', 'refill'),
    canonical, 'digest-1', head.state, head.session
  );
  if result.outcome <> 'committed' or result.revision <> 1 then
    raise exception 'first commit returned % at revision %', result.outcome, result.revision;
  end if;

  -- The event and the head moved together.
  if not exists (
    select 1 from public.live_game_events
    where game_id = room.room_id and revision = 1 and command_id = 'intent-1'
  ) then
    raise exception 'the committed command was not recorded in the event log';
  end if;
  select * into head from public.room_live where room_id = room.room_id;
  if head.revision <> 1 or head.canonical is null then
    raise exception 'the head did not move with its event';
  end if;

  -- 2) A second writer composed on revision 0 loses, and changes nothing.
  select * into result from public.commit_live_game_command(
    room.room_id, 0, 'intent-2', 'B', jsonb_build_object('kind', 'refill'),
    canonical, 'digest-2', head.state, head.session
  );
  if result.outcome <> 'conflict' or result.revision <> 1 then
    raise exception 'a stale commit returned % at revision %', result.outcome, result.revision;
  end if;
  if exists (select 1 from public.live_game_events where command_id = 'intent-2') then
    raise exception 'a conflicting commit still appended an event';
  end if;

  -- 3) A retry of an already-committed intent is a no-op, not a second move.
  select * into result from public.commit_live_game_command(
    room.room_id, 0, 'intent-1', 'A', jsonb_build_object('kind', 'refill'),
    canonical, 'digest-1', head.state, head.session
  );
  if result.outcome <> 'duplicate' or result.revision <> 1 then
    raise exception 'a retried command returned % at revision %', result.outcome, result.revision;
  end if;
  if (select count(*) from public.live_game_events where game_id = room.room_id) <> 1 then
    raise exception 'a retried command was applied twice';
  end if;

  -- 4) Committed history is immutable.
  refused := false;
  begin
    update public.live_game_events set command_id = 'rewritten'
    where game_id = room.room_id and revision = 1;
  exception when others then
    refused := true;
  end;
  if not refused then
    raise exception 'a committed event could be rewritten';
  end if;

  refused := false;
  begin
    delete from public.live_game_events where game_id = room.room_id and revision = 1;
  exception when others then
    refused := true;
  end;
  if not refused then
    raise exception 'a committed event could be deleted';
  end if;

  -- 5) The unconditional write path is closed.
  refused := false;
  begin
    perform public.sync_live_game_state(room.room_id, head.state, head.session);
  exception when others then
    refused := true;
  end;
  if not refused then
    raise exception 'unconditional state writes are still accepted';
  end if;

  -- 6) A reader cannot advance the game.
  perform set_config('request.jwt.claim.sub', watcher_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', watcher_id, 'role', 'authenticated')::text,
    true
  );
  refused := false;
  begin
    perform public.commit_live_game_command(
      room.room_id, 1, 'intent-watcher', 'A', jsonb_build_object('kind', 'refill'),
      canonical, 'digest-3', null, null
    );
  exception when others then
    refused := true;
  end;
  if not refused then
    raise exception 'a spectator was able to commit a move';
  end if;

  -- ...but can read the canonical head and the deltas it is missing.
  if not exists (select 1 from public.get_live_game_snapshot(room.room_id)) then
    raise exception 'a spectator could not read the canonical snapshot';
  end if;
  if (select count(*) from public.list_live_game_events(room.room_id, 0, 200)) <> 1 then
    raise exception 'a spectator could not read the committed deltas';
  end if;
  if (select count(*) from public.list_live_game_events(room.room_id, 1, 200)) <> 0 then
    raise exception 'gap filling returned deltas the caller already had';
  end if;
end;
$smoke$;

rollback;
