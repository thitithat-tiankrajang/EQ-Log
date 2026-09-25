-- Local/staging-only smoke test for parked lines (supabase/multiverse_timeline_migration.sql).
-- Requires game_archives_migration.sql, canonical_revision_migration.sql and the multiverse
-- migration. Always rolls back.
--
-- Proves against a real Postgres what tests/multiverse.test.ts proves against the pure model:
-- a branch moves the position and the parked lines together or not at all; a stale document or
-- a stale revision changes nothing; a retry is recognized; readers can study lines but never
-- write them; pruning only removes; finishing the game carries the lines into its archive and
-- leaves nothing behind; and a stranger cannot pull somebody else's lines into their library.

begin;

insert into auth.users (id, email)
values
  ('30000000-0000-4000-8000-000000000001', 'mv-owner@example.test'),
  ('30000000-0000-4000-8000-000000000002', 'mv-watcher@example.test'),
  ('30000000-0000-4000-8000-000000000003', 'mv-stranger@example.test')
on conflict (id) do nothing;

update public.profiles
set status = 'approved',
    display_name = case id
      when '30000000-0000-4000-8000-000000000001' then 'Multiverse Owner'
      else 'Multiverse Watcher'
    end
where id in ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002');
-- The stranger stays pending: not an approved member, so not a reader of public games.

do $smoke$
declare
  owner_id constant uuid := '30000000-0000-4000-8000-000000000001';
  watcher_id constant uuid := '30000000-0000-4000-8000-000000000002';
  stranger_id constant uuid := '30000000-0000-4000-8000-000000000003';
  room record;
  other record;
  head record;
  result record;
  stored record;
  canonical jsonb;
  one_line jsonb;
  two_lines jsonb;
  refused boolean;
  visible bigint;
  archived jsonb;
begin
  select jsonb_build_object(
    'v', 1, 'revision', 1, 'turnNumber', 1, 'activeSide', 'A', 'phase', 'refill',
    'status', 'playing', 'scores', jsonb_build_object('A', 0, 'B', 0),
    'inventory', jsonb_agg(jsonb_build_object('at', 'bag', 'seq', seq) order by seq)
  ) into canonical
  from generate_series(0, 99) as seq;

  -- Two tiny documents. The database checks their outline, not their turns.
  one_line := jsonb_build_object('v', 1, 'version', 0, 'lines', jsonb_build_array(
    jsonb_build_object('id', 'l1', 'from', null, 'at', '2026-01-01T00:00:00Z',
      'logs', jsonb_build_array(jsonb_build_object('id', 't-1')), 'after', jsonb_build_array(0),
      'tip', 'last')
  ));
  two_lines := jsonb_set(one_line, '{lines}', (one_line -> 'lines') || jsonb_build_array(
    jsonb_build_object('id', 'l2', 'from', 't-1', 'at', '2026-01-01T00:00:00Z',
      'logs', jsonb_build_array(jsonb_build_object('id', 't-2'), jsonb_build_object('id', 't-3')),
      'after', jsonb_build_array(0, 0), 'tip', 'last')
  ));

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text, true);

  select * into room from public.create_live_game(
    jsonb_build_object(
      'gameId', gen_random_uuid(), 'name', 'Multiverse smoke test', 'gameMode', 'versus',
      'roomStage', 'playing', 'players', jsonb_build_object('A', 'Owner', 'B', 'Open seat'),
      'playerUserIds', jsonb_build_object('A', owner_id), 'status', 'playing',
      'phase', 'refill', 'activeSide', 'A', 'scores', jsonb_build_object('A', 0, 'B', 0),
      'startingSide', 'A', 'turnNumber', 1
    ),
    'public', 'public', null, 'open', null
  );
  select * into head from public.room_live where room_id = room.room_id;

  -- 1) A branch lands the position and the parked lines together.
  select * into result from public.commit_live_game_timeline(
    room.room_id, head.revision, 'branch-1', 'host', jsonb_build_object('kind', 'timeline'),
    canonical, 'digest-1',
    jsonb_set(head.state, '{timelineRef}', jsonb_build_object('version', 1, 'lines', 1)),
    head.session, one_line, 0
  );
  if result.outcome <> 'committed' or result.revision <> head.revision + 1
    or result.timeline_version <> 1
  then
    raise exception 'first branch returned % / r% / v%',
      result.outcome, result.revision, result.timeline_version;
  end if;
  select * into stored from public.game_timelines where game_id = room.room_id;
  if stored.version <> 1 or stored.line_count <> 1 or stored.node_count <> 1
    or (stored.doc ->> 'version') <> '1'
  then
    raise exception 'the stored document does not match the branch: %', row_to_json(stored);
  end if;
  select * into head from public.room_live where room_id = room.room_id;
  if (head.state #>> '{timelineRef,version}') <> '1' then
    raise exception 'the live position does not name the document it was committed with';
  end if;

  -- 2) Retrying the same branch is recognized, not applied twice.
  select * into result from public.commit_live_game_timeline(
    room.room_id, head.revision - 1, 'branch-1', 'host', jsonb_build_object('kind', 'timeline'),
    canonical, 'digest-1',
    jsonb_set(head.state, '{timelineRef}', jsonb_build_object('version', 1, 'lines', 1)),
    head.session, one_line, 0
  );
  if result.outcome <> 'duplicate' or result.timeline_version <> 1 then
    raise exception 'a retried branch returned % / v%', result.outcome, result.timeline_version;
  end if;

  -- 3) A branch built on an older document changes nothing.
  select * into result from public.commit_live_game_timeline(
    room.room_id, head.revision, 'branch-stale-doc', 'host', jsonb_build_object('kind', 'timeline'),
    canonical, 'digest-2',
    jsonb_set(head.state, '{timelineRef}', jsonb_build_object('version', 1, 'lines', 2)),
    head.session, two_lines, 0
  );
  if result.outcome <> 'timeline_conflict' or result.timeline_version <> 1 then
    raise exception 'a stale document returned % / v%', result.outcome, result.timeline_version;
  end if;
  if exists (select 1 from public.live_game_events where command_id = 'branch-stale-doc') then
    raise exception 'a refused branch still moved the game';
  end if;

  -- 4) A branch built on an older position changes nothing either — not even the document.
  select * into result from public.commit_live_game_timeline(
    room.room_id, head.revision - 1, 'branch-stale-revision', 'host',
    jsonb_build_object('kind', 'timeline'), canonical, 'digest-3',
    jsonb_set(head.state, '{timelineRef}', jsonb_build_object('version', 2, 'lines', 2)),
    head.session, two_lines, 1
  );
  if result.outcome <> 'conflict' then
    raise exception 'a stale position returned %', result.outcome;
  end if;
  select * into stored from public.game_timelines where game_id = room.room_id;
  if stored.version <> 1 or stored.line_count <> 1 then
    raise exception 'a refused branch rewrote the parked lines';
  end if;

  -- 5) A position that does not name the document it lands with is refused.
  refused := false;
  begin
    perform public.commit_live_game_timeline(
      room.room_id, head.revision, 'branch-bad-ref', 'host', jsonb_build_object('kind', 'timeline'),
      canonical, 'digest-4',
      jsonb_set(head.state, '{timelineRef}', jsonb_build_object('version', 9, 'lines', 2)),
      head.session, two_lines, 1
    );
  exception when sqlstate '22023' then
    refused := true;
  end;
  if not refused then raise exception 'a mismatched timelineRef was accepted'; end if;

  -- 6) A malformed document is refused before anything moves.
  refused := false;
  begin
    perform public.commit_live_game_timeline(
      room.room_id, head.revision, 'branch-bad-doc', 'host', jsonb_build_object('kind', 'timeline'),
      canonical, 'digest-5',
      jsonb_set(head.state, '{timelineRef}', jsonb_build_object('version', 2, 'lines', 1)),
      head.session,
      jsonb_build_object('v', 1, 'lines', jsonb_build_array(jsonb_build_object('id', 'empty'))),
      1
    );
  exception when sqlstate '22023' then
    refused := true;
  end;
  if not refused then raise exception 'a line without turns was accepted'; end if;

  -- 7) A second branch parks two lines.
  select * into result from public.commit_live_game_timeline(
    room.room_id, head.revision, 'branch-2', 'host', jsonb_build_object('kind', 'timeline'),
    canonical, 'digest-6',
    jsonb_set(head.state, '{timelineRef}', jsonb_build_object('version', 2, 'lines', 2)),
    head.session, two_lines, 1
  );
  if result.outcome <> 'committed' or result.timeline_version <> 2 then
    raise exception 'second branch returned % / v%', result.outcome, result.timeline_version;
  end if;

  -- 8) Pruning removes whole lines and nothing else.
  refused := false;
  begin
    perform public.update_live_game_timeline(
      room.room_id,
      jsonb_set(two_lines, '{lines,0,id}', '"edited"'::jsonb),
      2
    );
  exception when sqlstate '22023' then
    refused := true;
  end;
  if not refused then raise exception 'pruning could edit a parked line'; end if;

  select * into result from public.update_live_game_timeline(room.room_id, one_line, 1);
  if result.outcome <> 'timeline_conflict' then
    raise exception 'pruning an older document returned %', result.outcome;
  end if;

  select * into result from public.update_live_game_timeline(room.room_id, one_line, 2);
  if result.outcome <> 'committed' or result.timeline_version <> 3 then
    raise exception 'pruning returned % / v%', result.outcome, result.timeline_version;
  end if;
  select * into stored from public.game_timelines where game_id = room.room_id;
  if stored.line_count <> 1 or stored.node_count <> 1 or (stored.doc ->> 'version') <> '3' then
    raise exception 'pruning left the wrong lines: %', row_to_json(stored);
  end if;

  -- 9) Readers study, never write. RLS is only real under the API role.
  perform set_config('request.jwt.claim.sub', watcher_id::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', watcher_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into visible from public.game_timelines where game_id = room.room_id;
  if visible <> 1 then raise exception 'a spectator could not read the parked lines'; end if;
  refused := false;
  begin
    perform public.commit_live_game_timeline(
      room.room_id, head.revision + 1, 'branch-watcher', 'host',
      jsonb_build_object('kind', 'timeline'), canonical, 'digest-7',
      jsonb_set(head.state, '{timelineRef}', jsonb_build_object('version', 4, 'lines', 1)),
      head.session, one_line, 3
    );
  exception when sqlstate '42501' then
    refused := true;
  end;
  if not refused then raise exception 'a spectator could branch the game'; end if;
  refused := false;
  begin
    perform public.update_live_game_timeline(room.room_id,
      jsonb_set(one_line, '{lines}', '[]'::jsonb), 3);
  exception when sqlstate '42501' then
    refused := true;
  end;
  if not refused then raise exception 'a spectator could prune the game'; end if;
  refused := false;
  begin
    delete from public.game_timelines where game_id = room.room_id;
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then raise exception 'a spectator could delete parked lines directly'; end if;
  reset role;

  perform set_config('request.jwt.claim.sub', stranger_id::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', stranger_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into visible from public.game_timelines where game_id = room.room_id;
  if visible <> 0 then raise exception 'a non-member could read the parked lines'; end if;
  reset role;

  set local role anon;
  refused := false;
  begin
    perform 1 from public.game_timelines;
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then raise exception 'anon could read parked lines'; end if;
  reset role;

  -- 10) A second live game, to try to steal from.
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  select * into other from public.create_live_game(
    jsonb_build_object(
      'gameId', gen_random_uuid(), 'name', 'Someone else''s game', 'gameMode', 'versus',
      'roomStage', 'playing', 'players', jsonb_build_object('A', 'Owner', 'B', 'Open seat'),
      'playerUserIds', jsonb_build_object('A', owner_id), 'status', 'playing',
      'phase', 'refill', 'activeSide', 'A', 'scores', jsonb_build_object('A', 0, 'B', 0),
      'startingSide', 'A', 'turnNumber', 1
    ),
    'public', 'public', null, 'open', null
  );
  select * into head from public.room_live where room_id = other.room_id;
  select * into result from public.commit_live_game_timeline(
    other.room_id, head.revision, 'other-branch', 'host', jsonb_build_object('kind', 'timeline'),
    canonical, 'digest-8',
    jsonb_set(head.state, '{timelineRef}', jsonb_build_object('version', 1, 'lines', 2)),
    head.session, two_lines, 0
  );
  if result.outcome <> 'committed' then raise exception 'setting up the second game failed'; end if;

  -- Members may create folders directly, but never a game item: those are written only by trusted
  -- functions. So act as such a function would — privileged, on the watcher's behalf — and check
  -- the trigger's own guard as well.
  perform set_config('request.jwt.claim.sub', watcher_id::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', watcher_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  refused := false;
  begin
    insert into public.private_library_items (
      owner_id, item_type, name, game_id, game_mode, mode_key, completion_kind,
      completion_reason, snapshot
    ) values (
      watcher_id, 'game', 'Direct insert', other.room_id, 'versus', 'local_versus',
      'terminated', 'manual', '{}'::jsonb
    );
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then raise exception 'members can insert game items directly'; end if;
  reset role;
  insert into public.private_library_items (
    owner_id, item_type, name, source_scope, source_game_id, game_id, game_mode, mode_key,
    completion_kind, completion_reason, turn_number, score_a, score_b, snapshot
  ) values (
    watcher_id, 'game', 'Not mine', 'private', other.room_id, other.room_id, 'versus',
    'local_versus', 'terminated', 'manual', 1, 0, 0, '{}'::jsonb
  );
  select item.snapshot into archived from public.private_library_items item
   where item.owner_id = watcher_id and item.game_id = other.room_id;
  if archived ? 'timeline' then
    raise exception 'a stranger pulled another game''s parked lines into their library';
  end if;

  -- 11) Finishing carries the lines into the archive, then removes them with the live game.
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  select * into head from public.room_live where room_id = room.room_id;
  perform public.finalize_live_game(
    room.room_id,
    jsonb_set(head.state, '{status}', '"finished"'::jsonb, true),
    'terminated', 'manual', null
  );
  select snapshot into archived from public.public_game_snapshots where game_id = room.room_id;
  if archived is null or not (archived ? 'timeline')
    or jsonb_array_length(archived #> '{timeline,lines}') <> 1
    or (archived #>> '{timeline,version}') <> '3'
  then
    raise exception 'the archive did not keep the parked lines: %', archived -> 'timeline';
  end if;
  if exists (select 1 from public.game_timelines where game_id = room.room_id) then
    raise exception 'finishing left the parked lines behind';
  end if;

  -- 12) Cancelling a game drops its lines with it, and archives nothing.
  perform public.cancel_live_game(other.room_id);
  if exists (select 1 from public.game_timelines where game_id = other.room_id) then
    raise exception 'cancelling left the parked lines behind';
  end if;
end;
$smoke$;

rollback;
