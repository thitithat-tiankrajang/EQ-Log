-- Apply only with the archive-replay Edge function and client replay switch.
-- Browser roles keep metadata listing access, never the internal archive JSON.
begin;

-- Supabase's inherited postgres defaults otherwise grant ALL on *future* public
-- tables to API roles. New payload tables/partitions must opt in explicitly.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
-- A future payload-returning helper must also opt in explicitly rather than
-- inheriting callable-by-browser defaults from the production baseline.
-- A schema-scoped revoke cannot cancel PostgreSQL's global PUBLIC EXECUTE
-- default. Revoke globally so future sensitive public functions start closed;
-- SQL fixtures using pg_temp functions grant their helpers explicitly.
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;

revoke all on table public.public_game_snapshots from public, anon, authenticated;
revoke select (snapshot) on table public.public_game_snapshots from public, anon, authenticated;
grant select (
  game_id, source_owner_id, name, player_a, player_b, game_mode, mode_key,
  turn_number, score_a, score_b, completion_kind, completion_reason,
  surrendered_side, created_at, finished_at, archived_at
) on table public.public_game_snapshots to authenticated;
grant all on table public.public_game_snapshots to service_role;

revoke all on table public.region_game_snapshots from public, anon, authenticated;
revoke select (snapshot) on table public.region_game_snapshots from public, anon, authenticated;
grant select (
  game_id, region_id, source_owner_id, name, player_a, player_b, game_mode,
  mode_key, turn_number, score_a, score_b, completion_kind, completion_reason,
  surrendered_side, created_at, finished_at, archived_at
) on table public.region_game_snapshots to authenticated;
grant all on table public.region_game_snapshots to service_role;

-- The baseline gave authenticated *table-level* SELECT here. A column-only
-- snapshot revoke would be ineffective until that grant is removed.
revoke all on table public.private_library_items from public, anon, authenticated;
revoke select (snapshot) on table public.private_library_items from public, anon, authenticated;
grant select (
  id, owner_id, item_type, parent_id, name, source_scope, source_game_id,
  game_id, game_mode, mode_key, completion_kind, completion_reason, turn_number,
  score_a, score_b, trashed_at, created_at, updated_at
) on table public.private_library_items to authenticated;
grant delete on table public.private_library_items to authenticated;
grant insert (owner_id, item_type, parent_id, name)
  on table public.private_library_items to authenticated;
grant update (parent_id, name, trashed_at)
  on table public.private_library_items to authenticated;
grant all on table public.private_library_items to service_role;

-- Legacy snapshots accept a parked `timeline` field. Compact v1 hashes a
-- closed, versioned payload: appending that field would corrupt its digest.
-- The trusted Compact writer must include parked suffixes as `branches`
-- before inserting the archive row. Refuse an incomplete branched capture.
create or replace function public.attach_game_timeline_to_archive()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  parked jsonb;
begin
  if new.game_id is null or new.snapshot is null
     or jsonb_typeof(new.snapshot) <> 'object' then
    return new;
  end if;
  if new.snapshot ? 'format' then
    if new.snapshot ->> 'format' <> '1' then
      raise exception 'unsupported completed archive format' using errcode = '22023';
    end if;
    select t.doc into parked from public.game_timelines t
     where t.game_id = new.game_id and t.line_count > 0;
    if parked is not null and new.snapshot -> 'branches' is distinct from parked then
      raise exception 'Compact archive branches differ from parked lines'
        using errcode = '22023';
    end if;
    return new;
  end if;
  if new.snapshot ? 'timeline' then
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

commit;
