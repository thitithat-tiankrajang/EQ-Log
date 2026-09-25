-- Follow-up for deployments that already applied game_archives_migration.sql.
-- Adds a server-authorized admin context and one atomic multi-snapshot move.

begin;

set lock_timeout = '15s';

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

notify pgrst, 'reload schema';

commit;
