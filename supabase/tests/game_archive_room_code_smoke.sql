-- Local/staging smoke test for game_archives_migration.sql.
-- Prerequisites: the migration is applied, the private secret exists, and at
-- least two profiles have status = 'approved'. This test always rolls back.

begin;

do $smoke$
declare
  owner_id uuid;
  joiner_id uuid;
  created record;
  joined record;
  owner_code text;
  outsider_code text;
  known_code text;
  stored_hash text;
begin
  if has_schema_privilege('anon', 'private', 'USAGE')
    or has_schema_privilege('authenticated', 'private', 'USAGE')
  then
    raise exception 'client role can use the private schema';
  end if;

  if has_table_privilege('anon', 'private.runtime_secrets', 'SELECT')
    or has_table_privilege('anon', 'private.runtime_secrets', 'INSERT')
    or has_table_privilege('anon', 'private.runtime_secrets', 'UPDATE')
    or has_table_privilege('authenticated', 'private.runtime_secrets', 'SELECT')
    or has_table_privilege('authenticated', 'private.runtime_secrets', 'INSERT')
    or has_table_privilege('authenticated', 'private.runtime_secrets', 'UPDATE')
  then
    raise exception 'client role can read or mutate runtime secrets';
  end if;

  if has_function_privilege('anon', 'public.derive_live_room_code(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.derive_live_room_code(uuid)', 'EXECUTE')
  then
    raise exception 'client role can execute derive_live_room_code directly';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.create_live_game(jsonb,text,text,uuid,text,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.get_live_game_code(uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.join_live_game(text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'an authenticated room-code RPC grant is missing';
  end if;

  -- Pin the secret inside this rollback-only transaction and verify the actual
  -- PostgreSQL function against an OpenSSL-derived known vector.
  update private.runtime_secrets
  set value = '0123456789abcdef0123456789abcdef'
  where key = 'room_code_secret';

  known_code := public.derive_live_room_code('11111111-2222-4333-8444-555555555555');
  if known_code <> '38BA8FC799D7'
    or known_code <> public.derive_live_room_code('11111111-2222-4333-8444-555555555555')
    or known_code !~ '^[A-F0-9]{12}$'
  then
    raise exception 'deterministic HMAC room-code contract failed';
  end if;

  select id into owner_id
  from public.profiles
  where status = 'approved'
  order by created_at, id
  limit 1;

  select id into joiner_id
  from public.profiles
  where status = 'approved' and id <> owner_id
  order by created_at, id
  limit 1;

  if owner_id is null or joiner_id is null then
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
      'name', 'Room-code smoke test',
      'gameMode', 'versus',
      'roomStage', 'waiting',
      'players', jsonb_build_object('A', 'Owner', 'B', 'Joiner'),
      'playerUserIds', jsonb_build_object('A', owner_id),
      'scores', jsonb_build_object('A', 0, 'B', 0),
      'startingSide', 'A',
      'turnNumber', 1
    ),
    'public',
    'public',
    null,
    'code_only',
    null
  );

  owner_code := public.get_live_game_code(created.room_id);
  select room_code_hash into stored_hash
  from public.room_live
  where room_id = created.room_id;

  if owner_code is distinct from created.room_code
    or stored_hash is distinct from encode(extensions.digest(created.room_code, 'sha256'), 'hex')
  then
    raise exception 'create/get/hash room-code flow failed';
  end if;

  perform set_config('request.jwt.claim.sub', joiner_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', joiner_id, 'role', 'authenticated')::text,
    true
  );

  outsider_code := public.get_live_game_code(created.room_id);
  if outsider_code is not null then
    raise exception 'non-participant received a live room code';
  end if;

  select * into joined
  from public.join_live_game(created.room_code, null);

  if joined.room_id is distinct from created.room_id
    or joined.claimed_side is distinct from 'B'
    or public.get_live_game_code(created.room_id) is distinct from created.room_code
  then
    raise exception 'join/get room-code flow failed';
  end if;

  delete from private.runtime_secrets where key = 'room_code_secret';
  begin
    perform public.derive_live_room_code(gen_random_uuid());
    raise exception 'missing room_code_secret did not fail preflight';
  exception when sqlstate '55000' then
    null;
  end;
end;
$smoke$;

rollback;
