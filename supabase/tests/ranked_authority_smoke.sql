-- Local/staging-only smoke test for Ranked match authority (Foundation C7).
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/ranked_authority_smoke.sql
-- One active Ranked match per user, waiting rooms, both claims, grandfathered
-- players, the board limit alongside, stakes parity with the result path and
-- stale stakes. Concurrency is in ranked_authority_race.sh. Rolls back.

begin;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
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
create function pg_temp.refused(sql text, pattern text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'EXPECTED refusal: %', sql;
exception when others then
  if sqlerrm not like pattern then raise; end if;
end $$;
-- A waiting room, written the way the Edge Function's `create` writes it.
create function pg_temp.waiting(creator uuid) returns uuid language sql as $$
  insert into public.ranked_matches (player_a_id, status, minutes_a, minutes_b, state)
  values (creator, 'waiting', 10, 10,
    jsonb_build_object('status', 'waiting', 'players', jsonb_build_object('A', 'Creator'),
      'playerUserIds', jsonb_build_object('A', creator::text),
      'lobbyReadyBySide', jsonb_build_object('A', false, 'B', false)))
  returning id
$$;
create function pg_temp.basis(match uuid, viewer uuid) returns text language sql as $$
  select s.basis from public.ranked_stakes(match, viewer) s
$$;
create function pg_temp.claim(match uuid, claimant uuid) returns boolean language sql as $$
  select not r.resumed from public.ranked_claim_match_v2(match, claimant, 'Claimant',
    pg_temp.basis(match, claimant)) r
$$;
create function pg_temp.active(u uuid) returns integer language sql security definer as $$
  select public.ranked_active_count(u)
$$;
create function pg_temp.set_rating(u uuid, r integer, g integer) returns void language sql as $$
  insert into public.ranked_ratings (player_id, rating, games) values (u, r, g)
  on conflict (player_id) do update set rating = excluded.rating, games = excluded.games
$$;
create function pg_temp.rating(u uuid) returns integer language sql as $$
  select rating from public.ranked_ratings where player_id = u
$$;
-- A finished position: resign needs no score check; a draw is scored level.
create function pg_temp.finish(match uuid, winner text) returns boolean language sql as $$
  select public.ranked_commit_match(match, (select revision from public.ranked_matches where id = match),
    jsonb_build_object('status', 'finished', 'scores',
      jsonb_build_object('A', case when winner = 'B' then 0 else 10 end, 'B', case when winner = 'A' then 0 else 10 end)),
    winner, case when winner = 'draw' then 'score' else 'resign' end)
$$;
-- The expression ranked_commit_match applied before C7, verbatim, to prove
-- the shared function did not change a single result.
create function pg_temp.old_formula(ra int, ga int, rb int, gb int, sa numeric, out na int, out nb int)
language plpgsql as $$
declare expected_a numeric; expected_b numeric;
begin
  expected_a := 1 / (1 + power(10::numeric, (rb - ra)::numeric / 400));
  expected_b := 1 - expected_a;
  na := greatest(100, ra + round((case when ga < 10 then 40 else 24 end) * (sa - expected_a))::int);
  nb := greatest(100, rb + round((case when gb < 10 then 40 else 24 end) * ((1 - sa) - expected_b))::int);
end $$;

insert into private.runtime_secrets (key, value) values ('room_code_secret', repeat('s', 40))
on conflict (key) do nothing;
insert into auth.users (id, email, aud, role)
select ('00000000-0000-4000-8000-0000000c70' || lpad(n::text, 2, '0'))::uuid,
       'ranked-c7-' || n || '@example.test', 'authenticated', 'authenticated'
  from generate_series(1, 40) n;
update public.profiles set status = 'approved' where id::text like '00000000-0000-4000-8000-0000000c70%';
update public.profiles set status = 'pending' where id = '00000000-0000-4000-8000-0000000c7040';

-- ── 9 · The shared formula is the old formula, across a grid ───────────────
grant execute on function pg_temp.act_as(uuid), pg_temp.act_as_anon(),
  pg_temp.act_as_service(), pg_temp.act_as_owner(),
  pg_temp.expect(text, anyelement, anyelement), pg_temp.refused(text, text),
  pg_temp.waiting(uuid), pg_temp.basis(uuid, uuid), pg_temp.claim(uuid, uuid),
  pg_temp.active(uuid), pg_temp.set_rating(uuid, integer, integer),
  pg_temp.rating(uuid), pg_temp.finish(uuid, text),
  pg_temp.old_formula(integer, integer, integer, integer, numeric)
  to authenticated, anon, service_role;

do $parity$
declare
  ra int; rb int; ga int; gb int; sa numeric;
  shared record; old record; checked int := 0;
begin
  foreach ra in array array[100, 101, 150, 400, 999, 1000, 1001, 1200, 1437, 1500, 1799, 2000, 2400] loop
    foreach rb in array array[100, 101, 150, 400, 999, 1000, 1001, 1200, 1437, 1500, 1799, 2000, 2400] loop
      foreach ga in array array[0, 9, 10, 50] loop
        foreach gb in array array[0, 9, 10, 50] loop
          foreach sa in array array[0, 0.5, 1]::numeric[] loop
            select * into shared from public.ranked_rating_outcome(ra, ga, rb, gb, sa);
            select * into old from pg_temp.old_formula(ra, ga, rb, gb, sa);
            if shared.new_a is distinct from old.na or shared.new_b is distinct from old.nb then
              raise exception 'formula drift at % % % % %: % % vs % %', ra, ga, rb, gb, sa,
                shared.new_a, shared.new_b, old.na, old.nb;
            end if;
            checked := checked + 1;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
  perform pg_temp.expect('parity grid size', checked, 13 * 13 * 4 * 4 * 3);
end;
$parity$;

do $ranked$
declare
  u constant text := '00000000-0000-4000-8000-0000000c70';
  a uuid := (u || '01')::uuid;  b uuid := (u || '02')::uuid;  c uuid := (u || '03')::uuid;
  d uuid := (u || '04')::uuid;  e uuid := (u || '05')::uuid;  f uuid := (u || '06')::uuid;
  g uuid := (u || '07')::uuid;  h uuid := (u || '08')::uuid;  k uuid := (u || '09')::uuid;
  l uuid := (u || '10')::uuid;  n uuid := (u || '11')::uuid;  o uuid := (u || '12')::uuid;
  p uuid := (u || '13')::uuid;  q uuid := (u || '14')::uuid;  s uuid := (u || '15')::uuid;
  pending uuid := (u || '40')::uuid;
  w1 uuid; w2 uuid; w3 uuid; m1 uuid; m2 uuid; x uuid;
  stake record; stake_b record; before record; after record; basis text;
  claimed record;
  ratings_before text; ratings_after text;
begin
  perform pg_temp.act_as_service();

  -- ── 1 · A waiting room is not an active match ─────────────────────────────
  w1 := pg_temp.waiting(a);
  perform pg_temp.expect('waiting room is not active', pg_temp.active(a), 0);
  -- …and its creator may still take another player's room.
  w2 := pg_temp.waiting(b);
  perform pg_temp.expect('creator with a waiting room claims', pg_temp.claim(w2, a), true);

  -- ── 2 · A matched match is active, for both players ───────────────────────
  perform pg_temp.expect('claimant active', pg_temp.active(a), 1);
  perform pg_temp.expect('creator active', pg_temp.active(b), 1);
  perform pg_temp.expect('status matched', (select status from public.ranked_matches where id = w2), 'matched');
  -- playing is active too
  perform public.ranked_ready_match(w2, a, now());
  perform public.ranked_ready_match(w2, b, now());
  perform pg_temp.expect('status playing', (select status from public.ranked_matches where id = w2), 'playing');
  perform pg_temp.expect('playing is active', pg_temp.active(a), 1);

  -- ── 3 · A player in an active match cannot claim another ─────────────────
  w3 := pg_temp.waiting(c);
  perform pg_temp.refused(format('select pg_temp.claim(%L, %L)', w3, a), 'ranked_already_active:%');
  -- nor through the v1 claim the current Edge Function uses
  perform pg_temp.refused(format('select public.ranked_claim_match(%L, %L, %L, now())', w3, a, 'A'),
    'ranked_already_active:%');

  -- ── 4/5 · A busy creator's room cannot be claimed, and is kept ────────────
  -- a (busy) still has w1 waiting.
  perform pg_temp.refused(format('select pg_temp.claim(%L, %L)', w1, d), 'ranked_room_unavailable:%');
  perform pg_temp.refused(format('select public.ranked_claim_match(%L, %L, %L, now())', w1, d, 'D'),
    'ranked_already_active:%');
  perform pg_temp.expect('busy creator''s room kept', (select status from public.ranked_matches where id = w1), 'waiting');
  perform pg_temp.expect('busy creator''s room unseated', (select player_b_id from public.ranked_matches where id = w1), null::uuid);
  -- once a is free again, the same room is claimable
  perform pg_temp.expect('finish frees a', pg_temp.finish(w2, 'A'), true);
  perform pg_temp.expect('a free', pg_temp.active(a), 0);
  perform pg_temp.expect('freed creator''s room claimable', pg_temp.claim(w1, d), true);

  -- ── 7 · Claiming a match you hold is a resume ─────────────────────────────
  select * into claimed from public.ranked_claim_match_v2(w1, d, 'D', 'rs1:anything');
  perform pg_temp.expect('resume flagged', claimed.resumed, true);
  perform pg_temp.expect('resume changes nothing', claimed.revision,
    (select revision from public.ranked_matches where id = w1));
  -- ready and play on as normal
  perform pg_temp.expect('ready a', public.ranked_ready_match(w1, a, now()), true);
  perform pg_temp.expect('ready d', public.ranked_ready_match(w1, d, now()), true);
  perform pg_temp.expect('move', public.ranked_commit_match(w1, (select revision from public.ranked_matches where id = w1),
    '{"status":"playing"}'::jsonb), true);
  perform pg_temp.expect('finish w1', pg_temp.finish(w1, 'B'), true);

  -- ── Other claim refusals ─────────────────────────────────────────────────
  perform pg_temp.refused(format('select pg_temp.claim(%L, %L)', w3, c), 'ranked_own_room:%');
  perform pg_temp.refused(format($q$select * from public.ranked_claim_match_v2(%L, %L, 'E', null)$q$, w3, e),
    'ranked_stakes_required:%');
  perform pg_temp.refused(format($q$select * from public.ranked_claim_match_v2(gen_random_uuid(), %L, 'E', 'rs1:x')$q$, e),
    'ranked_room_not_found:%');
  perform pg_temp.refused(format($q$select * from public.ranked_claim_match_v2(%L, %L, 'P', 'rs1:x')$q$, w3, pending),
    'approval_required:%');
  perform pg_temp.refused(format('select pg_temp.claim(%L, %L)', w1, e), 'ranked_room_finished:%');
  basis := pg_temp.basis(w3, e);
  perform pg_temp.act_as_owner();
  update public.ranked_matches set created_at = now() - interval '25 hours' where id = w3;
  perform pg_temp.act_as_service();
  perform pg_temp.refused(format($q$select * from public.ranked_claim_match_v2(%L, %L, 'E', %L)$q$, w3, e, basis),
    'ranked_room_expired:%');
  perform pg_temp.refused(format('select pg_temp.basis(%L, %L)', w3, e), 'ranked_room_expired:%');
  perform pg_temp.act_as_owner();
  update public.ranked_matches set created_at = now() where id = w3;
  perform pg_temp.act_as_service();
  -- a claimed room is not previewable or claimable by a third player
  perform pg_temp.expect('e claims w3', pg_temp.claim(w3, e), true);
  perform pg_temp.refused(format('select pg_temp.basis(%L, %L)', w3, f), 'ranked_room_claimed:%');
  perform pg_temp.refused(format($q$select * from public.ranked_claim_match_v2(%L, %L, 'F', 'rs1:x')$q$, w3, f),
    'ranked_room_claimed:%');

  -- ── 9 · Stakes are what the result path applies ──────────────────────────
  -- For each outcome: preview both players, finish, compare with the ratings
  -- ranked_commit_match actually wrote.
  perform pg_temp.act_as_owner();
  perform pg_temp.set_rating(g, 1437, 9);
  perform pg_temp.set_rating(h, 1200, 50);
  perform pg_temp.act_as_service();
  declare
    outcome text;
  begin
    foreach outcome in array array['A', 'B', 'draw'] loop
      perform pg_temp.act_as_owner();
      perform pg_temp.set_rating(g, 1437, 9);
      perform pg_temp.set_rating(h, 1200, 50);
      perform pg_temp.act_as_service();
      m1 := pg_temp.waiting(g);
      -- the prospective claimant's view of the waiting room …
      select * into stake_b from public.ranked_stakes(m1, h);
      perform pg_temp.expect('claimant seat', stake_b.viewer_side, 'B');
      perform pg_temp.expect('claimant rating', stake_b.viewer_rating, 1200);
      perform pg_temp.expect('claimant games', stake_b.viewer_games, 50);
      perform pg_temp.expect('opponent rating', stake_b.opponent_rating, 1437);
      perform pg_temp.expect('opponent id', stake_b.opponent_id, g);
      perform pg_temp.expect('claims with it', pg_temp.claim(m1, h), true);
      -- … is still its view once seated, and the creator's view matches too
      perform pg_temp.expect('seated basis unchanged', pg_temp.basis(m1, h), stake_b.basis);
      select * into stake from public.ranked_stakes(m1, g);
      perform pg_temp.expect('creator seat', stake.viewer_side, 'A');
      perform public.ranked_ready_match(m1, g, now());
      perform public.ranked_ready_match(m1, h, now());
      perform pg_temp.expect('finish ' || outcome, pg_temp.finish(m1, outcome), true);
      perform pg_temp.act_as_owner();
      perform pg_temp.expect('creator after ' || outcome, pg_temp.rating(g),
        case outcome when 'A' then stake.win_rating when 'B' then stake.loss_rating else stake.draw_rating end);
      perform pg_temp.expect('claimant after ' || outcome, pg_temp.rating(h),
        case outcome when 'B' then stake_b.win_rating when 'A' then stake_b.loss_rating else stake_b.draw_rating end);
      perform pg_temp.expect('result row agrees ' || outcome,
        (select rating_b_after from public.ranked_results where match_id = m1), pg_temp.rating(h));
      perform pg_temp.act_as_service();
    end loop;
  end;
  -- Players with no ratings row are previewed at the row's defaults.
  m1 := pg_temp.waiting(k);
  select * into stake from public.ranked_stakes(m1, l);
  perform pg_temp.expect('default rating', stake.viewer_rating, 1000);
  perform pg_temp.expect('default games', stake.viewer_games, 0);
  perform pg_temp.expect('even win', stake.win_rating, 1020);
  perform pg_temp.expect('even draw', stake.draw_rating, 1000);
  perform pg_temp.expect('even loss', stake.loss_rating, 980);
  perform pg_temp.expect('claim k/l', pg_temp.claim(m1, l), true);
  perform public.ranked_ready_match(m1, k, now());
  perform public.ranked_ready_match(m1, l, now());
  perform pg_temp.finish(m1, 'B');
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('default row result', pg_temp.rating(l), stake.win_rating);
  -- The floor is previewed as it is applied.
  perform pg_temp.set_rating(n, 100, 50);
  perform pg_temp.set_rating(o, 2400, 50);
  perform pg_temp.act_as_service();
  m1 := pg_temp.waiting(o);
  select * into stake from public.ranked_stakes(m1, n);
  perform pg_temp.expect('floor loss', stake.loss_rating, 100);

  -- ── 10/11/12 · Stale stakes are refused and change nothing ──────────────
  perform pg_temp.act_as_owner();
  perform pg_temp.set_rating(p, 1300, 20);
  perform pg_temp.set_rating(q, 1310, 20);
  perform pg_temp.act_as_service();
  m2 := pg_temp.waiting(p);
  basis := pg_temp.basis(m2, q);
  perform pg_temp.act_as_owner();
  select status, player_b_id, revision, state into before from public.ranked_matches where id = m2;
  select string_agg(player_id || ':' || rating || ':' || games, ',' order by player_id) into ratings_before
    from public.ranked_ratings where player_id in (p, q);
  -- the claimant's rating moves (a result elsewhere) …
  update public.ranked_ratings set rating = 1311 where player_id = q;
  perform pg_temp.act_as_service();
  perform pg_temp.refused(format($q$select * from public.ranked_claim_match_v2(%L, %L, 'Q', %L)$q$, m2, q, basis),
    'ranked_stakes_changed:%');
  -- … or the creator's, or their games played (which changes K)
  perform pg_temp.act_as_owner();
  update public.ranked_ratings set rating = 1310 where player_id = q;
  update public.ranked_ratings set rating = 1299 where player_id = p;
  perform pg_temp.act_as_service();
  perform pg_temp.refused(format($q$select * from public.ranked_claim_match_v2(%L, %L, 'Q', %L)$q$, m2, q, basis),
    'ranked_stakes_changed:%');
  perform pg_temp.act_as_owner();
  update public.ranked_ratings set rating = 1300 where player_id = p;
  update public.ranked_ratings set games = 21 where player_id = q;
  perform pg_temp.act_as_service();
  perform pg_temp.refused(format($q$select * from public.ranked_claim_match_v2(%L, %L, 'Q', %L)$q$, m2, q, basis),
    'ranked_stakes_changed:%');
  perform pg_temp.act_as_owner();
  update public.ranked_ratings set games = 20 where player_id = q;
  perform pg_temp.act_as_service();
  -- a basis from another player or another room is not this basis
  perform pg_temp.refused(format($q$select * from public.ranked_claim_match_v2(%L, %L, 'Q', %L)$q$,
    m2, q, pg_temp.basis(m2, s)), 'ranked_stakes_changed:%');
  perform pg_temp.refused(format($q$select * from public.ranked_claim_match_v2(%L, %L, 'Q', %L)$q$,
    m2, q, 'rs1:' || repeat('0', 64)), 'ranked_stakes_changed:%');
  -- nothing the refusals touched has changed
  perform pg_temp.act_as_owner();
  select status, player_b_id, revision, state into after from public.ranked_matches where id = m2;
  perform pg_temp.expect('room untouched', after::text, before::text);
  select string_agg(player_id || ':' || rating || ':' || games, ',' order by player_id) into ratings_after
    from public.ranked_ratings where player_id in (p, q);
  perform pg_temp.expect('ratings untouched', ratings_after, ratings_before);
  perform pg_temp.act_as_service();
  -- the original basis is valid again, and claims
  perform pg_temp.expect('fresh basis claims', (select not r.resumed
    from public.ranked_claim_match_v2(m2, q, 'Q', basis) r), true);
  perform pg_temp.expect('claimed by q', (select player_b_id from public.ranked_matches where id = m2), q);
end;
$ranked$;

-- ── 6 · The board limit still refuses independently ────────────────────────
do $boards$
declare
  u constant text := '00000000-0000-4000-8000-0000000c70';
  r1 uuid := (u || '20')::uuid; r2 uuid := (u || '21')::uuid; r3 uuid := (u || '22')::uuid;
  w uuid;
begin
  perform pg_temp.act_as_owner();
  update public.system_settings set value_int = 1 where key = 'max_active_boards_per_user';
  -- r2 holds one board that is not Ranked: no Ranked match, but no capacity.
  perform pg_temp.act_as(r2);
  perform public.create_live_game('{"name":"solo","gameMode":"solo","players":{"A":"Me"}}',
    'private', 'none', null, 'invite_only', null);
  perform pg_temp.act_as_service();
  w := pg_temp.waiting(r1);
  perform pg_temp.expect('r2 has no Ranked match', pg_temp.active(r2), 0);
  perform pg_temp.refused(format('select pg_temp.claim(%L, %L)', w, r2), 'active_board_limit: you have%');
  perform pg_temp.refused(format('select public.ranked_claim_match(%L, %L, %L, now())', w, r2, 'R2'),
    'active_board_limit:%');
  perform pg_temp.expect('room still waiting', (select status from public.ranked_matches where id = w), 'waiting');
  -- the creator's waiting room is their board: they cannot open a second one
  perform pg_temp.refused(format('select pg_temp.waiting(%L)', r1), 'active_board_limit:%');
  -- a player with capacity claims it
  perform pg_temp.expect('r3 claims', pg_temp.claim(w, r3), true);
  perform pg_temp.act_as_owner();
  update public.system_settings set value_int = 3 where key = 'max_active_boards_per_user';
end;
$boards$;

-- ── 8 · Players who already held several active matches keep them ──────────
do $grandfathered$
declare
  u constant text := '00000000-0000-4000-8000-0000000c70';
  gf uuid := (u || '30')::uuid; o1 uuid := (u || '31')::uuid; o2 uuid := (u || '32')::uuid;
  o3 uuid := (u || '33')::uuid; o4 uuid := (u || '34')::uuid;
  g1 uuid; g2 uuid; w uuid;
begin
  -- Legacy state from before the rule: written with the rule switched off.
  perform pg_temp.act_as_owner();
  alter table public.ranked_matches disable trigger ranked_matches_active_match;
  insert into public.ranked_matches (player_a_id, player_b_id, status, minutes_a, minutes_b, state)
  values (gf, o1, 'matched', 10, 10, '{"status":"waiting","lobbyReadyBySide":{"A":false,"B":false}}') returning id into g1;
  insert into public.ranked_matches (player_a_id, player_b_id, status, minutes_a, minutes_b, state)
  values (o2, gf, 'playing', 10, 10, '{"status":"playing"}') returning id into g2;
  alter table public.ranked_matches enable trigger ranked_matches_active_match;
  perform pg_temp.expect('grandfathered holds two', pg_temp.active(gf), 2);

  perform pg_temp.act_as_service();
  -- cannot acquire a third, as claimant or as creator
  w := pg_temp.waiting(o3);
  perform pg_temp.refused(format('select pg_temp.claim(%L, %L)', w, gf), 'ranked_already_active:%');
  w := pg_temp.waiting(gf);
  perform pg_temp.refused(format('select pg_temp.claim(%L, %L)', w, o4), 'ranked_room_unavailable:%');
  -- but readies, plays and finishes both
  perform pg_temp.expect('ready legacy', public.ranked_ready_match(g1, gf, now()), true);
  perform pg_temp.expect('ready legacy other', public.ranked_ready_match(g1, o1, now()), true);
  perform pg_temp.expect('legacy playing', (select status from public.ranked_matches where id = g1), 'playing');
  perform pg_temp.expect('move legacy', public.ranked_commit_match(g2, (select revision from public.ranked_matches where id = g2),
    '{"status":"playing"}'::jsonb), true);
  perform pg_temp.expect('finish legacy 1', pg_temp.finish(g1, 'A'), true);
  -- still one active: still cannot acquire another
  perform pg_temp.expect('one left', pg_temp.active(gf), 1);
  perform pg_temp.refused(format('select pg_temp.claim(%L, %L)', w, o4), 'ranked_room_unavailable:%');
  perform pg_temp.expect('finish legacy 2', pg_temp.finish(g2, 'B'), true);
  -- free: their own waiting room can now be claimed
  perform pg_temp.expect('free again', pg_temp.active(gf), 0);
  perform pg_temp.expect('claim after grandfathering', pg_temp.claim(w, o4), true);
end;
$grandfathered$;

-- ── 16 · Only the service role reaches Ranked authority ───────────────────
do $security$
declare
  u constant text := '00000000-0000-4000-8000-0000000c70';
  viewer uuid := (u || '35')::uuid;
  w uuid;
  fn text;
begin
  perform pg_temp.act_as_service();
  w := pg_temp.waiting((u || '36')::uuid);
  foreach fn in array array[
    format('select * from public.ranked_stakes(%L, %L)', w, viewer),
    format($q$select * from public.ranked_claim_match_v2(%L, %L, 'V', 'rs1:x')$q$, w, viewer),
    format('select public.ranked_rating_outcome(1000, 0, 1000, 0, 1)'),
    format('select public.ranked_active_count(%L)', viewer),
    format('select * from public.ranked_matches'),
    format('select * from public.ranked_ratings'),
    format('select * from public.ranked_results')
  ] loop
    perform pg_temp.act_as(viewer);
    perform pg_temp.refused(fn, 'permission denied%');
    perform pg_temp.act_as_anon();
    perform pg_temp.refused(fn, 'permission denied%');
  end loop;
  perform pg_temp.act_as_service();
  -- the service role cannot reach the internals either, only the two entry points
  perform pg_temp.refused('select public.ranked_rating_outcome(1000, 0, 1000, 0, 1)', 'permission denied%');
  perform pg_temp.refused(format('select public.ranked_active_count(%L)', viewer), 'permission denied%');
  perform pg_temp.expect('service previews', (select count(*)::int from public.ranked_stakes(w, viewer)), 1);
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('definer functions pin search_path',
    (select count(*)::int from pg_proc where proname in ('ranked_stakes', 'ranked_claim_match_v2',
       'ranked_active_count', 'enforce_ranked_active_match', 'ranked_commit_match', 'ranked_rating_outcome')
       and pronamespace = 'public'::regnamespace
       and not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')), 0);
end;
$security$;

rollback;
