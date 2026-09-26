-- Production baseline, 2026-09-26.
--
-- `supabase db dump --linked` of project ilhtcsnndlcsyfdznoow (schema only, no
-- data), taken after 20260924170000, 20260924170100, 20260924180000 and
-- 20260925120000 had been applied there. It replaces the unordered supabase/*.sql
-- files as the way to create a database: those files are kept as history but are
-- no longer a build input.
--
-- The four later migrations are idempotent and re-apply over this baseline as
-- no-ops. Verified: an empty local Supabase database migrated from this
-- directory dumps byte-identical (comments and blank lines aside) to production,
-- privileges included.
--
-- After this runs, a database still needs its private runtime secret
-- (private.runtime_secrets.room_code_secret, >= 32 chars); see
-- supabase/room_code_secret_setup.example.sql and docs/production.md.




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."attach_game_timeline_to_archive"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."attach_game_timeline_to_archive"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bot_folder_open_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select id from public.bot_stat_folders where is_open limit 1
$$;


ALTER FUNCTION "public"."bot_folder_open_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."broadcast_live_game_commit"("target_game_id" "uuid", "target_revision" bigint, "target_command_id" "text", "target_issued_by" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."broadcast_live_game_commit"("target_game_id" "uuid", "target_revision" bigint, "target_command_id" "text", "target_issued_by" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_read_live_game"("target_game_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."can_read_live_game"("target_game_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_read_room"("room_visibility" "text", "room_region_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    room_visibility = 'public'
    or (
      room_visibility = 'region'
      and auth.uid() is not null
      and exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.region_id = room_region_id
          and (p.status = 'approved' or p.is_admin)
      )
    ),
    false
  )
$$;


ALTER FUNCTION "public"."can_read_room"("room_visibility" "text", "room_region_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_read_room_live"("p_room_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room_id
      and public.can_read_room(r.visibility, r.region_id)
  )
$$;


ALTER FUNCTION "public"."can_read_room_live"("p_room_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_write_live_game"("target_game_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.room_live l
    where l.room_id = target_game_id
      and public.can_read_live_game(l.room_id)
      and auth.uid() in (l.owner_id, l.player_a_user_id, l.player_b_user_id)
  ) or public.is_admin()
$$;


ALTER FUNCTION "public"."can_write_live_game"("target_game_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_write_room_live"("p_room_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room_id
      and public.can_read_room(r.visibility, r.region_id)
      and (
        (
          r.owner_id = auth.uid()
          and coalesce(r.state ->> 'emailPlayMode', 'hosted') <> 'direct'
        )
        or public.is_admin()
        or public.is_room_player(
          r.invite_user_a_id, r.invite_user_b_id,
          r.invite_email_a, r.invite_email_b
        )
      )
  )
$$;


ALTER FUNCTION "public"."can_write_room_live"("p_room_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_live_game"("target_game_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  delete from public.room_live
  where room_id = target_game_id
    and (owner_id = auth.uid() or public.is_admin());
  if not found then
    raise exception 'live game cancel access required' using errcode = '42501';
  end if;
end; $$;


ALTER FUNCTION "public"."cancel_live_game"("target_game_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_expired_live_games"() RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."cleanup_expired_live_games"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_private_library_trash"() RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."cleanup_private_library_trash"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."close_bot_folder"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  update public.bot_stat_folders
     set is_open = false, closed_at = now()
   where id = p_id and is_open;
end;
$$;


ALTER FUNCTION "public"."close_bot_folder"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."commit_live_game_command"("target_game_id" "uuid", "target_expected_revision" bigint, "target_command_id" "text", "target_issued_by" "text", "target_command" "jsonb", "target_canonical" "jsonb", "target_canonical_digest" "text", "target_state" "jsonb" DEFAULT NULL::"jsonb", "target_session" "jsonb" DEFAULT NULL::"jsonb") RETURNS TABLE("outcome" "text", "revision" bigint, "canonical" "jsonb", "canonical_digest" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."commit_live_game_command"("target_game_id" "uuid", "target_expected_revision" bigint, "target_command_id" "text", "target_issued_by" "text", "target_command" "jsonb", "target_canonical" "jsonb", "target_canonical_digest" "text", "target_state" "jsonb", "target_session" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."commit_live_game_timeline"("target_game_id" "uuid", "target_expected_revision" bigint, "target_command_id" "text", "target_issued_by" "text", "target_command" "jsonb", "target_canonical" "jsonb", "target_canonical_digest" "text", "target_state" "jsonb", "target_session" "jsonb", "target_timeline" "jsonb", "target_timeline_expected_version" bigint) RETURNS TABLE("outcome" "text", "revision" bigint, "timeline_version" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."commit_live_game_timeline"("target_game_id" "uuid", "target_expected_revision" bigint, "target_command_id" "text", "target_issued_by" "text", "target_command" "jsonb", "target_canonical" "jsonb", "target_canonical_digest" "text", "target_state" "jsonb", "target_session" "jsonb", "target_timeline" "jsonb", "target_timeline_expected_version" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."controls_live_game_side"("target_game_id" "uuid", "target_side" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.room_live l
    where l.room_id = target_game_id
      and public.can_write_live_game(l.room_id)
      and target_side in ('A', 'B')
      and case
        -- A direct room has no gameplay host: each account plays its own side,
        -- and neither ownership nor admin reaches across the table.
        when coalesce(l.state ->> 'emailPlayMode', '') = 'direct' then
          auth.uid() = case target_side
            when 'A' then l.player_a_user_id
            else l.player_b_user_id
          end
        -- A hosted room with assigned seats: the seated account acts, and the
        -- owner still hosts whichever seat is unassigned (pass-and-play).
        when l.player_a_user_id is not null or l.player_b_user_id is not null then
          auth.uid() = coalesce(
            case target_side when 'A' then l.player_a_user_id else l.player_b_user_id end,
            l.owner_id
          )
          or public.is_admin()
        -- Local / pass-and-play: one device, the owner drives both sides.
        else auth.uid() = l.owner_id or public.is_admin()
      end
  )
$$;


ALTER FUNCTION "public"."controls_live_game_side"("target_game_id" "uuid", "target_side" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."copy_private_game_item"("source_item_id" "uuid", "target_parent_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."copy_private_game_item"("source_item_id" "uuid", "target_parent_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."bot_stat_folders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_by" "uuid",
    "is_open" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "opened_at" timestamp with time zone,
    "closed_at" timestamp with time zone
);


ALTER TABLE "public"."bot_stat_folders" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_bot_folder"("p_name" "text", "p_open" boolean DEFAULT true) RETURNS "public"."bot_stat_folders"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  row public.bot_stat_folders;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_open then
    update public.bot_stat_folders
       set is_open = false, closed_at = now()
     where is_open;
  end if;
  insert into public.bot_stat_folders (name, created_by, is_open, opened_at)
  values (coalesce(nullif(trim(p_name), ''), 'Untitled folder'), auth.uid(),
          p_open, case when p_open then now() else null end)
  returning * into row;
  return row;
end;
$$;


ALTER FUNCTION "public"."create_bot_folder"("p_name" "text", "p_open" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_live_game"("target_state" "jsonb", "target_access_scope" "text", "target_archive_policy" "text", "target_region_id" "uuid" DEFAULT NULL::"uuid", "target_join_policy" "text" DEFAULT 'invite_only'::"text", "target_private_parent_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("room_id" "uuid", "room_code" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."create_live_game"("target_state" "jsonb", "target_access_scope" "text", "target_archive_policy" "text", "target_region_id" "uuid", "target_join_policy" "text", "target_private_parent_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."derive_live_bot_config"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.bot_side is null then
    new.bot_side := case
      when new.state ->> 'botSide' in ('A', 'B') then new.state ->> 'botSide'
      else null
    end;
  end if;
  if new.bot_side is not null and new.bot_difficulty is null then
    new.bot_difficulty := coalesce(
      nullif(new.state ->> 'botDifficulty', ''),
      'medium'
    );
    if new.bot_difficulty not in ('medium', 'hard', 'max', 'super') then
      new.bot_difficulty := 'medium';
    end if;
  end if;
  if new.bot_side is null then
    new.bot_difficulty := null;
  end if;
  return new;
end; $$;


ALTER FUNCTION "public"."derive_live_bot_config"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."derive_live_room_code"("target_game_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'extensions', 'private'
    AS $$
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


ALTER FUNCTION "public"."derive_live_room_code"("target_game_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_live_game"("target_game_id" "uuid", "target_state" "jsonb", "target_completion_kind" "text", "target_completion_reason" "text", "target_surrendered_side" "text" DEFAULT NULL::"text") RETURNS TABLE("archive_scope" "text", "archive_game_id" "uuid", "private_item_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."finalize_live_game"("target_game_id" "uuid", "target_state" "jsonb", "target_completion_kind" "text", "target_completion_reason" "text", "target_surrendered_side" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."freeze_live_bot_config"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.bot_side is distinct from old.bot_side
     or new.bot_difficulty is distinct from old.bot_difficulty then
    raise exception 'bot configuration is fixed for the life of a game'
      using errcode = '42501';
  end if;
  return new;
end; $$;


ALTER FUNCTION "public"."freeze_live_bot_config"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_game_mode_tools"("target_mode_key" "text") RETURNS TABLE("tool_key" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select t.tool_key
  from public.game_modes m
  join public.game_mode_tools mt on mt.mode_id = m.id
  join public.game_tools t on t.id = mt.tool_id
  where m.mode_key = target_mode_key
  order by t.tool_key
$$;


ALTER FUNCTION "public"."get_game_mode_tools"("target_mode_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_live_game_code"("target_game_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when exists (
    select 1 from public.room_live l
    where l.room_id = target_game_id
      and (public.is_admin() or auth.uid() in (l.owner_id, l.player_a_user_id, l.player_b_user_id))
  ) then public.derive_live_room_code(target_game_id) else null end
$$;


ALTER FUNCTION "public"."get_live_game_code"("target_game_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_live_game_engine_context"("target_game_id" "uuid") RETURNS TABLE("revision" bigint, "status" "text", "game_mode" "text", "mode_key" "text", "bot_side" "text", "bot_difficulty" "text", "active_side" "text", "turn_number" integer, "phase" "text", "canonical" "jsonb", "canonical_digest" "text", "caller_controls_active_side" boolean, "active_side_is_bot" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    l.revision,
    l.status,
    l.game_mode,
    l.mode_key,
    l.bot_side,
    l.bot_difficulty,
    l.canonical ->> 'activeSide' as active_side,
    (l.canonical ->> 'turnNumber')::int as turn_number,
    l.canonical ->> 'phase' as phase,
    l.canonical,
    l.canonical_digest,
    public.controls_live_game_side(l.room_id, l.canonical ->> 'activeSide')
      as caller_controls_active_side,
    (l.bot_side is not null and l.bot_side = l.canonical ->> 'activeSide')
      as active_side_is_bot
  from public.room_live l
  where l.room_id = target_game_id
    and public.can_read_live_game(target_game_id)
$$;


ALTER FUNCTION "public"."get_live_game_engine_context"("target_game_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_live_game_snapshot"("target_game_id" "uuid") RETURNS TABLE("revision" bigint, "canonical" "jsonb", "canonical_digest" "text", "status" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select l.revision, l.canonical, l.canonical_digest, l.status
  from public.room_live l
  where l.room_id = target_game_id
    and public.can_read_live_game(target_game_id)
$$;


ALTER FUNCTION "public"."get_live_game_snapshot"("target_game_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_profile"() RETURNS TABLE("id" "uuid", "email" "text", "display_name" "text", "status" "text", "is_admin" boolean, "region_id" "uuid", "region_name" "text", "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.id, p.email, p.display_name, p.status, p.is_admin,
         p.region_id, r.name, p.created_at
  from public.profiles p
  left join public.regions r on r.id = p.region_id
  where p.id = auth.uid()
$$;


ALTER FUNCTION "public"."get_my_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_archive_move_context"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."get_public_archive_move_context"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_game_timeline_tool"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.room_live l
    join public.game_modes m on m.mode_key = l.mode_key
    join public.game_mode_tools mt on mt.mode_id = m.id
    join public.game_tools t on t.id = mt.tool_id and t.tool_key = 'multiverse'
    where l.room_id = new.game_id
  ) then
    raise exception 'alternate lines are unavailable in this mode' using errcode = '42501';
  end if;
  return new;
end; $$;


ALTER FUNCTION "public"."guard_game_timeline_tool"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin
  )
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_approved"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved'
  )
$$;


ALTER FUNCTION "public"."is_approved"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_room_invitee"("email_a" "text", "email_b" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    public.my_email_lower() is not null
      and public.my_email_lower() in (lower(btrim(email_a)), lower(btrim(email_b))),
    false
  )
$$;


ALTER FUNCTION "public"."is_room_invitee"("email_a" "text", "email_b" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_room_invitee_for_active_side"("room_state" "jsonb", "email_a" "text", "email_b" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    case room_state ->> 'activeSide'
      when 'A' then lower(btrim(email_a)) = public.my_email_lower()
      when 'B' then lower(btrim(email_b)) = public.my_email_lower()
      else false
    end,
    false
  )
$$;


ALTER FUNCTION "public"."is_room_invitee_for_active_side"("room_state" "jsonb", "email_a" "text", "email_b" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_room_player"("user_a" "uuid", "user_b" "uuid", "email_a" "text", "email_b" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    case
      when user_a is not null or user_b is not null
        then auth.uid() in (user_a, user_b)
      else public.is_room_invitee(email_a, email_b)
    end,
    false
  )
$$;


ALTER FUNCTION "public"."is_room_player"("user_a" "uuid", "user_b" "uuid", "email_a" "text", "email_b" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_room_player_for_active_side"("room_state" "jsonb", "user_a" "uuid", "user_b" "uuid", "email_a" "text", "email_b" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    case room_state ->> 'activeSide'
      when 'A' then case
        when user_a is not null then user_a = auth.uid()
        else lower(btrim(email_a)) = public.my_email_lower()
      end
      when 'B' then case
        when user_b is not null then user_b = auth.uid()
        else lower(btrim(email_b)) = public.my_email_lower()
      end
      else false
    end,
    false
  )
$$;


ALTER FUNCTION "public"."is_room_player_for_active_side"("room_state" "jsonb", "user_a" "uuid", "user_b" "uuid", "email_a" "text", "email_b" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_live_game"("target_room_code" "text" DEFAULT NULL::"text", "target_game_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("room_id" "uuid", "claimed_side" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."join_live_game"("target_room_code" "text", "target_game_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_live_game_events"("target_game_id" "uuid", "target_since_revision" bigint DEFAULT 0, "target_limit" integer DEFAULT 200) RETURNS TABLE("revision" bigint, "command_id" "text", "issued_by" "text", "command" "jsonb", "committed_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select e.revision, e.command_id, e.issued_by, e.command, e.committed_at
  from public.live_game_events e
  where e.game_id = target_game_id
    and e.revision > coalesce(target_since_revision, 0)
    and public.can_read_live_game(target_game_id)
  order by e.revision
  limit least(greatest(coalesce(target_limit, 200), 1), 500)
$$;


ALTER FUNCTION "public"."list_live_game_events"("target_game_id" "uuid", "target_since_revision" bigint, "target_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_live_games"("target_access_scope" "text", "target_region_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("room_id" "uuid", "name" "text", "player_a" "text", "player_b" "text", "status" "text", "access_scope" "text", "archive_policy" "text", "join_policy" "text", "region_id" "uuid", "game_mode" "text", "mode_key" "text", "starting_side" "text", "turn_number" integer, "score_a" integer, "score_b" integer, "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "owner_name" "text", "viewer_role" "text", "can_manage" boolean, "has_opponent" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
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
    l.room_id, l.name, l.player_a, l.player_b, l.status,
    l.access_scope, l.archive_policy, l.join_policy, l.region_id,
    l.game_mode, l.mode_key, l.starting_side, l.turn_number,
    l.score_a, l.score_b, l.created_at, l.updated_at, p.display_name,
    case
      when l.owner_id = auth.uid() then 'Owner'
      when public.is_admin() then 'Admin'
      when l.player_a_user_id = auth.uid() then 'Player A'
      when l.player_b_user_id = auth.uid() then 'Player B'
      else 'Spectator'
    end::text,
    (l.owner_id = auth.uid() or public.is_admin()),
    case
      when l.game_mode = 'solo' or left(l.mode_key, 7) = 'aether_'
        or left(l.mode_key, 7) = 'authur_' then true
      when l.creator_side = 'A' then l.player_b_user_id is not null
      when l.creator_side = 'B' then l.player_a_user_id is not null
      else l.player_a_user_id is not null and l.player_b_user_id is not null
    end
  from public.room_live l
  left join public.profiles p on p.id = l.owner_id
  where public.can_read_live_game(l.room_id)
    and (
      (target_access_scope = 'public' and l.access_scope = 'public')
      or (target_access_scope = 'region' and l.access_scope = 'region'
        and l.region_id = target_region_id)
      or (target_access_scope = 'private' and l.access_scope = 'private'
        and auth.uid() in (l.owner_id, l.player_a_user_id, l.player_b_user_id))
    )
  order by l.updated_at desc;
end; $$;


ALTER FUNCTION "public"."list_live_games"("target_access_scope" "text", "target_region_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_profiles_admin"() RETURNS TABLE("id" "uuid", "email" "text", "display_name" "text", "status" "text", "is_admin" boolean, "region_id" "uuid", "region_name" "text", "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.id, p.email, p.display_name, p.status, p.is_admin,
         p.region_id, r.name, p.created_at
  from public.profiles p
  left join public.regions r on r.id = p.region_id
  where public.is_admin()
  order by p.created_at, p.id
$$;


ALTER FUNCTION "public"."list_profiles_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_regions_admin"() RETURNS TABLE("id" "uuid", "name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select r.id, r.name
  from public.regions r
  where public.is_admin()
  order by lower(r.name), r.id
$$;


ALTER FUNCTION "public"."list_regions_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_registered_players"("target_visibility" "text" DEFAULT 'public'::"text") RETURNS TABLE("id" "uuid", "username" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.id, p.display_name
  from public.profiles p
  where auth.uid() is not null
    and target_visibility in ('public', 'region')
    and p.display_name is not null
    and btrim(p.display_name) <> ''
    and (p.status = 'approved' or p.is_admin)
    and (
      target_visibility = 'public'
      or (public.my_region_id() is not null and p.region_id = public.my_region_id())
    )
  order by lower(p.display_name), p.id
$$;


ALTER FUNCTION "public"."list_registered_players"("target_visibility" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mode_key_from_state"("target_state" "jsonb") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case
    when target_state ->> 'botSide' is not null
      and target_state ->> 'botEngine' = 'authur' then 'authur_strong'
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


ALTER FUNCTION "public"."mode_key_from_state"("target_state" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."move_private_library_items"("target_item_ids" "uuid"[], "target_parent_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."move_private_library_items"("target_item_ids" "uuid"[], "target_parent_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."move_public_snapshot_to_region"("target_game_id" "uuid", "target_region_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."move_public_snapshot_to_region"("target_game_id" "uuid", "target_region_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."move_public_snapshots_to_region"("target_game_ids" "uuid"[], "target_region_id" "uuid") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."move_public_snapshots_to_region"("target_game_ids" "uuid"[], "target_region_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_email_lower"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select lower(btrim(email)) from public.profiles where id = auth.uid()
$$;


ALTER FUNCTION "public"."my_email_lower"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_region_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.region_id from public.profiles p where p.id = auth.uid()
$$;


ALTER FUNCTION "public"."my_region_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."open_bot_folder"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  update public.bot_stat_folders
     set is_open = false, closed_at = now()
   where is_open and id <> p_id;
  update public.bot_stat_folders
     set is_open = true, opened_at = now(), closed_at = null
   where id = p_id;
end;
$$;


ALTER FUNCTION "public"."open_bot_folder"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_live_game_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."prepare_live_game_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_invited_room_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- A direct room has no host. Its creator remains owner_id for persistence,
  -- but must obey the same active-side restrictions as the other player.
  if public.is_admin()
    or (
      old.owner_id = auth.uid()
      and coalesce(old.state ->> 'emailPlayMode', 'hosted') <> 'direct'
    )
  then
    return new;
  end if;

  if old.state ->> 'roomStage' = 'waiting' then
    if not public.is_room_player(
      old.invite_user_a_id, old.invite_user_b_id,
      old.invite_email_a, old.invite_email_b
    ) then
      raise exception 'not assigned to this waiting room' using errcode = '42501';
    end if;
    if new.owner_id is distinct from old.owner_id
      or new.name is distinct from old.name
      or new.player_a is distinct from old.player_a
      or new.player_b is distinct from old.player_b
      or new.invite_user_a_id is distinct from old.invite_user_a_id
      or new.invite_user_b_id is distinct from old.invite_user_b_id
      or new.invite_email_a is distinct from old.invite_email_a
      or new.invite_email_b is distinct from old.invite_email_b
      or (new.state - 'lobbyReadyBySide') is distinct from (old.state - 'lobbyReadyBySide')
    then
      raise exception 'players can only update their waiting-room ready state'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status <> 'playing'
    or coalesce(old.state ->> 'status', '') <> 'playing'
    or (
      coalesce(old.state ->> 'emailPlayMode', 'hosted') = 'hosted'
      and old.state ->> 'tileDrawMode' = 'manual'
      and old.state ->> 'phase' = 'refill'
    )
    or not public.is_room_player_for_active_side(
      old.state,
      old.invite_user_a_id, old.invite_user_b_id,
      old.invite_email_a, old.invite_email_b
    )
  then
    raise exception 'not assigned to the active side' using errcode = '42501';
  end if;

  if new.owner_id is distinct from old.owner_id
    or new.name is distinct from old.name
    or new.player_a is distinct from old.player_a
    or new.player_b is distinct from old.player_b
    or new.invite_user_a_id is distinct from old.invite_user_a_id
    or new.invite_user_b_id is distinct from old.invite_user_b_id
    or new.invite_email_a is distinct from old.invite_email_a
    or new.invite_email_b is distinct from old.invite_email_b
    or new.state -> 'gameId' is distinct from old.state -> 'gameId'
    or new.state -> 'name' is distinct from old.state -> 'name'
    or new.state -> 'players' is distinct from old.state -> 'players'
    or new.state -> 'playerMembers' is distinct from old.state -> 'playerMembers'
    or new.state -> 'playerUserIds' is distinct from old.state -> 'playerUserIds'
    or new.state -> 'playerEmails' is distinct from old.state -> 'playerEmails'
    or new.state -> 'emailPlayMode' is distinct from old.state -> 'emailPlayMode'
    or new.state -> 'emailPlayersCanSeeOpponentRack'
      is distinct from old.state -> 'emailPlayersCanSeeOpponentRack'
    or new.state -> 'gameMode' is distinct from old.state -> 'gameMode'
    or new.state -> 'tileDrawMode' is distinct from old.state -> 'tileDrawMode'
    or new.state -> 'startingSide' is distinct from old.state -> 'startingSide'
  then
    raise exception 'players cannot change room ownership or configuration'
      using errcode = '42501';
  end if;

  return new;
end $$;


ALTER FUNCTION "public"."protect_invited_room_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_room_scope_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.visibility is distinct from old.visibility
    or new.region_id is distinct from old.region_id
  then
    raise exception 'room visibility cannot be changed after creation'
      using errcode = '42501';
  end if;
  return new;
end; $$;


ALTER FUNCTION "public"."protect_room_scope_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prune_public_game_snapshots"() RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."prune_public_game_snapshots"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prune_region_game_snapshots"("target_region_id" "uuid" DEFAULT NULL::"uuid") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."prune_region_game_snapshots"("target_region_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ranked_claim_match"("target_match_id" "uuid", "target_player_id" "uuid", "target_player_name" "text", "target_now" timestamp with time zone) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."ranked_claim_match"("target_match_id" "uuid", "target_player_id" "uuid", "target_player_name" "text", "target_now" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ranked_commit_match"("target_match_id" "uuid", "target_revision" bigint, "target_state" "jsonb", "target_winner" "text" DEFAULT NULL::"text", "target_reason" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."ranked_commit_match"("target_match_id" "uuid", "target_revision" bigint, "target_state" "jsonb", "target_winner" "text", "target_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ranked_ready_match"("target_match_id" "uuid", "target_player_id" "uuid", "target_now" timestamp with time zone) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."ranked_ready_match"("target_match_id" "uuid", "target_player_id" "uuid", "target_now" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_bot_game"("p_game_id" "text", "p_room_id" "uuid", "p_player_name" "text", "p_player_member_id" "text", "p_bot_side" "text", "p_bot_difficulty" "text", "p_bot_score" integer, "p_opp_score" integer, "p_outcome" "text", "p_turns" integer, "p_finished_at" timestamp with time zone) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  target uuid;
begin
  if not public.is_approved() then
    raise exception 'not approved';
  end if;
  select id into target from public.bot_stat_folders where is_open limit 1;
  if target is null then
    return null;
  end if;
  insert into public.bot_stat_games (
    folder_id, game_id, room_id, player_name, player_member_id,
    bot_side, bot_difficulty, bot_score, opp_score, outcome, turns,
    recorded_by, finished_at
  ) values (
    target, p_game_id, p_room_id,
    coalesce(nullif(trim(p_player_name), ''), 'Player'), p_player_member_id,
    p_bot_side, p_bot_difficulty, coalesce(p_bot_score, 0), coalesce(p_opp_score, 0),
    p_outcome, coalesce(p_turns, 0), auth.uid(), p_finished_at
  )
  on conflict (folder_id, game_id) do update
    set bot_score   = excluded.bot_score,
        opp_score   = excluded.opp_score,
        outcome     = excluded.outcome,
        turns       = excluded.turns,
        finished_at = excluded.finished_at;
  return target;
end;
$$;


ALTER FUNCTION "public"."record_bot_game"("p_game_id" "text", "p_room_id" "uuid", "p_player_name" "text", "p_player_member_id" "text", "p_bot_side" "text", "p_bot_difficulty" "text", "p_bot_score" integer, "p_opp_score" integer, "p_outcome" "text", "p_turns" integer, "p_finished_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_bot_game_v2"("p_game_id" "text", "p_room_id" "uuid", "p_player_name" "text", "p_player_member_id" "text", "p_bot_side" "text", "p_bot_engine" "text", "p_bot_difficulty" "text", "p_bot_score" integer, "p_opp_score" integer, "p_outcome" "text", "p_turns" integer, "p_finished_at" timestamp with time zone) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  target uuid;
begin
  if not public.is_approved() then
    raise exception 'not approved';
  end if;
  if p_bot_engine not in ('aether', 'authur') then
    raise exception 'invalid bot engine';
  end if;
  select id into target from public.bot_stat_folders where is_open limit 1;
  if target is null then return null; end if;
  insert into public.bot_stat_games (
    folder_id, game_id, room_id, player_name, player_member_id,
    bot_side, bot_engine, bot_difficulty, bot_score, opp_score, outcome, turns,
    recorded_by, finished_at
  ) values (
    target, p_game_id, p_room_id,
    coalesce(nullif(trim(p_player_name), ''), 'Player'), p_player_member_id,
    p_bot_side, p_bot_engine, p_bot_difficulty,
    coalesce(p_bot_score, 0), coalesce(p_opp_score, 0), p_outcome,
    coalesce(p_turns, 0), auth.uid(), p_finished_at
  )
  on conflict (folder_id, game_id) do update
    set bot_engine = excluded.bot_engine,
        bot_score = excluded.bot_score,
        opp_score = excluded.opp_score,
        outcome = excluded.outcome,
        turns = excluded.turns,
        finished_at = excluded.finished_at;
  return target;
end;
$$;


ALTER FUNCTION "public"."record_bot_game_v2"("p_game_id" "text", "p_room_id" "uuid", "p_player_name" "text", "p_player_member_id" "text", "p_bot_side" "text", "p_bot_engine" "text", "p_bot_difficulty" "text", "p_bot_score" integer, "p_opp_score" integer, "p_outcome" "text", "p_turns" integer, "p_finished_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_player_result"("target_profile_id" "uuid", "target_mode_key" "text", "target_game_mode" "text", "target_side" "text", "target_score_a" integer, "target_score_b" integer, "target_finished_at" timestamp with time zone, "target_surrendered_side" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."record_player_result"("target_profile_id" "uuid", "target_mode_key" "text", "target_game_mode" "text", "target_side" "text", "target_score_a" integer, "target_score_b" integer, "target_finished_at" timestamp with time zone, "target_surrendered_side" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_live_event_rewrite"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  raise exception 'committed game events are immutable' using errcode = '42501';
end; $$;


ALTER FUNCTION "public"."reject_live_event_rewrite"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_new_aether_room"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if left(new.mode_key, 7) = 'aether_' then
    if tg_op = 'INSERT' then
      raise exception 'Aether is retired; create an Authur room.' using errcode = '22023';
    end if;
    if old.mode_key is distinct from new.mode_key then
      raise exception 'Aether is retired; create an Authur room.' using errcode = '22023';
    end if;
  end if;
  return new;
end; $$;


ALTER FUNCTION "public"."reject_new_aether_room"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sanitize_game_snapshot"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."sanitize_game_snapshot"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_archive_to_private"("target_scope" "text", "target_game_id" "uuid", "target_parent_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."save_archive_to_private"("target_scope" "text", "target_game_id" "uuid", "target_parent_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_study_analysis"("p_score_self" integer, "p_score_opponent" integer, "p_board" "jsonb", "p_rack" "jsonb", "p_opp_rack_count" integer, "p_bag_count" integer, "p_level" "text", "p_summary" "text", "p_method" "jsonb", "p_candidates" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."save_study_analysis"("p_score_self" integer, "p_score_opponent" integer, "p_board" "jsonb", "p_rack" "jsonb", "p_opp_rack_count" integer, "p_bag_count" integer, "p_level" "text", "p_summary" "text", "p_method" "jsonb", "p_candidates" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_game_storage_limits"("next_public_limit" bigint, "next_region_limit" bigint, "next_private_limit" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."set_game_storage_limits"("next_public_limit" bigint, "next_region_limit" bigint, "next_private_limit" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_room_ready"("target_room_id" "uuid", "target_side" "text", "target_ready" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."set_room_ready"("target_room_id" "uuid", "target_side" "text", "target_ready" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."snapshot_completion_reason"("payload" "jsonb") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."snapshot_completion_reason"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_live_game_state"("target_game_id" "uuid", "target_state" "jsonb", "target_session" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform target_game_id, target_state, target_session;
  raise exception
    'unconditional state writes are no longer accepted; use commit_live_game_command with an expected revision'
    using errcode = '42501';
end; $$;


ALTER FUNCTION "public"."sync_live_game_state"("target_game_id" "uuid", "target_state" "jsonb", "target_session" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_live_game_session"("target_game_id" "uuid", "target_session" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."update_live_game_session"("target_game_id" "uuid", "target_session" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_live_game_state"("target_game_id" "uuid", "target_state" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."update_live_game_state"("target_game_id" "uuid", "target_state" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_live_game_timeline"("target_game_id" "uuid", "target_timeline" "jsonb", "target_timeline_expected_version" bigint) RETURNS TABLE("outcome" "text", "timeline_version" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."update_live_game_timeline"("target_game_id" "uuid", "target_timeline" "jsonb", "target_timeline_expected_version" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_profile_admin"("target_profile_id" "uuid", "next_status" "text", "next_is_admin" boolean, "next_region_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if next_status not in ('pending', 'approved', 'blocked') then
    raise exception 'invalid profile status' using errcode = '22023';
  end if;
  if next_region_id is not null
    and not exists (select 1 from public.regions where id = next_region_id)
  then
    raise exception 'region not found' using errcode = 'P0002';
  end if;

  update public.profiles
  set status = next_status,
      is_admin = next_is_admin,
      region_id = next_region_id
  where id = target_profile_id;
end; $$;


ALTER FUNCTION "public"."update_profile_admin"("target_profile_id" "uuid", "next_status" "text", "next_is_admin" boolean, "next_region_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_game_timeline"("target_timeline" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."validate_game_timeline"("target_timeline" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_private_library_item"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."validate_private_library_item"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "private"."runtime_secrets" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "runtime_secrets_key_check" CHECK (("key" = 'room_code_secret'::"text")),
    CONSTRAINT "runtime_secrets_value_length_check" CHECK (("length"("value") >= 32))
);


ALTER TABLE "private"."runtime_secrets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bot_stat_games" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "folder_id" "uuid" NOT NULL,
    "game_id" "text" NOT NULL,
    "room_id" "uuid",
    "player_name" "text" DEFAULT 'Player'::"text" NOT NULL,
    "player_member_id" "text",
    "bot_side" "text" NOT NULL,
    "bot_difficulty" "text",
    "bot_score" integer DEFAULT 0 NOT NULL,
    "opp_score" integer DEFAULT 0 NOT NULL,
    "outcome" "text" NOT NULL,
    "turns" integer DEFAULT 0 NOT NULL,
    "recorded_by" "uuid",
    "finished_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "bot_engine" "text" DEFAULT 'aether'::"text" NOT NULL,
    CONSTRAINT "bot_stat_games_bot_engine_check" CHECK (("bot_engine" = ANY (ARRAY['aether'::"text", 'authur'::"text"]))),
    CONSTRAINT "bot_stat_games_bot_side_check" CHECK (("bot_side" = ANY (ARRAY['A'::"text", 'B'::"text"]))),
    CONSTRAINT "bot_stat_games_outcome_check" CHECK (("outcome" = ANY (ARRAY['bot_win'::"text", 'bot_loss'::"text", 'draw'::"text"])))
);


ALTER TABLE "public"."bot_stat_games" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."game_mode_tools" (
    "mode_id" "uuid" NOT NULL,
    "tool_id" "uuid" NOT NULL
);


ALTER TABLE "public"."game_mode_tools" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."game_modes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mode_key" "text" NOT NULL,
    "label" "text" NOT NULL,
    CONSTRAINT "game_modes_label_check" CHECK (("btrim"("label") <> ''::"text")),
    CONSTRAINT "game_modes_mode_key_check" CHECK (("mode_key" ~ '^[a-z][a-z0-9_]*$'::"text"))
);


ALTER TABLE "public"."game_modes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."game_timelines" (
    "game_id" "uuid" NOT NULL,
    "version" bigint NOT NULL,
    "line_count" integer DEFAULT 0 NOT NULL,
    "node_count" integer DEFAULT 0 NOT NULL,
    "doc" "jsonb" NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "game_timelines_doc_shape" CHECK ((("jsonb_typeof"("doc") = 'object'::"text") AND ("jsonb_typeof"(("doc" -> 'lines'::"text")) = 'array'::"text"))),
    CONSTRAINT "game_timelines_doc_size" CHECK (("octet_length"(("doc")::"text") <= 2097152)),
    CONSTRAINT "game_timelines_line_count_check" CHECK (("line_count" >= 0)),
    CONSTRAINT "game_timelines_line_limit" CHECK (("line_count" <= 100)),
    CONSTRAINT "game_timelines_node_count_check" CHECK (("node_count" >= 0)),
    CONSTRAINT "game_timelines_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."game_timelines" OWNER TO "postgres";


COMMENT ON TABLE "public"."game_timelines" IS 'Lines of a live game that are not being played. Written on branch/switch/prune only, never per move, never published to Realtime.';



COMMENT ON COLUMN "public"."game_timelines"."version" IS 'Monotonic per game. The live state names the version it was committed with in state.timelineRef.';



CREATE TABLE IF NOT EXISTS "public"."game_tools" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tool_key" "text" NOT NULL,
    "label" "text" NOT NULL,
    CONSTRAINT "game_tools_label_check" CHECK (("btrim"("label") <> ''::"text")),
    CONSTRAINT "game_tools_tool_key_check" CHECK (("tool_key" ~ '^[a-z][a-z0-9_]*$'::"text"))
);


ALTER TABLE "public"."game_tools" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_game_events" (
    "game_id" "uuid" NOT NULL,
    "revision" bigint NOT NULL,
    "command_id" "text" NOT NULL,
    "issued_by" "text" NOT NULL,
    "actor_id" "uuid",
    "command" "jsonb" NOT NULL,
    "committed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_game_events_command_id_check" CHECK (("btrim"("command_id") <> ''::"text")),
    CONSTRAINT "live_game_events_issued_by_check" CHECK (("issued_by" = ANY (ARRAY['A'::"text", 'B'::"text", 'host'::"text"]))),
    CONSTRAINT "live_game_events_revision_check" CHECK (("revision" > 0))
);


ALTER TABLE "public"."live_game_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "institution" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "members_name_check" CHECK (("btrim"("name") <> ''::"text"))
);


ALTER TABLE "public"."members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."private_library_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "item_type" "text" NOT NULL,
    "parent_id" "uuid",
    "name" "text" NOT NULL,
    "source_scope" "text",
    "source_game_id" "uuid",
    "game_id" "uuid",
    "game_mode" "text",
    "mode_key" "text",
    "completion_kind" "text",
    "completion_reason" "text",
    "turn_number" integer,
    "score_a" integer,
    "score_b" integer,
    "snapshot" "jsonb",
    "trashed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "private_library_item_shape_check" CHECK (((("item_type" = 'folder'::"text") AND ("game_id" IS NULL) AND ("snapshot" IS NULL) AND ("game_mode" IS NULL) AND ("mode_key" IS NULL) AND ("completion_kind" IS NULL) AND ("completion_reason" IS NULL)) OR (("item_type" = 'game'::"text") AND ("game_id" IS NOT NULL) AND ("snapshot" IS NOT NULL) AND ("game_mode" IS NOT NULL) AND ("mode_key" IS NOT NULL) AND ("completion_kind" IS NOT NULL) AND ("completion_reason" IS NOT NULL)))),
    CONSTRAINT "private_library_items_completion_kind_check" CHECK ((("completion_kind" IS NULL) OR ("completion_kind" = ANY (ARRAY['natural'::"text", 'terminated'::"text"])))),
    CONSTRAINT "private_library_items_game_mode_check" CHECK ((("game_mode" IS NULL) OR ("game_mode" = ANY (ARRAY['versus'::"text", 'solo'::"text"])))),
    CONSTRAINT "private_library_items_item_type_check" CHECK (("item_type" = ANY (ARRAY['folder'::"text", 'game'::"text"]))),
    CONSTRAINT "private_library_items_name_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "private_library_items_source_scope_check" CHECK ((("source_scope" IS NULL) OR ("source_scope" = ANY (ARRAY['public'::"text", 'region'::"text", 'private'::"text"]))))
);


ALTER TABLE "public"."private_library_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "display_name" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "is_admin" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "region_id" "uuid",
    CONSTRAINT "profiles_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'blocked'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."public_game_snapshots" (
    "game_id" "uuid" NOT NULL,
    "source_owner_id" "uuid",
    "name" "text" NOT NULL,
    "player_a" "text" NOT NULL,
    "player_b" "text" DEFAULT ''::"text" NOT NULL,
    "game_mode" "text" NOT NULL,
    "mode_key" "text" NOT NULL,
    "turn_number" integer DEFAULT 1 NOT NULL,
    "score_a" integer DEFAULT 0 NOT NULL,
    "score_b" integer DEFAULT 0 NOT NULL,
    "completion_kind" "text" NOT NULL,
    "completion_reason" "text" NOT NULL,
    "surrendered_side" "text",
    "creator_side" "text",
    "player_a_user_id" "uuid",
    "player_b_user_id" "uuid",
    "snapshot" "jsonb" NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "finished_at" timestamp with time zone NOT NULL,
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "public_game_snapshots_completion_kind_check" CHECK (("completion_kind" = ANY (ARRAY['natural'::"text", 'terminated'::"text"]))),
    CONSTRAINT "public_game_snapshots_creator_side_check" CHECK ((("creator_side" IS NULL) OR ("creator_side" = ANY (ARRAY['A'::"text", 'B'::"text"])))),
    CONSTRAINT "public_game_snapshots_game_mode_check" CHECK (("game_mode" = ANY (ARRAY['versus'::"text", 'solo'::"text"]))),
    CONSTRAINT "public_game_snapshots_name_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "public_game_snapshots_surrendered_side_check" CHECK ((("surrendered_side" IS NULL) OR ("surrendered_side" = ANY (ARRAY['A'::"text", 'B'::"text"]))))
);


ALTER TABLE "public"."public_game_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ranked_matches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "player_a_id" "uuid" NOT NULL,
    "player_b_id" "uuid",
    "status" "text" NOT NULL,
    "revision" bigint DEFAULT 0 NOT NULL,
    "minutes_a" integer NOT NULL,
    "minutes_b" integer NOT NULL,
    "state" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ranked_distinct_players" CHECK (("player_a_id" IS DISTINCT FROM "player_b_id")),
    CONSTRAINT "ranked_equal_clocks" CHECK (("minutes_a" = "minutes_b")),
    CONSTRAINT "ranked_matches_minutes_a_check" CHECK (("minutes_a" = ANY (ARRAY[10, 15, 20, 30]))),
    CONSTRAINT "ranked_matches_minutes_b_check" CHECK (("minutes_b" = ANY (ARRAY[10, 15, 20, 30]))),
    CONSTRAINT "ranked_matches_revision_check" CHECK (("revision" >= 0)),
    CONSTRAINT "ranked_matches_status_check" CHECK (("status" = ANY (ARRAY['waiting'::"text", 'matched'::"text", 'playing'::"text", 'finished'::"text"]))),
    CONSTRAINT "ranked_seats_match_status" CHECK ((("status" = 'waiting'::"text") = ("player_b_id" IS NULL)))
);


ALTER TABLE "public"."ranked_matches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ranked_ratings" (
    "player_id" "uuid" NOT NULL,
    "rating" integer DEFAULT 1000 NOT NULL,
    "games" integer DEFAULT 0 NOT NULL,
    "wins" integer DEFAULT 0 NOT NULL,
    "losses" integer DEFAULT 0 NOT NULL,
    "draws" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ranked_ratings_games_check" CHECK (("games" >= 0)),
    CONSTRAINT "ranked_ratings_rating_check" CHECK (("rating" >= 100))
);


ALTER TABLE "public"."ranked_ratings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ranked_results" (
    "match_id" "uuid" NOT NULL,
    "player_a_id" "uuid" NOT NULL,
    "player_b_id" "uuid" NOT NULL,
    "winner_id" "uuid",
    "reason" "text" NOT NULL,
    "score_a" integer NOT NULL,
    "score_b" integer NOT NULL,
    "rating_a_before" integer NOT NULL,
    "rating_b_before" integer NOT NULL,
    "rating_a_after" integer NOT NULL,
    "rating_b_after" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ranked_results_reason_check" CHECK (("reason" = ANY (ARRAY['score'::"text", 'resign'::"text", 'timeout'::"text"])))
);


ALTER TABLE "public"."ranked_results" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."region_game_snapshots" (
    "game_id" "uuid" NOT NULL,
    "region_id" "uuid" NOT NULL,
    "source_owner_id" "uuid",
    "name" "text" NOT NULL,
    "player_a" "text" NOT NULL,
    "player_b" "text" DEFAULT ''::"text" NOT NULL,
    "game_mode" "text" NOT NULL,
    "mode_key" "text" NOT NULL,
    "turn_number" integer DEFAULT 1 NOT NULL,
    "score_a" integer DEFAULT 0 NOT NULL,
    "score_b" integer DEFAULT 0 NOT NULL,
    "completion_kind" "text" NOT NULL,
    "completion_reason" "text" NOT NULL,
    "surrendered_side" "text",
    "creator_side" "text",
    "player_a_user_id" "uuid",
    "player_b_user_id" "uuid",
    "snapshot" "jsonb" NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "finished_at" timestamp with time zone NOT NULL,
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "region_game_snapshots_completion_kind_check" CHECK (("completion_kind" = ANY (ARRAY['natural'::"text", 'terminated'::"text"]))),
    CONSTRAINT "region_game_snapshots_creator_side_check" CHECK ((("creator_side" IS NULL) OR ("creator_side" = ANY (ARRAY['A'::"text", 'B'::"text"])))),
    CONSTRAINT "region_game_snapshots_game_mode_check" CHECK (("game_mode" = ANY (ARRAY['versus'::"text", 'solo'::"text"]))),
    CONSTRAINT "region_game_snapshots_name_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "region_game_snapshots_surrendered_side_check" CHECK ((("surrendered_side" IS NULL) OR ("surrendered_side" = ANY (ARRAY['A'::"text", 'B'::"text"]))))
);


ALTER TABLE "public"."region_game_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."regions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "regions_name_check" CHECK (("btrim"("name") <> ''::"text"))
);


ALTER TABLE "public"."regions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."room_live" (
    "room_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "session" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "owner_id" "uuid",
    "name" "text" NOT NULL,
    "player_a" "text" NOT NULL,
    "player_b" "text" NOT NULL,
    "status" "text" NOT NULL,
    "access_scope" "text" NOT NULL,
    "archive_policy" "text" NOT NULL,
    "region_id" "uuid",
    "join_policy" "text" NOT NULL,
    "room_code_hash" "text" NOT NULL,
    "game_mode" "text" NOT NULL,
    "mode_key" "text" NOT NULL,
    "member_a_id" "text",
    "member_b_id" "text",
    "player_a_user_id" "uuid",
    "player_b_user_id" "uuid",
    "starting_side" "text" NOT NULL,
    "creator_side" "text",
    "turn_number" integer NOT NULL,
    "score_a" integer NOT NULL,
    "score_b" integer NOT NULL,
    "state" "jsonb" NOT NULL,
    "state_version" bigint DEFAULT 0 NOT NULL,
    "private_parent_id" "uuid",
    "created_at" timestamp with time zone NOT NULL,
    "last_activity_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone,
    "revision" bigint DEFAULT 0 NOT NULL,
    "canonical" "jsonb",
    "canonical_digest" "text",
    "bot_side" "text",
    "bot_difficulty" "text",
    CONSTRAINT "room_live_bot_config_check" CHECK (((("bot_side" IS NULL) AND ("bot_difficulty" IS NULL)) OR (("bot_side" = ANY (ARRAY['A'::"text", 'B'::"text"])) AND ("bot_difficulty" = ANY (ARRAY['medium'::"text", 'hard'::"text", 'max'::"text", 'super'::"text", 'easy'::"text"]))))),
    CONSTRAINT "room_live_creator_side_check" CHECK ((("creator_side" IS NULL) OR ("creator_side" = ANY (ARRAY['A'::"text", 'B'::"text"])))),
    CONSTRAINT "room_live_game_mode_check" CHECK (("game_mode" = ANY (ARRAY['versus'::"text", 'solo'::"text"]))),
    CONSTRAINT "room_live_join_policy_check" CHECK (("join_policy" = ANY (ARRAY['open'::"text", 'code_only'::"text", 'invite_only'::"text"]))),
    CONSTRAINT "room_live_player_ids_different_check" CHECK ((("player_a_user_id" IS NULL) OR ("player_b_user_id" IS NULL) OR ("player_a_user_id" <> "player_b_user_id"))),
    CONSTRAINT "room_live_scope_check" CHECK (((("access_scope" = 'public'::"text") AND ("region_id" IS NULL) AND ("archive_policy" = ANY (ARRAY['public'::"text", 'none'::"text"]))) OR (("access_scope" = 'region'::"text") AND ("region_id" IS NOT NULL) AND ("archive_policy" = ANY (ARRAY['region'::"text", 'none'::"text"]))) OR (("access_scope" = 'private'::"text") AND ("region_id" IS NULL) AND ("archive_policy" = ANY (ARRAY['private'::"text", 'none'::"text"]))))),
    CONSTRAINT "room_live_starting_side_check" CHECK (("starting_side" = ANY (ARRAY['A'::"text", 'B'::"text"]))),
    CONSTRAINT "room_live_status_check" CHECK (("status" = ANY (ARRAY['waiting'::"text", 'playing'::"text", 'paused'::"text"])))
);


ALTER TABLE "public"."room_live" OWNER TO "postgres";


COMMENT ON COLUMN "public"."room_live"."revision" IS 'Authoritative position of this game. Monotonic; exactly +1 per committed command.';



COMMENT ON COLUMN "public"."room_live"."canonical" IS 'Canonical committed state AT `revision`: the closed 100-tile placement table plus turn control.';



COMMENT ON COLUMN "public"."room_live"."canonical_digest" IS 'Digest of `canonical`, so observers can prove they agree at a revision rather than assume it.';



COMMENT ON COLUMN "public"."room_live"."bot_side" IS 'Side played by the engine, or null in a human-only room. Fixed at creation; the server refuses to change it.';



COMMENT ON COLUMN "public"."room_live"."bot_difficulty" IS 'Engine strength for `bot_side`: medium | hard | max | super. Fixed at creation. `easy` is retired — still stored by rooms created before it was removed, never assigned to new ones.';



CREATE TABLE IF NOT EXISTS "public"."study_positions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "score_self" integer DEFAULT 0 NOT NULL,
    "score_opponent" integer DEFAULT 0 NOT NULL,
    "board" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "rack" "jsonb" NOT NULL,
    "opp_rack_count" integer NOT NULL,
    "bag_count" integer NOT NULL,
    "level" "text" NOT NULL,
    "summary" "text" DEFAULT ''::"text" NOT NULL,
    "method" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "candidates" "jsonb" NOT NULL,
    CONSTRAINT "study_positions_bag_count_check" CHECK (("bag_count" >= 0)),
    CONSTRAINT "study_positions_board_is_array" CHECK (("jsonb_typeof"("board") = 'array'::"text")),
    CONSTRAINT "study_positions_candidates_is_array" CHECK (("jsonb_typeof"("candidates") = 'array'::"text")),
    CONSTRAINT "study_positions_level_check" CHECK (("level" = ANY (ARRAY['medium'::"text", 'hard'::"text", 'max'::"text", 'super'::"text"]))),
    CONSTRAINT "study_positions_opp_rack_count_check" CHECK (("opp_rack_count" >= 0)),
    CONSTRAINT "study_positions_rack_is_array" CHECK (("jsonb_typeof"("rack") = 'array'::"text"))
);


ALTER TABLE "public"."study_positions" OWNER TO "postgres";


COMMENT ON TABLE "public"."study_positions" IS 'One engine analysis of a made-up position. Immutable: no update policy exists, deliberately.';



CREATE TABLE IF NOT EXISTS "public"."survival_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "level_id" "uuid" NOT NULL,
    "room_id" "uuid" NOT NULL,
    "player_id" "uuid" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "player_score" integer,
    "authur_score" integer,
    "result" "text",
    CONSTRAINT "survival_attempt_result_complete" CHECK (((("finished_at" IS NULL) AND ("player_score" IS NULL) AND ("authur_score" IS NULL) AND ("result" IS NULL)) OR (("finished_at" IS NOT NULL) AND ("player_score" IS NOT NULL) AND ("authur_score" IS NOT NULL) AND ("result" IS NOT NULL)))),
    CONSTRAINT "survival_attempts_authur_score_check" CHECK (("authur_score" >= 0)),
    CONSTRAINT "survival_attempts_player_score_check" CHECK (("player_score" >= 0)),
    CONSTRAINT "survival_attempts_result_check" CHECK (("result" = ANY (ARRAY['win'::"text", 'loss'::"text", 'tie'::"text"])))
);


ALTER TABLE "public"."survival_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."survival_levels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season_key" "text" NOT NULL,
    "level_no" integer NOT NULL,
    "seed" integer NOT NULL,
    "reference_key" "text" DEFAULT 'endgame-v1'::"text" NOT NULL,
    "sample_policy" "text" NOT NULL,
    "sample_count" integer NOT NULL,
    "win_count" integer NOT NULL,
    "immediate_winning_moves" integer DEFAULT '-1'::integer NOT NULL,
    "shortest_winning_replay_turns" integer DEFAULT 0 NOT NULL,
    "bot_latency_ms" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "winning_replays" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "admin_note" "text" DEFAULT ''::"text" NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "survival_approval_requires_evidence" CHECK ((("status" = 'draft'::"text") OR (("jsonb_array_length"("winning_replays") >= 3) AND ("immediate_winning_moves" = 0) AND ("shortest_winning_replay_turns" >= 5) AND ("length"("btrim"("admin_note")) > 0) AND ("approved_by" IS NOT NULL) AND ("approved_at" IS NOT NULL)))),
    CONSTRAINT "survival_levels_check" CHECK ((("win_count" >= 0) AND ("win_count" <= "sample_count"))),
    CONSTRAINT "survival_levels_immediate_winning_moves_check" CHECK (("immediate_winning_moves" >= '-1'::integer)),
    CONSTRAINT "survival_levels_level_no_check" CHECK ((("level_no" >= 1) AND ("level_no" <= 100))),
    CONSTRAINT "survival_levels_sample_count_check" CHECK (("sample_count" > 0)),
    CONSTRAINT "survival_levels_seed_check" CHECK (("seed" >= 0)),
    CONSTRAINT "survival_levels_shortest_winning_replay_turns_check" CHECK (("shortest_winning_replay_turns" >= 0)),
    CONSTRAINT "survival_levels_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'approved'::"text"]))),
    CONSTRAINT "survival_levels_winning_replays_check" CHECK (("jsonb_typeof"("winning_replays") = 'array'::"text"))
);


ALTER TABLE "public"."survival_levels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_settings" (
    "key" "text" NOT NULL,
    "value_int" bigint NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "system_settings_value_int_check" CHECK (("value_int" >= 0))
);


ALTER TABLE "public"."system_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_mode_stats" (
    "profile_id" "uuid" NOT NULL,
    "mode_key" "text" NOT NULL,
    "games_created" bigint DEFAULT 0 NOT NULL,
    "games_played" bigint DEFAULT 0 NOT NULL,
    "wins" bigint DEFAULT 0 NOT NULL,
    "losses" bigint DEFAULT 0 NOT NULL,
    "draws" bigint DEFAULT 0 NOT NULL,
    "solo_score" bigint DEFAULT 0 NOT NULL,
    "last_played_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_mode_stats_draws_check" CHECK (("draws" >= 0)),
    CONSTRAINT "user_mode_stats_games_created_check" CHECK (("games_created" >= 0)),
    CONSTRAINT "user_mode_stats_games_played_check" CHECK (("games_played" >= 0)),
    CONSTRAINT "user_mode_stats_losses_check" CHECK (("losses" >= 0)),
    CONSTRAINT "user_mode_stats_wins_check" CHECK (("wins" >= 0))
);


ALTER TABLE "public"."user_mode_stats" OWNER TO "postgres";


ALTER TABLE ONLY "private"."runtime_secrets"
    ADD CONSTRAINT "runtime_secrets_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."bot_stat_folders"
    ADD CONSTRAINT "bot_stat_folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bot_stat_games"
    ADD CONSTRAINT "bot_stat_games_folder_id_game_id_key" UNIQUE ("folder_id", "game_id");



ALTER TABLE ONLY "public"."bot_stat_games"
    ADD CONSTRAINT "bot_stat_games_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_mode_tools"
    ADD CONSTRAINT "game_mode_tools_pkey" PRIMARY KEY ("mode_id", "tool_id");



ALTER TABLE ONLY "public"."game_modes"
    ADD CONSTRAINT "game_modes_mode_key_key" UNIQUE ("mode_key");



ALTER TABLE ONLY "public"."game_modes"
    ADD CONSTRAINT "game_modes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_timelines"
    ADD CONSTRAINT "game_timelines_pkey" PRIMARY KEY ("game_id");



ALTER TABLE ONLY "public"."game_tools"
    ADD CONSTRAINT "game_tools_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_tools"
    ADD CONSTRAINT "game_tools_tool_key_key" UNIQUE ("tool_key");



ALTER TABLE ONLY "public"."live_game_events"
    ADD CONSTRAINT "live_game_events_pkey" PRIMARY KEY ("game_id", "revision");



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."private_library_items"
    ADD CONSTRAINT "private_library_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_display_name_key" UNIQUE ("display_name");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."public_game_snapshots"
    ADD CONSTRAINT "public_game_snapshots_pkey" PRIMARY KEY ("game_id");



ALTER TABLE ONLY "public"."ranked_matches"
    ADD CONSTRAINT "ranked_matches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ranked_ratings"
    ADD CONSTRAINT "ranked_ratings_pkey" PRIMARY KEY ("player_id");



ALTER TABLE ONLY "public"."ranked_results"
    ADD CONSTRAINT "ranked_results_pkey" PRIMARY KEY ("match_id");



ALTER TABLE ONLY "public"."region_game_snapshots"
    ADD CONSTRAINT "region_game_snapshots_pkey" PRIMARY KEY ("game_id");



ALTER TABLE ONLY "public"."regions"
    ADD CONSTRAINT "regions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."room_live"
    ADD CONSTRAINT "room_live_pkey" PRIMARY KEY ("room_id");



ALTER TABLE ONLY "public"."study_positions"
    ADD CONSTRAINT "study_positions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survival_attempts"
    ADD CONSTRAINT "survival_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survival_attempts"
    ADD CONSTRAINT "survival_attempts_room_id_key" UNIQUE ("room_id");



ALTER TABLE ONLY "public"."survival_levels"
    ADD CONSTRAINT "survival_levels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survival_levels"
    ADD CONSTRAINT "survival_levels_season_key_level_no_key" UNIQUE ("season_key", "level_no");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."user_mode_stats"
    ADD CONSTRAINT "user_mode_stats_pkey" PRIMARY KEY ("profile_id", "mode_key");



CREATE UNIQUE INDEX "bot_stat_folders_single_open_idx" ON "public"."bot_stat_folders" USING "btree" ("is_open") WHERE "is_open";



CREATE INDEX "bot_stat_games_folder_idx" ON "public"."bot_stat_games" USING "btree" ("folder_id", "created_at" DESC);



CREATE UNIQUE INDEX "live_game_events_command_unique_idx" ON "public"."live_game_events" USING "btree" ("game_id", "command_id");



CREATE INDEX "live_game_events_stream_idx" ON "public"."live_game_events" USING "btree" ("game_id", "revision");



CREATE INDEX "members_owner_idx" ON "public"."members" USING "btree" ("owner_id", "name");



CREATE INDEX "private_library_owner_parent_idx" ON "public"."private_library_items" USING "btree" ("owner_id", "parent_id", "trashed_at", "updated_at" DESC);



CREATE INDEX "private_library_owner_source_idx" ON "public"."private_library_items" USING "btree" ("owner_id", "source_scope", "source_game_id") WHERE ("item_type" = 'game'::"text");



CREATE INDEX "profiles_region_idx" ON "public"."profiles" USING "btree" ("region_id");



CREATE INDEX "public_game_snapshots_mode_idx" ON "public"."public_game_snapshots" USING "btree" ("mode_key", "finished_at" DESC);



CREATE INDEX "public_game_snapshots_retention_idx" ON "public"."public_game_snapshots" USING "btree" ("finished_at" DESC, "game_id" DESC);



CREATE INDEX "public_game_snapshots_training_idx" ON "public"."public_game_snapshots" USING "btree" ("finished_at" DESC) WHERE ("completion_kind" = 'natural'::"text");



CREATE UNIQUE INDEX "ranked_one_waiting_per_creator_idx" ON "public"."ranked_matches" USING "btree" ("player_a_id") WHERE ("status" = 'waiting'::"text");



CREATE INDEX "ranked_player_a_idx" ON "public"."ranked_matches" USING "btree" ("player_a_id", "updated_at" DESC);



CREATE INDEX "ranked_player_b_idx" ON "public"."ranked_matches" USING "btree" ("player_b_id", "updated_at" DESC);



CREATE INDEX "ranked_waiting_idx" ON "public"."ranked_matches" USING "btree" ("created_at" DESC) WHERE ("status" = 'waiting'::"text");



CREATE INDEX "region_game_snapshots_retention_idx" ON "public"."region_game_snapshots" USING "btree" ("region_id", "finished_at" DESC, "game_id" DESC);



CREATE INDEX "region_game_snapshots_training_idx" ON "public"."region_game_snapshots" USING "btree" ("region_id", "finished_at" DESC) WHERE ("completion_kind" = 'natural'::"text");



CREATE UNIQUE INDEX "regions_name_unique_idx" ON "public"."regions" USING "btree" ("lower"("btrim"("name")));



CREATE UNIQUE INDEX "room_live_code_hash_unique_idx" ON "public"."room_live" USING "btree" ("room_code_hash");



CREATE INDEX "room_live_expiry_idx" ON "public"."room_live" USING "btree" ("expires_at") WHERE ("expires_at" IS NOT NULL);



CREATE INDEX "room_live_public_activity_idx" ON "public"."room_live" USING "btree" ("last_activity_at" DESC) WHERE ("access_scope" = 'public'::"text");



CREATE INDEX "room_live_region_activity_idx" ON "public"."room_live" USING "btree" ("region_id", "last_activity_at" DESC) WHERE ("access_scope" = 'region'::"text");



CREATE INDEX "study_positions_owner_idx" ON "public"."study_positions" USING "btree" ("owner_id", "created_at" DESC);



CREATE OR REPLACE TRIGGER "attach_game_timeline" BEFORE INSERT ON "public"."private_library_items" FOR EACH ROW EXECUTE FUNCTION "public"."attach_game_timeline_to_archive"();



CREATE OR REPLACE TRIGGER "attach_game_timeline" BEFORE INSERT ON "public"."public_game_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."attach_game_timeline_to_archive"();



CREATE OR REPLACE TRIGGER "attach_game_timeline" BEFORE INSERT ON "public"."region_game_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."attach_game_timeline_to_archive"();



CREATE OR REPLACE TRIGGER "game_timeline_tool_guard" BEFORE INSERT OR UPDATE ON "public"."game_timelines" FOR EACH ROW EXECUTE FUNCTION "public"."guard_game_timeline_tool"();



CREATE OR REPLACE TRIGGER "live_game_events_immutable" BEFORE UPDATE ON "public"."live_game_events" FOR EACH ROW EXECUTE FUNCTION "public"."reject_live_event_rewrite"();



CREATE OR REPLACE TRIGGER "prepare_live_game_update" BEFORE UPDATE ON "public"."room_live" FOR EACH ROW EXECUTE FUNCTION "public"."prepare_live_game_update"();



CREATE OR REPLACE TRIGGER "reject_new_aether_room" BEFORE INSERT OR UPDATE OF "mode_key" ON "public"."room_live" FOR EACH ROW EXECUTE FUNCTION "public"."reject_new_aether_room"();



CREATE OR REPLACE TRIGGER "room_live_bot_config_derived" BEFORE INSERT ON "public"."room_live" FOR EACH ROW EXECUTE FUNCTION "public"."derive_live_bot_config"();



CREATE OR REPLACE TRIGGER "room_live_bot_config_frozen" BEFORE UPDATE ON "public"."room_live" FOR EACH ROW EXECUTE FUNCTION "public"."freeze_live_bot_config"();



CREATE OR REPLACE TRIGGER "validate_private_library_item" BEFORE INSERT OR UPDATE ON "public"."private_library_items" FOR EACH ROW EXECUTE FUNCTION "public"."validate_private_library_item"();



ALTER TABLE ONLY "public"."bot_stat_folders"
    ADD CONSTRAINT "bot_stat_folders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bot_stat_games"
    ADD CONSTRAINT "bot_stat_games_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."bot_stat_folders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bot_stat_games"
    ADD CONSTRAINT "bot_stat_games_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."game_mode_tools"
    ADD CONSTRAINT "game_mode_tools_mode_id_fkey" FOREIGN KEY ("mode_id") REFERENCES "public"."game_modes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_mode_tools"
    ADD CONSTRAINT "game_mode_tools_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "public"."game_tools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_timelines"
    ADD CONSTRAINT "game_timelines_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."room_live"("room_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_timelines"
    ADD CONSTRAINT "game_timelines_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_game_events"
    ADD CONSTRAINT "live_game_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."live_game_events"
    ADD CONSTRAINT "live_game_events_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."room_live"("room_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."private_library_items"
    ADD CONSTRAINT "private_library_items_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."private_library_items"
    ADD CONSTRAINT "private_library_items_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."private_library_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."public_game_snapshots"
    ADD CONSTRAINT "public_game_snapshots_player_a_user_id_fkey" FOREIGN KEY ("player_a_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."public_game_snapshots"
    ADD CONSTRAINT "public_game_snapshots_player_b_user_id_fkey" FOREIGN KEY ("player_b_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."public_game_snapshots"
    ADD CONSTRAINT "public_game_snapshots_source_owner_id_fkey" FOREIGN KEY ("source_owner_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ranked_matches"
    ADD CONSTRAINT "ranked_matches_player_a_id_fkey" FOREIGN KEY ("player_a_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."ranked_matches"
    ADD CONSTRAINT "ranked_matches_player_b_id_fkey" FOREIGN KEY ("player_b_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."ranked_ratings"
    ADD CONSTRAINT "ranked_ratings_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ranked_results"
    ADD CONSTRAINT "ranked_results_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."ranked_matches"("id");



ALTER TABLE ONLY "public"."ranked_results"
    ADD CONSTRAINT "ranked_results_player_a_id_fkey" FOREIGN KEY ("player_a_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."ranked_results"
    ADD CONSTRAINT "ranked_results_player_b_id_fkey" FOREIGN KEY ("player_b_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."ranked_results"
    ADD CONSTRAINT "ranked_results_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."region_game_snapshots"
    ADD CONSTRAINT "region_game_snapshots_player_a_user_id_fkey" FOREIGN KEY ("player_a_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."region_game_snapshots"
    ADD CONSTRAINT "region_game_snapshots_player_b_user_id_fkey" FOREIGN KEY ("player_b_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."region_game_snapshots"
    ADD CONSTRAINT "region_game_snapshots_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."region_game_snapshots"
    ADD CONSTRAINT "region_game_snapshots_source_owner_id_fkey" FOREIGN KEY ("source_owner_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."regions"
    ADD CONSTRAINT "regions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."room_live"
    ADD CONSTRAINT "room_live_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."room_live"
    ADD CONSTRAINT "room_live_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."room_live"
    ADD CONSTRAINT "room_live_player_a_user_id_fkey" FOREIGN KEY ("player_a_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."room_live"
    ADD CONSTRAINT "room_live_player_b_user_id_fkey" FOREIGN KEY ("player_b_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."room_live"
    ADD CONSTRAINT "room_live_private_parent_id_fkey" FOREIGN KEY ("private_parent_id") REFERENCES "public"."private_library_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."room_live"
    ADD CONSTRAINT "room_live_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."study_positions"
    ADD CONSTRAINT "study_positions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."survival_attempts"
    ADD CONSTRAINT "survival_attempts_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "public"."survival_levels"("id");



ALTER TABLE ONLY "public"."survival_attempts"
    ADD CONSTRAINT "survival_attempts_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."survival_levels"
    ADD CONSTRAINT "survival_levels_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_mode_stats"
    ADD CONSTRAINT "user_mode_stats_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE "private"."runtime_secrets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bot_folders_admin_write" ON "public"."bot_stat_folders" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "bot_folders_read" ON "public"."bot_stat_folders" FOR SELECT USING ("public"."is_approved"());



CREATE POLICY "bot_games_admin_delete" ON "public"."bot_stat_games" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "bot_games_admin_modify" ON "public"."bot_stat_games" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "bot_games_insert" ON "public"."bot_stat_games" FOR INSERT WITH CHECK ("public"."is_approved"());



CREATE POLICY "bot_games_read" ON "public"."bot_stat_games" FOR SELECT USING ("public"."is_approved"());



ALTER TABLE "public"."bot_stat_folders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bot_stat_games" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_mode_tools" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_modes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_timelines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "game_timelines_read" ON "public"."game_timelines" FOR SELECT USING ("public"."can_read_live_game"("game_id"));



ALTER TABLE "public"."game_tools" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_game_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "live_game_events_read" ON "public"."live_game_events" FOR SELECT USING ("public"."can_read_live_game"("game_id"));



ALTER TABLE "public"."members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "members_delete_own" ON "public"."members" FOR DELETE USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "members_insert_own" ON "public"."members" FOR INSERT WITH CHECK ((("owner_id" = "auth"."uid"()) AND ("public"."is_approved"() OR "public"."is_admin"())));



CREATE POLICY "members_select_own" ON "public"."members" FOR SELECT USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "members_update_own" ON "public"."members" FOR UPDATE USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "private_library_delete_own" ON "public"."private_library_items" FOR DELETE USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "private_library_insert_own" ON "public"."private_library_items" FOR INSERT WITH CHECK (("owner_id" = "auth"."uid"()));



ALTER TABLE "public"."private_library_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "private_library_read_own" ON "public"."private_library_items" FOR SELECT USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "private_library_update_own" ON "public"."private_library_items" FOR UPDATE USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert" ON "public"."profiles" FOR INSERT WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "profiles_read" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "profiles_update" ON "public"."profiles" FOR UPDATE USING ((("id" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."public_game_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public_snapshots_read" ON "public"."public_game_snapshots" FOR SELECT USING (("public"."is_approved"() OR "public"."is_admin"()));



ALTER TABLE "public"."ranked_matches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ranked_ratings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ranked_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."region_game_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "region_snapshots_read" ON "public"."region_game_snapshots" FOR SELECT USING (("public"."is_admin"() OR ("public"."is_approved"() AND ("region_id" = "public"."my_region_id"()))));



ALTER TABLE "public"."regions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "regions_delete_admin" ON "public"."regions" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "regions_insert_admin" ON "public"."regions" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "regions_read" ON "public"."regions" FOR SELECT USING (("public"."is_admin"() OR ("id" = "public"."my_region_id"())));



CREATE POLICY "regions_update_admin" ON "public"."regions" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."room_live" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "room_live_delete" ON "public"."room_live" FOR DELETE USING ((("owner_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "room_live_insert" ON "public"."room_live" FOR INSERT WITH CHECK ((("owner_id" = "auth"."uid"()) AND ("public"."is_approved"() OR "public"."is_admin"())));



CREATE POLICY "room_live_read" ON "public"."room_live" FOR SELECT USING ("public"."can_read_live_game"("room_id"));



CREATE POLICY "room_live_update" ON "public"."room_live" FOR UPDATE USING ("public"."can_write_live_game"("room_id")) WITH CHECK ("public"."can_write_live_game"("room_id"));



ALTER TABLE "public"."study_positions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "study_positions_delete" ON "public"."study_positions" FOR DELETE USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "study_positions_insert" ON "public"."study_positions" FOR INSERT WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "study_positions_read" ON "public"."study_positions" FOR SELECT USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "survival_admin_insert" ON "public"."survival_levels" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "survival_admin_update" ON "public"."survival_levels" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "survival_attempt_insert" ON "public"."survival_attempts" FOR INSERT TO "authenticated" WITH CHECK ((("player_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ("public"."survival_levels" "l"
     JOIN "public"."room_live" "r" ON (("r"."room_id" = "survival_attempts"."room_id")))
  WHERE (("l"."id" = "survival_attempts"."level_id") AND ("r"."owner_id" = "auth"."uid"()) AND ("r"."mode_key" = 'authur_strong'::"text") AND ("r"."name" = ('Survival test · seed '::"text" || ("l"."seed")::"text")) AND (("l"."status" = 'approved'::"text") OR "public"."is_admin"()))))));



CREATE POLICY "survival_attempt_read" ON "public"."survival_attempts" FOR SELECT TO "authenticated" USING ((("player_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "survival_attempt_update" ON "public"."survival_attempts" FOR UPDATE TO "authenticated" USING ((("player_id" = "auth"."uid"()) AND ("finished_at" IS NULL))) WITH CHECK (("player_id" = "auth"."uid"()));



ALTER TABLE "public"."survival_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."survival_levels" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "survival_read" ON "public"."survival_levels" FOR SELECT TO "authenticated" USING ((("status" = 'approved'::"text") OR "public"."is_admin"()));



ALTER TABLE "public"."system_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_settings_read" ON "public"."system_settings" FOR SELECT USING (("public"."is_approved"() OR "public"."is_admin"()));



ALTER TABLE "public"."user_mode_stats" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_mode_stats_read_own" ON "public"."user_mode_stats" FOR SELECT USING ((("profile_id" = "auth"."uid"()) OR "public"."is_admin"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."members";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."room_live";



-- ── Reproduce production privileges exactly ──────────────────────────────
-- A fresh Supabase database grants ALL on every new public table and function
-- to anon, authenticated and service_role (default privileges). Production has
-- since narrowed many of them, and pg_dump records only the grants that exist,
-- not the defaults that were revoked. Clear the default grants here so the
-- GRANT/REVOKE statements below leave each object exactly as in production.
DO $baseline_acl$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.oid::regclass AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  LOOP
    EXECUTE format('REVOKE ALL ON %s FROM anon, authenticated, service_role', target.name);
  END LOOP;
  FOR target IN
    SELECT p.oid::regprocedure AS name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated, service_role', target.name);
  END LOOP;
END
$baseline_acl$;

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."attach_game_timeline_to_archive"() FROM PUBLIC;



GRANT ALL ON FUNCTION "public"."bot_folder_open_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."bot_folder_open_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bot_folder_open_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."broadcast_live_game_commit"("target_game_id" "uuid", "target_revision" bigint, "target_command_id" "text", "target_issued_by" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."can_read_live_game"("target_game_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_read_live_game"("target_game_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_read_live_game"("target_game_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_read_live_game"("target_game_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_read_room"("room_visibility" "text", "room_region_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_read_room"("room_visibility" "text", "room_region_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_read_room"("room_visibility" "text", "room_region_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_read_room"("room_visibility" "text", "room_region_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_read_room_live"("p_room_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_read_room_live"("p_room_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_read_room_live"("p_room_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_read_room_live"("p_room_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_write_live_game"("target_game_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_write_live_game"("target_game_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_write_live_game"("target_game_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_write_live_game"("target_game_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_write_room_live"("p_room_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_write_room_live"("p_room_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_write_room_live"("p_room_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_write_room_live"("p_room_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_live_game"("target_game_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_live_game"("target_game_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_live_game"("target_game_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_live_game"("target_game_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_expired_live_games"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_expired_live_games"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_expired_live_games"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_expired_live_games"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_private_library_trash"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_private_library_trash"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_private_library_trash"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_private_library_trash"() TO "service_role";



GRANT ALL ON FUNCTION "public"."close_bot_folder"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."close_bot_folder"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."close_bot_folder"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."commit_live_game_command"("target_game_id" "uuid", "target_expected_revision" bigint, "target_command_id" "text", "target_issued_by" "text", "target_command" "jsonb", "target_canonical" "jsonb", "target_canonical_digest" "text", "target_state" "jsonb", "target_session" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."commit_live_game_command"("target_game_id" "uuid", "target_expected_revision" bigint, "target_command_id" "text", "target_issued_by" "text", "target_command" "jsonb", "target_canonical" "jsonb", "target_canonical_digest" "text", "target_state" "jsonb", "target_session" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."commit_live_game_timeline"("target_game_id" "uuid", "target_expected_revision" bigint, "target_command_id" "text", "target_issued_by" "text", "target_command" "jsonb", "target_canonical" "jsonb", "target_canonical_digest" "text", "target_state" "jsonb", "target_session" "jsonb", "target_timeline" "jsonb", "target_timeline_expected_version" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."commit_live_game_timeline"("target_game_id" "uuid", "target_expected_revision" bigint, "target_command_id" "text", "target_issued_by" "text", "target_command" "jsonb", "target_canonical" "jsonb", "target_canonical_digest" "text", "target_state" "jsonb", "target_session" "jsonb", "target_timeline" "jsonb", "target_timeline_expected_version" bigint) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."controls_live_game_side"("target_game_id" "uuid", "target_side" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."controls_live_game_side"("target_game_id" "uuid", "target_side" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."controls_live_game_side"("target_game_id" "uuid", "target_side" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."copy_private_game_item"("source_item_id" "uuid", "target_parent_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."copy_private_game_item"("source_item_id" "uuid", "target_parent_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."copy_private_game_item"("source_item_id" "uuid", "target_parent_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."copy_private_game_item"("source_item_id" "uuid", "target_parent_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."bot_stat_folders" TO "anon";
GRANT ALL ON TABLE "public"."bot_stat_folders" TO "authenticated";
GRANT ALL ON TABLE "public"."bot_stat_folders" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_bot_folder"("p_name" "text", "p_open" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."create_bot_folder"("p_name" "text", "p_open" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_bot_folder"("p_name" "text", "p_open" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_live_game"("target_state" "jsonb", "target_access_scope" "text", "target_archive_policy" "text", "target_region_id" "uuid", "target_join_policy" "text", "target_private_parent_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_live_game"("target_state" "jsonb", "target_access_scope" "text", "target_archive_policy" "text", "target_region_id" "uuid", "target_join_policy" "text", "target_private_parent_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_live_game"("target_state" "jsonb", "target_access_scope" "text", "target_archive_policy" "text", "target_region_id" "uuid", "target_join_policy" "text", "target_private_parent_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_live_game"("target_state" "jsonb", "target_access_scope" "text", "target_archive_policy" "text", "target_region_id" "uuid", "target_join_policy" "text", "target_private_parent_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."derive_live_bot_config"() TO "anon";
GRANT ALL ON FUNCTION "public"."derive_live_bot_config"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."derive_live_bot_config"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."derive_live_room_code"("target_game_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."finalize_live_game"("target_game_id" "uuid", "target_state" "jsonb", "target_completion_kind" "text", "target_completion_reason" "text", "target_surrendered_side" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_live_game"("target_game_id" "uuid", "target_state" "jsonb", "target_completion_kind" "text", "target_completion_reason" "text", "target_surrendered_side" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."finalize_live_game"("target_game_id" "uuid", "target_state" "jsonb", "target_completion_kind" "text", "target_completion_reason" "text", "target_surrendered_side" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_live_game"("target_game_id" "uuid", "target_state" "jsonb", "target_completion_kind" "text", "target_completion_reason" "text", "target_surrendered_side" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."freeze_live_bot_config"() TO "anon";
GRANT ALL ON FUNCTION "public"."freeze_live_bot_config"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."freeze_live_bot_config"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_game_mode_tools"("target_mode_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_game_mode_tools"("target_mode_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_game_mode_tools"("target_mode_key" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_live_game_code"("target_game_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_live_game_code"("target_game_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_live_game_code"("target_game_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_live_game_code"("target_game_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_live_game_engine_context"("target_game_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_live_game_engine_context"("target_game_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_live_game_snapshot"("target_game_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_live_game_snapshot"("target_game_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_my_profile"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_profile"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_profile"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_public_archive_move_context"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_archive_move_context"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."guard_game_timeline_tool"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_game_timeline_tool"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_approved"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_approved"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_approved"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_room_invitee"("email_a" "text", "email_b" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_room_invitee"("email_a" "text", "email_b" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_room_invitee"("email_a" "text", "email_b" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_room_invitee_for_active_side"("room_state" "jsonb", "email_a" "text", "email_b" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_room_invitee_for_active_side"("room_state" "jsonb", "email_a" "text", "email_b" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_room_invitee_for_active_side"("room_state" "jsonb", "email_a" "text", "email_b" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_room_player"("user_a" "uuid", "user_b" "uuid", "email_a" "text", "email_b" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_room_player"("user_a" "uuid", "user_b" "uuid", "email_a" "text", "email_b" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_room_player"("user_a" "uuid", "user_b" "uuid", "email_a" "text", "email_b" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_room_player_for_active_side"("room_state" "jsonb", "user_a" "uuid", "user_b" "uuid", "email_a" "text", "email_b" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_room_player_for_active_side"("room_state" "jsonb", "user_a" "uuid", "user_b" "uuid", "email_a" "text", "email_b" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_room_player_for_active_side"("room_state" "jsonb", "user_a" "uuid", "user_b" "uuid", "email_a" "text", "email_b" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_live_game"("target_room_code" "text", "target_game_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."join_live_game"("target_room_code" "text", "target_game_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."join_live_game"("target_room_code" "text", "target_game_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_live_game"("target_room_code" "text", "target_game_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_live_game_events"("target_game_id" "uuid", "target_since_revision" bigint, "target_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_live_game_events"("target_game_id" "uuid", "target_since_revision" bigint, "target_limit" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."list_live_games"("target_access_scope" "text", "target_region_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_live_games"("target_access_scope" "text", "target_region_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."list_profiles_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_profiles_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."list_profiles_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_profiles_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_regions_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_regions_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."list_regions_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_regions_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_registered_players"("target_visibility" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_registered_players"("target_visibility" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."list_registered_players"("target_visibility" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_registered_players"("target_visibility" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mode_key_from_state"("target_state" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."mode_key_from_state"("target_state" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mode_key_from_state"("target_state" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."move_private_library_items"("target_item_ids" "uuid"[], "target_parent_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."move_private_library_items"("target_item_ids" "uuid"[], "target_parent_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."move_private_library_items"("target_item_ids" "uuid"[], "target_parent_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."move_private_library_items"("target_item_ids" "uuid"[], "target_parent_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."move_public_snapshot_to_region"("target_game_id" "uuid", "target_region_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."move_public_snapshot_to_region"("target_game_id" "uuid", "target_region_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."move_public_snapshot_to_region"("target_game_id" "uuid", "target_region_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."move_public_snapshot_to_region"("target_game_id" "uuid", "target_region_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."move_public_snapshots_to_region"("target_game_ids" "uuid"[], "target_region_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."move_public_snapshots_to_region"("target_game_ids" "uuid"[], "target_region_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."my_email_lower"() TO "anon";
GRANT ALL ON FUNCTION "public"."my_email_lower"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_email_lower"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_region_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_region_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."my_region_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_region_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."open_bot_folder"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."open_bot_folder"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."open_bot_folder"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."prepare_live_game_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."prepare_live_game_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prepare_live_game_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_invited_room_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_invited_room_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_invited_room_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_room_scope_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_room_scope_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_room_scope_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prune_public_game_snapshots"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prune_public_game_snapshots"() TO "anon";
GRANT ALL ON FUNCTION "public"."prune_public_game_snapshots"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prune_public_game_snapshots"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prune_region_game_snapshots"("target_region_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prune_region_game_snapshots"("target_region_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."prune_region_game_snapshots"("target_region_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prune_region_game_snapshots"("target_region_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ranked_claim_match"("target_match_id" "uuid", "target_player_id" "uuid", "target_player_name" "text", "target_now" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ranked_claim_match"("target_match_id" "uuid", "target_player_id" "uuid", "target_player_name" "text", "target_now" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."ranked_commit_match"("target_match_id" "uuid", "target_revision" bigint, "target_state" "jsonb", "target_winner" "text", "target_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ranked_commit_match"("target_match_id" "uuid", "target_revision" bigint, "target_state" "jsonb", "target_winner" "text", "target_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ranked_ready_match"("target_match_id" "uuid", "target_player_id" "uuid", "target_now" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ranked_ready_match"("target_match_id" "uuid", "target_player_id" "uuid", "target_now" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."record_bot_game"("p_game_id" "text", "p_room_id" "uuid", "p_player_name" "text", "p_player_member_id" "text", "p_bot_side" "text", "p_bot_difficulty" "text", "p_bot_score" integer, "p_opp_score" integer, "p_outcome" "text", "p_turns" integer, "p_finished_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."record_bot_game"("p_game_id" "text", "p_room_id" "uuid", "p_player_name" "text", "p_player_member_id" "text", "p_bot_side" "text", "p_bot_difficulty" "text", "p_bot_score" integer, "p_opp_score" integer, "p_outcome" "text", "p_turns" integer, "p_finished_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_bot_game"("p_game_id" "text", "p_room_id" "uuid", "p_player_name" "text", "p_player_member_id" "text", "p_bot_side" "text", "p_bot_difficulty" "text", "p_bot_score" integer, "p_opp_score" integer, "p_outcome" "text", "p_turns" integer, "p_finished_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_bot_game_v2"("p_game_id" "text", "p_room_id" "uuid", "p_player_name" "text", "p_player_member_id" "text", "p_bot_side" "text", "p_bot_engine" "text", "p_bot_difficulty" "text", "p_bot_score" integer, "p_opp_score" integer, "p_outcome" "text", "p_turns" integer, "p_finished_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_bot_game_v2"("p_game_id" "text", "p_room_id" "uuid", "p_player_name" "text", "p_player_member_id" "text", "p_bot_side" "text", "p_bot_engine" "text", "p_bot_difficulty" "text", "p_bot_score" integer, "p_opp_score" integer, "p_outcome" "text", "p_turns" integer, "p_finished_at" timestamp with time zone) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_player_result"("target_profile_id" "uuid", "target_mode_key" "text", "target_game_mode" "text", "target_side" "text", "target_score_a" integer, "target_score_b" integer, "target_finished_at" timestamp with time zone, "target_surrendered_side" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_player_result"("target_profile_id" "uuid", "target_mode_key" "text", "target_game_mode" "text", "target_side" "text", "target_score_a" integer, "target_score_b" integer, "target_finished_at" timestamp with time zone, "target_surrendered_side" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."record_player_result"("target_profile_id" "uuid", "target_mode_key" "text", "target_game_mode" "text", "target_side" "text", "target_score_a" integer, "target_score_b" integer, "target_finished_at" timestamp with time zone, "target_surrendered_side" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_player_result"("target_profile_id" "uuid", "target_mode_key" "text", "target_game_mode" "text", "target_side" "text", "target_score_a" integer, "target_score_b" integer, "target_finished_at" timestamp with time zone, "target_surrendered_side" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reject_live_event_rewrite"() TO "anon";
GRANT ALL ON FUNCTION "public"."reject_live_event_rewrite"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_live_event_rewrite"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reject_new_aether_room"() TO "anon";
GRANT ALL ON FUNCTION "public"."reject_new_aether_room"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_new_aether_room"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sanitize_game_snapshot"("payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."sanitize_game_snapshot"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sanitize_game_snapshot"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_archive_to_private"("target_scope" "text", "target_game_id" "uuid", "target_parent_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_archive_to_private"("target_scope" "text", "target_game_id" "uuid", "target_parent_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."save_archive_to_private"("target_scope" "text", "target_game_id" "uuid", "target_parent_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_archive_to_private"("target_scope" "text", "target_game_id" "uuid", "target_parent_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_study_analysis"("p_score_self" integer, "p_score_opponent" integer, "p_board" "jsonb", "p_rack" "jsonb", "p_opp_rack_count" integer, "p_bag_count" integer, "p_level" "text", "p_summary" "text", "p_method" "jsonb", "p_candidates" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_study_analysis"("p_score_self" integer, "p_score_opponent" integer, "p_board" "jsonb", "p_rack" "jsonb", "p_opp_rack_count" integer, "p_bag_count" integer, "p_level" "text", "p_summary" "text", "p_method" "jsonb", "p_candidates" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."save_study_analysis"("p_score_self" integer, "p_score_opponent" integer, "p_board" "jsonb", "p_rack" "jsonb", "p_opp_rack_count" integer, "p_bag_count" integer, "p_level" "text", "p_summary" "text", "p_method" "jsonb", "p_candidates" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_study_analysis"("p_score_self" integer, "p_score_opponent" integer, "p_board" "jsonb", "p_rack" "jsonb", "p_opp_rack_count" integer, "p_bag_count" integer, "p_level" "text", "p_summary" "text", "p_method" "jsonb", "p_candidates" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_game_storage_limits"("next_public_limit" bigint, "next_region_limit" bigint, "next_private_limit" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_game_storage_limits"("next_public_limit" bigint, "next_region_limit" bigint, "next_private_limit" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."set_game_storage_limits"("next_public_limit" bigint, "next_region_limit" bigint, "next_private_limit" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_game_storage_limits"("next_public_limit" bigint, "next_region_limit" bigint, "next_private_limit" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_room_ready"("target_room_id" "uuid", "target_side" "text", "target_ready" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_room_ready"("target_room_id" "uuid", "target_side" "text", "target_ready" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."set_room_ready"("target_room_id" "uuid", "target_side" "text", "target_ready" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_room_ready"("target_room_id" "uuid", "target_side" "text", "target_ready" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."snapshot_completion_reason"("payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."snapshot_completion_reason"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."snapshot_completion_reason"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_live_game_state"("target_game_id" "uuid", "target_state" "jsonb", "target_session" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_live_game_state"("target_game_id" "uuid", "target_state" "jsonb", "target_session" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_live_game_session"("target_game_id" "uuid", "target_session" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_live_game_session"("target_game_id" "uuid", "target_session" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_live_game_state"("target_game_id" "uuid", "target_state" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_live_game_state"("target_game_id" "uuid", "target_state" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_live_game_state"("target_game_id" "uuid", "target_state" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_live_game_state"("target_game_id" "uuid", "target_state" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_live_game_timeline"("target_game_id" "uuid", "target_timeline" "jsonb", "target_timeline_expected_version" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_live_game_timeline"("target_game_id" "uuid", "target_timeline" "jsonb", "target_timeline_expected_version" bigint) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_profile_admin"("target_profile_id" "uuid", "next_status" "text", "next_is_admin" boolean, "next_region_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_profile_admin"("target_profile_id" "uuid", "next_status" "text", "next_is_admin" boolean, "next_region_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."update_profile_admin"("target_profile_id" "uuid", "next_status" "text", "next_is_admin" boolean, "next_region_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_profile_admin"("target_profile_id" "uuid", "next_status" "text", "next_is_admin" boolean, "next_region_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_game_timeline"("target_timeline" "jsonb") FROM PUBLIC;



GRANT ALL ON FUNCTION "public"."validate_private_library_item"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_private_library_item"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_private_library_item"() TO "service_role";


















GRANT ALL ON TABLE "public"."bot_stat_games" TO "anon";
GRANT ALL ON TABLE "public"."bot_stat_games" TO "authenticated";
GRANT ALL ON TABLE "public"."bot_stat_games" TO "service_role";



GRANT ALL ON TABLE "public"."game_mode_tools" TO "service_role";



GRANT ALL ON TABLE "public"."game_modes" TO "service_role";



GRANT ALL ON TABLE "public"."game_timelines" TO "service_role";
GRANT SELECT ON TABLE "public"."game_timelines" TO "authenticated";



GRANT ALL ON TABLE "public"."game_tools" TO "service_role";



GRANT SELECT ON TABLE "public"."live_game_events" TO "authenticated";



GRANT ALL ON TABLE "public"."members" TO "anon";
GRANT ALL ON TABLE "public"."members" TO "authenticated";
GRANT ALL ON TABLE "public"."members" TO "service_role";



GRANT ALL ON TABLE "public"."private_library_items" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."private_library_items" TO "authenticated";



GRANT INSERT("owner_id") ON TABLE "public"."private_library_items" TO "authenticated";



GRANT INSERT("item_type") ON TABLE "public"."private_library_items" TO "authenticated";



GRANT INSERT("parent_id"),UPDATE("parent_id") ON TABLE "public"."private_library_items" TO "authenticated";



GRANT INSERT("name"),UPDATE("name") ON TABLE "public"."private_library_items" TO "authenticated";



GRANT UPDATE("trashed_at") ON TABLE "public"."private_library_items" TO "authenticated";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."profiles" TO "anon";
GRANT REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("id"),INSERT("id") ON TABLE "public"."profiles" TO "authenticated";



GRANT INSERT("email") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("display_name") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("display_name"),INSERT("display_name"),UPDATE("display_name") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."public_game_snapshots" TO "service_role";



GRANT SELECT("game_id") ON TABLE "public"."public_game_snapshots" TO "authenticated";



GRANT SELECT("source_owner_id") ON TABLE "public"."public_game_snapshots" TO "authenticated";



GRANT SELECT("name") ON TABLE "public"."public_game_snapshots" TO "authenticated";



GRANT SELECT("player_a") ON TABLE "public"."public_game_snapshots" TO "authenticated";



GRANT SELECT("player_b") ON TABLE "public"."public_game_snapshots" TO "authenticated";



GRANT SELECT("game_mode") ON TABLE "public"."public_game_snapshots" TO "authenticated";



GRANT SELECT("mode_key") ON TABLE "public"."public_game_snapshots" TO "authenticated";



GRANT SELECT("turn_number") ON TABLE "public"."public_game_snapshots" TO "authenticated";



GRANT SELECT("score_a") ON TABLE "public"."public_game_snapshots" TO "authenticated";



GRANT SELECT("score_b") ON TABLE "public"."public_game_snapshots" TO "authenticated";



GRANT SELECT("completion_kind") ON TABLE "public"."public_game_snapshots" TO "authenticated";



GRANT SELECT("completion_reason") ON TABLE "public"."public_game_snapshots" TO "authenticated";



GRANT SELECT("surrendered_side") ON TABLE "public"."public_game_snapshots" TO "authenticated";



GRANT SELECT("snapshot") ON TABLE "public"."public_game_snapshots" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."public_game_snapshots" TO "authenticated";



GRANT SELECT("finished_at") ON TABLE "public"."public_game_snapshots" TO "authenticated";



GRANT SELECT("archived_at") ON TABLE "public"."public_game_snapshots" TO "authenticated";



GRANT ALL ON TABLE "public"."ranked_matches" TO "service_role";



GRANT ALL ON TABLE "public"."ranked_ratings" TO "service_role";



GRANT ALL ON TABLE "public"."ranked_results" TO "service_role";



GRANT ALL ON TABLE "public"."region_game_snapshots" TO "service_role";



GRANT SELECT("game_id") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT SELECT("region_id") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT SELECT("source_owner_id") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT SELECT("name") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT SELECT("player_a") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT SELECT("player_b") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT SELECT("game_mode") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT SELECT("mode_key") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT SELECT("turn_number") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT SELECT("score_a") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT SELECT("score_b") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT SELECT("completion_kind") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT SELECT("completion_reason") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT SELECT("surrendered_side") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT SELECT("snapshot") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT SELECT("finished_at") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT SELECT("archived_at") ON TABLE "public"."region_game_snapshots" TO "authenticated";



GRANT ALL ON TABLE "public"."regions" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."regions" TO "authenticated";



GRANT ALL ON TABLE "public"."room_live" TO "service_role";



GRANT SELECT("room_id") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("session") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("owner_id") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("name") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("player_a") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("player_b") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("status") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("access_scope") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("archive_policy") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("region_id") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("join_policy") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("game_mode") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("mode_key") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("member_a_id") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("member_b_id") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("player_a_user_id") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("player_b_user_id") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("starting_side") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("creator_side") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("turn_number") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("score_a") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("score_b") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("state") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."room_live" TO "authenticated";



GRANT SELECT("revision") ON TABLE "public"."room_live" TO "authenticated";



GRANT ALL ON TABLE "public"."study_positions" TO "anon";
GRANT ALL ON TABLE "public"."study_positions" TO "authenticated";
GRANT ALL ON TABLE "public"."study_positions" TO "service_role";



GRANT ALL ON TABLE "public"."survival_attempts" TO "anon";
GRANT ALL ON TABLE "public"."survival_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."survival_attempts" TO "service_role";



GRANT UPDATE("finished_at") ON TABLE "public"."survival_attempts" TO "authenticated";



GRANT UPDATE("player_score") ON TABLE "public"."survival_attempts" TO "authenticated";



GRANT UPDATE("authur_score") ON TABLE "public"."survival_attempts" TO "authenticated";



GRANT UPDATE("result") ON TABLE "public"."survival_attempts" TO "authenticated";



GRANT ALL ON TABLE "public"."survival_levels" TO "anon";
GRANT ALL ON TABLE "public"."survival_levels" TO "authenticated";
GRANT ALL ON TABLE "public"."survival_levels" TO "service_role";



GRANT ALL ON TABLE "public"."system_settings" TO "service_role";



GRANT SELECT("key") ON TABLE "public"."system_settings" TO "authenticated";



GRANT SELECT("value_int") ON TABLE "public"."system_settings" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."system_settings" TO "authenticated";



GRANT ALL ON TABLE "public"."user_mode_stats" TO "service_role";
GRANT SELECT ON TABLE "public"."user_mode_stats" TO "authenticated";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































