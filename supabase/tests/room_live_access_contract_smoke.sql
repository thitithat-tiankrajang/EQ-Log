-- Local/staging-only smoke test for room_live_access_contract_migration.sql.
-- Requires two approved profiles and always rolls back.

begin;

do $smoke$
declare
  owner_id uuid;
  viewer_id uuid;
  created record;
  owner_summary jsonb;
  viewer_summary jsonb;
begin
  if has_table_privilege('anon', 'public.room_live', 'SELECT') then
    raise exception 'anon can select room_live';
  end if;
  if has_function_privilege('anon', 'public.list_live_games(text,uuid)', 'EXECUTE') then
    raise exception 'anon can execute list_live_games';
  end if;
  if has_function_privilege(
    'service_role',
    'public.list_live_games(text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'service_role can execute list_live_games';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.list_live_games(text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated cannot execute list_live_games';
  end if;
  if not has_column_privilege('authenticated', 'public.room_live', 'room_id', 'SELECT')
    or not has_column_privilege('authenticated', 'public.room_live', 'state', 'SELECT')
    or not has_column_privilege('authenticated', 'public.room_live', 'session', 'SELECT')
  then
    raise exception 'opened-game columns are not selectable';
  end if;
  if has_column_privilege('authenticated', 'public.room_live', 'room_code_hash', 'SELECT')
    or has_column_privilege('authenticated', 'public.room_live', 'private_parent_id', 'SELECT')
  then
    raise exception 'authenticated can select a restricted live-game column';
  end if;

  select id into owner_id
  from public.profiles
  where status = 'approved'
  order by created_at, id
  limit 1;

  select id into viewer_id
  from public.profiles
  where status = 'approved' and id <> owner_id
  order by created_at, id
  limit 1;

  if owner_id is null or viewer_id is null then
    raise exception 'smoke test requires two approved profiles';
  end if;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text,
    true
  );

  select * into created
  from public.create_live_game(
    jsonb_build_object(
      'name', 'Access contract smoke test',
      'gameMode', 'versus',
      'roomStage', 'waiting',
      'players', jsonb_build_object('A', 'Owner', 'B', 'Viewer'),
      'playerUserIds', jsonb_build_object('A', owner_id),
      'scores', jsonb_build_object('A', 0, 'B', 0),
      'startingSide', 'A',
      'turnNumber', 1
    ),
    'public',
    'public',
    null,
    'open',
    null
  );

  select to_jsonb(summary) into owner_summary
  from public.list_live_games('public', null) summary
  where summary.room_id = created.room_id;

  if owner_summary is null
    or owner_summary ->> 'viewer_role' <> 'Owner'
    or (owner_summary ->> 'can_manage')::boolean is not true
  then
    raise exception 'owner did not receive the expected safe summary';
  end if;

  if owner_summary ?| array[
    'state', 'session', 'player_a_user_id', 'player_b_user_id',
    'room_code_hash', 'private_parent_id'
  ] then
    raise exception 'safe summary exposed a restricted field';
  end if;

  perform set_config('request.jwt.claim.sub', viewer_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', viewer_id, 'role', 'authenticated')::text,
    true
  );

  select to_jsonb(summary) into viewer_summary
  from public.list_live_games('public', null) summary
  where summary.room_id = created.room_id;

  if viewer_summary is null
    or viewer_summary ->> 'viewer_role' <> 'Spectator'
    or (viewer_summary ->> 'can_manage')::boolean is not false
  then
    raise exception 'viewer did not receive the expected safe summary';
  end if;
end;
$smoke$;

rollback;
