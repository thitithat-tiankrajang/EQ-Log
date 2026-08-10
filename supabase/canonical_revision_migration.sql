-- ── Canonical revisions, conditional commits and cheap spectator fan-out ─────
--
-- Replaces last-writer-wins state pushes with a conditional, ordered,
-- idempotent commit protocol.
--
-- Before: every client PUT the whole game state whenever it thought it had
-- something newer. Ordering was decided after the fact, on the client, by
-- comparing log lengths and wall-clock timestamps. Two writers on the same
-- position both succeeded and the later arrival won, whatever it contained.
--
-- After:
--   • room_live.revision is the authoritative position of the game.
--   • A commit names the revision it was composed against and is applied ONLY
--     if the game is still there (compare-and-set inside one locked
--     transaction). The loser is told it conflicted and resynchronizes.
--   • Every accepted commit appends one immutable row to live_game_events at
--     revision N+1. The log is the ordered truth; the stored canonical state is
--     the materialized head of that log, and carries a digest so any observer
--     can prove agreement instead of assuming it.
--   • A command id can be committed at most once per game, so a retry after a
--     lost response cannot apply a physical move twice.
--
-- Spectators never write. They read one snapshot and then follow deltas, which
-- is why this migration also moves fan-out onto Realtime Broadcast: one small
-- message per move, published once, instead of a full-state row change
-- re-evaluated per subscriber.

begin;

set lock_timeout = '15s';

-- 1) The authoritative position ---------------------------------------------

alter table public.room_live
  add column if not exists revision bigint not null default 0,
  add column if not exists canonical jsonb,
  add column if not exists canonical_digest text;

comment on column public.room_live.revision is
  'Authoritative position of this game. Monotonic; exactly +1 per committed command.';
comment on column public.room_live.canonical is
  'Canonical committed state AT `revision`: the closed 100-tile placement table plus turn control.';
comment on column public.room_live.canonical_digest is
  'Digest of `canonical`, so observers can prove they agree at a revision rather than assume it.';

-- 2) The ordered, immutable command log --------------------------------------

create table if not exists public.live_game_events (
  game_id      uuid not null references public.room_live(room_id) on delete cascade,
  revision     bigint not null check (revision > 0),
  command_id   text not null check (btrim(command_id) <> ''),
  issued_by    text not null check (issued_by in ('A', 'B', 'host')),
  actor_id     uuid references public.profiles(id) on delete set null,
  command      jsonb not null,
  committed_at timestamptz not null default now(),
  primary key (game_id, revision)
);

-- One physical effect per intent: a retried command id is refused by the index
-- rather than appended a second time.
create unique index if not exists live_game_events_command_unique_idx
  on public.live_game_events (game_id, command_id);
create index if not exists live_game_events_stream_idx
  on public.live_game_events (game_id, revision);

alter table public.live_game_events enable row level security;
revoke all on table public.live_game_events from anon, authenticated;
grant select on table public.live_game_events to authenticated;

-- Anyone who may read the game may read its deltas. Nobody may write them
-- directly; the commit function is the only door.
drop policy if exists live_game_events_read on public.live_game_events;
create policy live_game_events_read on public.live_game_events for select
  using (public.can_read_live_game(game_id));

-- The log is append-only. Rewriting history would let an older state overwrite
-- a newer one, which is the exact failure this migration exists to remove.
create or replace function public.reject_live_event_rewrite()
returns trigger language plpgsql as $$
begin
  raise exception 'committed game events are immutable' using errcode = '42501';
end; $$;

drop trigger if exists live_game_events_immutable on public.live_game_events;
create trigger live_game_events_immutable
  before update or delete on public.live_game_events
  for each row execute function public.reject_live_event_rewrite();

-- 3) Spectator fan-out --------------------------------------------------------
--
-- One broadcast per committed move on topic `game:<uuid>`. Publishing is O(1)
-- in the number of spectators, and the payload is the canonical placement
-- table — bounded at roughly 100 short entries no matter how long the game runs
-- — rather than the full record with its per-turn board and rack copies.
--
-- A canonical state is self-sufficient at its revision, so a spectator that
-- misses messages needs no replay: the next one it receives already carries
-- everything, and the revision compare stops an older one from landing on a
-- newer one. The event log beside it exists for ordering, idempotency and
-- audit, not for rendering.
--
-- Projects whose Realtime does not expose broadcast-from-database keep working:
-- clients fall back to postgres_changes, which this migration leaves in place.

-- Published explicitly at the end of a commit, once the head has actually
-- moved. A trigger on the event insert would fire while `room_live` still held
-- the previous revision's state and would broadcast a state one move behind its
-- own revision number.
create or replace function public.broadcast_live_game_commit(
  target_game_id uuid,
  target_revision bigint,
  target_command_id text,
  target_issued_by text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  head public.room_live%rowtype;
begin
  if to_regproc('realtime.send') is null then
    return;
  end if;
  select * into head from public.room_live where room_id = target_game_id;
  if not found or head.revision is distinct from target_revision then
    return;
  end if;
  perform realtime.send(
    jsonb_build_object(
      'revision', target_revision,
      'gameId', target_game_id,
      'commandId', target_command_id,
      'issuedBy', target_issued_by,
      'canonical', head.canonical,
      'canonicalDigest', head.canonical_digest
    ),
    'commit',
    'game:' || target_game_id::text,
    false
  );
end; $$;

revoke all on function public.broadcast_live_game_commit(uuid, bigint, text, text)
  from public, anon, authenticated, service_role;

drop trigger if exists broadcast_live_game_event on public.live_game_events;

-- Reading a game's broadcast topic requires read access to that game, so the
-- authorization is checked once when a spectator joins the topic instead of
-- once per row per change.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $policy$
      drop policy if exists live_game_broadcast_read on realtime.messages;
    $policy$;
    execute $policy$
      create policy live_game_broadcast_read on realtime.messages for select
        to authenticated
        using (
          extension = 'broadcast'
          and topic like 'game:%'
          and public.can_read_live_game(nullif(split_part(topic, ':', 2), '')::uuid)
        );
    $policy$;
  end if;
end; $$;

-- 4) The conditional commit ---------------------------------------------------

create or replace function public.commit_live_game_command(
  target_game_id uuid,
  target_expected_revision bigint,
  target_command_id text,
  target_issued_by text,
  target_command jsonb,
  target_canonical jsonb,
  target_canonical_digest text,
  target_state jsonb default null,
  target_session jsonb default null
)
returns table (
  outcome text,
  revision bigint,
  canonical jsonb,
  canonical_digest text
)
language plpgsql security definer set search_path = public as $$
declare
  live public.room_live%rowtype;
  existing public.live_game_events%rowtype;
  next_revision bigint;
  clean_session jsonb;
begin
  if target_command is null or jsonb_typeof(target_command) <> 'object' then
    raise exception 'a command must be an object' using errcode = '22023';
  end if;
  if target_canonical is null or jsonb_typeof(target_canonical) <> 'object' then
    raise exception 'canonical state must be an object' using errcode = '22023';
  end if;
  if coalesce(btrim(target_command_id), '') = '' then
    raise exception 'a command must carry a stable id' using errcode = '22023';
  end if;
  if target_issued_by not in ('A', 'B', 'host') then
    raise exception 'a command must be issued by A, B or host' using errcode = '22023';
  end if;

  -- Serialize every commit for this game behind one row lock. Two players
  -- acting on the same revision are ordered here, not on their devices.
  select * into live from public.room_live where room_id = target_game_id for update;
  if not found then
    raise exception 'live game not found' using errcode = 'P0002';
  end if;
  if not public.can_write_live_game(target_game_id) then
    -- Spectators land here. They are readers, and a reader can never advance
    -- the game or create a second version of it.
    raise exception 'live game write access required' using errcode = '42501';
  end if;

  -- Idempotency: a command id that already produced an effect returns that
  -- effect. A client retrying after a lost response converges instead of
  -- playing its move twice.
  select * into existing from public.live_game_events
   where game_id = target_game_id and command_id = target_command_id;
  if found then
    return query select 'duplicate'::text, live.revision, live.canonical, live.canonical_digest;
    return;
  end if;

  -- Compare-and-set: the command is only legal against the revision it was
  -- composed on. Anything else is told to resynchronize.
  if live.revision is distinct from target_expected_revision then
    return query select 'conflict'::text, live.revision, live.canonical, live.canonical_digest;
    return;
  end if;

  next_revision := live.revision + 1;

  insert into public.live_game_events (
    game_id, revision, command_id, issued_by, actor_id, command
  ) values (
    target_game_id, next_revision, target_command_id, target_issued_by, auth.uid(),
    public.sanitize_game_snapshot(target_command)
  );

  clean_session := case
    when target_session is null or jsonb_typeof(target_session) <> 'object' then live.session
    else jsonb_set(
      coalesce(public.sanitize_game_snapshot(target_session), '{}'::jsonb),
      '{actorId}', to_jsonb(auth.uid()::text), true
    )
  end;

  -- The head of the log and the materialized state move together, in the same
  -- transaction as the event. There is no window in which a client can read a
  -- revision whose event has not been recorded, or a state that belongs to a
  -- different revision.
  update public.room_live
     set revision = next_revision,
         canonical = public.sanitize_game_snapshot(target_canonical),
         canonical_digest = target_canonical_digest,
         state = coalesce(public.sanitize_game_snapshot(target_state), state),
         turn_number = coalesce((target_canonical ->> 'turnNumber')::int, turn_number),
         score_a = coalesce((target_canonical #>> '{scores,A}')::int, score_a),
         score_b = coalesce((target_canonical #>> '{scores,B}')::int, score_b),
         status = case
           when coalesce(target_canonical ->> 'status', '') = 'draft' then 'paused'
           else 'playing'
         end,
         actor_id = auth.uid(),
         session = clean_session,
         last_activity_at = now()
   where room_id = target_game_id;

  perform public.broadcast_live_game_commit(
    target_game_id, next_revision, target_command_id, target_issued_by
  );

  return query select 'committed'::text, next_revision,
    (select l.canonical from public.room_live l where l.room_id = target_game_id),
    target_canonical_digest;
end; $$;

revoke all on function public.commit_live_game_command(uuid, bigint, text, text, jsonb, jsonb, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_live_game_command(uuid, bigint, text, text, jsonb, jsonb, text, jsonb, jsonb)
  to authenticated;

-- 5) Reading canonical truth --------------------------------------------------

-- One small row: the head state and its revision. This is what a joining
-- spectator, a refreshed tab and a reconnecting player all fetch, so the three
-- paths cannot drift apart.
create or replace function public.get_live_game_snapshot(target_game_id uuid)
returns table (revision bigint, canonical jsonb, canonical_digest text, status text)
language sql stable security definer set search_path = public as $$
  select l.revision, l.canonical, l.canonical_digest, l.status
  from public.room_live l
  where l.room_id = target_game_id
    and public.can_read_live_game(target_game_id)
$$;

revoke all on function public.get_live_game_snapshot(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_live_game_snapshot(uuid) to authenticated;

-- Gap filling: a client that missed deltas asks for exactly the ones it lacks
-- instead of pulling the whole game again.
create or replace function public.list_live_game_events(
  target_game_id uuid,
  target_since_revision bigint default 0,
  target_limit int default 200
)
returns table (
  revision bigint,
  command_id text,
  issued_by text,
  command jsonb,
  committed_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select e.revision, e.command_id, e.issued_by, e.command, e.committed_at
  from public.live_game_events e
  where e.game_id = target_game_id
    and e.revision > coalesce(target_since_revision, 0)
    and public.can_read_live_game(target_game_id)
  order by e.revision
  limit least(greatest(coalesce(target_limit, 200), 1), 500)
$$;

revoke all on function public.list_live_game_events(uuid, bigint, int)
  from public, anon, authenticated, service_role;
grant execute on function public.list_live_game_events(uuid, bigint, int) to authenticated;

-- 6) Close the unconditional write path ---------------------------------------
--
-- `sync_live_game_state` accepted any state from any writer at any time and is
-- how a stale client could overwrite a committed turn. Keeping it beside the
-- conditional path would leave two sources of truth, so it is retired: it now
-- refuses to run and names its replacement.

create or replace function public.sync_live_game_state(
  target_game_id uuid,
  target_state jsonb,
  target_session jsonb
)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform target_game_id, target_state, target_session;
  raise exception
    'unconditional state writes are no longer accepted; use commit_live_game_command with an expected revision'
    using errcode = '42501';
end; $$;

notify pgrst, 'reload schema';

commit;
