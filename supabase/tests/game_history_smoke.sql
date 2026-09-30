-- Isolated local Supabase only. Rolls back every fixture.
begin;

create function pg_temp.expect(ok boolean, message text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception '%', message; end if; end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin execute 'reset role'; end $$;
grant execute on function pg_temp.expect(boolean, text), pg_temp.as_user(uuid),
  pg_temp.as_owner() to authenticated;

insert into auth.users (id, email, aud, role) values
  ('71000000-0000-4000-8000-000000000001', 'history-a@example.test', 'authenticated', 'authenticated'),
  ('71000000-0000-4000-8000-000000000002', 'history-b@example.test', 'authenticated', 'authenticated'),
  ('71000000-0000-4000-8000-000000000003', 'history-host@example.test', 'authenticated', 'authenticated'),
  ('71000000-0000-4000-8000-000000000004', 'history-spectator@example.test', 'authenticated', 'authenticated');
update public.profiles set status = 'approved'
  where id::text like '71000000-0000-4000-8000-00000000000%';

-- A Hosted owner is neither seated player. The normal legacy finalizer is
-- still the terminal authority; its History wrapper must use frozen seats.
insert into public.room_live (
  room_id, owner_id, name, player_a, player_b, status, access_scope,
  archive_policy, join_policy, room_code_hash, game_mode, mode_key,
  player_a_user_id, player_b_user_id, starting_side, turn_number,
  score_a, score_b, state, created_at, last_activity_at
) values (
  '71000000-0000-4000-8000-000000000010',
  '71000000-0000-4000-8000-000000000003',
  'Hosted terminal', 'Player A', 'Player B', 'playing', 'public', 'public',
  'open', repeat('a', 64), 'versus', 'hosted_versus',
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000002',
  'A', 2, 0, 0,
  '{"v":3,"status":"playing","scores":{"A":0,"B":0}}', now(), now()
);

select pg_temp.as_user('71000000-0000-4000-8000-000000000003');
select * from public.finalize_live_game(
  '71000000-0000-4000-8000-000000000010',
  '{"v":3,"status":"finished","scores":{"A":19,"B":12},"playerUserIds":{"A":"71000000-0000-4000-8000-000000000004","B":"71000000-0000-4000-8000-000000000003"}}',
  'terminated', 'manual', null
);
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = 2 from public.game_history
  where source_id = '71000000-0000-4000-8000-000000000010'),
  'normal terminal did not create exactly two participant rows');
select pg_temp.expect(not exists (select 1 from public.game_history
  where participant_id in ('71000000-0000-4000-8000-000000000003',
                           '71000000-0000-4000-8000-000000000004')),
  'Host or spectator gained History ownership');
select pg_temp.expect((select outcome = 'win' and score_for = 19 and score_against = 12
  from public.game_history where source_id = '71000000-0000-4000-8000-000000000010'
    and participant_side = 'A'), 'normal result summary drifted');
select pg_temp.expect((select outcome = 'loss' and score_for = 12 and score_against = 19
  from public.game_history where source_id = '71000000-0000-4000-8000-000000000010'
    and participant_side = 'B'), 'opponent result summary drifted');
select pg_temp.expect(public.history_normal_outcome('versus', 'A', 1, 99, 'B') = 'win',
  'surrender result did not match player-result semantics');

-- A retry leaves the immutable pair untouched.
select pg_temp.as_user('71000000-0000-4000-8000-000000000001');
select * from public.finalize_live_game(
  '71000000-0000-4000-8000-000000000010',
  '{"v":3,"status":"finished","scores":{"A":19,"B":12}}',
  'terminated', 'manual', null
);
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = 2 from public.game_history
  where source_id = '71000000-0000-4000-8000-000000000010'),
  'duplicate terminal created duplicate History');

-- Retention disabled: completion still writes History, including a Host retry
-- despite the Host not being a History participant.
insert into public.room_live (
  room_id, owner_id, name, player_a, player_b, status, access_scope,
  archive_policy, join_policy, room_code_hash, game_mode, mode_key,
  player_a_user_id, player_b_user_id, starting_side, turn_number,
  score_a, score_b, state, created_at, last_activity_at
) values (
  '71000000-0000-4000-8000-000000000012',
  '71000000-0000-4000-8000-000000000003',
  'No replay', 'Player A', 'Player B', 'playing', 'public', 'none',
  'open', repeat('b', 64), 'versus', 'hosted_versus',
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000002',
  'A', 2, 0, 0,
  '{"v":3,"status":"playing","scores":{"A":0,"B":0}}', now(), now()
);
select pg_temp.as_user('71000000-0000-4000-8000-000000000003');
select * from public.finalize_live_game(
  '71000000-0000-4000-8000-000000000012',
  '{"v":3,"status":"finished","scores":{"A":9,"B":7}}',
  'terminated', 'manual', null
);
select * from public.finalize_live_game(
  '71000000-0000-4000-8000-000000000012',
  '{"v":3,"status":"finished","scores":{"A":9,"B":7}}',
  'terminated', 'manual', null
);
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = 2 from public.game_history
  where source_id = '71000000-0000-4000-8000-000000000012'),
  'no-replay terminal did not create durable History');
select pg_temp.expect(not exists (select 1 from public.public_game_snapshots
  where game_id = '71000000-0000-4000-8000-000000000012'),
  'no-replay terminal unexpectedly saved payload');

-- A Private replay slot disappears before finish. The legacy archive insert
-- fails its quota check, but the accepted result and permanent History commit.
insert into public.room_live (
  room_id, owner_id, name, player_a, player_b, status, access_scope,
  archive_policy, join_policy, room_code_hash, game_mode, mode_key,
  player_a_user_id, starting_side, turn_number, score_a, score_b,
  state, created_at, last_activity_at
) values (
  '71000000-0000-4000-8000-000000000013',
  '71000000-0000-4000-8000-000000000001',
  'Private no space', 'Player A', '', 'playing', 'private', 'private',
  'invite_only', repeat('c', 64), 'solo', 'solo_practice',
  '71000000-0000-4000-8000-000000000001',
  'A', 2, 0, 0, '{"v":3,"status":"playing","scores":{"A":0,"B":0}}', now(), now()
);
insert into public.system_settings (key, value_int) values ('private_board_limit', 0)
  on conflict (key) do update set value_int = 0;
select pg_temp.as_user('71000000-0000-4000-8000-000000000001');
select * from public.finalize_live_game(
  '71000000-0000-4000-8000-000000000013',
  '{"v":3,"status":"finished","scores":{"A":17,"B":0}}',
  'terminated', 'manual', null
);
select pg_temp.as_owner();
select pg_temp.expect((select score_for = 17 from public.game_history
  where source_id = '71000000-0000-4000-8000-000000000013'),
  'full Private library blocked History');
select pg_temp.expect((select games_played = 1 and solo_score = 17 from public.user_mode_stats
  where profile_id = '71000000-0000-4000-8000-000000000001'
    and mode_key = 'solo_practice'), 'quota fallback lost existing stats semantics');
select pg_temp.expect(not exists (select 1 from public.private_library_items
  where source_game_id = '71000000-0000-4000-8000-000000000013'),
  'quota fallback saved replay despite no capacity');

-- Ranked result authority inserts both players within its result transaction.
insert into public.ranked_matches (
  id, player_a_id, player_b_id, status, revision, minutes_a, minutes_b, state
) values (
  '71000000-0000-4000-8000-000000000011',
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000002',
  'finished', 2, 10, 10, '{"players":{"A":"Player A","B":"Player B"}}'
);
insert into public.ranked_results (
  match_id, player_a_id, player_b_id, winner_id, reason, score_a, score_b,
  rating_a_before, rating_b_before, rating_a_after, rating_b_after
) values (
  '71000000-0000-4000-8000-000000000011',
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000002',
  '71000000-0000-4000-8000-000000000002', 'score', 8, 22,
  1000, 1000, 984, 1016
);
select pg_temp.expect((select count(*) = 2 from public.game_history
  where source_kind = 'ranked' and source_id = '71000000-0000-4000-8000-000000000011'),
  'Ranked result did not create both History rows');
-- Simulate a result predating this migration; the service backfill must restore
-- exactly the same two participant rows without touching the result or rating.
delete from public.game_history
 where source_kind = 'ranked' and source_id = '71000000-0000-4000-8000-000000000011';

-- Old advisory Stage result is backfilled as advisory, without replay.
insert into public.survival_levels (
  id, season_key, level_no, seed, reference_key, sample_policy,
  sample_count, win_count
) values ('71000000-0000-4000-8000-000000000020', 'history-smoke', 1, 23,
  'endgame-v1', 'history', 3, 0);
insert into public.survival_attempts (
  id, level_id, room_id, player_id, finished_at, player_score, authur_score, result
) values (
  '71000000-0000-4000-8000-000000000021',
  '71000000-0000-4000-8000-000000000020',
  '71000000-0000-4000-8000-000000000022',
  '71000000-0000-4000-8000-000000000001', now(), 4, 9, 'loss'
);

-- Captured Stage uses the server-created completed-attempt row and keeps its
-- honest client-state provenance.
insert into public.survival_attempts (
  id, level_id, room_id, player_id, finished_at, player_score, authur_score, result
) values (
  '71000000-0000-4000-8000-000000000023',
  '71000000-0000-4000-8000-000000000020',
  '71000000-0000-4000-8000-000000000024',
  '71000000-0000-4000-8000-000000000001', now(), 25, 10, 'win'
);
insert into public.stage_completed_attempts (
  attempt_id, room_id, player_id, level_id, source_revision,
  completion_kind, completion_reason, outcome, score_a, score_b,
  rules_version, record_digest, record
) values (
  '71000000-0000-4000-8000-000000000023',
  '71000000-0000-4000-8000-000000000024',
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000020', 1,
  'terminated', 'manual', 'win', 25, 10,
  'eq-lab-840ef0e', repeat('a', 64), '{"format":1,"corrupt":"test"}'
);
select pg_temp.expect((select result_authority = 'captured_client_state'
  from public.game_history where source_id = '71000000-0000-4000-8000-000000000023'),
  'captured Stage provenance was lost');

-- Legacy archive backfill reads frozen listing metadata, never its payload.
insert into public.public_game_snapshots (
  game_id, source_owner_id, name, player_a, player_b, game_mode, mode_key,
  player_a_user_id, player_b_user_id, score_a, score_b,
  completion_kind, completion_reason, snapshot, created_at, finished_at
) values (
  '71000000-0000-4000-8000-000000000030',
  '71000000-0000-4000-8000-000000000003', 'Old public game',
  'Old A', 'Old B', 'versus', 'online_versus',
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000002', 3, 3,
  'natural', 'rack_out', '{"v":2,"history_missing":true}', now(), now()
);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select * from public.backfill_game_history_page('public', null, 1000);
select * from public.backfill_game_history_page('ranked', null, 1000);
select * from public.backfill_game_history_page('stage', null, 1000);
select * from public.backfill_game_history_page('public', null, 1000);
select pg_temp.expect((select count(*) = 2 from public.game_history
  where source_kind = 'ranked' and source_id = '71000000-0000-4000-8000-000000000011'),
  'legacy Ranked result was not backfilled');
select pg_temp.expect((select count(*) = 2 from public.game_history
  where source_id = '71000000-0000-4000-8000-000000000030'),
  'legacy archive backfill was not idempotent');
select pg_temp.expect((select result_authority = 'advisory'
  from public.game_history where source_id = '71000000-0000-4000-8000-000000000021'),
  'old Stage result was invented as trusted');

-- Per-user listing, stable cursor, no raw payload, and replay state derived
-- from current storage. A corrupt stored replay cannot corrupt History.
select pg_temp.as_user('71000000-0000-4000-8000-000000000001');
select pg_temp.expect((select count(*) = 2 from public.list_my_game_history(2)),
  'first page not limited');
select pg_temp.expect((select count(*) = 0 from public.list_my_game_history(
  2, '2000-01-01T00:00:00Z', 'normal',
  '00000000-0000-4000-8000-000000000000')),
  'pagination cursor did not advance');
do $$ begin
  begin
    perform public.list_my_game_history(20, now(), null, null);
    raise exception 'malformed History cursor was accepted';
  exception when sqlstate '22023' then null;
  end;
end $$;
select pg_temp.expect((select replay_availability = 'unsupported_legacy'
  from public.list_my_game_history(20) where source_id = '71000000-0000-4000-8000-000000000021'),
  'old Stage advertised fabricated replay');
select pg_temp.expect((select replay_availability = 'legacy_partial'
  from public.list_my_game_history(20) where source_id = '71000000-0000-4000-8000-000000000030'),
  'face-only old game advertised full replay');
select pg_temp.expect((select replay_availability = 'compact_available'
  from public.list_my_game_history(20) where source_id = '71000000-0000-4000-8000-000000000023'),
  'captured Stage replay not listed');
select pg_temp.as_owner();
delete from public.public_game_snapshots
  where game_id = '71000000-0000-4000-8000-000000000010';
select pg_temp.as_user('71000000-0000-4000-8000-000000000001');
select pg_temp.expect((select replay_availability = 'unavailable'
  from public.list_my_game_history(20) where source_id = '71000000-0000-4000-8000-000000000010'),
  'pruned replay removed or mislabeled History');
select pg_temp.as_user('71000000-0000-4000-8000-000000000004');
select pg_temp.expect((select count(*) = 0 from public.list_my_game_history(20)),
  'spectator enumerated private History');
select pg_temp.as_owner();

-- Thirty same-time rows exercise the tuple tie-breaker and a representative
-- 20-item page without loading any replay column.
insert into public.game_history (
  source_kind, source_id, participant_id, game_id, participant_side,
  game_name, mode_key, game_mode, score_for, score_against, outcome,
  completed_at, result_authority
)
select 'normal', md5('history-page-' || n::text)::uuid,
  '71000000-0000-4000-8000-000000000001',
  md5('history-page-' || n::text)::uuid,
  'A', 'Page game ' || n::text, 'solo_practice', 'solo', n, null, null,
  '2026-09-29T12:00:00Z'::timestamptz, 'client_reported'
from generate_series(1, 30) n;
select pg_temp.as_user('71000000-0000-4000-8000-000000000001');
do $pages$
declare cursor_row record; first_ids uuid[]; second_ids uuid[];
begin
  select array_agg(source_id order by completed_at desc, source_kind desc, source_id desc)
    into first_ids from public.list_my_game_history(20);
  select * into cursor_row from public.list_my_game_history(20)
    order by completed_at, source_kind, source_id limit 1;
  select array_agg(source_id) into second_ids from public.list_my_game_history(
    20, cursor_row.completed_at, cursor_row.source_kind, cursor_row.source_id);
  if cardinality(first_ids) <> 20 or cardinality(second_ids) < 10 or
     first_ids && second_ids then
    raise exception 'History pagination repeated or skipped a tied row';
  end if;
end $pages$;
select pg_temp.as_owner();

do $$
begin
  if has_table_privilege('authenticated', 'public.game_history', 'SELECT')
     or has_table_privilege('authenticated', 'public.game_history', 'INSERT')
     or has_table_privilege('authenticated', 'public.game_history', 'UPDATE')
     or has_table_privilege('anon', 'public.game_history', 'SELECT')
     or not has_function_privilege('authenticated',
       'public.list_my_game_history(integer,timestamptz,text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.backfill_game_history_page(text,uuid,integer)', 'EXECUTE') then
    raise exception 'History permissions are unsafe';
  end if;
  raise notice 'game History smoke passed';
end $$;

select count(*) as fixture_history_rows,
       round(avg(pg_column_size(h))) as average_row_bytes
  from public.game_history h;
select pg_temp.as_user('71000000-0000-4000-8000-000000000001');
select octet_length(coalesce(json_agg(row_to_json(p))::text, '[]')) as page_json_bytes
  from public.list_my_game_history(20) p;
select pg_temp.as_owner();
explain (analyze, buffers)
select source_kind, source_id, completed_at from public.game_history
 where participant_id = '71000000-0000-4000-8000-000000000001'
 order by completed_at desc, source_kind desc, source_id desc limit 20;
rollback;
