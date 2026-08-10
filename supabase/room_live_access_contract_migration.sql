-- Follow-up for deployments that already applied game_archives_migration.sql.
-- Keeps anonymous visitors outside member game data, routes lobby reads
-- through a safe projection, and removes sensitive columns from direct grants.

begin;

set lock_timeout = '15s';

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

-- Supabase can assign explicit default EXECUTE grants to its API roles when a
-- function is created. Revoking PUBLIC alone does not remove those role ACLs.
revoke all on function public.list_live_games(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_live_games(text, uuid) to authenticated;

revoke all on table public.room_live from anon, authenticated;
grant select (
  room_id, owner_id, name, player_a, player_b, status,
  access_scope, archive_policy, region_id, join_policy,
  game_mode, mode_key, member_a_id, member_b_id,
  player_a_user_id, player_b_user_id, starting_side, creator_side,
  turn_number, score_a, score_b, state, session, created_at, updated_at
) on table public.room_live to authenticated;

notify pgrst, 'reload schema';

commit;
