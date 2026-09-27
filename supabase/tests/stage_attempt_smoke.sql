-- Local/staging-only smoke test for server-authoritative Stage attempts.
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/stage_attempt_smoke.sql
-- A Stage attempt is created only by create_stage_attempt against an
-- approved, SEALED level; it is never charged; its first position must be the
-- sealed start and later positions cannot take a tile off the board. Nothing
-- the client names (room name, bot, a flag) makes a room a Stage. Rolls back.

begin;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.act_as_owner() returns void language plpgsql as $$
begin execute 'reset role'; end $$;
create function pg_temp.expect(label text, actual anyelement, expected anyelement) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then raise exception '%: expected %, got %', label, expected, actual; end if;
end $$;
create function pg_temp.refused(sql text, pattern text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'EXPECTED refusal: %', sql;
exception when others then
  if sqlerrm not like pattern then raise; end if;
end $$;
-- A 100-tile inventory: tiles < on_board sit on row 7 from col 0, the rest in the bag.
create function pg_temp.inventory(on_board int, shift int default 0) returns jsonb language sql as $$
  select jsonb_agg(case when i < on_board
                        then jsonb_build_object('at', 'board', 'row', 7, 'col', i + shift)
                        else jsonb_build_object('at', 'bag') end order by i)
    from generate_series(0, 99) i
$$;
create function pg_temp.position(on_board int, turn int, shift int default 0, score_a int default 0)
returns jsonb language sql as $$
  select jsonb_build_object('inventory', pg_temp.inventory(on_board, shift),
    'scores', jsonb_build_object('A', score_a, 'B', 0), 'activeSide', 'A',
    'turnNumber', turn, 'startingSide', 'A')
$$;
create function pg_temp.commit(room uuid, rev bigint, canonical jsonb) returns text language sql as $$
  select outcome from public.commit_live_game_command(room, rev, 'c-' || gen_random_uuid(), 'A',
    '{"kind":"place"}'::jsonb, canonical, 'd', null, null)
$$;
create function pg_temp.consumed(u uuid) returns bigint language sql security definer as $$
  select (select count(*) from public.probot_consumptions where user_id = u)
       + (select count(*) from public.economy_entries where user_id = u)
$$;
create function pg_temp.fact(sql text) returns bigint language plpgsql security definer as $$
declare n bigint;
begin execute sql into n; return n; end $$;

insert into private.runtime_secrets (key, value) values ('room_code_secret', repeat('s', 40))
on conflict (key) do nothing;
insert into auth.users (id, email, aud, role)
select ('00000000-0000-4000-8000-0000000008' || lpad(n::text, 2, '0'))::uuid,
       'stage-' || n || '@example.test', 'authenticated', 'authenticated'
  from generate_series(1, 6) n;
update public.profiles set status = 'approved' where id::text like '00000000-0000-4000-8000-0000000008%';
update public.profiles set is_admin = true where id = '00000000-0000-4000-8000-000000000801';

insert into public.survival_levels (id, season_key, level_no, seed, sample_policy, sample_count, win_count,
  immediate_winning_moves, shortest_winning_replay_turns, winning_replays, status, admin_note,
  approved_by, approved_at)
values
  ('88888888-0000-4000-8000-000000000001', 'stage-smoke', 1, 4242, 'test', 10, 5, 0, 6,
   '[1,2,3]', 'approved', 'smoke', '00000000-0000-4000-8000-000000000801', now()),
  ('88888888-0000-4000-8000-000000000002', 'stage-smoke', 2, 4343, 'test', 10, 5, 0, 6,
   '[1,2,3]', 'approved', 'smoke', '00000000-0000-4000-8000-000000000801', now()),
  ('88888888-0000-4000-8000-000000000003', 'stage-smoke', 3, 4444, 'test', 10, 5, 0, 6,
   '[]', 'draft', '', null, null);

do $stage$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000801';
  player constant uuid := '00000000-0000-4000-8000-000000000802';
  other constant uuid := '00000000-0000-4000-8000-000000000803';
  sealed constant uuid := '88888888-0000-4000-8000-000000000001';
  unsealed constant uuid := '88888888-0000-4000-8000-000000000002';
  draft constant uuid := '88888888-0000-4000-8000-000000000003';
  req constant uuid := '88888888-1111-4000-8000-000000000001';
  a record;
  replay record;
  fake record;
  room public.room_live%rowtype;
begin
  -- ── Sealing is admin-only and validated ──────────────────────────────────
  perform pg_temp.act_as(player);
  perform pg_temp.refused(format('select public.admin_seal_stage_start(%L, %L)', sealed, pg_temp.position(5, 1)),
    'admin access required');
  perform pg_temp.act_as(admin_id);
  perform pg_temp.refused(format('select public.admin_seal_stage_start(%L, %L)', sealed,
    '{"inventory":[],"scores":{},"activeSide":"A","turnNumber":1,"startingSide":"A"}'), 'a sealed start needs%');
  perform public.admin_seal_stage_start(sealed, pg_temp.position(5, 1) || '{"extra":"dropped"}');
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('seal stores only the position',
    (select start_canonical ? 'extra' from public.survival_levels where id = sealed), false);
  -- nobody writes a sealed start (or the seed) through the table
  perform pg_temp.act_as(player);
  perform pg_temp.refused(format('update public.survival_levels set start_canonical = %L where id = %L',
    pg_temp.position(0, 1), sealed), 'permission denied%');
  perform pg_temp.act_as(admin_id);
  perform pg_temp.refused(format('update public.survival_levels set start_canonical = %L where id = %L',
    pg_temp.position(0, 1), sealed), 'permission denied%');
  perform pg_temp.refused(format('update public.survival_levels set seed = 1 where id = %L', sealed), 'permission denied%');
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('player cannot reseal',
    (select start_canonical -> 'inventory' from public.survival_levels where id = sealed), pg_temp.inventory(5));

  -- ── Only approved, sealed levels can be played ───────────────────────────
  perform pg_temp.act_as(player);
  perform pg_temp.refused(format('select * from public.create_stage_attempt(gen_random_uuid(), %L, %L)',
    draft, '{}'), 'stage_level_unavailable:%');
  perform pg_temp.refused(format('select * from public.create_stage_attempt(gen_random_uuid(), %L, %L)',
    unsealed, '{}'), 'stage_level_not_sealed:%');
  perform pg_temp.refused(format('select * from public.create_stage_attempt(null, %L, %L)',
    sealed, '{}'), 'a Stage attempt needs a creation request id');

  -- ── A real attempt: server-named, private, purpose stage, never charged ──
  select * into a from public.create_stage_attempt(req,  sealed,
    '{"name":"my free Authur","players":{"A":"Me","B":"Authur"},"botSide":"B","gameMode":"solo"}');
  perform pg_temp.expect('fresh', a.replayed, false);
  perform pg_temp.act_as_owner();
  select * into room from public.room_live where room_id = a.room_id;
  perform pg_temp.expect('purpose', room.room_purpose, 'stage');
  perform pg_temp.expect('server names it', room.name, 'Survival test · seed 4242');
  perform pg_temp.expect('mode', room.game_mode, 'versus');
  perform pg_temp.expect('bot', room.bot_key, 'authur_strong');
  perform pg_temp.expect('private', room.access_scope, 'private');
  perform pg_temp.expect('seated', room.player_a_user_id, player);
  perform pg_temp.expect('attempt row', (select room_id from public.survival_attempts where id = a.attempt_id), a.room_id);
  perform pg_temp.expect('no consumption, no ledger entry', pg_temp.consumed(player), 0::bigint);
  perform pg_temp.expect('counts as a board', public.active_board_count(player, clock_timestamp()), 1);

  -- replay returns the same attempt; reuse for another level conflicts
  perform pg_temp.act_as(player);
  select * into replay from public.create_stage_attempt(req, sealed, '{}');
  perform pg_temp.expect('replayed', replay.replayed, true);
  perform pg_temp.expect('same room', replay.room_id, a.room_id);
  perform pg_temp.expect('same attempt', replay.attempt_id, a.attempt_id);
  perform pg_temp.refused(format('select * from public.create_stage_attempt(%L, %L, %L)', req, unsealed, '{}'),
    'idempotency_conflict:%');
  perform pg_temp.refused(format($q$select * from public.create_bot_game(%L, 'authur_strong', 'B',
      '{"name":"x","gameMode":"versus","players":{"A":"Me","B":"Authur"},"botSide":"B"}', 'private', 'none',
      null, 'invite_only', null, 'credit')$q$, req), 'idempotency_conflict:%');

  -- ── First position must be the sealed start ──────────────────────────────
  perform pg_temp.refused(format('select pg_temp.commit(%L, 0, %L)', a.room_id, pg_temp.position(0, 1)),
    'stage_start_mismatch:%');
  perform pg_temp.refused(format('select pg_temp.commit(%L, 0, %L)', a.room_id, pg_temp.position(5, 1, 0, 400)),
    'stage_start_mismatch:%');
  perform pg_temp.refused(format('select pg_temp.commit(%L, 0, %L)', a.room_id, pg_temp.position(5, 2)),
    'stage_start_mismatch:%');
  perform pg_temp.refused(format('select pg_temp.commit(%L, 0, %L)', a.room_id,
    '{"inventory":[],"scores":{"A":0,"B":0},"activeSide":"A","turnNumber":1,"startingSide":"A"}'),
    'stage_invalid_position:%');
  perform pg_temp.expect('sealed start accepted', pg_temp.commit(a.room_id, 0, pg_temp.position(5, 1)), 'committed');

  -- ── Later positions may add tiles, never move or remove board tiles ──────
  perform pg_temp.expect('a move adds tiles', pg_temp.commit(a.room_id, 1, pg_temp.position(8, 2, 0, 12)), 'committed');
  perform pg_temp.refused(format('select pg_temp.commit(%L, 2, %L)', a.room_id, pg_temp.position(0, 3)),
    'stage_board_rewrite:%');
  perform pg_temp.refused(format('select pg_temp.commit(%L, 2, %L)', a.room_id, pg_temp.position(8, 3, 1)),
    'stage_board_rewrite:%');
  perform pg_temp.refused(format('select pg_temp.commit(%L, 2, %L)', a.room_id, pg_temp.position(7, 3)),
    'stage_board_rewrite:%');
  -- a stale writer gets the ordinary conflict, not a Stage error
  perform pg_temp.expect('stale writer conflicts', pg_temp.commit(a.room_id, 1, pg_temp.position(5, 2)), 'conflict');
  perform pg_temp.expect('replayed start conflicts', pg_temp.commit(a.room_id, 0, pg_temp.position(5, 1)), 'conflict');

  -- ── Purpose and bot are frozen; a Stage cannot become a normal room ──────
  perform pg_temp.act_as_owner();
  perform pg_temp.refused(format($q$update public.room_live set room_purpose = 'normal' where room_id = %L$q$, a.room_id),
    '%fixed for the life of a game%');
  perform pg_temp.refused(format($q$update public.room_live set bot_key = null where room_id = %L$q$, a.room_id),
    '%fixed for the life of a game%');
  perform pg_temp.act_as(player);
  -- vacating the player's seat would stop the board counting: refused
  perform pg_temp.refused(format($q$select public.update_live_game_state(%L,
    '{"name":"renamed","gameMode":"versus","players":{"A":"Me","B":"Authur"},"botSide":"B"}')$q$, a.room_id),
    'bot_room_seat_fixed:%');
  perform pg_temp.refused(format($q$select public.update_live_game_state(%L, jsonb_build_object('name','renamed',
    'gameMode','versus','players',jsonb_build_object('A','Me','B','Authur'),'botSide','B',
    'playerUserIds', jsonb_build_object('A', %L::text)))$q$, a.room_id, other), 'bot_room_seat_fixed:%');
  perform public.update_live_game_state(a.room_id, jsonb_build_object('name', 'renamed',
    'gameMode', 'solo', 'players', jsonb_build_object('A', 'Me', 'B', 'Authur'), 'botSide', 'B',
    'playerUserIds', jsonb_build_object('A', player::text)));
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('still stage', (select room_purpose from public.room_live where room_id = a.room_id), 'stage');
  perform pg_temp.expect('still Authur', (select bot_key from public.room_live where room_id = a.room_id), 'authur_strong');

  -- ── Nothing the client names makes a room a Stage ────────────────────────
  perform pg_temp.act_as(other);
  -- the old path: a room named like an attempt, plus a hand-inserted attempt row
  select * into fake from public.create_live_game(
    '{"name":"Survival test · seed 4242","gameMode":"versus","players":{"A":"Me","B":"Authur"}}',
    'private', 'none', null, 'invite_only', null);
  perform pg_temp.refused(format('insert into public.survival_attempts (level_id, room_id, player_id) values (%L, %L, %L)',
    sealed, fake.room_id, other), 'permission denied%');
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('named room stays normal', (select room_purpose from public.room_live where room_id = fake.room_id), 'normal');
  -- a bot room claiming the Stage purpose or name must still be funded
  perform pg_temp.act_as(other);
  perform pg_temp.refused($q$select * from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B',
      '{"name":"Survival test · seed 4242","gameMode":"versus","players":{"A":"Me","B":"Authur"},"botSide":"B","roomPurpose":"stage"}',
      'private', 'none', null, 'invite_only', null, null)$q$, 'funding_required:%');
  -- a Stage attempt cannot be made for someone else's attempt row by update
  perform pg_temp.expect('no rows visible to change', pg_temp.fact(format(
    'select count(*) from public.survival_attempts where player_id = %L and room_id = %L', other, a.room_id)), 0::bigint);
  -- the purpose column is not writable directly
  perform pg_temp.refused(format($q$update public.room_live set room_purpose = 'stage' where room_id = %L$q$, fake.room_id),
    'permission denied%');
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('fake stays normal', (select room_purpose from public.room_live where room_id = fake.room_id), 'normal');
  perform pg_temp.expect('no consumption for the refused bot room', pg_temp.consumed(other), 0::bigint);

  -- ── Stage attempts count toward the board limit ──────────────────────────
  perform pg_temp.act_as(player);
  perform public.create_stage_attempt(gen_random_uuid(), sealed, '{}');
  perform public.create_stage_attempt(gen_random_uuid(), sealed, '{}');
  perform pg_temp.refused(format('select * from public.create_stage_attempt(gen_random_uuid(), %L, %L)', sealed, '{}'),
    'active_board_limit:%');
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('refused attempt left no row', pg_temp.fact(format(
    'select count(*) from public.survival_attempts where player_id = %L', player)), 3::bigint);

  -- ── Disabled opponent refuses new attempts ───────────────────────────────
  update public.bot_catalog set enabled = false where bot_key = 'authur_strong';
  perform pg_temp.act_as(other);
  perform pg_temp.refused(format('select * from public.create_stage_attempt(gen_random_uuid(), %L, %L)', sealed, '{}'),
    'bot_disabled:%');
  perform pg_temp.act_as_owner();
  update public.bot_catalog set enabled = true where bot_key = 'authur_strong';

  -- ── Stage attempts never enter normal bot statistics ─────────────────────
  perform pg_temp.act_as(admin_id);
  perform public.create_bot_folder('stage smoke', true);
  perform pg_temp.act_as(other);
  select * into replay from public.create_stage_attempt(gen_random_uuid(), sealed, '{}');
  perform public.finalize_live_game(replay.room_id, '{"status":"finished","scores":{"A":10,"B":20}}'::jsonb,
    'terminated', 'manual', null);
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('Stage attempt not in bot statistics', pg_temp.fact(format(
    'select count(*) from public.bot_stat_games where room_id = %L', replay.room_id)), 0::bigint);

  raise notice 'stage attempt smoke test passed';
end
$stage$;

rollback;
