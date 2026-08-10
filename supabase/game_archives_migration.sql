-- Live-game + immutable archive architecture.
-- Run after supabase/region_visibility_migration.sql.
--
-- This migration is intentionally staged: it expands room_live, copies every
-- unfinished legacy room into it, archives every finished legacy room as
-- Public, then removes rooms only after all replacement functions and policies
-- exist.

begin;

set statement_timeout = '15min';
set lock_timeout = '15s';

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Runtime secrets live outside every Data API schema. The deployment operator
-- provisions the value separately before this migration; no production secret
-- is committed here.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;
alter default privileges in schema private revoke all on tables from public;
alter default privileges in schema private revoke all on functions from public;

create table if not exists private.runtime_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  constraint runtime_secrets_key_check check (key = 'room_code_secret'),
  constraint runtime_secrets_value_length_check check (length(value) >= 32)
);

alter table private.runtime_secrets enable row level security;
revoke all on table private.runtime_secrets from public, anon, authenticated, service_role;

-- 1) Deploy-managed limits --------------------------------------------------
create table if not exists public.system_settings (
  key text primary key,
  value_int bigint not null check (value_int >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

insert into public.system_settings (key, value_int)
values
  ('public_archive_limit', 100000),
  ('region_archive_limit', 1000),
  ('private_board_limit', 1000),
  ('private_folder_limit', 200),
  ('private_folder_depth_limit', 8)
on conflict (key) do nothing;

alter table public.system_settings enable row level security;
revoke all on table public.system_settings from anon, authenticated;
grant select (key, value_int, updated_at) on table public.system_settings to authenticated;

drop policy if exists system_settings_read on public.system_settings;
create policy system_settings_read on public.system_settings for select
  using (public.is_approved() or public.is_admin());

-- Join codes are deterministic server-side HMACs. Only their SHA-256 hashes
-- are stored in room_live, so public Realtime payloads never disclose the
-- private room-code secret.
create or replace function public.derive_live_room_code(target_game_id uuid)
returns text language plpgsql stable security definer
set search_path = pg_catalog, extensions, private as $$
declare
  code_secret text;
begin
  select value into code_secret
  from private.runtime_secrets
  where key = 'room_code_secret';

  if code_secret is null or length(code_secret) < 32 then
    raise exception 'room_code_secret must contain at least 32 characters'
      using errcode = '55000';
  end if;
  return upper(substr(encode(extensions.hmac(
    pg_catalog.convert_to(target_game_id::text, 'utf8'),
    pg_catalog.convert_to(code_secret, 'utf8'),
    'sha256'
  ), 'hex'), 1, 12));
end;
$$;

REVOKE ALL ON FUNCTION public.derive_live_room_code(uuid)
FROM PUBLIC, anon, authenticated, service_role;

-- Fail the transaction before any data movement if the separately provisioned
-- deployment secret is missing or invalid.
do $$
begin
  perform public.derive_live_room_code(gen_random_uuid());
end; $$;

-- 2) Sanitized immutable snapshots -----------------------------------------
create or replace function public.sanitize_game_snapshot(payload jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  result jsonb;
  item jsonb;
  key_name text;
  key_value jsonb;
begin
  if payload is null then return null; end if;
  if jsonb_typeof(payload) = 'array' then
    result := '[]'::jsonb;
    for item in select value from jsonb_array_elements(payload) loop
      result := result || jsonb_build_array(public.sanitize_game_snapshot(item));
    end loop;
    return result;
  end if;
  if jsonb_typeof(payload) = 'object' then
    result := '{}'::jsonb;
    for key_name, key_value in select key, value from jsonb_each(payload) loop
      if key_name not in (
        'playerEmails', 'inviteEmailA', 'inviteEmailB', 'email',
        'roomCode', 'inviteToken', 'accessToken', 'refreshToken', 'session'
      ) then
        result := result || jsonb_build_object(
          key_name,
          public.sanitize_game_snapshot(key_value)
        );
      end if;
    end loop;
    return result;
  end if;
  return payload;
end; $$;

create or replace function public.snapshot_completion_reason(payload jsonb)
returns text language sql immutable set search_path = public as $$
  select coalesce(
    (
      select entry.value #>> '{actionDetail,reason}'
      from jsonb_array_elements(coalesce(payload -> 'logs', '[]'::jsonb))
        with ordinality as entry(value, position)
      where entry.value ->> 'action' = 'end_game'
      order by entry.position desc
      limit 1
    ),
    case when coalesce(payload #>> '{matchControl,surrenderedSide}', '') <> ''
      then 'surrender' else 'legacy_finished' end
  )
$$;

create table if not exists public.public_game_snapshots (
  game_id uuid primary key,
  source_owner_id uuid references public.profiles(id) on delete set null,
  name text not null check (btrim(name) <> ''),
  player_a text not null,
  player_b text not null default '',
  game_mode text not null check (game_mode in ('versus', 'solo')),
  mode_key text not null,
  turn_number int not null default 1,
  score_a int not null default 0,
  score_b int not null default 0,
  completion_kind text not null check (completion_kind in ('natural', 'terminated')),
  completion_reason text not null,
  surrendered_side text check (surrendered_side is null or surrendered_side in ('A', 'B')),
  creator_side text check (creator_side is null or creator_side in ('A', 'B')),
  player_a_user_id uuid references public.profiles(id) on delete set null,
  player_b_user_id uuid references public.profiles(id) on delete set null,
  snapshot jsonb not null,
  created_at timestamptz not null,
  finished_at timestamptz not null,
  archived_at timestamptz not null default now()
);

create index if not exists public_game_snapshots_retention_idx
  on public.public_game_snapshots (finished_at desc, game_id desc);
create index if not exists public_game_snapshots_mode_idx
  on public.public_game_snapshots (mode_key, finished_at desc);
create index if not exists public_game_snapshots_training_idx
  on public.public_game_snapshots (finished_at desc)
  where completion_kind = 'natural';

create table if not exists public.region_game_snapshots (
  game_id uuid primary key,
  region_id uuid not null references public.regions(id) on delete restrict,
  source_owner_id uuid references public.profiles(id) on delete set null,
  name text not null check (btrim(name) <> ''),
  player_a text not null,
  player_b text not null default '',
  game_mode text not null check (game_mode in ('versus', 'solo')),
  mode_key text not null,
  turn_number int not null default 1,
  score_a int not null default 0,
  score_b int not null default 0,
  completion_kind text not null check (completion_kind in ('natural', 'terminated')),
  completion_reason text not null,
  surrendered_side text check (surrendered_side is null or surrendered_side in ('A', 'B')),
  creator_side text check (creator_side is null or creator_side in ('A', 'B')),
  player_a_user_id uuid references public.profiles(id) on delete set null,
  player_b_user_id uuid references public.profiles(id) on delete set null,
  snapshot jsonb not null,
  created_at timestamptz not null,
  finished_at timestamptz not null,
  archived_at timestamptz not null default now()
);

create index if not exists region_game_snapshots_retention_idx
  on public.region_game_snapshots (region_id, finished_at desc, game_id desc);
create index if not exists region_game_snapshots_training_idx
  on public.region_game_snapshots (region_id, finished_at desc)
  where completion_kind = 'natural';

-- A single tree table preserves the three-table archive/library model. Game
-- payloads are immutable; folder/name/trash metadata remains editable.
create table if not exists public.private_library_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  item_type text not null check (item_type in ('folder', 'game')),
  parent_id uuid references public.private_library_items(id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  source_scope text check (source_scope is null or source_scope in ('public', 'region', 'private')),
  source_game_id uuid,
  game_id uuid,
  game_mode text check (game_mode is null or game_mode in ('versus', 'solo')),
  mode_key text,
  completion_kind text check (completion_kind is null or completion_kind in ('natural', 'terminated')),
  completion_reason text,
  turn_number int,
  score_a int,
  score_b int,
  snapshot jsonb,
  trashed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint private_library_item_shape_check check (
    (item_type = 'folder'
      and game_id is null and snapshot is null and game_mode is null
      and mode_key is null and completion_kind is null and completion_reason is null)
    or
    (item_type = 'game'
      and game_id is not null and snapshot is not null and game_mode is not null
      and mode_key is not null and completion_kind is not null and completion_reason is not null)
  )
);

alter table public.private_library_items
  drop constraint if exists private_library_items_parent_id_fkey;
alter table public.private_library_items
  add constraint private_library_items_parent_id_fkey
  foreign key (parent_id) references public.private_library_items(id) on delete cascade;

create index if not exists private_library_owner_parent_idx
  on public.private_library_items (owner_id, parent_id, trashed_at, updated_at desc);
create index if not exists private_library_owner_source_idx
  on public.private_library_items (owner_id, source_scope, source_game_id)
  where item_type = 'game';
drop index if exists public.private_library_sibling_name_unique_idx;

-- 3) Durable profile aggregates --------------------------------------------
create table if not exists public.user_mode_stats (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mode_key text not null,
  games_created bigint not null default 0 check (games_created >= 0),
  games_played bigint not null default 0 check (games_played >= 0),
  wins bigint not null default 0 check (wins >= 0),
  losses bigint not null default 0 check (losses >= 0),
  draws bigint not null default 0 check (draws >= 0),
  solo_score bigint not null default 0,
  last_played_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, mode_key)
);

alter table public.user_mode_stats enable row level security;
revoke all on table public.user_mode_stats from anon, authenticated;
grant select on table public.user_mode_stats to authenticated;
drop policy if exists user_mode_stats_read_own on public.user_mode_stats;
create policy user_mode_stats_read_own on public.user_mode_stats for select
  using (profile_id = auth.uid() or public.is_admin());

-- 4) room_live becomes the entire mutable live-game record -----------------
alter table public.room_live drop constraint if exists room_live_room_id_fkey;
alter table public.room_live
  add column if not exists owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists name text,
  add column if not exists player_a text,
  add column if not exists player_b text,
  add column if not exists status text,
  add column if not exists access_scope text,
  add column if not exists archive_policy text,
  add column if not exists region_id uuid references public.regions(id) on delete restrict,
  add column if not exists join_policy text,
  add column if not exists room_code_hash text,
  add column if not exists game_mode text,
  add column if not exists mode_key text,
  add column if not exists member_a_id text,
  add column if not exists member_b_id text,
  add column if not exists player_a_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists player_b_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists starting_side text,
  add column if not exists creator_side text,
  add column if not exists turn_number int,
  add column if not exists score_a int,
  add column if not exists score_b int,
  add column if not exists state jsonb,
  add column if not exists state_version bigint not null default 0,
  add column if not exists private_parent_id uuid references public.private_library_items(id) on delete set null,
  add column if not exists created_at timestamptz,
  add column if not exists last_activity_at timestamptz,
  add column if not exists expires_at timestamptz;

-- Legacy room_live rows are enriched from rooms before any NOT NULL checks.
do $$
begin
  if to_regclass('public.rooms') is not null then
    execute $migration$
      update public.room_live l
      set owner_id = r.owner_id,
          name = r.name,
          player_a = r.player_a,
          player_b = r.player_b,
          status = case
            when coalesce(r.state ->> 'roomStage', '') = 'waiting' then 'waiting'
            when coalesce(r.lifecycle_status, r.status) = 'draft' then 'paused'
            else 'playing'
          end,
          access_scope = coalesce(r.visibility, 'public'),
          archive_policy = coalesce(r.visibility, 'public'),
          region_id = r.region_id,
          join_policy = case
            when r.invite_user_a_id is not null or r.invite_user_b_id is not null then 'invite_only'
            else 'open'
          end,
          room_code_hash = encode(extensions.digest(public.derive_live_room_code(r.id), 'sha256'), 'hex'),
          game_mode = coalesce(r.game_mode, r.state ->> 'gameMode', 'versus'),
          mode_key = case
            when r.state ->> 'botSide' is not null then
              'aether_' || coalesce(r.state ->> 'botDifficulty', 'medium')
            when coalesce(r.game_mode, r.state ->> 'gameMode') = 'solo' then 'solo_practice'
            when r.state ->> 'emailPlayMode' = 'direct' then 'online_versus'
            when r.invite_user_a_id is not null or r.invite_user_b_id is not null then 'hosted_versus'
            else 'local_versus'
          end,
          member_a_id = r.member_a_id,
          member_b_id = r.member_b_id,
          player_a_user_id = coalesce(
            r.invite_user_a_id,
            (select p.id from public.profiles p where lower(p.email) = lower(r.invite_email_a) limit 1)
          ),
          player_b_user_id = coalesce(
            r.invite_user_b_id,
            (select p.id from public.profiles p where lower(p.email) = lower(r.invite_email_b) limit 1)
          ),
          starting_side = coalesce(r.starting_side, r.state ->> 'startingSide', 'A'),
          creator_side = case
            when r.owner_id = r.invite_user_a_id then 'A'
            when r.owner_id = r.invite_user_b_id then 'B'
            when r.state ->> 'botSide' = 'B' or coalesce(r.game_mode, r.state ->> 'gameMode') = 'solo' then 'A'
            when r.state ->> 'botSide' = 'A' then 'B'
            else null
          end,
          turn_number = r.turn_number,
          score_a = r.score_a,
          score_b = r.score_b,
          state = public.sanitize_game_snapshot(r.state),
          created_at = r.created_at,
          last_activity_at = r.updated_at,
          updated_at = r.updated_at,
          expires_at = case
            when coalesce(r.state ->> 'roomStage', '') = 'waiting' then r.updated_at + interval '24 hours'
            when coalesce(r.lifecycle_status, r.status) = 'draft' then r.updated_at + interval '30 days'
            else null
          end
      from public.rooms r
      where r.id = l.room_id
    $migration$;

    execute $migration$
      insert into public.room_live (
        room_id, actor_id, session, owner_id, name, player_a, player_b,
        status, access_scope, archive_policy, region_id, join_policy, room_code_hash,
        game_mode, mode_key, member_a_id, member_b_id,
        player_a_user_id, player_b_user_id, starting_side, creator_side,
        turn_number, score_a, score_b, state, created_at, last_activity_at,
        updated_at, expires_at
      )
      select
        r.id, r.owner_id, '{}'::jsonb, r.owner_id, r.name, r.player_a, r.player_b,
        case
          when coalesce(r.state ->> 'roomStage', '') = 'waiting' then 'waiting'
          when coalesce(r.lifecycle_status, r.status) = 'draft' then 'paused'
          else 'playing'
        end,
        coalesce(r.visibility, 'public'), coalesce(r.visibility, 'public'), r.region_id,
        case when r.invite_user_a_id is not null or r.invite_user_b_id is not null
          then 'invite_only' else 'open' end,
        encode(extensions.digest(public.derive_live_room_code(r.id), 'sha256'), 'hex'),
        coalesce(r.game_mode, r.state ->> 'gameMode', 'versus'),
        case
          when r.state ->> 'botSide' is not null then
            'aether_' || coalesce(r.state ->> 'botDifficulty', 'medium')
          when coalesce(r.game_mode, r.state ->> 'gameMode') = 'solo' then 'solo_practice'
          when r.state ->> 'emailPlayMode' = 'direct' then 'online_versus'
          when r.invite_user_a_id is not null or r.invite_user_b_id is not null then 'hosted_versus'
          else 'local_versus'
        end,
        r.member_a_id, r.member_b_id,
        coalesce(r.invite_user_a_id,
          (select p.id from public.profiles p where lower(p.email) = lower(r.invite_email_a) limit 1)),
        coalesce(r.invite_user_b_id,
          (select p.id from public.profiles p where lower(p.email) = lower(r.invite_email_b) limit 1)),
        coalesce(r.starting_side, r.state ->> 'startingSide', 'A'),
        case
          when r.owner_id = r.invite_user_a_id then 'A'
          when r.owner_id = r.invite_user_b_id then 'B'
          when r.state ->> 'botSide' = 'B' or coalesce(r.game_mode, r.state ->> 'gameMode') = 'solo' then 'A'
          when r.state ->> 'botSide' = 'A' then 'B'
          else null
        end,
        r.turn_number, r.score_a, r.score_b, public.sanitize_game_snapshot(r.state),
        r.created_at, r.updated_at, r.updated_at,
        case
          when coalesce(r.state ->> 'roomStage', '') = 'waiting' then r.updated_at + interval '24 hours'
          when coalesce(r.lifecycle_status, r.status) = 'draft' then r.updated_at + interval '30 days'
          else null
        end
      from public.rooms r
      where coalesce(r.lifecycle_status, r.status) <> 'finished'
        and not exists (select 1 from public.room_live l where l.room_id = r.id)
    $migration$;

    -- Every legacy finished room is Public, per the migration decision.
    execute $migration$
      insert into public.public_game_snapshots (
        game_id, source_owner_id, name, player_a, player_b, game_mode, mode_key,
        turn_number, score_a, score_b, completion_kind, completion_reason,
        surrendered_side, creator_side, player_a_user_id, player_b_user_id,
        snapshot, created_at, finished_at, archived_at
      )
      select
        r.id, r.owner_id, r.name, r.player_a, r.player_b,
        coalesce(r.game_mode, r.state ->> 'gameMode', 'versus'),
        case
          when r.state ->> 'botSide' is not null then
            'aether_' || coalesce(r.state ->> 'botDifficulty', 'medium')
          when coalesce(r.game_mode, r.state ->> 'gameMode') = 'solo' then 'solo_practice'
          when r.state ->> 'emailPlayMode' = 'direct' then 'online_versus'
          when r.invite_user_a_id is not null or r.invite_user_b_id is not null then 'hosted_versus'
          else 'local_versus'
        end,
        r.turn_number, r.score_a, r.score_b,
        case when public.snapshot_completion_reason(r.state)
          in ('rack_out', 'no_score_streak', 'perfect_game')
          then 'natural' else 'terminated' end,
        public.snapshot_completion_reason(r.state),
        nullif(r.state #>> '{matchControl,surrenderedSide}', ''),
        case
          when r.owner_id = r.invite_user_a_id then 'A'
          when r.owner_id = r.invite_user_b_id then 'B'
          when r.state ->> 'botSide' = 'B' or coalesce(r.game_mode, r.state ->> 'gameMode') = 'solo' then 'A'
          when r.state ->> 'botSide' = 'A' then 'B'
          else null
        end,
        coalesce(r.invite_user_a_id,
          (select p.id from public.profiles p where lower(p.email) = lower(r.invite_email_a) limit 1)),
        coalesce(r.invite_user_b_id,
          (select p.id from public.profiles p where lower(p.email) = lower(r.invite_email_b) limit 1)),
        public.sanitize_game_snapshot(r.state), r.created_at, r.updated_at, now()
      from public.rooms r
      where coalesce(r.lifecycle_status, r.status) = 'finished'
      on conflict (game_id) do nothing
    $migration$;

    -- A legacy room may already have had a companion room_live row. Finished
    -- games belong only in the immutable archive after this migration.
    execute $migration$
      delete from public.room_live l
      using public.rooms r
      where l.room_id = r.id
        and coalesce(r.lifecycle_status, r.status) = 'finished'
    $migration$;

    -- Backfill created counts for every legacy room before rooms is dropped.
    execute $migration$
      insert into public.user_mode_stats (profile_id, mode_key, games_created, updated_at)
      select r.owner_id,
        case
          when r.state ->> 'botSide' is not null then
            'aether_' || coalesce(r.state ->> 'botDifficulty', 'medium')
          when coalesce(r.game_mode, r.state ->> 'gameMode') = 'solo' then 'solo_practice'
          when r.state ->> 'emailPlayMode' = 'direct' then 'online_versus'
          when r.invite_user_a_id is not null or r.invite_user_b_id is not null then 'hosted_versus'
          else 'local_versus'
        end,
        count(*), now()
      from public.rooms r
      where r.owner_id is not null
      group by r.owner_id, 2
      on conflict (profile_id, mode_key) do update
        set games_created = public.user_mode_stats.games_created + excluded.games_created,
            updated_at = now()
    $migration$;

    -- Backfill lifetime play results independently from bounded archives.
    execute $migration$
      with legacy_finished as (
        select r.*,
          case
            when r.state ->> 'botSide' is not null then
              'aether_' || coalesce(r.state ->> 'botDifficulty', 'medium')
            when coalesce(r.game_mode, r.state ->> 'gameMode') = 'solo' then 'solo_practice'
            when r.state ->> 'emailPlayMode' = 'direct' then 'online_versus'
            when r.invite_user_a_id is not null or r.invite_user_b_id is not null then 'hosted_versus'
            else 'local_versus'
          end as normalized_mode,
          coalesce(r.invite_user_a_id,
            (select p.id from public.profiles p where lower(p.email) = lower(r.invite_email_a) limit 1),
            case when coalesce(r.game_mode, r.state ->> 'gameMode') = 'solo'
              or r.state ->> 'botSide' = 'B' then r.owner_id else null end
          ) as player_a_id,
          coalesce(r.invite_user_b_id,
            (select p.id from public.profiles p where lower(p.email) = lower(r.invite_email_b) limit 1),
            case when r.state ->> 'botSide' = 'A' then r.owner_id else null end
          ) as player_b_id,
          nullif(r.state #>> '{matchControl,surrenderedSide}', '') as surrendered_side
        from public.rooms r
        where coalesce(r.lifecycle_status, r.status) = 'finished'
      ), players as (
        select player_a_id as profile_id, normalized_mode as mode_key,
          coalesce(game_mode, state ->> 'gameMode', 'versus') as game_mode,
          'A'::text as side, score_a, score_b, surrendered_side, updated_at
        from legacy_finished where player_a_id is not null
        union all
        select player_b_id, normalized_mode,
          coalesce(game_mode, state ->> 'gameMode', 'versus'),
          'B'::text, score_a, score_b, surrendered_side, updated_at
        from legacy_finished
        where player_b_id is not null
          and coalesce(game_mode, state ->> 'gameMode', 'versus') = 'versus'
      ), aggregates as (
        select profile_id, mode_key,
          count(*) as games_played,
          count(*) filter (where game_mode = 'versus' and (
            (surrendered_side is not null and side <> surrendered_side)
            or (surrendered_side is null and (
              (side = 'A' and score_a > score_b) or (side = 'B' and score_b > score_a)
            ))
          )) as wins,
          count(*) filter (where game_mode = 'versus' and (
            (surrendered_side is not null and side = surrendered_side)
            or (surrendered_side is null and (
              (side = 'A' and score_a < score_b) or (side = 'B' and score_b < score_a)
            ))
          )) as losses,
          count(*) filter (where game_mode = 'versus' and surrendered_side is null
            and score_a = score_b) as draws,
          sum(case when game_mode = 'solo' then
            case when side = 'A' then score_a else score_b end else 0 end) as solo_score,
          max(updated_at) as last_played_at
        from players group by profile_id, mode_key
      )
      insert into public.user_mode_stats (
        profile_id, mode_key, games_played, wins, losses, draws,
        solo_score, last_played_at, updated_at
      )
      select profile_id, mode_key, games_played, wins, losses, draws,
        solo_score, last_played_at, now()
      from aggregates
      on conflict (profile_id, mode_key) do update set
        games_played = public.user_mode_stats.games_played + excluded.games_played,
        wins = public.user_mode_stats.wins + excluded.wins,
        losses = public.user_mode_stats.losses + excluded.losses,
        draws = public.user_mode_stats.draws + excluded.draws,
        solo_score = public.user_mode_stats.solo_score + excluded.solo_score,
        last_played_at = greatest(public.user_mode_stats.last_played_at, excluded.last_played_at),
        updated_at = now()
    $migration$;
  end if;
end; $$;

update public.room_live
set name = coalesce(nullif(btrim(name), ''), 'Untitled game'),
    player_a = coalesce(player_a, 'Player A'),
    player_b = coalesce(player_b, ''),
    status = coalesce(status, 'paused'),
    access_scope = coalesce(access_scope, 'public'),
    archive_policy = coalesce(archive_policy, 'public'),
    join_policy = coalesce(join_policy, 'invite_only'),
    room_code_hash = coalesce(
      room_code_hash,
      encode(extensions.digest(public.derive_live_room_code(room_id), 'sha256'), 'hex')
    ),
    game_mode = coalesce(game_mode, 'versus'),
    mode_key = coalesce(mode_key, 'local_versus'),
    starting_side = coalesce(starting_side, 'A'),
    turn_number = coalesce(turn_number, 1),
    score_a = coalesce(score_a, 0),
    score_b = coalesce(score_b, 0),
    state = coalesce(state, '{}'::jsonb),
    created_at = coalesce(created_at, updated_at, now()),
    last_activity_at = coalesce(last_activity_at, updated_at, now()),
    updated_at = coalesce(updated_at, now());

alter table public.room_live
  alter column name set not null,
  alter column player_a set not null,
  alter column player_b set not null,
  alter column status set not null,
  alter column access_scope set not null,
  alter column archive_policy set not null,
  alter column join_policy set not null,
  alter column room_code_hash set not null,
  alter column game_mode set not null,
  alter column mode_key set not null,
  alter column starting_side set not null,
  alter column turn_number set not null,
  alter column score_a set not null,
  alter column score_b set not null,
  alter column state set not null,
  alter column created_at set not null,
  alter column last_activity_at set not null;

alter table public.room_live drop constraint if exists room_live_status_check;
alter table public.room_live add constraint room_live_status_check
  check (status in ('waiting', 'playing', 'paused'));
alter table public.room_live drop constraint if exists room_live_scope_check;
alter table public.room_live add constraint room_live_scope_check check (
  (access_scope = 'public' and region_id is null and archive_policy in ('public', 'none'))
  or (access_scope = 'region' and region_id is not null and archive_policy in ('region', 'none'))
  or (access_scope = 'private' and region_id is null and archive_policy in ('private', 'none'))
);
alter table public.room_live drop constraint if exists room_live_join_policy_check;
alter table public.room_live add constraint room_live_join_policy_check
  check (join_policy in ('open', 'code_only', 'invite_only'));
alter table public.room_live drop constraint if exists room_live_game_mode_check;
alter table public.room_live add constraint room_live_game_mode_check
  check (game_mode in ('versus', 'solo'));
alter table public.room_live drop constraint if exists room_live_starting_side_check;
alter table public.room_live add constraint room_live_starting_side_check
  check (starting_side in ('A', 'B'));
alter table public.room_live drop constraint if exists room_live_creator_side_check;
alter table public.room_live add constraint room_live_creator_side_check
  check (creator_side is null or creator_side in ('A', 'B'));
alter table public.room_live drop constraint if exists room_live_player_ids_different_check;
alter table public.room_live add constraint room_live_player_ids_different_check
  check (player_a_user_id is null or player_b_user_id is null or player_a_user_id <> player_b_user_id);

drop index if exists public.room_live_code_unique_idx;
create unique index if not exists room_live_code_hash_unique_idx on public.room_live (room_code_hash);
create index if not exists room_live_public_activity_idx
  on public.room_live (last_activity_at desc) where access_scope = 'public';
create index if not exists room_live_region_activity_idx
  on public.room_live (region_id, last_activity_at desc) where access_scope = 'region';
create index if not exists room_live_expiry_idx
  on public.room_live (expires_at) where expires_at is not null;

-- 5) Access helpers, lifecycle and quotas -----------------------------------
create or replace function public.can_read_live_game(target_game_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.room_live l
    where l.room_id = target_game_id
      and (
        public.is_admin()
        or (l.access_scope = 'public' and public.is_approved())
        or (l.access_scope = 'region' and public.is_approved()
          and l.region_id = public.my_region_id())
        or (l.access_scope = 'private' and auth.uid() is not null
          and auth.uid() in (l.owner_id, l.player_a_user_id, l.player_b_user_id))
      )
  )
$$;

create or replace function public.can_write_live_game(target_game_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.room_live l
    where l.room_id = target_game_id
      and public.can_read_live_game(l.room_id)
      and auth.uid() in (l.owner_id, l.player_a_user_id, l.player_b_user_id)
  ) or public.is_admin()
$$;

revoke all on function public.can_read_live_game(uuid) from public;
revoke all on function public.can_write_live_game(uuid) from public;
grant execute on function public.can_read_live_game(uuid) to authenticated;
grant execute on function public.can_write_live_game(uuid) to authenticated;

drop function if exists public.list_live_games(text, uuid);
create function public.list_live_games(
  target_access_scope text,
  target_region_id uuid default null
)
returns table (
  room_id uuid,
  name text,
  player_a text,
  player_b text,
  status text,
  access_scope text,
  archive_policy text,
  join_policy text,
  region_id uuid,
  game_mode text,
  mode_key text,
  starting_side text,
  turn_number int,
  score_a int,
  score_b int,
  created_at timestamptz,
  updated_at timestamptz,
  owner_name text,
  viewer_role text,
  can_manage boolean,
  has_opponent boolean
)
language plpgsql stable security definer
set search_path = pg_catalog as $$
begin
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'approved membership required' using errcode = '42501';
  end if;
  if target_access_scope not in ('public', 'region', 'private') then
    raise exception 'invalid live game scope' using errcode = '22023';
  end if;
  if target_access_scope = 'region' then
    if target_region_id is null
      or (not public.is_admin() and target_region_id is distinct from public.my_region_id())
    then
      raise exception 'region access required' using errcode = '42501';
    end if;
  elsif target_region_id is not null then
    raise exception 'only region listings may specify a region' using errcode = '22023';
  end if;

  return query
  select
    l.room_id,
    l.name,
    l.player_a,
    l.player_b,
    l.status,
    l.access_scope,
    l.archive_policy,
    l.join_policy,
    l.region_id,
    l.game_mode,
    l.mode_key,
    l.starting_side,
    l.turn_number,
    l.score_a,
    l.score_b,
    l.created_at,
    l.updated_at,
    p.display_name,
    case
      when l.owner_id = auth.uid() then 'Owner'
      when public.is_admin() then 'Admin'
      when l.player_a_user_id = auth.uid() then 'Player A'
      when l.player_b_user_id = auth.uid() then 'Player B'
      else 'Spectator'
    end::text,
    (l.owner_id = auth.uid() or public.is_admin()),
    case
      when l.game_mode = 'solo' or left(l.mode_key, 7) = 'aether_' then true
      when l.creator_side = 'A' then l.player_b_user_id is not null
      when l.creator_side = 'B' then l.player_a_user_id is not null
      else l.player_a_user_id is not null and l.player_b_user_id is not null
    end
  from public.room_live l
  left join public.profiles p on p.id = l.owner_id
  where public.can_read_live_game(l.room_id)
    and (
      (target_access_scope = 'public' and l.access_scope = 'public')
      or
      (target_access_scope = 'region' and l.access_scope = 'region'
        and l.region_id = target_region_id)
      or
      (target_access_scope = 'private' and l.access_scope = 'private'
        and auth.uid() in (l.owner_id, l.player_a_user_id, l.player_b_user_id))
    )
  order by l.updated_at desc;
end; $$;

revoke all on function public.list_live_games(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_live_games(text, uuid) to authenticated;

create or replace function public.mode_key_from_state(target_state jsonb)
returns text language sql immutable as $$
  select case
    when target_state ->> 'botSide' is not null then
      'aether_' || coalesce(target_state ->> 'botDifficulty', 'medium')
    when coalesce(target_state ->> 'gameMode', 'versus') = 'solo' then 'solo_practice'
    when target_state ->> 'emailPlayMode' = 'direct' then 'online_versus'
    when target_state ->> 'emailPlayMode' = 'hosted'
      and (target_state #>> '{playerUserIds,A}' is not null
        or target_state #>> '{playerUserIds,B}' is not null) then 'hosted_versus'
    else 'local_versus'
  end
$$;

create or replace function public.prepare_live_game_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is distinct from old.owner_id
    or new.access_scope is distinct from old.access_scope
    or new.archive_policy is distinct from old.archive_policy
    or new.region_id is distinct from old.region_id
    or new.room_code_hash is distinct from old.room_code_hash
    or new.created_at is distinct from old.created_at
  then
    raise exception 'live game identity and archive policy are immutable' using errcode = '42501';
  end if;
  if new.state is distinct from old.state then
    new.state := public.sanitize_game_snapshot(new.state);
    new.state_version := old.state_version + 1;
  end if;
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists prepare_live_game_update on public.room_live;
create trigger prepare_live_game_update
  before update on public.room_live
  for each row execute function public.prepare_live_game_update();

create or replace function public.create_live_game(
  target_state jsonb,
  target_access_scope text,
  target_archive_policy text,
  target_region_id uuid default null,
  target_join_policy text default 'invite_only',
  target_private_parent_id uuid default null
)
returns table (room_id uuid, room_code text)
language plpgsql security definer set search_path = public as $$
declare
  next_id uuid := gen_random_uuid();
  next_code text;
  next_mode text := coalesce(target_state ->> 'gameMode', 'versus');
  next_mode_key text := public.mode_key_from_state(target_state);
  player_a_id uuid := nullif(target_state #>> '{playerUserIds,A}', '')::uuid;
  player_b_id uuid := nullif(target_state #>> '{playerUserIds,B}', '')::uuid;
  owner_side text;
  private_limit bigint;
  private_usage bigint;
begin
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'approved membership required' using errcode = '42501';
  end if;
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
  -- Solo and Aether force the creator to play. Persist that identity now so
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
    created_at, last_activity_at, updated_at, expires_at
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
      then now() + interval '24 hours' else null end
  );

  insert into public.user_mode_stats (profile_id, mode_key, games_created)
  values (auth.uid(), next_mode_key, 1)
  on conflict (profile_id, mode_key) do update
    set games_created = public.user_mode_stats.games_created + 1,
        updated_at = now();

  return query select next_id, next_code;
end; $$;

revoke all on function public.create_live_game(jsonb, text, text, uuid, text, uuid) from public;
grant execute on function public.create_live_game(jsonb, text, text, uuid, text, uuid) to authenticated;

create or replace function public.join_live_game(
  target_room_code text default null,
  target_game_id uuid default null
)
returns table (room_id uuid, claimed_side text)
language plpgsql security definer set search_path = public as $$
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
  if live.game_mode = 'solo' or live.state ->> 'botSide' is not null then
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
end; $$;

revoke all on function public.join_live_game(text, uuid) from public;
grant execute on function public.join_live_game(text, uuid) to authenticated;

create or replace function public.get_live_game_code(target_game_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when exists (
    select 1 from public.room_live l
    where l.room_id = target_game_id
      and (public.is_admin() or auth.uid() in (l.owner_id, l.player_a_user_id, l.player_b_user_id))
  ) then public.derive_live_room_code(target_game_id) else null end
$$;

revoke all on function public.get_live_game_code(uuid) from public;
grant execute on function public.get_live_game_code(uuid) to authenticated;

-- Browser clients receive SELECT only on room_live. All mutations pass through
-- narrow RPCs so participants cannot rewrite ownership, scope, join policy, or
-- another player's identity by crafting a direct PostgREST update.
create or replace function public.update_live_game_state(
  target_game_id uuid,
  target_state jsonb
)
returns void language plpgsql security definer set search_path = public as $$
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
      mode_key = case when caller_can_configure
        then public.mode_key_from_state(target_state) else mode_key end,
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
end; $$;

revoke all on function public.update_live_game_state(uuid, jsonb) from public;
grant execute on function public.update_live_game_state(uuid, jsonb) to authenticated;

-- Commits the durable game snapshot and the matching ephemeral draft in one
-- row update. Keeping these values in one WAL record prevents Realtime clients
-- from combining a new board with an older pending-placement session.
create or replace function public.sync_live_game_state(
  target_game_id uuid,
  target_state jsonb,
  target_session jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  live public.room_live%rowtype;
  caller_can_configure boolean;
  next_game_mode text := coalesce(target_state ->> 'gameMode', 'versus');
  clean_session jsonb;
begin
  if target_state is null or jsonb_typeof(target_state) <> 'object' then
    raise exception 'live game state must be an object' using errcode = '22023';
  end if;
  if target_session is null or jsonb_typeof(target_session) <> 'object' then
    raise exception 'live game session must be an object' using errcode = '22023';
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

  clean_session := jsonb_set(
    coalesce(public.sanitize_game_snapshot(target_session), '{}'::jsonb),
    '{actorId}',
    to_jsonb(auth.uid()::text),
    true
  );

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
      mode_key = case when caller_can_configure
        then public.mode_key_from_state(target_state) else mode_key end,
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
      actor_id = auth.uid(),
      session = clean_session,
      last_activity_at = now(),
      expires_at = case
        when coalesce(target_state ->> 'roomStage', '') = 'waiting' then now() + interval '24 hours'
        when coalesce(target_state ->> 'status', '') = 'draft' then now() + interval '30 days'
        else null
      end
  where room_id = target_game_id;
end; $$;

revoke all on function public.sync_live_game_state(uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sync_live_game_state(uuid, jsonb, jsonb) to authenticated;

create or replace function public.update_live_game_session(
  target_game_id uuid,
  target_session jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  clean_session jsonb;
begin
  if target_session is null or jsonb_typeof(target_session) <> 'object' then
    raise exception 'live game session must be an object' using errcode = '22023';
  end if;
  if not public.can_write_live_game(target_game_id) then
    raise exception 'live game write access required' using errcode = '42501';
  end if;
  clean_session := jsonb_set(
    coalesce(public.sanitize_game_snapshot(target_session), '{}'::jsonb),
    '{actorId}',
    to_jsonb(auth.uid()::text),
    true
  );
  update public.room_live
  set actor_id = auth.uid(),
      session = clean_session,
      last_activity_at = now()
  where room_id = target_game_id
    and coalesce(session ->> 'updatedAt', '') <= coalesce(clean_session ->> 'updatedAt', '');
  if not found and not exists (
    select 1 from public.room_live where room_id = target_game_id
  ) then
    raise exception 'live game not found' using errcode = 'P0002';
  end if;
end; $$;

revoke all on function public.update_live_game_session(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.update_live_game_session(uuid, jsonb) to authenticated;

create or replace function public.cancel_live_game(target_game_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.room_live
  where room_id = target_game_id
    and (owner_id = auth.uid() or public.is_admin());
  if not found then
    raise exception 'live game cancel access required' using errcode = '42501';
  end if;
end; $$;

revoke all on function public.cancel_live_game(uuid) from public;
grant execute on function public.cancel_live_game(uuid) to authenticated;

create or replace function public.prune_public_game_snapshots()
returns bigint language plpgsql security definer set search_path = public as $$
declare
  target_limit bigint;
  removed bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('public_game_snapshots', 42));
  select value_int into target_limit from public.system_settings where key = 'public_archive_limit';
  with removed_rows as (
    delete from public.public_game_snapshots
    where game_id in (
      select game_id from public.public_game_snapshots
      order by finished_at desc, game_id desc
      offset greatest(coalesce(target_limit, 100000), 0)
    )
    returning 1
  ) select count(*) into removed from removed_rows;
  return removed;
end; $$;

create or replace function public.prune_region_game_snapshots(target_region_id uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  target_limit bigint;
  removed bigint;
begin
  select value_int into target_limit from public.system_settings where key = 'region_archive_limit';
  if target_region_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(target_region_id::text, 43));
  end if;
  with ranked as (
    select game_id,
      row_number() over (partition by region_id order by finished_at desc, game_id desc) as position
    from public.region_game_snapshots
    where target_region_id is null or region_id = target_region_id
  ), removed_rows as (
    delete from public.region_game_snapshots target
    using ranked
    where target.game_id = ranked.game_id
      and ranked.position > coalesce(target_limit, 1000)
    returning 1
  ) select count(*) into removed from removed_rows;
  return removed;
end; $$;

revoke all on function public.prune_public_game_snapshots() from public;
revoke all on function public.prune_region_game_snapshots(uuid) from public;

-- Legacy imports are bounded before the migration commits, not deferred until
-- the next game finishes.
select public.prune_public_game_snapshots();
select public.prune_region_game_snapshots(null);

create or replace function public.set_game_storage_limits(
  next_public_limit bigint,
  next_region_limit bigint,
  next_private_limit bigint
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if least(next_public_limit, next_region_limit, next_private_limit) < 0 then
    raise exception 'limits cannot be negative' using errcode = '22023';
  end if;

  insert into public.system_settings (key, value_int, updated_at, updated_by)
  values
    ('public_archive_limit', next_public_limit, now(), auth.uid()),
    ('region_archive_limit', next_region_limit, now(), auth.uid()),
    ('private_board_limit', next_private_limit, now(), auth.uid())
  on conflict (key) do update
    set value_int = excluded.value_int,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  perform public.prune_public_game_snapshots();
  perform public.prune_region_game_snapshots(null);
end; $$;

revoke all on function public.set_game_storage_limits(bigint, bigint, bigint) from public;
grant execute on function public.set_game_storage_limits(bigint, bigint, bigint) to authenticated;

create or replace function public.record_player_result(
  target_profile_id uuid,
  target_mode_key text,
  target_game_mode text,
  target_side text,
  target_score_a int,
  target_score_b int,
  target_finished_at timestamptz,
  target_surrendered_side text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  add_win bigint := 0;
  add_loss bigint := 0;
  add_draw bigint := 0;
  add_solo bigint := 0;
begin
  if target_profile_id is null then return; end if;
  if target_game_mode = 'solo' then
    add_solo := case when target_side = 'A' then target_score_a else target_score_b end;
  elsif target_surrendered_side is not null then
    if target_side = target_surrendered_side then add_loss := 1;
    else add_win := 1;
    end if;
  elsif target_score_a = target_score_b then
    add_draw := 1;
  elsif (target_side = 'A' and target_score_a > target_score_b)
    or (target_side = 'B' and target_score_b > target_score_a)
  then
    add_win := 1;
  else
    add_loss := 1;
  end if;

  insert into public.user_mode_stats (
    profile_id, mode_key, games_played, wins, losses, draws,
    solo_score, last_played_at, updated_at
  ) values (
    target_profile_id, target_mode_key, 1, add_win, add_loss, add_draw,
    add_solo, target_finished_at, now()
  )
  on conflict (profile_id, mode_key) do update set
    games_played = public.user_mode_stats.games_played + 1,
    wins = public.user_mode_stats.wins + excluded.wins,
    losses = public.user_mode_stats.losses + excluded.losses,
    draws = public.user_mode_stats.draws + excluded.draws,
    solo_score = public.user_mode_stats.solo_score + excluded.solo_score,
    last_played_at = greatest(public.user_mode_stats.last_played_at, excluded.last_played_at),
    updated_at = now();
end; $$;

revoke all on function public.record_player_result(uuid, text, text, text, int, int, timestamptz, text) from public;

create or replace function public.finalize_live_game(
  target_game_id uuid,
  target_state jsonb,
  target_completion_kind text,
  target_completion_reason text,
  target_surrendered_side text default null
)
returns table (archive_scope text, archive_game_id uuid, private_item_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  live public.room_live%rowtype;
  finished_at timestamptz := now();
  saved_private_id uuid;
  state_completion_reason text;
begin
  if target_completion_kind not in ('natural', 'terminated') then
    raise exception 'invalid completion kind' using errcode = '22023';
  end if;
  if target_completion_kind = 'natural'
    and target_completion_reason not in ('rack_out', 'no_score_streak', 'perfect_game')
  then
    raise exception 'natural completion requires a natural rule reason' using errcode = '22023';
  end if;
  if target_completion_kind = 'terminated'
    and target_completion_reason not in (
      'surrender', 'manual', 'admin', 'timeout', 'disconnect', 'legacy_finished', 'other'
    )
  then
    raise exception 'invalid termination reason' using errcode = '22023';
  end if;
  if target_surrendered_side is not null and target_surrendered_side not in ('A', 'B') then
    raise exception 'invalid surrendered side' using errcode = '22023';
  end if;
  if (target_completion_reason = 'surrender') <> (target_surrendered_side is not null) then
    raise exception 'surrender reason and side must be provided together' using errcode = '22023';
  end if;

  select * into live from public.room_live where room_id = target_game_id for update;
  if not found then
    -- Idempotent retry: return the already-created destination if retained.
    if exists (select 1 from public.public_game_snapshots where game_id = target_game_id) then
      return query select 'public'::text, target_game_id, null::uuid;
      return;
    end if;
    if exists (select 1 from public.region_game_snapshots where game_id = target_game_id) then
      return query select 'region'::text, target_game_id, null::uuid;
      return;
    end if;
    select id into saved_private_id from public.private_library_items
      where source_game_id = target_game_id and source_scope = 'private' limit 1;
    if saved_private_id is not null then
      return query select 'private'::text, target_game_id, saved_private_id;
      return;
    end if;
    raise exception 'live game not found' using errcode = 'P0002';
  end if;
  if not public.can_write_live_game(target_game_id) then
    raise exception 'game access required' using errcode = '42501';
  end if;
  if coalesce(target_state ->> 'status', '') <> 'finished' then
    raise exception 'final state must be finished' using errcode = '22023';
  end if;
  state_completion_reason := public.snapshot_completion_reason(target_state);
  if target_completion_kind = 'natural' and state_completion_reason <> target_completion_reason then
    raise exception 'natural completion does not match the final game log' using errcode = '22023';
  end if;
  if target_completion_reason = 'surrender' and
    nullif(target_state #>> '{matchControl,surrenderedSide}', '') is distinct from target_surrendered_side
  then
    raise exception 'surrender side does not match the final game state' using errcode = '22023';
  end if;

  live.state := public.sanitize_game_snapshot(target_state);
  live.turn_number := coalesce((target_state ->> 'turnNumber')::int, live.turn_number);
  live.score_a := coalesce((target_state #>> '{scores,A}')::int, live.score_a);
  live.score_b := coalesce((target_state #>> '{scores,B}')::int, live.score_b);

  if live.archive_policy = 'public' then
    insert into public.public_game_snapshots (
      game_id, source_owner_id, name, player_a, player_b, game_mode, mode_key,
      turn_number, score_a, score_b, completion_kind, completion_reason,
      surrendered_side, creator_side, player_a_user_id, player_b_user_id,
      snapshot, created_at, finished_at
    ) values (
      live.room_id, live.owner_id, live.name, live.player_a, live.player_b,
      live.game_mode, live.mode_key, live.turn_number, live.score_a, live.score_b,
      target_completion_kind, target_completion_reason, target_surrendered_side,
      live.creator_side, live.player_a_user_id, live.player_b_user_id,
      live.state, live.created_at, finished_at
    ) on conflict (game_id) do nothing;
    perform public.prune_public_game_snapshots();
  elsif live.archive_policy = 'region' then
    insert into public.region_game_snapshots (
      game_id, region_id, source_owner_id, name, player_a, player_b, game_mode, mode_key,
      turn_number, score_a, score_b, completion_kind, completion_reason,
      surrendered_side, creator_side, player_a_user_id, player_b_user_id,
      snapshot, created_at, finished_at
    ) values (
      live.room_id, live.region_id, live.owner_id, live.name, live.player_a, live.player_b,
      live.game_mode, live.mode_key, live.turn_number, live.score_a, live.score_b,
      target_completion_kind, target_completion_reason, target_surrendered_side,
      live.creator_side, live.player_a_user_id, live.player_b_user_id,
      live.state, live.created_at, finished_at
    ) on conflict (game_id) do nothing;
    perform public.prune_region_game_snapshots(live.region_id);
  elsif live.archive_policy = 'private' then
    insert into public.private_library_items (
      owner_id, item_type, parent_id, name, source_scope, source_game_id,
      game_id, game_mode, mode_key, completion_kind, completion_reason,
      turn_number, score_a, score_b, snapshot
    ) values (
      live.owner_id, 'game', live.private_parent_id, live.name, 'private', live.room_id,
      live.room_id, live.game_mode, live.mode_key, target_completion_kind,
      target_completion_reason, live.turn_number, live.score_a, live.score_b, live.state
    ) returning id into saved_private_id;
  end if;

  perform public.record_player_result(
    live.player_a_user_id, live.mode_key, live.game_mode, 'A',
    live.score_a, live.score_b, finished_at, target_surrendered_side
  );
  if live.game_mode = 'versus' then
    perform public.record_player_result(
      live.player_b_user_id, live.mode_key, live.game_mode, 'B',
      live.score_a, live.score_b, finished_at, target_surrendered_side
    );
  end if;

  delete from public.room_live where room_id = target_game_id;
  return query select live.archive_policy, live.room_id, saved_private_id;
end; $$;

revoke all on function public.finalize_live_game(uuid, jsonb, text, text, text) from public;
grant execute on function public.finalize_live_game(uuid, jsonb, text, text, text) to authenticated;

create or replace function public.move_public_snapshot_to_region(
  target_game_id uuid,
  target_region_id uuid
)
returns void language plpgsql security definer set search_path = public as $$
declare
  source public.public_game_snapshots%rowtype;
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.regions where id = target_region_id) then
    raise exception 'region not found' using errcode = 'P0002';
  end if;
  select * into source from public.public_game_snapshots
    where game_id = target_game_id for update;
  if not found then
    raise exception 'finished public snapshot not found' using errcode = 'P0002';
  end if;

  insert into public.region_game_snapshots (
    game_id, region_id, source_owner_id, name, player_a, player_b, game_mode,
    mode_key, turn_number, score_a, score_b, completion_kind,
    completion_reason, surrendered_side, creator_side, player_a_user_id,
    player_b_user_id, snapshot, created_at, finished_at, archived_at
  ) values (
    source.game_id, target_region_id, source.source_owner_id, source.name,
    source.player_a, source.player_b, source.game_mode, source.mode_key,
    source.turn_number, source.score_a, source.score_b, source.completion_kind,
    source.completion_reason, source.surrendered_side, source.creator_side,
    source.player_a_user_id, source.player_b_user_id, source.snapshot,
    source.created_at, source.finished_at, now()
  );
  delete from public.public_game_snapshots where game_id = target_game_id;
  perform public.prune_region_game_snapshots(target_region_id);
end; $$;

revoke all on function public.move_public_snapshot_to_region(uuid, uuid) from public;
grant execute on function public.move_public_snapshot_to_region(uuid, uuid) to authenticated;

create or replace function public.get_public_archive_move_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  admin_access boolean := public.is_admin();
  region_options jsonb;
begin
  select coalesce(
    jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by lower(r.name), r.id),
    '[]'::jsonb
  ) into region_options
  from public.regions r
  where admin_access;

  return jsonb_build_object('can_move', admin_access, 'regions', region_options);
end; $$;

revoke all on function public.get_public_archive_move_context()
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_archive_move_context() to authenticated;

create or replace function public.move_public_snapshots_to_region(
  target_game_ids uuid[],
  target_region_id uuid
)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  requested_ids uuid[];
  source_count bigint;
  moved_count bigint;
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.regions where id = target_region_id) then
    raise exception 'region not found' using errcode = 'P0002';
  end if;

  select array_agg(distinct game_id)
  into requested_ids
  from unnest(coalesce(target_game_ids, '{}'::uuid[])) as requested(game_id)
  where game_id is not null;
  if coalesce(cardinality(requested_ids), 0) = 0 then
    raise exception 'select at least one finished public snapshot' using errcode = '22023';
  end if;

  perform 1 from public.public_game_snapshots
  where game_id = any(requested_ids)
  for update;
  select count(*) into source_count
  from public.public_game_snapshots
  where game_id = any(requested_ids);
  if source_count <> cardinality(requested_ids) then
    raise exception 'one or more finished public snapshots were not found' using errcode = 'P0002';
  end if;

  insert into public.region_game_snapshots (
    game_id, region_id, source_owner_id, name, player_a, player_b, game_mode,
    mode_key, turn_number, score_a, score_b, completion_kind,
    completion_reason, surrendered_side, creator_side, player_a_user_id,
    player_b_user_id, snapshot, created_at, finished_at, archived_at
  )
  select
    source.game_id, target_region_id, source.source_owner_id, source.name,
    source.player_a, source.player_b, source.game_mode, source.mode_key,
    source.turn_number, source.score_a, source.score_b, source.completion_kind,
    source.completion_reason, source.surrendered_side, source.creator_side,
    source.player_a_user_id, source.player_b_user_id, source.snapshot,
    source.created_at, source.finished_at, now()
  from public.public_game_snapshots source
  where source.game_id = any(requested_ids);

  delete from public.public_game_snapshots
  where game_id = any(requested_ids);
  get diagnostics moved_count = row_count;
  perform public.prune_region_game_snapshots(target_region_id);
  return moved_count;
end; $$;

revoke all on function public.move_public_snapshots_to_region(uuid[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.move_public_snapshots_to_region(uuid[], uuid) to authenticated;

create or replace function public.save_archive_to_private(
  target_scope text,
  target_game_id uuid,
  target_parent_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  result_id uuid;
  source_public public.public_game_snapshots%rowtype;
  source_region public.region_game_snapshots%rowtype;
  target_name text;
  target_game_mode text;
  target_mode_key text;
  target_completion_kind text;
  target_completion_reason text;
  target_turn_number int;
  target_score_a int;
  target_score_b int;
  target_snapshot jsonb;
  private_limit bigint;
  private_usage bigint;
begin
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'approved membership required' using errcode = '42501';
  end if;
  if target_scope = 'public' then
    select * into source_public from public.public_game_snapshots where game_id = target_game_id;
    if not found then raise exception 'public snapshot not found' using errcode = 'P0002'; end if;
    target_name := source_public.name;
    target_game_mode := source_public.game_mode;
    target_mode_key := source_public.mode_key;
    target_completion_kind := source_public.completion_kind;
    target_completion_reason := source_public.completion_reason;
    target_turn_number := source_public.turn_number;
    target_score_a := source_public.score_a;
    target_score_b := source_public.score_b;
    target_snapshot := source_public.snapshot;
  elsif target_scope = 'region' then
    select * into source_region from public.region_game_snapshots
      where game_id = target_game_id
        and (public.is_admin() or (public.is_approved() and region_id = public.my_region_id()));
    if not found then raise exception 'region snapshot not found' using errcode = 'P0002'; end if;
    target_name := source_region.name;
    target_game_mode := source_region.game_mode;
    target_mode_key := source_region.mode_key;
    target_completion_kind := source_region.completion_kind;
    target_completion_reason := source_region.completion_reason;
    target_turn_number := source_region.turn_number;
    target_score_a := source_region.score_a;
    target_score_b := source_region.score_b;
    target_snapshot := source_region.snapshot;
  else
    raise exception 'invalid archive scope' using errcode = '22023';
  end if;

  select id into result_id from public.private_library_items
    where owner_id = auth.uid() and source_scope = target_scope
      and source_game_id = target_game_id and trashed_at is null
    order by created_at limit 1;
  if result_id is not null then return result_id; end if;

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

  insert into public.private_library_items (
    owner_id, item_type, parent_id, name, source_scope, source_game_id,
    game_id, game_mode, mode_key, completion_kind, completion_reason,
    turn_number, score_a, score_b, snapshot
  ) values (
    auth.uid(), 'game', target_parent_id, target_name, target_scope, target_game_id,
    target_game_id, target_game_mode, target_mode_key, target_completion_kind,
    target_completion_reason, target_turn_number, target_score_a, target_score_b,
    target_snapshot
  ) returning id into result_id;
  return result_id;
end; $$;

revoke all on function public.save_archive_to_private(text, uuid, uuid) from public;
grant execute on function public.save_archive_to_private(text, uuid, uuid) to authenticated;

create or replace function public.copy_private_game_item(
  source_item_id uuid,
  target_parent_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  source public.private_library_items%rowtype;
  result_id uuid;
begin
  select * into source from public.private_library_items
  where id = source_item_id and owner_id = auth.uid()
    and item_type = 'game' and trashed_at is null;
  if not found then
    raise exception 'private game not found' using errcode = 'P0002';
  end if;

  insert into public.private_library_items (
    owner_id, item_type, parent_id, name, source_scope, source_game_id,
    game_id, game_mode, mode_key, completion_kind, completion_reason,
    turn_number, score_a, score_b, snapshot
  ) values (
    source.owner_id, 'game', coalesce(target_parent_id, source.parent_id),
    source.name || ' (Copy)', 'private', source.game_id,
    gen_random_uuid(), source.game_mode, source.mode_key, source.completion_kind,
    source.completion_reason, source.turn_number, source.score_a, source.score_b,
    source.snapshot
  ) returning id into result_id;
  return result_id;
end; $$;

revoke all on function public.copy_private_game_item(uuid, uuid) from public;
grant execute on function public.copy_private_game_item(uuid, uuid) to authenticated;

create or replace function public.move_private_library_items(
  target_item_ids uuid[],
  target_parent_id uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  requested_count int;
  owned_count int;
begin
  requested_count := coalesce(array_length(target_item_ids, 1), 0);
  if requested_count = 0 then
    raise exception 'at least one private item is required' using errcode = '22023';
  end if;
  select count(distinct id) into owned_count
  from public.private_library_items
  where owner_id = auth.uid() and id = any(target_item_ids) and trashed_at is null;
  if owned_count <> requested_count then
    raise exception 'private item not found' using errcode = 'P0002';
  end if;
  if target_parent_id is not null and not exists (
    select 1 from public.private_library_items
    where id = target_parent_id and owner_id = auth.uid()
      and item_type = 'folder' and trashed_at is null
  ) then
    raise exception 'destination folder not found' using errcode = 'P0002';
  end if;

  update public.private_library_items
  set parent_id = target_parent_id
  where owner_id = auth.uid() and id = any(target_item_ids);
end; $$;

revoke all on function public.move_private_library_items(uuid[], uuid) from public;
grant execute on function public.move_private_library_items(uuid[], uuid) to authenticated;

-- 6) Private tree integrity -------------------------------------------------
create or replace function public.validate_private_library_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cursor_id uuid;
  cursor_owner uuid;
  depth int := 0;
  depth_limit int;
  item_limit bigint;
  item_count bigint;
begin
  if tg_op = 'UPDATE' and old.item_type = 'game' and (
    new.snapshot is distinct from old.snapshot
    or new.game_id is distinct from old.game_id
    or new.game_mode is distinct from old.game_mode
    or new.mode_key is distinct from old.mode_key
    or new.completion_kind is distinct from old.completion_kind
    or new.completion_reason is distinct from old.completion_reason
    or new.source_scope is distinct from old.source_scope
    or new.source_game_id is distinct from old.source_game_id
  ) then
    raise exception 'private game snapshots are immutable' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    raise exception 'private items cannot change owner' using errcode = '42501';
  end if;

  if new.parent_id is not null then
    cursor_id := new.parent_id;
    loop
      select owner_id, parent_id into cursor_owner, cursor_id
      from public.private_library_items
      where id = cursor_id and item_type = 'folder';
      if not found or cursor_owner <> new.owner_id then
        raise exception 'parent folder not found' using errcode = '22023';
      end if;
      depth := depth + 1;
      if cursor_id is null then exit; end if;
      if cursor_id = new.id then
        raise exception 'folder cycle is not allowed' using errcode = '22023';
      end if;
    end loop;
    select value_int::int into depth_limit from public.system_settings
      where key = 'private_folder_depth_limit';
    if depth > coalesce(depth_limit, 8) then
      raise exception 'private folder depth limit reached' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text, 41));
    select value_int into item_limit from public.system_settings
      where key = case when new.item_type = 'game' then 'private_board_limit'
        else 'private_folder_limit' end;
    select count(*) into item_count from public.private_library_items
      where owner_id = new.owner_id and item_type = new.item_type;
    if new.item_type = 'game' and new.source_scope = 'private' then
      select item_count + count(*) into item_count from public.room_live
        where owner_id = new.owner_id and archive_policy = 'private'
          and room_id <> new.source_game_id;
    end if;
    if item_count >= coalesce(item_limit, case when new.item_type = 'game' then 1000 else 200 end) then
      raise exception 'private library quota reached' using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists validate_private_library_item on public.private_library_items;
create trigger validate_private_library_item
  before insert or update on public.private_library_items
  for each row execute function public.validate_private_library_item();

create or replace function public.cleanup_expired_live_games()
returns bigint language plpgsql security definer set search_path = public as $$
declare
  removed bigint;
begin
  with removed_rows as (
    delete from public.room_live
    where expires_at is not null and expires_at <= now()
    returning 1
  ) select count(*) into removed from removed_rows;
  return removed;
end; $$;
revoke all on function public.cleanup_expired_live_games() from public;

create or replace function public.cleanup_private_library_trash()
returns bigint language plpgsql security definer set search_path = public as $$
declare
  removed bigint;
begin
  with removed_rows as (
    delete from public.private_library_items
    where trashed_at is not null and trashed_at <= now() - interval '30 days'
    returning 1
  ) select count(*) into removed from removed_rows;
  return removed;
end; $$;
revoke all on function public.cleanup_private_library_trash() from public;

-- 7) RLS --------------------------------------------------------------------
alter table public.public_game_snapshots enable row level security;
alter table public.region_game_snapshots enable row level security;
alter table public.private_library_items enable row level security;
alter table public.room_live enable row level security;

drop policy if exists public_snapshots_read on public.public_game_snapshots;
create policy public_snapshots_read on public.public_game_snapshots for select
  using (public.is_approved() or public.is_admin());

drop policy if exists region_snapshots_read on public.region_game_snapshots;
create policy region_snapshots_read on public.region_game_snapshots for select
  using (public.is_admin() or (public.is_approved() and region_id = public.my_region_id()));

drop policy if exists private_library_read_own on public.private_library_items;
create policy private_library_read_own on public.private_library_items for select
  using (owner_id = auth.uid());
drop policy if exists private_library_insert_own on public.private_library_items;
create policy private_library_insert_own on public.private_library_items for insert
  with check (owner_id = auth.uid());
drop policy if exists private_library_update_own on public.private_library_items;
create policy private_library_update_own on public.private_library_items for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists private_library_delete_own on public.private_library_items;
create policy private_library_delete_own on public.private_library_items for delete
  using (owner_id = auth.uid());

drop policy if exists room_live_read on public.room_live;
create policy room_live_read on public.room_live for select
  using (public.can_read_live_game(room_id));
drop policy if exists room_live_insert on public.room_live;
create policy room_live_insert on public.room_live for insert
  with check (owner_id = auth.uid() and (public.is_approved() or public.is_admin()));
drop policy if exists room_live_update on public.room_live;
create policy room_live_update on public.room_live for update
  using (public.can_write_live_game(room_id)) with check (public.can_write_live_game(room_id));
drop policy if exists room_live_delete on public.room_live;
create policy room_live_delete on public.room_live for delete
  using (owner_id = auth.uid() or public.is_admin());

revoke all on table public.public_game_snapshots from anon, authenticated;
revoke all on table public.region_game_snapshots from anon, authenticated;
grant select (
  game_id, name, player_a, player_b, game_mode, mode_key, turn_number,
  score_a, score_b, completion_kind, completion_reason, surrendered_side,
  snapshot, created_at, finished_at, archived_at
) on table public.public_game_snapshots to authenticated;
grant select (
  game_id, region_id, name, player_a, player_b, game_mode, mode_key,
  turn_number, score_a, score_b, completion_kind, completion_reason,
  surrendered_side, snapshot, created_at, finished_at, archived_at
) on table public.region_game_snapshots to authenticated;
revoke all on table public.private_library_items from anon, authenticated;
grant select, delete on table public.private_library_items to authenticated;
grant insert (owner_id, item_type, parent_id, name)
  on table public.private_library_items to authenticated;
grant update (name, parent_id, trashed_at)
  on table public.private_library_items to authenticated;
revoke all on table public.room_live from anon, authenticated;
grant select (
  room_id, owner_id, name, player_a, player_b, status,
  access_scope, archive_policy, region_id, join_policy,
  game_mode, mode_key, member_a_id, member_b_id,
  player_a_user_id, player_b_user_id, starting_side, creator_side,
  turn_number, score_a, score_b, state, session, created_at, updated_at
) on table public.room_live to authenticated;

-- Readiness now mutates room_live directly.
drop function if exists public.set_room_ready(uuid, text, boolean);
create function public.set_room_ready(
  target_room_id uuid,
  target_side text,
  target_ready boolean
)
returns void language plpgsql security definer set search_path = public as $$
declare
  live public.room_live%rowtype;
  target_user_id uuid;
  ready_state jsonb;
begin
  if target_side not in ('A', 'B') then
    raise exception 'invalid player side' using errcode = '22023';
  end if;
  select * into live from public.room_live where room_id = target_room_id for update;
  if not found or live.status <> 'waiting' or not public.can_read_live_game(target_room_id) then
    raise exception 'waiting room not found' using errcode = 'P0002';
  end if;
  target_user_id := case when target_side = 'A' then live.player_a_user_id else live.player_b_user_id end;
  if target_user_id is distinct from auth.uid() then
    raise exception 'not assigned to this player side' using errcode = '42501';
  end if;
  ready_state := coalesce(live.state -> 'lobbyReadyBySide', '{}'::jsonb);
  ready_state := jsonb_set(ready_state, array[target_side], to_jsonb(target_ready), true);
  update public.room_live
  set state = jsonb_set(state, '{lobbyReadyBySide}', ready_state, true),
      state_version = state_version + 1,
      last_activity_at = now(), updated_at = now(), expires_at = now() + interval '24 hours'
  where room_id = target_room_id;
end; $$;
revoke all on function public.set_room_ready(uuid, text, boolean) from public;
grant execute on function public.set_room_ready(uuid, text, boolean) to authenticated;

-- Remove the legacy parent only after all data is copied and no replacement
-- function depends on it. Old migration files remain historical documentation.
do $$
begin
  if to_regclass('public.rooms') is not null then
    execute 'drop table public.rooms cascade';
  end if;
end; $$;

do $$
begin
  alter publication supabase_realtime add table public.room_live;
exception when duplicate_object then null;
end; $$;

do $$
begin
  if to_regclass('public.rooms') is not null
    or to_regclass('public.room_live') is null
    or to_regclass('public.public_game_snapshots') is null
    or to_regclass('public.region_game_snapshots') is null
    or to_regclass('public.private_library_items') is null
  then
    raise exception 'game archive migration verification failed';
  end if;
end; $$;

notify pgrst, 'reload schema';

commit;
