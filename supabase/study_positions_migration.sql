-- ── Study: analysing a position that is not a game ───────────────────────────
--
-- The app could only ever ask the engine about a LIVE ROOM: a request carries a
-- game id and a revision, and the server reads the position out of its own
-- state. That is the right rule for play — it is what stops a client asking
-- about a board that has already moved on, or about tiles it may not see.
--
-- Study is the other thing a strong player wants: "here is a position I made
-- up, what would you play?" There is no room, no opponent, no turn order and no
-- game log — the position is entirely the caller's own invention, so there is
-- nothing to hide from them and nothing to keep in sync.
--
-- What is kept is the ANSWER. A study record is the engine's ranked opinion at
-- a stated strength, and it is immutable by design: there is no update policy
-- below, because a record of what the bot thought is worthless if it can be
-- edited afterwards. Delete it or keep it; you cannot rewrite it.
--
-- Run this in the Supabase SQL editor after supabase/game_archives_migration.sql.

begin;

set statement_timeout = '120s';
set lock_timeout = '15s';

-- 1) TABLE --------------------------------------------------------------------

create table if not exists public.study_positions (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at     timestamptz not null default now(),

  -- The position, exactly as the engine was asked about it.
  score_self     int not null default 0,
  score_opponent int not null default 0,
  -- [{ "r": int, "c": int, "kind": text, "token": text }]
  board          jsonb not null default '[]'::jsonb,
  -- ["1", "+", "="] — the rack the analysis is FOR.
  rack           jsonb not null,
  -- Derived by the service from the physical tile set, never sent by a client:
  -- the opponent holds a full rack while the bag has tiles, and everything that
  -- is left once it does not. Stored because the analysis is not reproducible
  -- without them.
  opp_rack_count int not null check (opp_rack_count >= 0),
  bag_count      int not null check (bag_count >= 0),

  -- What was asked, and what came back.
  level          text not null check (level in ('medium', 'hard', 'max', 'super')),
  summary        text not null default '',
  -- { solver, samples, legalMoves, candidatesEvaluated, nodes, elapsedMs, proven, complete }
  method         jsonb not null default '{}'::jsonb,
  -- The ranked moves, best first. Capped at ten by the service.
  candidates     jsonb not null,

  constraint study_positions_candidates_is_array check (jsonb_typeof(candidates) = 'array'),
  constraint study_positions_board_is_array check (jsonb_typeof(board) = 'array'),
  constraint study_positions_rack_is_array check (jsonb_typeof(rack) = 'array')
);

create index if not exists study_positions_owner_idx
  on public.study_positions (owner_id, created_at desc);

comment on table public.study_positions is
  'One engine analysis of a made-up position. Immutable: no update policy exists, deliberately.';

-- 2) RLS ----------------------------------------------------------------------

alter table public.study_positions enable row level security;

-- Yours and only yours. A study position is a private note, not shared content:
-- there is no room, no members list and nobody else with a claim on it.
drop policy if exists study_positions_read on public.study_positions;
create policy study_positions_read on public.study_positions
  for select using (owner_id = auth.uid());

drop policy if exists study_positions_insert on public.study_positions;
create policy study_positions_insert on public.study_positions
  for insert with check (owner_id = auth.uid());

drop policy if exists study_positions_delete on public.study_positions;
create policy study_positions_delete on public.study_positions
  for delete using (owner_id = auth.uid());

-- Deliberately no `for update` policy. See the header.

grant select, insert, delete on public.study_positions to authenticated;

-- 3) WRITE PATH ---------------------------------------------------------------
--
-- The service persists the result, not the browser, and it calls this with the
-- CALLER'S token — so `auth.uid()` is the player and the policies above are the
-- authority, exactly as everywhere else in this schema. The service holds no
-- service-role key.
--
-- Why the server and not the client: a `super` analysis runs for minutes with
-- nobody watching. If saving were the browser's job, closing the tab would
-- throw away the compute that was already spent, and the record would exist
-- only for players who waited.
--
-- `security invoker` is the point of this function. It is a typed, validating
-- front door — not a way around RLS.
create or replace function public.save_study_analysis(
  p_score_self     int,
  p_score_opponent int,
  p_board          jsonb,
  p_rack           jsonb,
  p_opp_rack_count int,
  p_bag_count      int,
  p_level          text,
  p_summary        text,
  p_method         jsonb,
  p_candidates     jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'sign-in required' using errcode = '42501';
  end if;
  -- Ten is the product decision, enforced where it cannot be argued with. A
  -- caller that sends more is refused rather than silently truncated: a record
  -- that says "top 10" and holds 24 is a record nobody can reason about.
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) > 10 then
    raise exception 'candidates must be an array of at most 10 entries'
      using errcode = '22023';
  end if;

  insert into public.study_positions (
    owner_id, score_self, score_opponent, board, rack,
    opp_rack_count, bag_count, level, summary, method, candidates
  ) values (
    auth.uid(), p_score_self, p_score_opponent, coalesce(p_board, '[]'::jsonb), p_rack,
    p_opp_rack_count, p_bag_count, p_level, coalesce(p_summary, ''),
    coalesce(p_method, '{}'::jsonb), p_candidates
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.save_study_analysis(
  int, int, jsonb, jsonb, int, int, text, text, jsonb, jsonb
) from public;
grant execute on function public.save_study_analysis(
  int, int, jsonb, jsonb, int, int, text, text, jsonb, jsonb
) to authenticated;

commit;
