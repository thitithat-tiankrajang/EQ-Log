-- Ranked positions are intentionally separate from room_live. No authenticated
-- role can SELECT these rows: state includes both racks, the draw queue and
-- complete historical logs. Only the ranked Edge Function uses service_role.
begin;

create table if not exists public.ranked_matches (
  id uuid primary key default gen_random_uuid(),
  player_a_id uuid not null references public.profiles(id),
  player_b_id uuid references public.profiles(id),
  status text not null check (status in ('waiting', 'matched', 'playing', 'finished')),
  revision bigint not null default 0 check (revision >= 0),
  minutes_a int not null check (minutes_a in (10, 15, 20, 30)),
  minutes_b int not null check (minutes_b in (10, 15, 20, 30)),
  constraint ranked_equal_clocks check (minutes_a = minutes_b),
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ranked_distinct_players check (player_a_id is distinct from player_b_id),
  constraint ranked_seats_match_status check ((status = 'waiting') = (player_b_id is null))
);

create index if not exists ranked_waiting_idx on public.ranked_matches(created_at desc)
  where status = 'waiting';
create unique index if not exists ranked_one_waiting_per_creator_idx on public.ranked_matches(player_a_id)
  where status = 'waiting';
create index if not exists ranked_player_a_idx on public.ranked_matches(player_a_id, updated_at desc);
create index if not exists ranked_player_b_idx on public.ranked_matches(player_b_id, updated_at desc);

create table if not exists public.ranked_ratings (
  player_id uuid primary key references public.profiles(id) on delete cascade,
  rating int not null default 1000 check (rating >= 100),
  games int not null default 0 check (games >= 0),
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.ranked_results (
  match_id uuid primary key references public.ranked_matches(id),
  player_a_id uuid not null references public.profiles(id),
  player_b_id uuid not null references public.profiles(id),
  winner_id uuid references public.profiles(id),
  reason text not null check (reason in ('score', 'resign', 'timeout')),
  score_a int not null,
  score_b int not null,
  rating_a_before int not null,
  rating_b_before int not null,
  rating_a_after int not null,
  rating_b_after int not null,
  created_at timestamptz not null default now()
);

alter table public.ranked_matches enable row level security;
alter table public.ranked_ratings enable row level security;
alter table public.ranked_results enable row level security;
revoke all on public.ranked_matches, public.ranked_ratings, public.ranked_results from public, anon, authenticated;
grant select, insert, update, delete on public.ranked_matches to service_role;
grant select, insert, update on public.ranked_ratings to service_role;
grant select, insert on public.ranked_results to service_role;

-- Claiming a seat does not start the clock. The ready transaction starts it
-- only after both players opt in, using server time rather than browser time.
create or replace function public.ranked_claim_match(target_match_id uuid, target_player_id uuid, target_player_name text, target_now timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare match_row public.ranked_matches%rowtype;
begin
  select * into match_row from public.ranked_matches where id = target_match_id for update;
  if not found or match_row.status <> 'waiting' or match_row.player_b_id is not null
    or match_row.created_at < now() - interval '24 hours'
    or match_row.player_a_id = target_player_id then return false; end if;
  if not exists (select 1 from public.profiles where id = target_player_id and status = 'approved') then
    raise exception 'approved account required' using errcode = '42501';
  end if;
  update public.ranked_matches set
    player_b_id = target_player_id,
    status = 'matched',
    revision = revision + 1,
    state = jsonb_set(
      jsonb_set(
        state, '{playerUserIds,B}', to_jsonb(target_player_id::text), true),
      '{players,B}', to_jsonb(target_player_name), true),
    updated_at = target_now
  where id = target_match_id;
  return true;
end; $$;
revoke all on function public.ranked_claim_match(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.ranked_claim_match(uuid, uuid, text, timestamptz) to service_role;

create or replace function public.ranked_ready_match(target_match_id uuid, target_player_id uuid, target_now timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  match_row public.ranked_matches%rowtype;
  ready_a boolean;
  ready_b boolean;
  next_state jsonb;
begin
  select * into match_row from public.ranked_matches where id = target_match_id for update;
  if not found or match_row.status <> 'matched'
    or target_player_id not in (match_row.player_a_id, match_row.player_b_id) then return false; end if;
  ready_a := coalesce((match_row.state #>> '{lobbyReadyBySide,A}')::boolean, false)
    or target_player_id = match_row.player_a_id;
  ready_b := coalesce((match_row.state #>> '{lobbyReadyBySide,B}')::boolean, false)
    or target_player_id = match_row.player_b_id;
  next_state := jsonb_set(
    jsonb_set(match_row.state, '{lobbyReadyBySide,A}', to_jsonb(ready_a), true),
    '{lobbyReadyBySide,B}', to_jsonb(ready_b), true);
  if ready_a and ready_b then
    next_state := jsonb_set(
      jsonb_set(
        jsonb_set(next_state, '{roomStage}', '"playing"'::jsonb, true),
        '{status}', '"playing"'::jsonb, true),
      '{timers,paused}', 'false'::jsonb, true)
      || jsonb_build_object('currentTurnStartedAt', target_now::text);
  end if;
  update public.ranked_matches set
    status = case when ready_a and ready_b then 'playing' else 'matched' end,
    revision = revision + 1,
    state = next_state,
    updated_at = target_now
  where id = target_match_id;
  return true;
end; $$;
revoke all on function public.ranked_ready_match(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.ranked_ready_match(uuid, uuid, timestamptz) to service_role;

-- Compare-and-set makes a retry or a second tab unable to count the same game
-- twice. Rating and result rows commit in the SAME database transaction.
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
  expected_a numeric;
  expected_b numeric;
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
  expected_a := 1 / (1 + power(10::numeric, (b.rating - a.rating)::numeric / 400));
  expected_b := 1 - expected_a;
  new_a := greatest(100, a.rating + round((case when a.games < 10 then 40 else 24 end) * (score_a - expected_a))::int);
  new_b := greatest(100, b.rating + round((case when b.games < 10 then 40 else 24 end) * ((1 - score_a) - expected_b))::int);

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

commit;
