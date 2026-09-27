-- Phase 1 of the plan architecture: the Admin Bot Collection and a server-owned
-- bot identity.
--
-- Before this migration a bot room's opponent came from the state blob the
-- client wrote: `derive_live_bot_config` copied `state.botSide` and
-- `state.botDifficulty` into the room, and `mode_key_from_state` turned
-- `state.botEngine` into the mode. The client decided which bot it was playing.
--
-- After it:
--   * `bot_catalog` is the only source of a bot's configuration. The client
--     names a bot by `bot_key`; engine family, strength, mode, execution type
--     and access tier are copied from the catalog and frozen on the room.
--   * Bot rooms are created only through `create_bot_game`, which is idempotent
--     on a caller-chosen request id. `create_live_game` refuses bot rooms, and
--     the insert trigger refuses any bot room that does not name a catalog bot.
--   * An administrator can hard-disable a bot. New rooms are refused, and
--     existing rooms cannot take a bot turn — neither on the engine service
--     (`get_live_game_engine_context`) nor by committing a bot-side command
--     from a browser (`commit_live_game_command`). Re-enabling resumes them.
--
-- Nothing here meters, charges or checks a plan. Every seeded bot is `free`
-- with `access_tier_status = 'provisional'`: a backward-compatibility default
-- so existing rooms behave exactly as before, NOT a product classification.
-- Idempotent: safe to re-run.
begin;

-- ── Catalog ─────────────────────────────────────────────────────────────────

create table if not exists public.bot_catalog (
  bot_key text primary key check (bot_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 60),
  engine_family text not null check (engine_family in ('aether', 'authur')),
  difficulty text not null check (difficulty in ('medium', 'hard', 'max', 'super', 'easy')),
  mode_key text not null references public.game_modes (mode_key) on update restrict on delete restrict,
  -- Where the bot's computation runs. Independent of access_tier by design:
  -- a client bot is not automatically free and a server bot is not automatically paid.
  execution_type text not null check (execution_type in ('CLIENT_WASM', 'SERVER', 'HYBRID')),
  access_tier text not null check (access_tier in ('free', 'pro')),
  access_tier_status text not null default 'provisional'
    check (access_tier_status in ('provisional', 'decided')),
  enabled boolean not null default true,
  -- false = existing rooms keep playing, no new room may choose it (retired bots).
  new_rooms_allowed boolean not null default true,
  config_version integer not null default 1 check (config_version >= 1),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

comment on table public.bot_catalog is
  'Admin Bot Collection. The only source of a bot room''s configuration; clients name a bot by bot_key only.';
comment on column public.bot_catalog.access_tier_status is
  'provisional = backward-compatibility default from the Phase 1 migration, not a Product Owner classification.';

create table if not exists public.bot_catalog_audit (
  id bigint generated always as identity primary key,
  bot_key text not null,
  action text not null check (action in ('insert', 'update', 'enable', 'disable')),
  before jsonb,
  after jsonb,
  reason text not null default '',
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists bot_catalog_audit_bot_idx on public.bot_catalog_audit (bot_key, created_at desc);

alter table public.bot_catalog enable row level security;
alter table public.bot_catalog_audit enable row level security;
revoke all on table public.bot_catalog, public.bot_catalog_audit from public, anon, authenticated;

-- Every mode a seeded bot names already exists (play_mode_tools); repeated here
-- so this file does not depend on that seed staying put.
insert into public.game_modes (mode_key, label) values
  ('aether_easy', 'Aether Easy'),
  ('aether_medium', 'Aether Medium'),
  ('aether_hard', 'Aether Hard'),
  ('aether_max', 'Aether Max'),
  ('aether_super', 'Aether Super'),
  ('authur_strong', 'Authur')
on conflict (mode_key) do nothing;

-- bot_key = mode_key for every existing bot, so a room's key is derivable from
-- what production already stored. Aether is retired for new rooms (the
-- reject_new_aether_room trigger); its rows exist so old rooms keep a catalog
-- entry that can be disabled.
insert into public.bot_catalog
  (bot_key, display_name, engine_family, difficulty, mode_key, execution_type,
   access_tier, access_tier_status, enabled, new_rooms_allowed, sort_order)
values
  ('authur_strong', 'Authur', 'authur', 'super', 'authur_strong', 'SERVER', 'free', 'provisional', true, true, 10),
  ('aether_super', 'Aether Super', 'aether', 'super', 'aether_super', 'HYBRID', 'free', 'provisional', true, false, 50),
  ('aether_max', 'Aether Max', 'aether', 'max', 'aether_max', 'SERVER', 'free', 'provisional', true, false, 51),
  ('aether_hard', 'Aether Hard', 'aether', 'hard', 'aether_hard', 'SERVER', 'free', 'provisional', true, false, 52),
  ('aether_medium', 'Aether Medium', 'aether', 'medium', 'aether_medium', 'SERVER', 'free', 'provisional', true, false, 53),
  ('aether_easy', 'Aether Easy', 'aether', 'easy', 'aether_easy', 'SERVER', 'free', 'provisional', true, false, 54)
on conflict (bot_key) do nothing;

-- ── Frozen bot identity on the room ─────────────────────────────────────────

alter table public.room_live
  add column if not exists bot_key text
    references public.bot_catalog (bot_key) on update restrict on delete restrict,
  add column if not exists bot_access_tier text,
  add column if not exists bot_execution_type text,
  add column if not exists bot_config_version integer;

comment on column public.room_live.bot_key is
  'Catalog bot playing bot_side, fixed at creation. Its enabled flag is read live; everything else is frozen here.';

-- Backfill every existing bot room. Only bot_key and the three frozen columns
-- are written; mode_key, bot_side and bot_difficulty stay exactly as stored. The prepare trigger would otherwise stamp
-- updated_at on rooms nobody touched.
alter table public.room_live disable trigger prepare_live_game_update;
update public.room_live l
   set bot_key = coalesce(
         (select c.bot_key from public.bot_catalog c where c.bot_key = l.mode_key),
         -- An unknown legacy mode is played by the engine as Aether at the room's
         -- stored difficulty (it runs Authur only for mode_key = 'authur_strong'),
         -- so it is keyed to that Aether tier: disabling that tier stops it.
         -- bot_difficulty is constrained to five values, all seeded above.
         'aether_' || l.bot_difficulty
       )
 where l.bot_side is not null and l.bot_key is null;
update public.room_live l
   set bot_access_tier = c.access_tier,
       bot_execution_type = c.execution_type,
       bot_config_version = c.config_version
  from public.bot_catalog c
 where c.bot_key = l.bot_key and l.bot_access_tier is null;
alter table public.room_live enable trigger prepare_live_game_update;

alter table public.room_live drop constraint if exists room_live_bot_identity_check;
alter table public.room_live add constraint room_live_bot_identity_check check (
  (bot_side is null and bot_key is null and bot_access_tier is null
    and bot_execution_type is null and bot_config_version is null)
  or (bot_side is not null and bot_key is not null
    and bot_access_tier in ('free', 'pro')
    and bot_execution_type in ('CLIENT_WASM', 'SERVER', 'HYBRID')
    and bot_config_version >= 1)
);
create index if not exists room_live_bot_key_idx on public.room_live (bot_key) where bot_key is not null;

-- On insert, a bot room's configuration comes from the catalog and nowhere
-- else. This is the backstop behind create_bot_game: whatever path inserts a
-- room, a client-written `state.botSide` without a catalog key is refused, and
-- a catalog key overwrites every bot field the caller supplied.
create or replace function public.derive_live_bot_config()
returns trigger language plpgsql set search_path = public as $$
declare
  bot public.bot_catalog%rowtype;
begin
  if new.bot_key is null then
    if new.bot_side is not null or coalesce(new.state ->> 'botSide', '') <> '' then
      raise exception 'bot_room_requires_catalog: bot rooms must be created with create_bot_game'
        using errcode = '42501';
    end if;
    new.bot_difficulty := null;
    new.bot_access_tier := null;
    new.bot_execution_type := null;
    new.bot_config_version := null;
    return new;
  end if;

  select * into bot from public.bot_catalog where bot_key = new.bot_key;
  if not found then
    raise exception 'unknown bot' using errcode = 'P0002';
  end if;
  if not bot.enabled then
    raise exception 'bot_disabled: % has been disabled by an administrator.', bot.display_name
      using errcode = 'P0001';
  end if;
  if not bot.new_rooms_allowed then
    raise exception 'bot_closed: % is not available for new games.', bot.display_name
      using errcode = '22023';
  end if;
  if new.bot_side is null or new.bot_side not in ('A', 'B') then
    raise exception 'a bot room must name the side the bot plays' using errcode = '22023';
  end if;

  new.bot_difficulty := bot.difficulty;
  new.mode_key := bot.mode_key;
  new.bot_access_tier := bot.access_tier;
  new.bot_execution_type := bot.execution_type;
  new.bot_config_version := bot.config_version;
  new.state := coalesce(new.state, '{}'::jsonb) || jsonb_build_object(
    'botSide', new.bot_side,
    'botEngine', bot.engine_family,
    'botDifficulty', bot.difficulty
  );
  return new;
end; $$;

-- The freeze is a BEFORE UPDATE row trigger. It binds every role that updates
-- the row through normal DML — browser roles (which have no UPDATE grant on
-- room_live anyway), service_role, every SECURITY DEFINER function and the
-- table owner. It does NOT bind a role that can switch it off: the table owner
-- (ALTER TABLE ... DISABLE TRIGGER) or a superuser (also via
-- session_replication_role). Those are the trusted maintenance path.
--
-- mode_key is covered too, because the Survival attempt policy, the per-mode
-- tools and per-mode statistics all read it: a bot room's mode is fixed, and a
-- room without a catalog bot can never take a bot mode.
create or replace function public.freeze_live_bot_config()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.bot_side is distinct from old.bot_side
     or new.bot_difficulty is distinct from old.bot_difficulty
     or new.bot_key is distinct from old.bot_key
     or new.bot_access_tier is distinct from old.bot_access_tier
     or new.bot_execution_type is distinct from old.bot_execution_type
     or new.bot_config_version is distinct from old.bot_config_version
     or (old.bot_key is not null and new.mode_key is distinct from old.mode_key) then
    raise exception 'bot configuration is fixed for the life of a game'
      using errcode = '42501';
  end if;
  if new.bot_key is null
     and new.mode_key is distinct from old.mode_key
     and (new.mode_key ~ '^(aether|authur)_'
          or exists (select 1 from public.bot_catalog c where c.mode_key = new.mode_key)) then
    raise exception 'bot_room_requires_catalog: a room cannot become a bot room after creation'
      using errcode = '42501';
  end if;
  return new;
end; $$;

revoke all on function public.derive_live_bot_config() from public, anon, authenticated, service_role;
revoke all on function public.freeze_live_bot_config() from public, anon, authenticated, service_role;

-- ── Room creation ───────────────────────────────────────────────────────────

-- The body of the original create_live_game, with a bot parameter. Callable
-- only by the two public wrappers below (it runs as its owner).
create or replace function public.create_live_game_core(
  target_state jsonb,
  target_access_scope text,
  target_archive_policy text,
  target_region_id uuid,
  target_join_policy text,
  target_private_parent_id uuid,
  target_bot_key text,
  target_bot_side text
) returns table (room_id uuid, room_code text)
language plpgsql security definer set search_path = public as $$
declare
  next_id uuid := gen_random_uuid();
  next_code text;
  next_mode text;
  next_mode_key text;
  player_a_id uuid;
  player_b_id uuid;
  owner_side text;
  private_limit bigint;
  private_usage bigint;
  bot public.bot_catalog%rowtype;
begin
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'approved membership required' using errcode = '42501';
  end if;
  if target_state is null or jsonb_typeof(target_state) <> 'object' then
    raise exception 'live game state must be an object' using errcode = '22023';
  end if;

  if target_bot_key is null then
    if coalesce(target_state ->> 'botSide', '') <> '' then
      raise exception 'bot_room_requires_catalog: bot rooms must be created with create_bot_game'
        using errcode = '42501';
    end if;
  else
    select * into bot from public.bot_catalog where bot_key = target_bot_key;
    if not found then
      raise exception 'unknown bot' using errcode = 'P0002';
    end if;
    if target_bot_side is null or target_bot_side not in ('A', 'B') then
      raise exception 'a bot room must name the side the bot plays' using errcode = '22023';
    end if;
    -- The client's own bot fields are replaced before anything reads them.
    target_state := target_state || jsonb_build_object(
      'botSide', target_bot_side,
      'botEngine', bot.engine_family,
      'botDifficulty', bot.difficulty
    );
  end if;

  next_mode := coalesce(target_state ->> 'gameMode', 'versus');
  next_mode_key := case
    when target_bot_key is not null then bot.mode_key
    else public.mode_key_from_state(target_state)
  end;
  player_a_id := nullif(target_state #>> '{playerUserIds,A}', '')::uuid;
  player_b_id := nullif(target_state #>> '{playerUserIds,B}', '')::uuid;

  if target_access_scope not in ('public', 'region', 'private')
    or target_archive_policy not in ('public', 'region', 'private', 'none')
    or target_join_policy not in ('open', 'code_only', 'invite_only')
  then
    raise exception 'invalid live game policy' using errcode = '22023';
  end if;
  if (target_access_scope = 'public' and target_archive_policy not in ('public', 'none'))
    or (target_access_scope = 'region' and target_archive_policy not in ('region', 'none'))
    or (target_access_scope = 'private' and target_archive_policy not in ('private', 'none'))
  then
    raise exception 'archive policy does not match access scope' using errcode = '22023';
  end if;
  if target_access_scope = 'region' then
    if target_region_id is null or (not public.is_admin() and target_region_id <> public.my_region_id()) then
      raise exception 'region access required' using errcode = '42501';
    end if;
  elsif target_region_id is not null then
    raise exception 'only region games may have a region' using errcode = '22023';
  end if;
  if target_access_scope = 'private' and target_join_policy = 'open' then
    raise exception 'private games cannot be open join' using errcode = '22023';
  end if;
  if (next_mode = 'solo' or target_state ->> 'botSide' is not null)
    and target_join_policy <> 'invite_only'
  then
    raise exception 'solo and Aether games are spectator-only' using errcode = '22023';
  end if;
  if target_private_parent_id is not null and (
    target_archive_policy <> 'private' or not exists (
      select 1 from public.private_library_items
      where id = target_private_parent_id and owner_id = auth.uid()
        and item_type = 'folder' and trashed_at is null
    )
  ) then
    raise exception 'private destination folder not found' using errcode = 'P0002';
  end if;

  owner_side := case
    when player_a_id = auth.uid() then 'A'
    when player_b_id = auth.uid() then 'B'
    when target_state ->> 'botSide' = 'B' or next_mode = 'solo' then 'A'
    when target_state ->> 'botSide' = 'A' then 'B'
    else null
  end;
  -- Solo and bot rooms force the creator to play. Persist that identity now so
  -- lifetime statistics never have to infer it from display names later.
  if owner_side = 'A' and player_a_id is null then
    player_a_id := auth.uid();
    target_state := jsonb_set(target_state, '{playerUserIds,A}', to_jsonb(auth.uid()::text), true);
  elsif owner_side = 'B' and player_b_id is null then
    player_b_id := auth.uid();
    target_state := jsonb_set(target_state, '{playerUserIds,B}', to_jsonb(auth.uid()::text), true);
  end if;

  if target_archive_policy = 'private' then
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 41));
    select value_int into private_limit from public.system_settings where key = 'private_board_limit';
    select
      (select count(*) from public.private_library_items
        where owner_id = auth.uid() and item_type = 'game')
      +
      (select count(*) from public.room_live
        where owner_id = auth.uid() and archive_policy = 'private')
    into private_usage;
    if private_usage >= coalesce(private_limit, 1000) then
      raise exception 'private library quota reached' using errcode = 'P0001';
    end if;
  end if;

  next_code := public.derive_live_room_code(next_id);

  insert into public.room_live (
    room_id, actor_id, session, owner_id, name, player_a, player_b, status,
    access_scope, archive_policy, region_id, join_policy, room_code_hash,
    game_mode, mode_key, member_a_id, member_b_id,
    player_a_user_id, player_b_user_id, starting_side, creator_side,
    turn_number, score_a, score_b, state, private_parent_id,
    created_at, last_activity_at, updated_at, expires_at,
    bot_side, bot_key
  ) values (
    next_id, auth.uid(), '{}'::jsonb, auth.uid(),
    coalesce(nullif(btrim(target_state ->> 'name'), ''), 'Untitled game'),
    coalesce(target_state #>> '{players,A}', 'Player A'),
    coalesce(target_state #>> '{players,B}', ''),
    case when coalesce(target_state ->> 'roomStage', '') = 'waiting' then 'waiting' else 'playing' end,
    target_access_scope, target_archive_policy, target_region_id, target_join_policy,
    encode(extensions.digest(next_code, 'sha256'), 'hex'),
    next_mode, next_mode_key,
    target_state #>> '{playerMembers,A}', target_state #>> '{playerMembers,B}',
    player_a_id, player_b_id,
    coalesce(target_state ->> 'startingSide', 'A'), owner_side,
    coalesce((target_state ->> 'turnNumber')::int, 1),
    coalesce((target_state #>> '{scores,A}')::int, 0),
    coalesce((target_state #>> '{scores,B}')::int, 0),
    public.sanitize_game_snapshot(target_state), target_private_parent_id,
    now(), now(), now(),
    case when coalesce(target_state ->> 'roomStage', '') = 'waiting'
      then now() + interval '24 hours' else null end,
    case when target_bot_key is null then null else target_bot_side end,
    target_bot_key
  );

  insert into public.user_mode_stats (profile_id, mode_key, games_created)
  values (auth.uid(), next_mode_key, 1)
  on conflict (profile_id, mode_key) do update
    set games_created = public.user_mode_stats.games_created + 1,
        updated_at = now();

  return query select next_id, next_code;
end; $$;

revoke all on function public.create_live_game_core(jsonb, text, text, uuid, text, uuid, text, text)
  from public, anon, authenticated, service_role;

-- Human rooms keep their existing entry point and behaviour. A state blob that
-- asks for a bot is refused: that request must name a catalog bot.
create or replace function public.create_live_game(
  target_state jsonb,
  target_access_scope text,
  target_archive_policy text,
  target_region_id uuid default null,
  target_join_policy text default 'invite_only',
  target_private_parent_id uuid default null
) returns table (room_id uuid, room_code text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select c.room_id, c.room_code
      from public.create_live_game_core(
        target_state, target_access_scope, target_archive_policy, target_region_id,
        target_join_policy, target_private_parent_id, null, null
      ) c;
end; $$;

-- anon could call this before; the body refused it, but the grant had no purpose.
revoke all on function public.create_live_game(jsonb, text, text, uuid, text, uuid) from public, anon;
grant execute on function public.create_live_game(jsonb, text, text, uuid, text, uuid)
  to authenticated, service_role;

-- One row per bot-room creation intent. A retry with the same request id —
-- a double click, a lost response — returns the room it already made.
create table if not exists public.room_creation_requests (
  user_id uuid not null references public.profiles (id) on delete cascade,
  request_id uuid not null,
  room_id uuid references public.room_live (room_id) on delete set null,
  bot_key text not null references public.bot_catalog (bot_key) on update restrict on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
create index if not exists room_creation_requests_room_idx
  on public.room_creation_requests (room_id) where room_id is not null;
alter table public.room_creation_requests enable row level security;
revoke all on table public.room_creation_requests from public, anon, authenticated;

create or replace function public.create_bot_game(
  target_request_id uuid,
  target_bot_key text,
  target_bot_side text,
  target_state jsonb,
  target_access_scope text,
  target_archive_policy text,
  target_region_id uuid default null,
  target_join_policy text default 'invite_only',
  target_private_parent_id uuid default null
) returns table (room_id uuid, room_code text, replayed boolean)
language plpgsql security definer set search_path = public as $$
declare
  caller uuid := auth.uid();
  previous public.room_creation_requests%rowtype;
  bot public.bot_catalog%rowtype;
  created record;
begin
  if caller is null or not (public.is_approved() or public.is_admin()) then
    raise exception 'approved membership required' using errcode = '42501';
  end if;
  if target_request_id is null then
    raise exception 'a bot room needs a creation request id' using errcode = '22023';
  end if;

  -- The per-user lock every plan-sensitive write will share. Two tabs sending
  -- the same request id serialize here; the second sees the first's row.
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 41));

  select * into previous from public.room_creation_requests r
   where r.user_id = caller and r.request_id = target_request_id;
  if found then
    if previous.bot_key is distinct from target_bot_key then
      raise exception 'this creation request id was already used for a different bot'
        using errcode = '22023';
    end if;
    if previous.room_id is null then
      raise exception 'this creation request already made a room that no longer exists'
        using errcode = 'P0002';
    end if;
    return query select previous.room_id, public.derive_live_room_code(previous.room_id), true;
    return;
  end if;

  select * into bot from public.bot_catalog where bot_key = target_bot_key;
  if not found then
    raise exception 'unknown bot' using errcode = 'P0002';
  end if;
  if not bot.enabled then
    raise exception 'bot_disabled: % has been disabled by an administrator.', bot.display_name
      using errcode = 'P0001';
  end if;
  if not bot.new_rooms_allowed then
    raise exception 'bot_closed: % is not available for new games.', bot.display_name
      using errcode = '22023';
  end if;

  select * into created from public.create_live_game_core(
    target_state, target_access_scope, target_archive_policy, target_region_id,
    target_join_policy, target_private_parent_id, target_bot_key, target_bot_side
  );

  insert into public.room_creation_requests (user_id, request_id, room_id, bot_key)
  values (caller, target_request_id, created.room_id, target_bot_key);

  return query select created.room_id, created.room_code, false;
end; $$;

revoke all on function public.create_bot_game(uuid, text, text, jsonb, text, text, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_bot_game(uuid, text, text, jsonb, text, text, uuid, text, uuid)
  to authenticated;

-- ── Hard disable on existing rooms ──────────────────────────────────────────

-- The engine service's only view of a game. A bot turn in a room whose bot is
-- disabled is refused with a message that starts `bot_disabled:`; the engine
-- passes it through, and the client shows it as such. Everything else
-- (analysis on the human's turn, reasoning for a move already played) is
-- unchanged. Re-enabling needs no other action.
create or replace function public.get_live_game_engine_context(target_game_id uuid)
returns table (
  revision bigint, status text, game_mode text, mode_key text, bot_side text,
  bot_difficulty text, active_side text, turn_number integer, phase text,
  canonical jsonb, canonical_digest text, caller_controls_active_side boolean,
  active_side_is_bot boolean
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  disabled_name text;
begin
  select c.display_name into disabled_name
    from public.room_live l
    join public.bot_catalog c on c.bot_key = l.bot_key
   where l.room_id = target_game_id
     and public.can_read_live_game(target_game_id)
     and not c.enabled
     and l.bot_side = l.canonical ->> 'activeSide';
  if found then
    raise exception 'bot_disabled: % has been disabled by an administrator.', disabled_name
      using errcode = 'P0001';
  end if;

  return query
  select
    l.revision,
    l.status,
    l.game_mode,
    l.mode_key,
    l.bot_side,
    l.bot_difficulty,
    l.canonical ->> 'activeSide',
    (l.canonical ->> 'turnNumber')::int,
    l.canonical ->> 'phase',
    l.canonical,
    l.canonical_digest,
    public.controls_live_game_side(l.room_id, l.canonical ->> 'activeSide'),
    (l.bot_side is not null and l.bot_side = l.canonical ->> 'activeSide')
  from public.room_live l
  where l.room_id = target_game_id
    and public.can_read_live_game(target_game_id);
end; $$;

revoke all on function public.get_live_game_engine_context(uuid) from public, anon;
grant execute on function public.get_live_game_engine_context(uuid) to authenticated;

-- The browser-side stop. A bot move computed on a device (client Super) or
-- written by a modified client lands here; while the room's bot is disabled,
-- no command issued as the bot, and no command on the bot's turn, commits.
-- Identical to the previous body apart from the marked block.
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
) returns table (outcome text, revision bigint, canonical jsonb, canonical_digest text)
language plpgsql security definer set search_path = public as $$
declare
  live public.room_live%rowtype;
  existing public.live_game_events%rowtype;
  next_revision bigint;
  clean_session jsonb;
  disabled_name text;
  bot_enabled boolean;
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

  select * into live from public.room_live where room_id = target_game_id for update;
  if not found then
    raise exception 'live game not found' using errcode = 'P0002';
  end if;
  if not public.can_write_live_game(target_game_id) then
    raise exception 'live game write access required' using errcode = '42501';
  end if;

  select * into existing from public.live_game_events
   where game_id = target_game_id and command_id = target_command_id;
  if found then
    return query select 'duplicate'::text, live.revision, live.canonical, live.canonical_digest;
    return;
  end if;

  -- ── Phase 1: hard bot disable ──
  -- Read live from the catalog, never from the room (the room freezes no
  -- enabled flag). FOR SHARE makes admin_set_bot_enabled wait for bot commits
  -- already in flight, so once a disable has returned, no bot command commits.
  if live.bot_key is not null
     and (target_issued_by = live.bot_side or live.canonical ->> 'activeSide' = live.bot_side)
  then
    select c.enabled, c.display_name into bot_enabled, disabled_name
      from public.bot_catalog c where c.bot_key = live.bot_key
      for share;
    if not bot_enabled then
      raise exception 'bot_disabled: % has been disabled by an administrator.', disabled_name
        using errcode = 'P0001';
    end if;
  end if;
  -- ── end Phase 1 ──

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

  update public.room_live
     set revision = next_revision,
         canonical = public.sanitize_game_snapshot(target_canonical),
         canonical_digest = target_canonical_digest,
         state = coalesce(public.sanitize_game_snapshot(target_state), state),
         turn_number = coalesce((target_canonical ->> 'turnNumber')::int, turn_number),
         score_a = coalesce((target_canonical #>> '{scores,A}')::int, score_a),
         score_b = coalesce((target_canonical #>> '{scores,B}')::int, score_b),
         status = case
           when coalesce(target_state ->> 'roomStage', '') = 'waiting' then 'waiting'
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

-- ── Catalog reads and administration ────────────────────────────────────────

-- What a signed-in member may know about the bots: no engine internals beyond
-- what the room already records.
create or replace function public.list_bots()
returns table (
  bot_key text, display_name text, engine_family text, difficulty text,
  execution_type text, access_tier text, enabled boolean, new_rooms_allowed boolean,
  sort_order integer
)
language sql stable security definer set search_path = public as $$
  select c.bot_key, c.display_name, c.engine_family, c.difficulty,
         c.execution_type, c.access_tier, c.enabled, c.new_rooms_allowed, c.sort_order
    from public.bot_catalog c
   where public.is_approved() or public.is_admin()
   order by c.sort_order, c.bot_key
$$;

create or replace function public.admin_list_bots()
returns table (
  bot_key text, display_name text, engine_family text, difficulty text, mode_key text,
  execution_type text, access_tier text, access_tier_status text, enabled boolean,
  new_rooms_allowed boolean, config_version integer, sort_order integer,
  updated_at timestamptz, live_rooms bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  return query
    select c.bot_key, c.display_name, c.engine_family, c.difficulty, c.mode_key,
           c.execution_type, c.access_tier, c.access_tier_status, c.enabled,
           c.new_rooms_allowed, c.config_version, c.sort_order, c.updated_at,
           (select count(*) from public.room_live l where l.bot_key = c.bot_key)
      from public.bot_catalog c
     order by c.sort_order, c.bot_key;
end; $$;

create or replace function public.admin_set_bot_enabled(
  target_bot_key text,
  target_enabled boolean,
  target_reason text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  before_row public.bot_catalog%rowtype;
  after_row public.bot_catalog%rowtype;
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if target_enabled is null then
    raise exception 'enabled must be true or false' using errcode = '22023';
  end if;
  select * into before_row from public.bot_catalog where bot_key = target_bot_key for update;
  if not found then
    raise exception 'unknown bot' using errcode = 'P0002';
  end if;
  if before_row.enabled = target_enabled then
    return;
  end if;
  update public.bot_catalog
     set enabled = target_enabled, updated_at = now(), updated_by = auth.uid()
   where bot_key = target_bot_key
  returning * into after_row;
  insert into public.bot_catalog_audit (bot_key, action, before, after, reason, actor_id)
  values (target_bot_key, case when target_enabled then 'enable' else 'disable' end,
          to_jsonb(before_row), to_jsonb(after_row), coalesce(btrim(target_reason), ''), auth.uid());
end; $$;

-- Creates a bot or edits its metadata. The engine identity of an existing key
-- (family, difficulty, mode) cannot change: rooms and statistics name the key.
-- A change to what a room freezes (execution type, access tier) bumps
-- config_version; a tier set here is an explicit decision.
create or replace function public.admin_upsert_bot(
  target_bot_key text,
  target_display_name text,
  target_engine_family text,
  target_difficulty text,
  target_mode_key text,
  target_execution_type text,
  target_access_tier text,
  target_new_rooms_allowed boolean,
  target_sort_order integer,
  target_reason text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  before_row public.bot_catalog%rowtype;
  after_row public.bot_catalog%rowtype;
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  select * into before_row from public.bot_catalog where bot_key = target_bot_key for update;
  if not found then
    insert into public.bot_catalog (
      bot_key, display_name, engine_family, difficulty, mode_key, execution_type,
      access_tier, access_tier_status, enabled, new_rooms_allowed, sort_order,
      updated_by
    ) values (
      target_bot_key, btrim(target_display_name), target_engine_family, target_difficulty,
      target_mode_key, target_execution_type, target_access_tier, 'decided',
      -- A new bot starts disabled; enabling it is a separate, audited act.
      false, coalesce(target_new_rooms_allowed, true), coalesce(target_sort_order, 100),
      auth.uid()
    ) returning * into after_row;
    insert into public.bot_catalog_audit (bot_key, action, before, after, reason, actor_id)
    values (target_bot_key, 'insert', null, to_jsonb(after_row),
            coalesce(btrim(target_reason), ''), auth.uid());
    return;
  end if;

  if target_engine_family is distinct from before_row.engine_family
     or target_difficulty is distinct from before_row.difficulty
     or target_mode_key is distinct from before_row.mode_key then
    raise exception 'engine family, difficulty and mode of an existing bot cannot change'
      using errcode = '22023';
  end if;

  update public.bot_catalog
     set display_name = btrim(target_display_name),
         execution_type = target_execution_type,
         access_tier = target_access_tier,
         access_tier_status = case
           when target_access_tier is distinct from before_row.access_tier then 'decided'
           else before_row.access_tier_status
         end,
         new_rooms_allowed = coalesce(target_new_rooms_allowed, before_row.new_rooms_allowed),
         sort_order = coalesce(target_sort_order, before_row.sort_order),
         config_version = before_row.config_version + case
           when target_execution_type is distinct from before_row.execution_type
             or target_access_tier is distinct from before_row.access_tier then 1
           else 0
         end,
         updated_at = now(),
         updated_by = auth.uid()
   where bot_key = target_bot_key
  returning * into after_row;
  insert into public.bot_catalog_audit (bot_key, action, before, after, reason, actor_id)
  values (target_bot_key, 'update', to_jsonb(before_row), to_jsonb(after_row),
          coalesce(btrim(target_reason), ''), auth.uid());
end; $$;

revoke all on function public.list_bots() from public, anon, authenticated, service_role;
revoke all on function public.admin_list_bots() from public, anon, authenticated, service_role;
revoke all on function public.admin_set_bot_enabled(text, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_upsert_bot(text, text, text, text, text, text, text, boolean, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.list_bots() to authenticated;
grant execute on function public.admin_list_bots() to authenticated;
grant execute on function public.admin_set_bot_enabled(text, boolean, text) to authenticated;
grant execute on function public.admin_upsert_bot(text, text, text, text, text, text, text, boolean, integer, text)
  to authenticated;

-- ── State-blob bot fields are never authoritative ───────────────────────────

-- Two existing functions read bot facts from the client-written state. Both
-- now read the room's own columns instead; otherwise identical to production.
-- (Before this, an owner could turn a human room's mode_key into
-- 'authur_strong' by writing botSide/botEngine into its state.)
create or replace function public.update_live_game_state(target_game_id uuid, target_state jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  live public.room_live%rowtype;
  caller_can_configure boolean;
  next_game_mode text := coalesce(target_state ->> 'gameMode', 'versus');
begin
  if target_state is null or jsonb_typeof(target_state) <> 'object' then
    raise exception 'live game state must be an object' using errcode = '22023';
  end if;
  select * into live from public.room_live where room_id = target_game_id for update;
  if not found or not public.can_write_live_game(target_game_id) then
    raise exception 'live game write access required' using errcode = '42501';
  end if;
  if coalesce(target_state ->> 'status', '') = 'finished' then
    raise exception 'finished games must use finalize_live_game' using errcode = '22023';
  end if;

  caller_can_configure := public.is_admin() or live.owner_id = auth.uid();
  if not caller_can_configure and (
    target_state -> 'name' is distinct from live.state -> 'name'
    or target_state -> 'players' is distinct from live.state -> 'players'
    or target_state -> 'playerMembers' is distinct from live.state -> 'playerMembers'
    or target_state -> 'playerUserIds' is distinct from live.state -> 'playerUserIds'
    or target_state -> 'startingSide' is distinct from live.state -> 'startingSide'
    or target_state -> 'gameMode' is distinct from live.state -> 'gameMode'
    or target_state -> 'botSide' is distinct from live.state -> 'botSide'
    or target_state -> 'botDifficulty' is distinct from live.state -> 'botDifficulty'
  ) then
    raise exception 'players cannot change live game configuration' using errcode = '42501';
  end if;

  update public.room_live
  set name = case when caller_can_configure
        then coalesce(nullif(btrim(target_state ->> 'name'), ''), name) else name end,
      player_a = case when caller_can_configure
        then coalesce(target_state #>> '{players,A}', player_a) else player_a end,
      player_b = case when caller_can_configure
        then coalesce(target_state #>> '{players,B}', player_b) else player_b end,
      status = case
        when coalesce(target_state ->> 'roomStage', '') = 'waiting' then 'waiting'
        when coalesce(target_state ->> 'status', '') = 'draft' then 'paused'
        else 'playing'
      end,
      game_mode = case when caller_can_configure then next_game_mode else game_mode end,
      -- A bot room keeps the mode its catalog bot gave it; a human room may
      -- change mode, but never into a bot mode from the state blob.
      mode_key = case
        when live.bot_key is not null then mode_key
        when caller_can_configure and coalesce(target_state ->> 'botSide', '') = ''
          then public.mode_key_from_state(target_state)
        else mode_key end,
      member_a_id = case when caller_can_configure
        then nullif(target_state #>> '{playerMembers,A}', '') else member_a_id end,
      member_b_id = case when caller_can_configure
        then nullif(target_state #>> '{playerMembers,B}', '') else member_b_id end,
      player_a_user_id = case when caller_can_configure
        then nullif(target_state #>> '{playerUserIds,A}', '')::uuid else player_a_user_id end,
      player_b_user_id = case when caller_can_configure
        then nullif(target_state #>> '{playerUserIds,B}', '')::uuid else player_b_user_id end,
      starting_side = case when caller_can_configure
        then coalesce(target_state ->> 'startingSide', starting_side) else starting_side end,
      turn_number = coalesce((target_state ->> 'turnNumber')::int, turn_number),
      score_a = coalesce((target_state #>> '{scores,A}')::int, score_a),
      score_b = coalesce((target_state #>> '{scores,B}')::int, score_b),
      state = public.sanitize_game_snapshot(target_state),
      last_activity_at = now(),
      expires_at = case
        when coalesce(target_state ->> 'roomStage', '') = 'waiting' then now() + interval '24 hours'
        when coalesce(target_state ->> 'status', '') = 'draft' then now() + interval '30 days'
        else null
      end
  where room_id = target_game_id;
end; $function$;

create or replace function public.join_live_game(target_room_code text DEFAULT NULL::text, target_game_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(room_id uuid, claimed_side text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  live public.room_live%rowtype;
  display_name text;
  next_side text;
begin
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'approved membership required' using errcode = '42501';
  end if;
  if (target_room_code is null) = (target_game_id is null) then
    raise exception 'provide exactly one room code or game id' using errcode = '22023';
  end if;

  select * into live
  from public.room_live l
  where (
      target_room_code is not null
      and l.room_code_hash = encode(extensions.digest(
        upper(regexp_replace(btrim(target_room_code), '[^A-Za-z0-9]', '', 'g')),
        'sha256'
      ), 'hex')
    ) or (
      target_game_id is not null
      and l.room_id = target_game_id
      and l.join_policy = 'open'
    )
  for update;

  if not found then
    raise exception 'live game not found' using errcode = 'P0002';
  end if;
  if live.access_scope = 'region'
    and not public.is_admin()
    and (not public.is_approved() or live.region_id <> public.my_region_id())
  then
    raise exception 'region access required' using errcode = '42501';
  end if;
  if live.access_scope = 'public' and not (public.is_approved() or public.is_admin()) then
    raise exception 'approved membership required' using errcode = '42501';
  end if;

  if auth.uid() = live.player_a_user_id then
    return query select live.room_id, 'A'::text;
    return;
  end if;
  if auth.uid() = live.player_b_user_id then
    return query select live.room_id, 'B'::text;
    return;
  end if;
  if live.join_policy = 'invite_only' then
    raise exception 'this game is invite only' using errcode = '42501';
  end if;
  if live.game_mode = 'solo' or live.bot_side is not null then
    return query select live.room_id, null::text;
    return;
  end if;

  select p.display_name into display_name from public.profiles p where p.id = auth.uid();
  if live.player_a_user_id is null then next_side := 'A';
  elsif live.player_b_user_id is null then next_side := 'B';
  else
    -- A full public/region game remains watchable; no player slot is claimed.
    return query select live.room_id, null::text;
    return;
  end if;

  update public.room_live
  set player_a_user_id = case when next_side = 'A' then auth.uid() else player_a_user_id end,
      player_b_user_id = case when next_side = 'B' then auth.uid() else player_b_user_id end,
      player_a = case when next_side = 'A' then coalesce(display_name, player_a) else player_a end,
      player_b = case when next_side = 'B' then coalesce(display_name, player_b) else player_b end,
      state = jsonb_set(
        jsonb_set(
          state,
          array['playerUserIds', next_side],
          to_jsonb(auth.uid()::text),
          true
        ),
        array['players', next_side],
        to_jsonb(coalesce(display_name, case when next_side = 'A' then player_a else player_b end)),
        true
      ),
      last_activity_at = now(),
      expires_at = case when status = 'waiting' then now() + interval '24 hours' else expires_at end
  where public.room_live.room_id = live.room_id;

  return query select live.room_id, next_side;
end; $function$;

commit;
