-- Phase 3: room creation that charges atomically, and Stage attempts the
-- server establishes itself.
--
--   * room_live.room_purpose ('normal' | 'stage') is set only by the server's
--     creation paths and frozen for the life of the room.
--   * create_bot_game takes an explicit funding source for a Pro-tier bot
--     (ALLOWANCE or CREDIT) and, in ONE transaction: locks the user, replays or
--     refuses a reused request id, locks the catalog row (so a disable that has
--     returned stops later creations), charges exactly once, creates the room
--     (the board limit is enforced by its trigger) and records the request.
--     Any failure rolls every part back.
--   * create_stage_attempt is the only way to start a Stage (Survival) attempt:
--     the level must be approved and SEALED (its starting position stored by
--     an admin), the room is created with purpose 'stage' and its attempt row
--     together, and it is never charged. The first committed position must be
--     the sealed start, and later commits may never take a tile off the board,
--     so a Stage room cannot be turned into a free normal game.
--   * get_my_probot_status is the client's single source of truth for the
--     allowance, weekly usage, credits and active boards.
-- Idempotent.
begin;

-- ── Room purpose ────────────────────────────────────────────────────────────

alter table public.room_live add column if not exists room_purpose text not null default 'normal';
alter table public.room_live drop constraint if exists room_live_room_purpose_check;
alter table public.room_live add constraint room_live_room_purpose_check
  check (room_purpose in ('normal', 'stage'));
comment on column public.room_live.room_purpose is
  'normal | stage. Set by create_bot_game / create_stage_attempt / create_live_game only; frozen.';

-- Rooms are created only through create_live_game / create_bot_game /
-- create_stage_attempt, which charge and name them. The baseline let
-- service_role insert room rows directly — a Pro-bot room with no charge. No
-- server component inserts rooms that way, so it is withdrawn. (Update and
-- delete stay: the freeze and board-limit triggers guard those rows.)
revoke insert, truncate, references, trigger on table public.room_live from service_role;

-- ── Sealed Stage starts ─────────────────────────────────────────────────────

alter table public.survival_levels add column if not exists start_canonical jsonb;
alter table public.survival_levels add column if not exists start_sealed_at timestamptz;
alter table public.survival_levels add column if not exists start_sealed_by uuid;
comment on column public.survival_levels.start_canonical is
  'The level''s starting position (inventory, scores, side to move, turn), sealed by an admin. A Stage attempt''s first commit must equal it.';

-- ── Creation request metadata (for idempotency comparisons) ─────────────────

alter table public.room_creation_requests add column if not exists purpose text;
alter table public.room_creation_requests add column if not exists funding text;
alter table public.room_creation_requests add column if not exists bot_side text;
alter table public.room_creation_requests add column if not exists access_scope text;
alter table public.room_creation_requests add column if not exists archive_policy text;
alter table public.room_creation_requests add column if not exists join_policy text;
alter table public.room_creation_requests add column if not exists region_id uuid;
alter table public.room_creation_requests add column if not exists stage_level_id uuid;
alter table public.room_creation_requests add column if not exists consumption_id uuid;

-- ── Frozen identity, stage-aware ────────────────────────────────────────────
create or replace function public.freeze_live_bot_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.bot_side is distinct from old.bot_side
     or new.bot_difficulty is distinct from old.bot_difficulty
     or new.bot_key is distinct from old.bot_key
     or new.bot_access_tier is distinct from old.bot_access_tier
     or new.bot_execution_type is distinct from old.bot_execution_type
     or new.room_purpose is distinct from old.room_purpose
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
end; $function$;

create or replace function public.derive_live_bot_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  bot public.bot_catalog%rowtype;
begin
  if new.room_purpose = 'stage' and new.bot_key is null then
    raise exception 'a Stage room must name its catalog bot' using errcode = '22023';
  end if;
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
end; $function$;

create or replace function public.commit_live_game_command(target_game_id uuid, target_expected_revision bigint, target_command_id text, target_issued_by text, target_command jsonb, target_canonical jsonb, target_canonical_digest text, target_state jsonb DEFAULT NULL::jsonb, target_session jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(outcome text, revision bigint, canonical jsonb, canonical_digest text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- ── Phase 3: Stage rooms keep the level's start and never lose board tiles ──
  -- After the revision check: a stale writer gets the ordinary conflict (and
  -- adopts the room's state); only a commit that would actually land is
  -- compared with the room's current position.
  if live.room_purpose = 'stage' then
    perform public.check_stage_commit(live, target_canonical);
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
end; $function$;

-- The Stage guard called by commit_live_game_command for purpose 'stage'.
create or replace function public.check_stage_commit(live public.room_live, target_canonical jsonb)
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  expected jsonb;
  new_inventory jsonb := target_canonical -> 'inventory';
  old_inventory jsonb;
  before_tile jsonb;
  after_tile jsonb;
begin
  select l.start_canonical into expected
    from public.survival_attempts a join public.survival_levels l on l.id = a.level_id
   where a.room_id = live.room_id;
  if expected is null then
    raise exception 'stage_start_unknown: this Stage room has no sealed starting position' using errcode = 'P0001';
  end if;
  if jsonb_typeof(new_inventory) is distinct from 'array' or jsonb_array_length(new_inventory) <> 100 then
    raise exception 'stage_invalid_position: a Stage position must place all 100 tiles' using errcode = 'P0001';
  end if;
  if live.canonical is null then
    if new_inventory <> expected -> 'inventory'
       or target_canonical -> 'scores' is distinct from expected -> 'scores'
       or target_canonical -> 'activeSide' is distinct from expected -> 'activeSide'
       or target_canonical -> 'turnNumber' is distinct from expected -> 'turnNumber'
       or target_canonical -> 'startingSide' is distinct from expected -> 'startingSide' then
      raise exception 'stage_start_mismatch: the first position is not this level''s sealed start'
        using errcode = 'P0001';
    end if;
    return;
  end if;
  old_inventory := live.canonical -> 'inventory';
  for i in 0 .. 99 loop
    before_tile := old_inventory -> i;
    if before_tile ->> 'at' = 'board' then
      after_tile := new_inventory -> i;
      if after_tile ->> 'at' is distinct from 'board'
         or after_tile -> 'row' is distinct from before_tile -> 'row'
         or after_tile -> 'col' is distinct from before_tile -> 'col' then
        raise exception 'stage_board_rewrite: a Stage attempt cannot move or remove a tile already on the board'
          using errcode = 'P0001';
      end if;
    end if;
  end loop;
end; $$;

-- ── Room creation core ──────────────────────────────────────────────────────

drop function if exists public.create_live_game_core(jsonb, text, text, uuid, text, uuid, text, text);
create or replace function public.create_live_game_core(
  target_state jsonb,
  target_access_scope text,
  target_archive_policy text,
  target_region_id uuid,
  target_join_policy text,
  target_private_parent_id uuid,
  target_bot_key text,
  target_bot_side text,
  target_room_purpose text,
  target_room_id uuid
) returns table (room_id uuid, room_code text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  next_id uuid := coalesce(target_room_id, gen_random_uuid());
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
  if target_room_purpose not in ('normal', 'stage') then
    raise exception 'invalid room purpose' using errcode = '22023';
  end if;

  if target_bot_key is null then
    if coalesce(target_state ->> 'botSide', '') <> '' then
      raise exception 'bot_room_requires_catalog: bot rooms must be created with create_bot_game'
        using errcode = '42501';
    end if;
    if target_room_purpose <> 'normal' then
      raise exception 'a Stage room must name its catalog bot' using errcode = '22023';
    end if;
  else
    select * into bot from public.bot_catalog where bot_key = target_bot_key;
    if not found then
      raise exception 'unknown bot' using errcode = 'P0002';
    end if;
    if target_bot_side is null or target_bot_side not in ('A', 'B') then
      raise exception 'a bot room must name the side the bot plays' using errcode = '22023';
    end if;
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
  if owner_side = 'A' and player_a_id is null then
    player_a_id := auth.uid();
    target_state := jsonb_set(target_state, '{playerUserIds,A}', to_jsonb(auth.uid()::text), true);
  elsif owner_side = 'B' and player_b_id is null then
    player_b_id := auth.uid();
    target_state := jsonb_set(target_state, '{playerUserIds,B}', to_jsonb(auth.uid()::text), true);
  end if;

  -- Every user this room may seat, locked up front in UUID order: the board
  -- limit trigger locks the same users, and taking them in one order is what
  -- keeps two creations over the same people from deadlocking.
  perform public.lock_board_users(array[auth.uid(), player_a_id, player_b_id]);

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
    bot_side, bot_key, room_purpose
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
    target_bot_key, target_room_purpose
  );

  insert into public.user_mode_stats (profile_id, mode_key, games_created)
  values (auth.uid(), next_mode_key, 1)
  on conflict (profile_id, mode_key) do update
    set games_created = public.user_mode_stats.games_created + 1,
        updated_at = now();

  return query select next_id, next_code;
end; $$;

create or replace function public.create_live_game(
  target_state jsonb,
  target_access_scope text,
  target_archive_policy text,
  target_region_id uuid default null,
  target_join_policy text default 'invite_only',
  target_private_parent_id uuid default null
) returns table (room_id uuid, room_code text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
    select c.room_id, c.room_code
      from public.create_live_game_core(
        target_state, target_access_scope, target_archive_policy, target_region_id,
        target_join_policy, target_private_parent_id, null, null, 'normal', null
      ) c;
end; $$;

-- ── Bot rooms, charged ──────────────────────────────────────────────────────

drop function if exists public.create_bot_game(uuid, text, text, jsonb, text, text, uuid, text, uuid);
create or replace function public.create_bot_game(
  target_request_id uuid,
  target_bot_key text,
  target_bot_side text,
  target_state jsonb,
  target_access_scope text,
  target_archive_policy text,
  target_region_id uuid default null,
  target_join_policy text default 'invite_only',
  target_private_parent_id uuid default null,
  target_funding text default null
) returns table (room_id uuid, room_code text, replayed boolean, funding text, consumption_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  caller uuid := auth.uid();
  previous public.room_creation_requests%rowtype;
  bot public.bot_catalog%rowtype;
  t timestamptz;
  new_room uuid := gen_random_uuid();
  charged uuid;
  created record;
begin
  if caller is null or not (public.is_approved() or public.is_admin()) then
    raise exception 'approved membership required' using errcode = '42501';
  end if;
  if target_request_id is null then
    raise exception 'a bot room needs a creation request id' using errcode = '22023';
  end if;
  if target_funding is not null and target_funding not in ('allowance', 'credit') then
    raise exception 'funding must be allowance or credit' using errcode = '22023';
  end if;

  perform public.lock_board_users(array[caller]);

  select * into previous from public.room_creation_requests r
   where r.user_id = caller and r.request_id = target_request_id;
  if found then
    if previous.bot_key is distinct from target_bot_key
       or (previous.purpose is not null and (
            previous.purpose is distinct from 'normal'
            or previous.funding is distinct from target_funding
            or previous.bot_side is distinct from target_bot_side
            or previous.access_scope is distinct from target_access_scope
            or previous.archive_policy is distinct from target_archive_policy
            or previous.join_policy is distinct from target_join_policy
            or previous.region_id is distinct from target_region_id)) then
      raise exception 'idempotency_conflict: this creation request id was already used differently'
        using errcode = '22023';
    end if;
    if previous.room_id is null then
      raise exception 'this creation request already made a room that no longer exists'
        using errcode = 'P0002';
    end if;
    return query select previous.room_id, public.derive_live_room_code(previous.room_id), true,
      previous.funding, previous.consumption_id;
    return;
  end if;

  -- Shared with admin_set_bot_enabled's row update: a disable that has
  -- returned is seen here, and one in flight waits for this creation.
  select * into bot from public.bot_catalog c where c.bot_key = target_bot_key for share;
  if not found then
    raise exception 'unknown bot' using errcode = 'P0002';
  end if;
  if bot.lifecycle = 'pending' then
    raise exception 'bot_pending: % is not available yet.', bot.display_name using errcode = '22023';
  end if;
  if not bot.enabled then
    raise exception 'bot_disabled: % has been disabled by an administrator.', bot.display_name
      using errcode = 'P0001';
  end if;
  if not bot.new_rooms_allowed or bot.lifecycle <> 'active' then
    raise exception 'bot_closed: % is not available for new games.', bot.display_name
      using errcode = '22023';
  end if;

  -- Funding follows the access tier, and only the tier.
  if bot.access_tier = 'pro' then
    if target_funding is null then
      raise exception 'funding_required: choose ALLOWANCE or CREDIT for %', bot.display_name
        using errcode = '22023';
    end if;
    t := public.probot_now(caller);
    charged := public.probot_charge(caller, target_request_id, new_room, bot.bot_key, target_funding, t);
  elsif target_funding is not null then
    raise exception 'funding_not_applicable: % is free and takes no funding', bot.display_name
      using errcode = '22023';
  end if;

  select * into created from public.create_live_game_core(
    target_state, target_access_scope, target_archive_policy, target_region_id,
    target_join_policy, target_private_parent_id, target_bot_key, target_bot_side,
    'normal', new_room
  );

  insert into public.room_creation_requests (
    user_id, request_id, room_id, bot_key, purpose, funding, bot_side, access_scope,
    archive_policy, join_policy, region_id, consumption_id
  ) values (
    caller, target_request_id, created.room_id, target_bot_key, 'normal', target_funding,
    target_bot_side, target_access_scope, target_archive_policy, target_join_policy,
    target_region_id, charged
  );

  return query select created.room_id, created.room_code, false, target_funding, charged;
end; $$;

-- ── Stage attempts ──────────────────────────────────────────────────────────

-- An admin seals a level's starting position, computed from its seed by the
-- same code that builds the attempt. Only sealed levels can be played.
create or replace function public.admin_seal_stage_start(target_level uuid, target_start jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if target_start is null or jsonb_typeof(target_start -> 'inventory') is distinct from 'array'
     or jsonb_array_length(target_start -> 'inventory') <> 100
     or target_start -> 'scores' is null or target_start -> 'activeSide' is null
     or target_start -> 'turnNumber' is null or target_start -> 'startingSide' is null then
    raise exception 'a sealed start needs inventory (100 tiles), scores, activeSide, turnNumber, startingSide'
      using errcode = '22023';
  end if;
  update public.survival_levels
     set start_canonical = jsonb_build_object(
           'inventory', target_start -> 'inventory', 'scores', target_start -> 'scores',
           'activeSide', target_start -> 'activeSide', 'turnNumber', target_start -> 'turnNumber',
           'startingSide', target_start -> 'startingSide'),
         start_sealed_at = now(), start_sealed_by = auth.uid(), updated_at = now()
   where id = target_level;
  if not found then
    raise exception 'unknown level' using errcode = 'P0002';
  end if;
end; $$;

create or replace function public.create_stage_attempt(
  target_request_id uuid,
  target_level_id uuid,
  target_state jsonb
) returns table (room_id uuid, room_code text, attempt_id uuid, replayed boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  caller uuid := auth.uid();
  previous public.room_creation_requests%rowtype;
  level public.survival_levels%rowtype;
  bot public.bot_catalog%rowtype;
  new_room uuid := gen_random_uuid();
  created record;
  attempt uuid;
begin
  if caller is null or not (public.is_approved() or public.is_admin()) then
    raise exception 'approved membership required' using errcode = '42501';
  end if;
  if target_request_id is null then
    raise exception 'a Stage attempt needs a creation request id' using errcode = '22023';
  end if;

  perform public.lock_board_users(array[caller]);

  select * into previous from public.room_creation_requests r
   where r.user_id = caller and r.request_id = target_request_id;
  if found then
    if previous.purpose is distinct from 'stage' or previous.stage_level_id is distinct from target_level_id then
      raise exception 'idempotency_conflict: this creation request id was already used differently'
        using errcode = '22023';
    end if;
    if previous.room_id is null then
      raise exception 'this creation request already made a room that no longer exists'
        using errcode = 'P0002';
    end if;
    return query select previous.room_id, public.derive_live_room_code(previous.room_id),
      (select a.id from public.survival_attempts a where a.room_id = previous.room_id), true;
    return;
  end if;

  select * into level from public.survival_levels l
   where l.id = target_level_id and (l.status = 'approved' or public.is_admin());
  if not found then
    raise exception 'stage_level_unavailable: this level cannot be played' using errcode = 'P0002';
  end if;
  if level.start_canonical is null then
    raise exception 'stage_level_not_sealed: this level has no sealed starting position yet'
      using errcode = 'P0001';
  end if;

  select * into bot from public.bot_catalog c where c.bot_key = 'authur_strong' for share;
  if not found or not bot.enabled or bot.lifecycle <> 'active' then
    raise exception 'bot_disabled: Stage''s opponent is not available right now.' using errcode = 'P0001';
  end if;

  -- The server names the attempt; the position itself is checked at its
  -- first commit against the sealed start.
  select * into created from public.create_live_game_core(
    coalesce(target_state, '{}'::jsonb) || jsonb_build_object(
      'name', 'Survival test · seed ' || level.seed::text, 'gameMode', 'versus'),
    'private', 'none', null, 'invite_only', null, 'authur_strong', 'B', 'stage', new_room
  );

  insert into public.survival_attempts (level_id, room_id, player_id)
  values (level.id, created.room_id, caller)
  returning id into attempt;

  insert into public.room_creation_requests (
    user_id, request_id, room_id, bot_key, purpose, bot_side, access_scope, archive_policy,
    join_policy, stage_level_id
  ) values (
    caller, target_request_id, created.room_id, 'authur_strong', 'stage', 'B', 'private', 'none',
    'invite_only', level.id
  );

  return query select created.room_id, created.room_code, attempt, false;
end; $$;

-- Attempts are created only by create_stage_attempt. Results stay client-
-- reported (advisory; the Stage product is unfinished) through the existing
-- update policy.
revoke all on table public.survival_attempts from public, anon, authenticated, service_role;
grant select on table public.survival_attempts to authenticated;
grant update (finished_at, player_score, authur_score, result) on public.survival_attempts to authenticated;
drop policy if exists survival_attempt_insert on public.survival_attempts;

-- Levels: the baseline granted every privilege (TRUNCATE included, which
-- ignores RLS) to every API role. Admins keep exactly what the admin panel
-- does — insert a draft, approve it — and a start is sealed only through
-- admin_seal_stage_start. The seed (which names the attempt and generated
-- the sealed start) cannot change once written.
revoke all on table public.survival_levels from public, anon, authenticated, service_role;
grant select on table public.survival_levels to authenticated;
grant insert (id, season_key, level_no, seed, reference_key, sample_policy, sample_count, win_count,
  immediate_winning_moves, shortest_winning_replay_turns, bot_latency_ms, winning_replays, status,
  admin_note, approved_by, approved_at, created_at, updated_at) on public.survival_levels to authenticated;
grant update (status, admin_note, approved_by, approved_at, updated_at) on public.survival_levels to authenticated;

-- ── Status for the signed-in user ───────────────────────────────────────────

create or replace function public.probot_status_for(target_user uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  t timestamptz := public.probot_now(target_user);
  al record;
  plan record;
  cap integer;
begin
  select * into al from public.probot_allowance_at(target_user, t);
  select * into plan from public.plan_effective(target_user, t);
  begin
    cap := public.active_board_limit();
  exception when others then
    cap := null;
  end;
  return jsonb_build_object(
    'evaluated_at', t,
    'plan_key', plan.plan_key,
    'plan_name', plan.display_name,
    'plan_ends_at', plan.effective_end,
    'allowance', jsonb_build_object(
      'capacity', al.capacity, 'available', al.units, 'regen_minutes', al.regen_minutes,
      'next_unit_at', al.next_unit_at, 'reason', al.reason),
    'weekly', jsonb_build_object(
      'used', al.weekly_used, 'cap', al.weekly_cap,
      'remaining', greatest(al.weekly_cap - al.weekly_used, 0),
      'week_start', al.week_start, 'week_end', al.week_end),
    'credits', coalesce((select b.balance from public.economy_balances b
                          where b.user_id = target_user and b.currency = 'probot_credit'), 0),
    'boards', jsonb_build_object(
      'active', public.active_board_count(target_user, t, null, null), 'limit', cap)
  );
end; $$;

create or replace function public.get_my_probot_status()
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  return public.probot_status_for(auth.uid());
end; $$;

create or replace function public.admin_get_user_economy(target_user uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  return public.probot_status_for(target_user) || jsonb_build_object(
    'consumptions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'room_id', c.room_id, 'bot_key', c.bot_key, 'funding', c.funding,
        'plan_key_at_use', c.plan_key_at_use, 'consumed_at', c.consumed_at) order by c.seq desc)
      from (select * from public.probot_consumptions where user_id = target_user order by seq desc limit 50) c),
      '[]'::jsonb),
    'credit_entries', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'delta', e.delta, 'reason', e.reason, 'note', e.note, 'source_id', e.source_id,
        'balance_after', e.balance_after, 'created_by', e.created_by, 'created_at', e.created_at)
        order by e.seq desc)
      from (select * from public.economy_entries where user_id = target_user
             and currency = 'probot_credit' order by seq desc limit 50) e),
      '[]'::jsonb)
  );
end; $$;

-- ── Grants ──────────────────────────────────────────────────────────────────

revoke all on function public.check_stage_commit(public.room_live, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.create_live_game_core(jsonb, text, text, uuid, text, uuid, text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_live_game(jsonb, text, text, uuid, text, uuid) from public, anon;
grant execute on function public.create_live_game(jsonb, text, text, uuid, text, uuid) to authenticated, service_role;
revoke all on function public.create_bot_game(uuid, text, text, jsonb, text, text, uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_bot_game(uuid, text, text, jsonb, text, text, uuid, text, uuid, text)
  to authenticated;
revoke all on function public.admin_seal_stage_start(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_seal_stage_start(uuid, jsonb) to authenticated;
revoke all on function public.create_stage_attempt(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.create_stage_attempt(uuid, uuid, jsonb) to authenticated;
revoke all on function public.probot_status_for(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_my_probot_status() from public, anon, authenticated, service_role;
grant execute on function public.get_my_probot_status() to authenticated;
revoke all on function public.admin_get_user_economy(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_user_economy(uuid) to authenticated;

commit;
