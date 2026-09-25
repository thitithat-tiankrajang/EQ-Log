-- ── Multiverse: the lines of a live game that are not being played ─────────────
--
-- A game can branch: go back to turn nine, play something else, and keep what was played. The
-- client keeps `room_live.state.logs` a single straight line — the line being played — so every
-- existing reader (scoring, the bot, archiving, stats, `snapshot_completion_reason`) keeps
-- seeing exactly the shape it always saw. The other lines are PARKED here, one document per
-- game, beside the live row rather than inside it.
--
-- Beside and not inside, for speed. `room_live.state` is written on every move, walked by
-- `sanitize_game_snapshot` twice per commit, and pushed to every player by Realtime. Parked
-- lines only change when somebody branches or switches lines, so they are written then and
-- read on demand — never with a move, never by Realtime. A game that never branches has no row
-- here at all, and its moves cost exactly what they cost before this migration.
--
-- The one thing the live state says about this table is `state.timelineRef`
-- ({"version": n, "lines": k}, a few dozen bytes): enough for another device to notice the
-- parked lines changed and fetch them.
--
-- Guarantees:
--   • A branch moves the live position AND rewrites the parked lines in one transaction, through
--     `commit_live_game_timeline`, on top of the ordinary conditional commit. Either both land or
--     neither does, so a line can never be both parked and live, or lost between the two.
--   • Every write names the document version it was built on. A stale write is refused
--     (`timeline_conflict`) instead of overwriting a newer document.
--   • Pruning can only remove whole lines (`update_live_game_timeline`); it cannot add or edit
--     one, and it never touches the live position.
--   • When the game finishes, its parked lines are folded into the archived snapshot as
--     `snapshot.timeline` by a trigger, then removed with the live row. Archives stay
--     self-contained: copying one to a region or a private library carries its lines along.
--
-- Run in the Supabase SQL editor after supabase/canonical_revision_migration.sql (and
-- supabase/waiting_room_ready_repair.sql where that applies). Safe to run more than once.
-- Nothing existing is rewritten: games without branches need no data migration.

begin;

set lock_timeout = '15s';
set statement_timeout = '120s';

-- 1) THE PARKED DOCUMENT ------------------------------------------------------------

create table if not exists public.game_timelines (
  game_id    uuid primary key references public.room_live(room_id) on delete cascade,
  -- Bumped by every write. Equal to state.timelineRef.version of the position committed with it.
  version    bigint not null check (version > 0),
  line_count int not null default 0 check (line_count >= 0),
  node_count int not null default 0 check (node_count >= 0),
  -- {"v": 1, "version": n, "lines": [...]}: turns as manifest ordinals, boards as deltas. See
  -- src/gameplay/multiverseCodec.ts. Opaque to the database beyond its outline.
  doc        jsonb not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint game_timelines_doc_shape check (
    jsonb_typeof(doc) = 'object' and jsonb_typeof(doc -> 'lines') = 'array'
  ),
  -- Generous next to what the client allows itself (40 lines), and still a hard ceiling: one
  -- runaway client must not be able to park megabytes against a live game.
  constraint game_timelines_line_limit check (line_count <= 100),
  constraint game_timelines_doc_size check (octet_length(doc::text) <= 2097152)
);

comment on table public.game_timelines is
  'Lines of a live game that are not being played. Written on branch/switch/prune only, never per move, never published to Realtime.';
comment on column public.game_timelines.version is
  'Monotonic per game. The live state names the version it was committed with in state.timelineRef.';

alter table public.game_timelines enable row level security;
revoke all on table public.game_timelines from public, anon, authenticated;
grant select on table public.game_timelines to authenticated;

-- Whoever may read the game may read its lines: spectators can study them too. Nobody writes
-- the table directly; the two functions below are the only doors.
drop policy if exists game_timelines_read on public.game_timelines;
create policy game_timelines_read on public.game_timelines for select
  using (public.can_read_live_game(game_id));

-- Outline checks shared by both writers. Returns the parked-turn count.
create or replace function public.validate_game_timeline(target_timeline jsonb)
returns int
language plpgsql immutable set search_path = public as $$
declare
  line_total int;
  node_total int := 0;
  line jsonb;
begin
  if target_timeline is null or jsonb_typeof(target_timeline) <> 'object' then
    raise exception 'the parked lines must be a document' using errcode = '22023';
  end if;
  if coalesce(target_timeline ->> 'v', '') <> '1' then
    raise exception 'unsupported parked-lines format %', target_timeline ->> 'v'
      using errcode = '22023';
  end if;
  if jsonb_typeof(target_timeline -> 'lines') is distinct from 'array' then
    raise exception 'the parked lines need a lines array' using errcode = '22023';
  end if;
  line_total := jsonb_array_length(target_timeline -> 'lines');
  if line_total > 100 then
    raise exception 'too many parked lines (%)', line_total using errcode = '22023';
  end if;
  if octet_length(target_timeline::text) > 2097152 then
    raise exception 'the parked lines are too large' using errcode = '22023';
  end if;
  for line in select value from jsonb_array_elements(target_timeline -> 'lines') loop
    if jsonb_typeof(line) <> 'object'
      or coalesce(btrim(line ->> 'id'), '') = ''
      or jsonb_typeof(line -> 'logs') is distinct from 'array'
      or jsonb_array_length(line -> 'logs') = 0
    then
      raise exception 'every parked line needs an id and at least one turn' using errcode = '22023';
    end if;
    node_total := node_total + jsonb_array_length(line -> 'logs');
  end loop;
  return node_total;
end; $$;

revoke all on function public.validate_game_timeline(jsonb)
  from public, anon, authenticated, service_role;

-- 2) BRANCH OR SWITCH: MOVE THE POSITION AND THE PARKED LINES TOGETHER -----------------

create or replace function public.commit_live_game_timeline(
  target_game_id uuid,
  target_expected_revision bigint,
  target_command_id text,
  target_issued_by text,
  target_command jsonb,
  target_canonical jsonb,
  target_canonical_digest text,
  target_state jsonb,
  target_session jsonb,
  target_timeline jsonb,
  target_timeline_expected_version bigint
)
returns table (outcome text, revision bigint, timeline_version bigint)
language plpgsql security definer set search_path = public as $$
declare
  head public.room_live%rowtype;
  current_version bigint;
  next_version bigint;
  node_total int;
  committed record;
begin
  node_total := public.validate_game_timeline(target_timeline);
  if target_state is null or jsonb_typeof(target_state) <> 'object' then
    raise exception 'a branch must carry the position it lands on' using errcode = '22023';
  end if;
  if target_timeline_expected_version is null or target_timeline_expected_version < 0 then
    raise exception 'a branch must name the parked-lines version it was built on'
      using errcode = '22023';
  end if;

  -- Lock order: the game row, then its parked lines. Every writer here takes them in this
  -- order, and the archive trigger only runs inside finalize, which already holds the game row.
  select * into head from public.room_live where room_id = target_game_id for update;
  if not found then
    raise exception 'live game not found' using errcode = 'P0002';
  end if;
  if not public.can_write_live_game(target_game_id) then
    raise exception 'live game write access required' using errcode = '42501';
  end if;

  select t.version into current_version
    from public.game_timelines t where t.game_id = target_game_id for update;
  current_version := coalesce(current_version, 0);

  -- A retry of a branch that already landed: report it as such, before any version check can
  -- mistake our own earlier write for somebody else's.
  if exists (
    select 1 from public.live_game_events e
     where e.game_id = target_game_id and e.command_id = target_command_id
  ) then
    return query select 'duplicate'::text, head.revision, current_version;
    return;
  end if;

  if current_version <> target_timeline_expected_version then
    return query select 'timeline_conflict'::text, head.revision, current_version;
    return;
  end if;

  next_version := current_version + 1;
  -- The position and the document must name each other; anything else is a client bug that
  -- would leave another device fetching lines that do not match what it is looking at.
  if coalesce(target_state #>> '{timelineRef,version}', '') <> next_version::text then
    raise exception 'the position must reference parked-lines version %', next_version
      using errcode = '22023';
  end if;

  select * into committed from public.commit_live_game_command(
    target_game_id,
    target_expected_revision,
    target_command_id,
    target_issued_by,
    target_command,
    target_canonical,
    target_canonical_digest,
    target_state,
    target_session
  );
  if committed.outcome is distinct from 'committed' then
    return query select committed.outcome::text, committed.revision::bigint, current_version;
    return;
  end if;

  insert into public.game_timelines as t (
    game_id, version, line_count, node_count, doc, updated_by, updated_at
  ) values (
    target_game_id,
    next_version,
    jsonb_array_length(target_timeline -> 'lines'),
    node_total,
    jsonb_build_object(
      'v', 1,
      'version', next_version,
      'lines', public.sanitize_game_snapshot(target_timeline -> 'lines')
    ),
    auth.uid(),
    now()
  )
  on conflict (game_id) do update
    set version = excluded.version,
        line_count = excluded.line_count,
        node_count = excluded.node_count,
        doc = excluded.doc,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  return query select 'committed'::text, committed.revision::bigint, next_version;
end; $$;

revoke all on function public.commit_live_game_timeline(
  uuid, bigint, text, text, jsonb, jsonb, text, jsonb, jsonb, jsonb, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.commit_live_game_timeline(
  uuid, bigint, text, text, jsonb, jsonb, text, jsonb, jsonb, jsonb, bigint
) to authenticated;

-- 3) PRUNE: FORGET PARKED LINES, NOTHING ELSE -----------------------------------------

create or replace function public.update_live_game_timeline(
  target_game_id uuid,
  target_timeline jsonb,
  target_timeline_expected_version bigint
)
returns table (outcome text, timeline_version bigint)
language plpgsql security definer set search_path = public as $$
declare
  stored public.game_timelines%rowtype;
  next_version bigint;
  node_total int;
begin
  node_total := public.validate_game_timeline(target_timeline);

  perform 1 from public.room_live where room_id = target_game_id for update;
  if not found then
    raise exception 'live game not found' using errcode = 'P0002';
  end if;
  if not public.can_write_live_game(target_game_id) then
    raise exception 'live game write access required' using errcode = '42501';
  end if;

  select * into stored from public.game_timelines t where t.game_id = target_game_id for update;
  if not found then
    return query select 'timeline_conflict'::text, 0::bigint;
    return;
  end if;
  if stored.version <> target_timeline_expected_version then
    return query select 'timeline_conflict'::text, stored.version;
    return;
  end if;

  -- Only whole existing lines may remain. A line cannot be added or edited from here: that
  -- would park turns the live position never had, without the conditional commit that proves
  -- where they came from.
  if exists (
    select 1 from jsonb_array_elements(target_timeline -> 'lines') kept
     where not exists (
       select 1 from jsonb_array_elements(stored.doc -> 'lines') old where old = kept
     )
  ) then
    raise exception 'pruning may only remove parked lines' using errcode = '22023';
  end if;

  next_version := stored.version + 1;
  update public.game_timelines
     set version = next_version,
         line_count = jsonb_array_length(target_timeline -> 'lines'),
         node_count = node_total,
         doc = jsonb_build_object(
           'v', 1, 'version', next_version, 'lines', target_timeline -> 'lines'
         ),
         updated_by = auth.uid(),
         updated_at = now()
   where game_id = target_game_id;

  return query select 'committed'::text, next_version;
end; $$;

revoke all on function public.update_live_game_timeline(uuid, jsonb, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.update_live_game_timeline(uuid, jsonb, bigint) to authenticated;

-- 4) FINISHING: THE LINES GO INTO THE ARCHIVE WITH THE GAME ---------------------------
--
-- `finalize_live_game` inserts the archive row and then deletes the live row, which cascades to
-- `game_timelines`. This trigger runs on that insert, while the parked lines still exist, and
-- folds them into the snapshot. It is deliberately narrow: it only fires when the snapshot has
-- no lines of its own, when there is something to fold, and when the caller could write the
-- live game — so a private-library insert that names somebody else's game id gets nothing.
create or replace function public.attach_game_timeline_to_archive()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parked jsonb;
begin
  if new.game_id is null
    or new.snapshot is null
    or jsonb_typeof(new.snapshot) <> 'object'
    or new.snapshot ? 'timeline'
  then
    return new;
  end if;
  select t.doc into parked from public.game_timelines t
   where t.game_id = new.game_id and t.line_count > 0;
  if parked is null or not public.can_write_live_game(new.game_id) then
    return new;
  end if;
  new.snapshot := new.snapshot || jsonb_build_object('timeline', parked);
  return new;
end; $$;

revoke all on function public.attach_game_timeline_to_archive()
  from public, anon, authenticated, service_role;

drop trigger if exists attach_game_timeline on public.public_game_snapshots;
create trigger attach_game_timeline
  before insert on public.public_game_snapshots
  for each row execute function public.attach_game_timeline_to_archive();

drop trigger if exists attach_game_timeline on public.region_game_snapshots;
create trigger attach_game_timeline
  before insert on public.region_game_snapshots
  for each row execute function public.attach_game_timeline_to_archive();

drop trigger if exists attach_game_timeline on public.private_library_items;
create trigger attach_game_timeline
  before insert on public.private_library_items
  for each row execute function public.attach_game_timeline_to_archive();

-- 5) VERIFY THE CONTRACT ---------------------------------------------------------------

do $verify$
begin
  if has_table_privilege('anon', 'public.game_timelines', 'SELECT') then
    raise exception 'anon must not read parked lines';
  end if;
  if has_table_privilege('authenticated', 'public.game_timelines', 'INSERT')
    or has_table_privilege('authenticated', 'public.game_timelines', 'UPDATE')
    or has_table_privilege('authenticated', 'public.game_timelines', 'DELETE')
  then
    raise exception 'parked lines must only be written through their functions';
  end if;
  if has_function_privilege(
    'anon',
    'public.commit_live_game_timeline(uuid, bigint, text, text, jsonb, jsonb, text, jsonb, jsonb, jsonb, bigint)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon', 'public.update_live_game_timeline(uuid, jsonb, bigint)', 'EXECUTE'
  ) then
    raise exception 'anon must not branch games';
  end if;
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_timelines'
  ) then
    raise exception 'parked lines must stay out of Realtime';
  end if;
end;
$verify$;

commit;

notify pgrst, 'reload schema';
