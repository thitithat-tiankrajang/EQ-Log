-- Foundation C7: Ranked match authority.
--
-- ONE ACTIVE RANKED MATCH. A Ranked match is ACTIVE for a user while the user
-- is seated in it (player_a_id / player_b_id) and its status is 'matched' or
-- 'playing'. A user may hold at most one. A 'waiting' room is not an active
-- match: it holds no rating stake, only a board (see 20260929130000). The two
-- rules are independent and both apply when a match is acquired:
--   board limit        20260929130000 (trigger ranked_matches_board_limit)
--   one active match   this file     (trigger ranked_matches_active_match)
--
-- Enforcement is on the ROWS, like the board limit: whenever an insert or
-- update seats a user in a match that is (becoming) active and that user was
-- not already seated in it while it was active, that user is locked and
-- recounted, and the change is refused if they already hold another active
-- match. That covers the v1 claim the current Edge Function calls, the new v2
-- claim and any direct write. Readying (matched → playing), moves, reads and
-- finishing seat nobody new and are never gated, so a user who already holds
-- several active matches from before this rule keeps and finishes all of them;
-- they just cannot acquire another until they are below the limit.
--
-- A waiting room whose creator becomes busy is NOT cancelled or deleted: it
-- stays stored and simply cannot be claimed until the creator is free again.
--
-- LOCKS. The same per-user advisory lock every board and plan write uses
-- (lock_board_users: hashtextextended(uuid, 41), users in UUID order), taken
-- AFTER the match row lock, exactly as the Phase 3 board trigger does. This
-- trigger fires before the board trigger (triggers fire in name order) and
-- locks every seated user of the row at once, so the board trigger's own lock
-- is a re-entry and no path takes two users in a different order.
-- ranked_commit_match's rating locks (namespace 781) are unchanged.
--
-- STAKES. ranked_stakes previews what a result would do to the viewer's
-- rating with the SAME function ranked_commit_match now uses to apply it
-- (ranked_rating_outcome — the expression is moved, not changed), and a basis
-- token over every input. ranked_claim_match_v2 recomputes the token under the
-- locks and refuses with ranked_stakes_changed when it differs.
--
-- ERRORS. Refusals raise the repository's `snake_code:` message prefix:
--   ranked_room_not_found, ranked_room_claimed, ranked_room_expired,
--   ranked_own_room, ranked_room_finished, ranked_already_active,
--   ranked_room_unavailable (creator busy), ranked_stakes_changed,
--   ranked_stakes_required, approval_required, and Phase 3's
--   active_board_limit / active_board_limit_unconfigured unchanged.
--
-- Additive: two functions, a trigger, two partial indexes. No data change.
-- Existing multi-match users are left exactly as they are. Idempotent.
begin;

-- ── The rating formula, in one place ────────────────────────────────────────
-- Verbatim from ranked_commit_match (20260925120000): Elo, K = 40 below ten
-- games and 24 after, the rating floor of 100, numeric `round`, and B's
-- expectation taken as 1 − A's. Only the service-side callers use it.
create or replace function public.ranked_rating_outcome(
  rating_a integer, games_a integer, rating_b integer, games_b integer, score_a numeric,
  out new_a integer, out new_b integer
)
language plpgsql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
declare
  expected_a numeric;
  expected_b numeric;
begin
  expected_a := 1 / (1 + power(10::numeric, (rating_b - rating_a)::numeric / 400));
  expected_b := 1 - expected_a;
  new_a := greatest(100, rating_a + round((case when games_a < 10 then 40 else 24 end) * (score_a - expected_a))::int);
  new_b := greatest(100, rating_b + round((case when games_b < 10 then 40 else 24 end) * ((1 - score_a) - expected_b))::int);
end; $$;

-- The result path now applies ratings through that function. Everything else
-- in ranked_commit_match is unchanged.
create or replace function public.ranked_commit_match(
  target_match_id uuid, target_revision bigint, target_state jsonb,
  target_winner text default null, target_reason text default null
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  match_row public.ranked_matches%rowtype;
  a public.ranked_ratings%rowtype;
  b public.ranked_ratings%rowtype;
  score_a numeric;
  new_a int;
  new_b int;
begin
  select * into match_row from public.ranked_matches where id = target_match_id for update;
  if not found or match_row.revision <> target_revision or match_row.status <> 'playing' then return false; end if;
  if target_state is null or coalesce(target_state ->> 'status', '') not in ('playing', 'finished') then
    raise exception 'invalid ranked state' using errcode = '22023';
  end if;
  if (target_state ->> 'status' = 'finished') <> (target_reason is not null) then
    raise exception 'result must match terminal state' using errcode = '22023';
  end if;
  if target_reason is not null and (target_reason not in ('score', 'resign', 'timeout')
    or target_winner is null or target_winner not in ('A', 'B', 'draw') or match_row.player_b_id is null) then
    raise exception 'invalid ranked result' using errcode = '22023';
  end if;
  if target_reason = 'score' and (
    (target_winner = 'A' and (target_state #>> '{scores,A}')::int <= (target_state #>> '{scores,B}')::int)
    or (target_winner = 'B' and (target_state #>> '{scores,B}')::int <= (target_state #>> '{scores,A}')::int)
    or (target_winner = 'draw' and (target_state #>> '{scores,A}')::int <> (target_state #>> '{scores,B}')::int)
  ) then
    raise exception 'ranked score and winner disagree' using errcode = '22023';
  end if;

  update public.ranked_matches set revision = revision + 1,
    status = case when target_reason is null then 'playing' else 'finished' end,
    state = target_state, updated_at = now() where id = target_match_id;
  if target_reason is null then return true; end if;

  -- Stable lock order across concurrent matches prevents rating deadlocks.
  perform pg_advisory_xact_lock(hashtextextended(least(match_row.player_a_id, match_row.player_b_id)::text, 781));
  perform pg_advisory_xact_lock(hashtextextended(greatest(match_row.player_a_id, match_row.player_b_id)::text, 781));
  insert into public.ranked_ratings(player_id) values (match_row.player_a_id), (match_row.player_b_id)
    on conflict (player_id) do nothing;
  select * into a from public.ranked_ratings where player_id = match_row.player_a_id for update;
  select * into b from public.ranked_ratings where player_id = match_row.player_b_id for update;
  score_a := case target_winner when 'A' then 1 when 'B' then 0 else 0.5 end;
  select o.new_a, o.new_b into new_a, new_b
    from public.ranked_rating_outcome(a.rating, a.games, b.rating, b.games, score_a) o;

  update public.ranked_ratings set rating = new_a, games = games + 1,
    wins = wins + case when score_a = 1 then 1 else 0 end,
    losses = losses + case when score_a = 0 then 1 else 0 end,
    draws = draws + case when score_a = 0.5 then 1 else 0 end,
    updated_at = now() where player_id = match_row.player_a_id;
  update public.ranked_ratings set rating = new_b, games = games + 1,
    wins = wins + case when score_a = 0 then 1 else 0 end,
    losses = losses + case when score_a = 1 then 1 else 0 end,
    draws = draws + case when score_a = 0.5 then 1 else 0 end,
    updated_at = now() where player_id = match_row.player_b_id;
  insert into public.ranked_results (
    match_id, player_a_id, player_b_id, winner_id, reason, score_a, score_b,
    rating_a_before, rating_b_before, rating_a_after, rating_b_after
  ) values (
    target_match_id, match_row.player_a_id, match_row.player_b_id,
    case target_winner when 'A' then match_row.player_a_id when 'B' then match_row.player_b_id else null end,
    target_reason, (target_state #>> '{scores,A}')::int, (target_state #>> '{scores,B}')::int,
    a.rating, b.rating, new_a, new_b
  );
  return true;
end; $$;
revoke all on function public.ranked_commit_match(uuid, bigint, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.ranked_commit_match(uuid, bigint, jsonb, text, text) to service_role;

-- ── One active Ranked match ─────────────────────────────────────────────────
create or replace function public.ranked_is_active(target_status text)
returns boolean
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select target_status in ('matched', 'playing')
$$;

-- The user's active Ranked matches other than `exclude_match`.
create or replace function public.ranked_active_count(target_user uuid, exclude_match uuid default null)
returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer from public.ranked_matches m
   where target_user in (m.player_a_id, m.player_b_id)
     and public.ranked_is_active(m.status)
     and m.id is distinct from exclude_match
$$;

create index if not exists ranked_active_player_a_idx on public.ranked_matches(player_a_id)
  where status in ('matched', 'playing');
create index if not exists ranked_active_player_b_idx on public.ranked_matches(player_b_id)
  where status in ('matched', 'playing');

create or replace function public.enforce_ranked_active_match()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
-- Seat comparisons are null-safe for the same reason as the board trigger.
declare
  was_active boolean := tg_op = 'UPDATE' and public.ranked_is_active(old.status);
  newly uuid[] := '{}';
  u uuid;
begin
  if not public.ranked_is_active(new.status) then
    return new;
  end if;
  if new.player_a_id is not null and not (was_active
       and new.player_a_id = any (array_remove(array[old.player_a_id, old.player_b_id], null))) then
    newly := newly || new.player_a_id;
  end if;
  if new.player_b_id is not null and not (was_active
       and new.player_b_id = any (array_remove(array[old.player_a_id, old.player_b_id], null))) then
    newly := newly || new.player_b_id;
  end if;
  if cardinality(newly) = 0 then
    return new;
  end if;
  -- Every seated user at once, in UUID order, before the board trigger locks
  -- any subset of them.
  perform public.lock_board_users(array[new.player_a_id, new.player_b_id]);
  for u in select distinct x from unnest(newly) x order by x loop
    if public.ranked_active_count(u, new.id) >= 1 then
      raise exception 'ranked_already_active: % already in an active Ranked match',
        case when u = auth.uid() then 'you are' else 'a seated player is' end
        using errcode = 'P0001';
    end if;
  end loop;
  return new;
end; $$;

-- Named to fire before ranked_matches_board_limit (triggers fire in name order).
drop trigger if exists ranked_matches_active_match on public.ranked_matches;
create trigger ranked_matches_active_match
  before insert or update of player_a_id, player_b_id, status
  on public.ranked_matches
  for each row execute function public.enforce_ranked_active_match();

-- ── Stakes ──────────────────────────────────────────────────────────────────
-- What the viewer's rating would become on each result of this match, from
-- the ratings the result path would read right now. For a waiting room the
-- viewer is the prospective claimant (who takes seat B); for a matched or
-- playing match, one of its two players. `basis` is a token over every input
-- (match, both players, the viewer's seat, both ratings and games played), so
-- the claim can tell that the stakes shown are no longer the stakes.
create or replace function public.ranked_stakes(target_match_id uuid, target_player_id uuid)
returns table (
  match_id uuid,
  viewer_side text,
  opponent_id uuid,
  viewer_rating integer,
  viewer_games integer,
  opponent_rating integer,
  win_rating integer,
  draw_rating integer,
  loss_rating integer,
  basis text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  m public.ranked_matches%rowtype;
  side text;
  opponent uuid;
  r_a integer;
  g_a integer;
  r_b integer;
  g_b integer;
  win_o record;
  draw_o record;
  loss_o record;
begin
  if target_match_id is null or target_player_id is null then
    raise exception 'ranked_room_not_found: no such Ranked room' using errcode = 'P0002';
  end if;
  select * into m from public.ranked_matches r where r.id = target_match_id;
  if not found then
    raise exception 'ranked_room_not_found: no such Ranked room' using errcode = 'P0002';
  end if;
  if m.status = 'finished' then
    raise exception 'ranked_room_finished: this Ranked match has finished' using errcode = 'P0001';
  end if;
  if m.status = 'waiting' then
    if m.player_a_id = target_player_id then
      raise exception 'ranked_own_room: this is your own Ranked room' using errcode = 'P0001';
    end if;
    if m.created_at <= now() - interval '24 hours' then
      raise exception 'ranked_room_expired: this Ranked room is no longer open' using errcode = 'P0001';
    end if;
    side := 'B';
    opponent := m.player_a_id;
  elsif target_player_id = m.player_a_id then
    side := 'A';
    opponent := m.player_b_id;
  elsif target_player_id = m.player_b_id then
    side := 'B';
    opponent := m.player_a_id;
  else
    raise exception 'ranked_room_claimed: this Ranked room has already been taken' using errcode = 'P0001';
  end if;

  -- A player without a ratings row is rated as the row's defaults, as the
  -- result path would create it.
  select coalesce(max(x.rating), 1000), coalesce(max(x.games), 0) into r_a, g_a
    from public.ranked_ratings x where x.player_id = case when side = 'A' then target_player_id else opponent end;
  select coalesce(max(x.rating), 1000), coalesce(max(x.games), 0) into r_b, g_b
    from public.ranked_ratings x where x.player_id = case when side = 'B' then target_player_id else opponent end;

  select * into win_o from public.ranked_rating_outcome(r_a, g_a, r_b, g_b, case when side = 'A' then 1 else 0 end);
  select * into draw_o from public.ranked_rating_outcome(r_a, g_a, r_b, g_b, 0.5);
  select * into loss_o from public.ranked_rating_outcome(r_a, g_a, r_b, g_b, case when side = 'A' then 0 else 1 end);

  return query select
    m.id,
    side,
    opponent,
    case when side = 'A' then r_a else r_b end,
    case when side = 'A' then g_a else g_b end,
    case when side = 'A' then r_b else r_a end,
    case when side = 'A' then win_o.new_a else win_o.new_b end,
    case when side = 'A' then draw_o.new_a else draw_o.new_b end,
    case when side = 'A' then loss_o.new_a else loss_o.new_b end,
    'rs1:' || encode(sha256(convert_to(concat_ws('|',
      m.id, target_player_id, side, opponent, r_a, g_a, r_b, g_b), 'UTF8')), 'hex');
end; $$;

-- ── Claim, v2 ───────────────────────────────────────────────────────────────
-- The claim a stakes-aware client makes: the basis it was shown must still be
-- the basis. Every rule is checked here, under the locks, whatever any list
-- said. The v1 claim (ranked_claim_match) is unchanged and still used by the
-- current Edge Function; the one-active rule reaches it through the trigger.
-- Claiming a match you already hold is a resume and succeeds without change.
create or replace function public.ranked_claim_match_v2(
  target_match_id uuid, target_player_id uuid, target_player_name text,
  target_stakes_basis text, target_now timestamptz default now()
)
returns table (match_id uuid, revision bigint, resumed boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m public.ranked_matches%rowtype;
  t timestamptz := clock_timestamp();
  current_basis text;
  held integer;
  cap integer;
begin
  if target_player_id is null then
    raise exception 'approval_required: an approved account is required' using errcode = '42501';
  end if;
  if coalesce(target_stakes_basis, '') = '' then
    raise exception 'ranked_stakes_required: confirm the stakes before joining' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = target_player_id and p.status = 'approved') then
    raise exception 'approval_required: an approved account is required' using errcode = '42501';
  end if;

  select * into m from public.ranked_matches r where r.id = target_match_id for update;
  if not found then
    raise exception 'ranked_room_not_found: no such Ranked room' using errcode = 'P0002';
  end if;
  if m.player_b_id = target_player_id and public.ranked_is_active(m.status) then
    return query select m.id, m.revision, true;
    return;
  end if;
  if m.player_a_id = target_player_id then
    raise exception 'ranked_own_room: this is your own Ranked room' using errcode = 'P0001';
  end if;
  if m.status <> 'waiting' then
    raise exception 'ranked_room_claimed: this Ranked room has already been taken' using errcode = 'P0001';
  end if;
  if m.created_at <= t - interval '24 hours' then
    raise exception 'ranked_room_expired: this Ranked room is no longer open' using errcode = 'P0001';
  end if;

  -- Both players, in UUID order, after the row lock: the order the triggers use.
  perform public.lock_board_users(array[m.player_a_id, target_player_id]);

  if public.ranked_active_count(target_player_id) >= 1 then
    raise exception 'ranked_already_active: you are already in an active Ranked match' using errcode = 'P0001';
  end if;
  if public.ranked_active_count(m.player_a_id) >= 1 then
    raise exception 'ranked_room_unavailable: this room''s creator is in another Ranked match' using errcode = 'P0001';
  end if;

  -- The claimant gains a board; the creator's waiting room already counts.
  -- Phase 3's own count and limit, worded for the claimant.
  cap := public.active_board_limit();
  held := public.active_board_count(target_player_id, t, null, m.id);
  if held >= cap then
    raise exception 'active_board_limit: you have % active boards already (limit %)', held, cap
      using errcode = 'P0001';
  end if;

  -- Neither player holds an active match, so no result can move either rating
  -- until this transaction ends: the basis read here is the basis claimed.
  select s.basis into current_basis from public.ranked_stakes(m.id, target_player_id) s;
  if current_basis is distinct from target_stakes_basis then
    raise exception 'ranked_stakes_changed: the stakes for this match have changed' using errcode = 'P0001';
  end if;

  update public.ranked_matches r set
    player_b_id = target_player_id,
    status = 'matched',
    revision = r.revision + 1,
    state = jsonb_set(
      jsonb_set(
        r.state, '{playerUserIds,B}', to_jsonb(target_player_id::text), true),
      '{players,B}', to_jsonb(coalesce(nullif(btrim(target_player_name), ''), 'Player')), true),
    updated_at = target_now
  where r.id = m.id;
  return query select m.id, m.revision + 1, false;
end; $$;

revoke all on function public.ranked_rating_outcome(integer, integer, integer, integer, numeric) from public, anon, authenticated, service_role;
revoke all on function public.ranked_is_active(text) from public, anon, authenticated, service_role;
revoke all on function public.ranked_active_count(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.enforce_ranked_active_match() from public, anon, authenticated, service_role;
revoke all on function public.ranked_stakes(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ranked_claim_match_v2(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.ranked_stakes(uuid, uuid) to service_role;
grant execute on function public.ranked_claim_match_v2(uuid, uuid, text, text, timestamptz) to service_role;

commit;
