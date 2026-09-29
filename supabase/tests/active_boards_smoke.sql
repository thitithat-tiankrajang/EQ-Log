-- Local/staging-only smoke test for the Phase 3 active-board limit.
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/active_boards_smoke.sql
-- Every path that can give a user a board: create, invite/seat, join,
-- re-open, re-seat, Ranked. Concurrency is in phase3_race.sh. Rolls back.

begin;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role service_role';
end $$;
create function pg_temp.act_as_owner() returns void language plpgsql as $$
begin execute 'reset role'; end $$;
create function pg_temp.expect(label text, actual anyelement, expected anyelement) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then raise exception '%: expected %, got %', label, expected, actual; end if;
end $$;
create function pg_temp.boards(u uuid) returns int language sql security definer as $$
  select public.active_board_count(u, clock_timestamp(), null, null)
$$;
-- A solo practice room: the creator is seated, so it is one board.
create function pg_temp.solo() returns uuid language sql as $$
  select room_id from public.create_live_game('{"name":"solo","gameMode":"solo","players":{"A":"Me"}}',
    'public', 'public', null, 'invite_only', null)
$$;
create function pg_temp.refused(sql text, pattern text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'EXPECTED refusal: %', sql;
exception when others then
  if sqlerrm not like pattern then raise; end if;
end $$;
create function pg_temp.ranked_state() returns jsonb language sql as $$
  select '{"status":"waiting"}'::jsonb
$$;

insert into private.runtime_secrets (key, value) values ('room_code_secret', repeat('s', 40))
on conflict (key) do nothing;
insert into auth.users (id, email, aud, role)
select ('00000000-0000-4000-8000-0000000007' || lpad(n::text, 2, '0'))::uuid,
       'boards-' || n || '@example.test', 'authenticated', 'authenticated'
  from generate_series(1, 12) n;
update public.profiles set status = 'approved' where id::text like '00000000-0000-4000-8000-0000000007%';
update public.profiles set is_admin = true where id = '00000000-0000-4000-8000-000000000701';

-- The global default EXECUTE revoke protects future public functions; these
-- transaction-local test helpers opt in for the roles exercising them.
grant execute on function pg_temp.act_as(uuid), pg_temp.act_as_service(),
  pg_temp.act_as_owner(), pg_temp.expect(text, anyelement, anyelement),
  pg_temp.boards(uuid), pg_temp.solo(), pg_temp.refused(text, text),
  pg_temp.ranked_state() to authenticated, service_role;

do $boards$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000701';
  host constant uuid := '00000000-0000-4000-8000-000000000702';
  p1 constant uuid := '00000000-0000-4000-8000-000000000703';
  p2 constant uuid := '00000000-0000-4000-8000-000000000704';
  joiner constant uuid := '00000000-0000-4000-8000-000000000705';
  heavy constant uuid := '00000000-0000-4000-8000-000000000706';
  ranker constant uuid := '00000000-0000-4000-8000-000000000707';
  ranker2 constant uuid := '00000000-0000-4000-8000-000000000708';
  mover constant uuid := '00000000-0000-4000-8000-000000000709';
  bot_player constant uuid := '00000000-0000-4000-8000-000000000710';
  hosted record;
  open_room record;
  rooms uuid[];
  r uuid;
  code text;
  committed record;
begin
  perform pg_temp.expect('limit', public.active_board_limit(), 3);

  -- ── A Host who is not seated holds no board; the seated players do ───────
  perform pg_temp.act_as(host);
  select * into hosted from public.create_live_game(
    jsonb_build_object('name', 'hosted', 'gameMode', 'versus', 'emailPlayMode', 'hosted',
      'players', jsonb_build_object('A', 'P1', 'B', 'P2'),
      'playerUserIds', jsonb_build_object('A', p1, 'B', p2)),
    'public', 'public', null, 'invite_only', null);
  perform pg_temp.expect('host not counted', pg_temp.boards(host), 0);
  perform pg_temp.expect('seated player A', pg_temp.boards(p1), 1);
  perform pg_temp.expect('seated player B', pg_temp.boards(p2), 1);

  -- ── Being seated by someone else at the limit is refused ─────────────────
  perform pg_temp.act_as(p1);
  perform pg_temp.solo();
  perform pg_temp.solo();
  perform pg_temp.expect('p1 at the limit', pg_temp.boards(p1), 3);
  perform pg_temp.refused('select pg_temp.solo()', 'active_board_limit:%');
  perform pg_temp.act_as(host);
  perform pg_temp.refused(format($q$select * from public.create_live_game(
      jsonb_build_object('name','h2','gameMode','versus','emailPlayMode','hosted',
        'players', jsonb_build_object('A','P1','B','J'),
        'playerUserIds', jsonb_build_object('A', %L::text, 'B', %L::text)),
      'public','public',null,'invite_only',null)$q$, p1, joiner), 'active_board_limit: a seated player%');
  perform pg_temp.expect('nothing created for the refused invite', pg_temp.boards(joiner), 0);

  -- ── Swapping seats between users who already hold the board is not new ───
  perform public.update_live_game_state(hosted.room_id,
    jsonb_build_object('name','hosted','gameMode','versus','emailPlayMode','hosted',
      'players', jsonb_build_object('A','P2','B','P1'),
      'playerUserIds', jsonb_build_object('A', p2::text, 'B', p1::text)));
  perform pg_temp.expect('swap keeps p1 at 3', pg_temp.boards(p1), 3);

  -- ── Joining someone else's room counts and is checked ────────────────────
  perform pg_temp.act_as(p2);
  select * into open_room from public.create_live_game(
    jsonb_build_object('name', 'open', 'gameMode', 'versus', 'players', jsonb_build_object('A', 'P2'),
      'playerUserIds', jsonb_build_object('A', p2)),
    'public', 'public', null, 'open', null);
  perform pg_temp.act_as(joiner);
  perform pg_temp.solo();
  perform pg_temp.solo();
  perform pg_temp.solo();
  perform pg_temp.refused(format('select * from public.join_live_game(null, %L)', open_room.room_id),
    'active_board_limit:%');
  perform pg_temp.act_as_owner();
  delete from public.room_live where room_id = (select room_id from public.room_live
    where player_a_user_id = joiner and game_mode = 'solo' limit 1);
  perform pg_temp.act_as(joiner);
  perform * from public.join_live_game(null, open_room.room_id);
  perform pg_temp.expect('joined room counts', pg_temp.boards(joiner), 3);
  -- re-joining a room already held is a reconnect, not a new board
  perform * from public.join_live_game(null, open_room.room_id);
  perform pg_temp.expect('rejoin adds nothing', pg_temp.boards(joiner), 3);

  -- ── Re-seating through the owner's configuration path is checked too ─────
  perform pg_temp.act_as(host);
  perform pg_temp.refused(format($q$select public.update_live_game_state(%L,
      jsonb_build_object('name','hosted','gameMode','versus','emailPlayMode','hosted',
        'players', jsonb_build_object('A','P2','B','J'),
        'playerUserIds', jsonb_build_object('A', %L::text, 'B', %L::text)))$q$,
      hosted.room_id, p2, joiner), 'active_board_limit: a seated player%');
  perform pg_temp.expect('refused re-seat left p1 seated', pg_temp.boards(p1), 3);

  -- ── Reconnect and play are never gated, even above the limit ─────────────
  perform pg_temp.act_as(heavy);
  rooms := array[pg_temp.solo(), pg_temp.solo(), pg_temp.solo()];
  perform pg_temp.act_as(admin_id);
  perform public.admin_set_active_board_limit(5, 'test: pre-existing heavy user');
  perform pg_temp.act_as(heavy);
  rooms := rooms || pg_temp.solo() || pg_temp.solo();
  perform pg_temp.act_as(admin_id);
  perform public.admin_set_active_board_limit(3, 'test: back to 3');
  perform pg_temp.act_as(heavy);
  perform pg_temp.expect('five boards held', pg_temp.boards(heavy), 5);
  foreach r in array rooms loop
    select * into committed from public.commit_live_game_command(r, 0, 'move-' || r, 'A',
      '{"kind":"place"}'::jsonb, '{"activeSide":"A","turnNumber":2,"phase":"play"}'::jsonb, 'd', null, null);
    perform pg_temp.expect('move on an existing board', committed.outcome, 'committed');
  end loop;
  perform pg_temp.refused('select pg_temp.solo()', 'active_board_limit:%');
  perform public.cancel_live_game(rooms[1]);
  perform public.cancel_live_game(rooms[2]);
  perform pg_temp.expect('three left', pg_temp.boards(heavy), 3);
  perform pg_temp.refused('select pg_temp.solo()', 'active_board_limit:%');
  perform public.cancel_live_game(rooms[3]);
  perform pg_temp.solo();
  perform pg_temp.expect('one new board allowed at two', pg_temp.boards(heavy), 3);

  -- ── Ranked counts, through its own lifecycle ─────────────────────────────
  perform pg_temp.act_as(ranker);
  perform pg_temp.solo();
  perform pg_temp.solo();
  perform pg_temp.act_as_service();
  insert into public.ranked_matches (player_a_id, status, minutes_a, minutes_b, state)
  values (ranker, 'waiting', 10, 10, pg_temp.ranked_state());
  perform pg_temp.expect('waiting ranked counts', pg_temp.boards(ranker), 3);
  perform pg_temp.act_as_owner();
  -- ranker2 at the limit cannot claim ranker's match
  perform pg_temp.act_as(ranker2);
  perform pg_temp.solo(); perform pg_temp.solo(); perform pg_temp.solo();
  perform pg_temp.act_as_service();
  perform pg_temp.refused(format($q$select public.ranked_claim_match(
      (select id from public.ranked_matches where player_a_id = %L), %L, 'R2', now())$q$, ranker, ranker2),
    'active_board_limit:%');
  -- a stale waiting match (unclaimable after 24 h) and a finished one do not count
  perform pg_temp.act_as_owner();
  update public.ranked_matches set created_at = now() - interval '25 hours' where player_a_id = ranker;
  perform pg_temp.expect('stale waiting ranked not counted', pg_temp.boards(ranker), 2);
  update public.ranked_matches set created_at = now() where player_a_id = ranker;
  perform pg_temp.act_as_service();
  perform pg_temp.refused(format($q$insert into public.ranked_matches (player_a_id, status, minutes_a, minutes_b, state)
      values (%L, 'waiting', 10, 10, '{}')$q$, ranker), 'active_board_limit:%');

  -- ── An expired lobby does not count; re-opening it is checked ────────────
  perform pg_temp.act_as_owner();
  perform pg_temp.act_as(mover);
  select room_id into r from public.create_live_game(
    jsonb_build_object('name', 'lobby', 'gameMode', 'versus', 'roomStage', 'waiting',
      'players', jsonb_build_object('A', 'M'), 'playerUserIds', jsonb_build_object('A', mover)),
    'public', 'public', null, 'open', null);
  perform pg_temp.expect('waiting lobby counts', pg_temp.boards(mover), 1);
  perform pg_temp.act_as_owner();
  update public.room_live set expires_at = now() - interval '1 minute' where room_id = r;
  perform pg_temp.expect('expired lobby does not count', pg_temp.boards(mover), 0);
  perform pg_temp.act_as(mover);
  perform pg_temp.solo(); perform pg_temp.solo(); perform pg_temp.solo();
  perform pg_temp.refused(format('select public.set_room_ready(%L, %L, true)', r, 'A'), 'active_board_limit:%');
  -- playing moves on the expired lobby would revive it as a board: checked
  perform pg_temp.refused(format($q$select * from public.commit_live_game_command(%L, 0, 'revive', 'A',
      '{"kind":"place"}', '{"activeSide":"A","turnNumber":2}', 'd', null, null)$q$, r), 'active_board_limit:%');
  perform pg_temp.act_as_owner();
  delete from public.room_live where room_id = (select room_id from public.room_live
    where player_a_user_id = mover and game_mode = 'solo' limit 1);
  perform pg_temp.act_as(mover);
  select * into committed from public.commit_live_game_command(r, 0, 'revive', 'A',
    '{"kind":"place"}', '{"activeSide":"A","turnNumber":2}', 'd', null, null);
  perform pg_temp.expect('revived by play', committed.outcome, 'committed');
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('a played room never expires', (select expires_at from public.room_live where room_id = r), null::timestamptz);
  perform pg_temp.expect('revived lobby counts again', pg_temp.boards(mover), 3);

  -- ── A bot room's player cannot be unseated ─────────────────────────────
  perform pg_temp.act_as_owner();
  insert into public.plan_passes (user_id, plan_key, kind, months, source, idempotency_key, activated_at, reason, created_by)
  values (bot_player, 'pro', 'grant', 1, 'admin', 'boards:' || gen_random_uuid(), now() - interval '1 hour', 'boards', admin_id);
  perform public.rebuild_plan_timeline(bot_player);
  perform pg_temp.act_as(bot_player);
  select room_id into r from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B',
    '{"name":"bot","gameMode":"versus","players":{"A":"Me","B":"Authur"},"botSide":"B"}',
    'private', 'none', null, 'invite_only', null, 'allowance');
  perform pg_temp.expect('bot room counts', pg_temp.boards(bot_player), 1);
  perform pg_temp.refused(format($q$select public.update_live_game_state(%L,
      '{"name":"bot","gameMode":"versus","players":{"A":"Me","B":"Authur"},"botSide":"B"}')$q$, r),
    'bot_room_seat_fixed:%');
  perform pg_temp.expect('still counted', pg_temp.boards(bot_player), 1);

  -- ── Configuration: admin-only, fails closed when missing ─────────────────
  perform pg_temp.act_as(mover);
  perform pg_temp.refused('select public.admin_set_active_board_limit(99, $$me$$)', 'admin access required');
  perform pg_temp.act_as_owner();
  delete from public.system_settings where key = 'max_active_boards_per_user';
  perform pg_temp.act_as(host);
  perform pg_temp.refused('select pg_temp.solo()', 'active_board_limit_unconfigured:%');

  raise notice 'active boards smoke test passed';
end
$boards$;

rollback;
