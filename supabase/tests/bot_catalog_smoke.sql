-- Local/staging-only smoke test for 20260927120000_bot_catalog.sql.
-- Run against a local Supabase built from supabase/migrations:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bot_catalog_smoke.sql
-- Creates its own users and always rolls back. Never run it against production.

begin;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
end $$;

create function pg_temp.act_as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
end $$;

-- A bot room as the client builds it: the owner on A, the bot on B.
create function pg_temp.bot_state(extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'name', 'Smoke vs Authur', 'gameMode', 'versus', 'startingSide', 'A',
    'players', jsonb_build_object('A', 'Smoke', 'B', 'Authur'),
    'botSide', 'B', 'botEngine', 'authur', 'botDifficulty', 'super',
    'turnNumber', 1, 'scores', jsonb_build_object('A', 0, 'B', 0)
  ) || extra
$$;

insert into private.runtime_secrets (key, value)
values ('room_code_secret', repeat('s', 40))
on conflict (key) do nothing;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000000a', 'smoke-player@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'smoke-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000c', 'smoke-pending@example.test', 'authenticated', 'authenticated');
update public.profiles set status = 'approved'
 where id in ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');
update public.profiles set is_admin = true where id = '00000000-0000-4000-8000-00000000000b';

do $smoke$
declare
  player constant uuid := '00000000-0000-4000-8000-00000000000a';
  admin_id constant uuid := '00000000-0000-4000-8000-00000000000b';
  pending constant uuid := '00000000-0000-4000-8000-00000000000c';
  request_one constant uuid := '11111111-1111-4111-8111-111111111111';
  created record;
  replay record;
  human record;
  room public.room_live%rowtype;
  ctx record;
  committed record;
  n bigint;
  stats_before bigint;
  stats_after bigint;
begin
  -- ── 1. Grants ─────────────────────────────────────────────────────────────
  if has_function_privilege('anon', 'public.create_live_game(jsonb,text,text,uuid,text,uuid)', 'EXECUTE') then
    raise exception 'anon can execute create_live_game';
  end if;
  if has_function_privilege('anon', 'public.create_bot_game(uuid,text,text,jsonb,text,text,uuid,text,uuid,text)', 'EXECUTE') then
    raise exception 'anon can execute create_bot_game';
  end if;
  if not has_function_privilege('authenticated', 'public.create_bot_game(uuid,text,text,jsonb,text,text,uuid,text,uuid,text)', 'EXECUTE') then
    raise exception 'authenticated cannot execute create_bot_game';
  end if;
  if has_function_privilege('service_role', 'public.create_bot_game(uuid,text,text,jsonb,text,text,uuid,text,uuid,text)', 'EXECUTE') then
    raise exception 'service_role can execute create_bot_game';
  end if;
  if has_function_privilege('authenticated', 'public.create_live_game_core(jsonb,text,text,uuid,text,uuid,text,text,text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_live_game_core(jsonb,text,text,uuid,text,uuid,text,text,text,uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.create_live_game_core(jsonb,text,text,uuid,text,uuid,text,text,text,uuid)', 'EXECUTE') then
    raise exception 'an API role can call create_live_game_core directly';
  end if;
  if has_function_privilege('anon', 'public.get_live_game_engine_context(uuid)', 'EXECUTE') then
    raise exception 'anon can execute get_live_game_engine_context';
  end if;
  if has_function_privilege('anon', 'public.list_bots()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_set_bot_enabled(text,boolean,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_upsert_bot(text,text,text,text,text,text,text,boolean,integer,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_list_bots()', 'EXECUTE') then
    raise exception 'anon can execute a bot catalog function';
  end if;
  if has_function_privilege('authenticated', 'public.derive_live_bot_config()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.freeze_live_bot_config()', 'EXECUTE') then
    raise exception 'authenticated can execute a bot trigger function';
  end if;
  if has_table_privilege('authenticated', 'public.bot_catalog', 'SELECT')
     or has_table_privilege('authenticated', 'public.bot_catalog', 'UPDATE')
     or has_table_privilege('authenticated', 'public.bot_catalog', 'INSERT')
     or has_table_privilege('authenticated', 'public.bot_catalog_audit', 'SELECT')
     or has_table_privilege('authenticated', 'public.room_creation_requests', 'SELECT')
     or has_table_privilege('authenticated', 'public.room_creation_requests', 'INSERT')
     or has_table_privilege('anon', 'public.bot_catalog', 'SELECT') then
    raise exception 'an API role has direct access to a bot catalog table';
  end if;
  if has_table_privilege('authenticated', 'public.room_live', 'INSERT')
     or has_column_privilege('authenticated', 'public.room_live', 'bot_key', 'UPDATE')
     or has_column_privilege('authenticated', 'public.room_live', 'bot_access_tier', 'UPDATE') then
    raise exception 'authenticated can write room_live bot identity directly';
  end if;

  -- ── 2. Catalog (Phase 3 final state) ─────────────────────────────────────
  if not exists (select 1 from public.bot_catalog where bot_key = 'authur_strong'
                  and access_tier = 'pro' and access_tier_status = 'decided' and lifecycle = 'active'
                  and enabled and new_rooms_allowed and execution_type = 'SERVER') then
    raise exception 'Authur must be the active Pro server bot';
  end if;
  -- Phase 3b: ArchBot (key stage5b) is the active, open, free CLIENT bot.
  if not exists (select 1 from public.bot_catalog where bot_key = 'stage5b'
                  and display_name = 'ArchBot' and engine_family = 'stage5b'
                  and difficulty = 'stage5b64' and mode_key = 'stage5b_standard'
                  and access_tier = 'free' and execution_type = 'CLIENT' and lifecycle = 'active'
                  and enabled and new_rooms_allowed) then
    raise exception 'ArchBot must be the active, enabled, open, free CLIENT bot';
  end if;
  if (select label from public.game_modes where mode_key = 'stage5b_standard') <> 'ArchBot'
     or (select string_agg(t.tool_key, ',' order by t.tool_key)
           from public.game_mode_tools mt
           join public.game_modes m on m.id = mt.mode_id
           join public.game_tools t on t.id = mt.tool_id
          where m.mode_key = 'stage5b_standard') <> 'analysis,multiverse,replay,turn_log' then
    raise exception 'ArchBot rooms must offer turn log, replay, analysis and alternate lines, and no bot explanation';
  end if;

  -- A pending bot — the state ArchBot was in until Phase 3b — stays closed. A
  -- test-only row, removed again so the catalog counts below are unaffected.
  insert into public.bot_catalog (bot_key, display_name, engine_family, difficulty, mode_key,
    execution_type, access_tier, access_tier_status, enabled, new_rooms_allowed, lifecycle, sort_order)
  values ('smoke_pending', 'Smoke Pending', 'stage5b', 'stage5b64', 'stage5b_standard',
          'CLIENT', 'free', 'decided', false, false, 'pending', 98);
  begin
    update public.bot_catalog set new_rooms_allowed = true where bot_key = 'smoke_pending';
    raise exception 'EXPECTED: a pending bot was opened to new rooms';
  exception when check_violation then null;
  end;
  perform pg_temp.act_as(admin_id);
  begin
    perform public.admin_set_bot_enabled('smoke_pending', true, 'smoke');
    raise exception 'EXPECTED: a pending bot was enabled';
  exception when others then
    if sqlerrm not like 'bot_pending:%' then raise; end if;
  end;
  perform pg_temp.act_as(player);
  begin
    perform * from public.create_bot_game(gen_random_uuid(), 'smoke_pending', 'B', pg_temp.bot_state(),
      'public', 'public', null, 'invite_only', null, null);
    raise exception 'EXPECTED: a room was created with a pending bot';
  exception when others then
    if sqlerrm not like 'bot_pending:%' then raise; end if;
  end;
  perform pg_temp.act_as_owner();
  delete from public.bot_catalog where bot_key = 'smoke_pending';
  if exists (select 1 from public.bot_catalog
              where bot_key like 'aether_%' and (new_rooms_allowed or lifecycle <> 'retired')) then
    raise exception 'Aether must be retired and closed to new rooms';
  end if;

  -- ── 3. The old path refuses a bot room from the state blob ───────────────
  perform pg_temp.act_as(player);
  begin
    perform * from public.create_live_game(pg_temp.bot_state(), 'public', 'public', null, 'invite_only', null);
    raise exception 'EXPECTED: create_live_game accepted a bot room';
  exception when others then
    if sqlerrm not like 'bot_room_requires_catalog%' then raise; end if;
  end;

  -- anon cannot create anything
  perform pg_temp.act_as_anon();
  begin
    perform * from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B', pg_temp.bot_state(),
      'public', 'public', null, 'invite_only', null, 'credit');
    raise exception 'EXPECTED: anon created a bot room';
  exception when insufficient_privilege then null;
  end;

  -- an unapproved account cannot create a bot room
  perform pg_temp.act_as(pending);
  begin
    perform * from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B', pg_temp.bot_state(),
      'public', 'public', null, 'invite_only', null, 'credit');
    raise exception 'EXPECTED: unapproved account created a bot room';
  exception when others then
    if sqlerrm <> 'approved membership required' then raise; end if;
  end;

  -- ── 4. Tampering: the client's bot fields are ignored ────────────────────
  perform pg_temp.act_as_owner();
  -- Authur is Pro (Phase 3): these rooms are paid with Credits.
  perform public.economy_post(player, 'probot_credit', 20, 'admin_grant', 'admin_request', 'smoke', 'smoke:p1:' || player, admin_id, 'smoke');
  perform public.economy_post(admin_id, 'probot_credit', 20, 'admin_grant', 'admin_request', 'smoke', 'smoke:p1:' || admin_id, admin_id, 'smoke');
  select count(*) into stats_before from public.room_live;
  perform pg_temp.act_as(player);
  select * into created from public.create_bot_game(
    request_one, 'authur_strong', 'B',
    pg_temp.bot_state(jsonb_build_object(
      'botSide', 'A', 'botEngine', 'aether', 'botDifficulty', 'hard',
      'botAccessTier', 'pro', 'botExecutionType', 'CLIENT_WASM')),
    'public', 'public', null, 'invite_only', null, 'credit');
  if created.replayed then raise exception 'first creation reported as a replay'; end if;

  perform pg_temp.act_as_owner();
  select * into room from public.room_live where room_id = created.room_id;
  if room.bot_key <> 'authur_strong' or room.bot_side <> 'B'
     or room.bot_difficulty <> 'super' or room.mode_key <> 'authur_strong'
     or room.bot_access_tier <> 'pro' or room.bot_execution_type <> 'SERVER'
     or room.bot_config_version <> 2 then
    raise exception 'room did not freeze the catalog config: % % % % % % %',
      room.bot_key, room.bot_side, room.bot_difficulty, room.mode_key,
      room.bot_access_tier, room.bot_execution_type, room.bot_config_version;
  end if;
  if room.state ->> 'botEngine' <> 'authur' or room.state ->> 'botDifficulty' <> 'super'
     or room.state ->> 'botSide' <> 'B' then
    raise exception 'state blob kept client bot fields: %', room.state;
  end if;
  if room.owner_id <> player or room.player_a_user_id <> player then
    raise exception 'owner was not seated opposite the bot';
  end if;

  -- a naming a bot that does not exist, a retired bot, or no side
  perform pg_temp.act_as(player);
  begin
    perform * from public.create_bot_game(gen_random_uuid(), 'authur_ultra', 'B', pg_temp.bot_state(),
      'public', 'public', null, 'invite_only', null, 'credit');
    raise exception 'EXPECTED: unknown bot accepted';
  exception when others then
    if sqlerrm <> 'unknown bot' then raise; end if;
  end;
  begin
    perform * from public.create_bot_game(gen_random_uuid(), 'aether_max', 'B', pg_temp.bot_state(),
      'public', 'public', null, 'invite_only', null, 'credit');
    raise exception 'EXPECTED: retired Aether accepted';
  exception when others then
    if sqlerrm not like 'bot_closed%' then raise; end if;
  end;
  begin
    perform * from public.create_bot_game(gen_random_uuid(), 'authur_strong', null, pg_temp.bot_state(),
      'public', 'public', null, 'invite_only', null, 'credit');
    raise exception 'EXPECTED: bot room without a side accepted';
  exception when others then
    if sqlerrm <> 'a bot room must name the side the bot plays' then raise; end if;
  end;

  -- the frozen identity cannot be rewritten afterwards, even by the table owner
  perform pg_temp.act_as_owner();
  begin
    update public.room_live set bot_access_tier = 'free' where room_id = created.room_id;
    raise exception 'EXPECTED: bot tier rewritten';
  exception when others then
    if sqlerrm <> 'bot configuration is fixed for the life of a game' then raise; end if;
  end;
  begin
    update public.room_live set bot_key = 'aether_max' where room_id = created.room_id;
    raise exception 'EXPECTED: bot key rewritten';
  exception when others then
    if sqlerrm <> 'bot configuration is fixed for the life of a game' then raise; end if;
  end;
  -- and a raw insert naming no catalog bot is refused by the trigger
  begin
    insert into public.room_live (room_id, owner_id, name, player_a, player_b, status,
      access_scope, archive_policy, join_policy, room_code_hash, game_mode, mode_key,
      starting_side, turn_number, score_a, score_b, state, created_at, last_activity_at,
      updated_at, bot_side, bot_difficulty)
    values (gen_random_uuid(), player, 'raw', 'A', 'B', 'playing', 'public', 'public',
      'invite_only', 'x', 'versus', 'authur_strong', 'A', 1, 0, 0,
      pg_temp.bot_state(), now(), now(), now(), 'B', 'super');
    raise exception 'EXPECTED: raw bot insert accepted';
  exception when others then
    if sqlerrm not like 'bot_room_requires_catalog%' then raise; end if;
  end;

  -- ── 5. Idempotency ────────────────────────────────────────────────────────
  select games_created into stats_before from public.user_mode_stats
   where profile_id = player and mode_key = 'authur_strong';
  perform pg_temp.act_as(player);
  select * into replay from public.create_bot_game(
    request_one, 'authur_strong', 'B', pg_temp.bot_state(),
    'public', 'public', null, 'invite_only', null, 'credit');
  if not replay.replayed or replay.room_id <> created.room_id or replay.room_code <> created.room_code then
    raise exception 'replay did not return the same room';
  end if;
  begin
    perform * from public.create_bot_game(request_one, 'aether_super', 'B', pg_temp.bot_state(),
      'public', 'public', null, 'invite_only', null, 'credit');
    raise exception 'EXPECTED: request id reused for another bot';
  exception when others then
    if sqlerrm not like 'idempotency_conflict:%' then raise; end if;
  end;
  perform pg_temp.act_as_owner();
  select count(*) into n from public.room_live where owner_id = player and bot_key is not null;
  if n <> 1 then raise exception 'idempotent retry created % bot rooms', n; end if;
  select count(*) into n from public.room_creation_requests where user_id = player;
  if n <> 1 then raise exception 'expected one creation request, found %', n; end if;
  select games_created into stats_after from public.user_mode_stats
   where profile_id = player and mode_key = 'authur_strong';
  if stats_after <> stats_before then raise exception 'a replay counted as a new game'; end if;
  -- another account's identical request id is a different request
  perform pg_temp.act_as(admin_id);
  select * into replay from public.create_bot_game(
    request_one, 'authur_strong', 'B', pg_temp.bot_state(),
    'public', 'public', null, 'invite_only', null, 'credit');
  if replay.replayed or replay.room_id = created.room_id then
    raise exception 'a request id was shared across accounts';
  end if;

  -- ── 6. Human rooms are unchanged ──────────────────────────────────────────
  perform pg_temp.act_as(player);
  select * into human from public.create_live_game(
    jsonb_build_object('name', 'Friends', 'gameMode', 'versus',
      'players', jsonb_build_object('A', 'Smoke', 'B', 'Friend')),
    'public', 'public', null, 'open', null);
  perform pg_temp.act_as_owner();
  if not exists (select 1 from public.room_live
                  where room_id = human.room_id and bot_key is null and bot_side is null
                    and mode_key = 'local_versus') then
    raise exception 'human room was not created as before';
  end if;

  -- (Phase 3: bot rooms are now funded and limited to 3 active boards; the
  -- economy suites test that. This suite keeps to catalog security.)
  perform pg_temp.act_as(player);

  -- ── 8. Hard disable ───────────────────────────────────────────────────────
  -- Put the created room on the bot's turn: the human's command hands over.
  select * into committed from public.commit_live_game_command(
    created.room_id, 0, 'smoke-human-1', 'A',
    '{"kind":"place"}'::jsonb, '{"activeSide":"B","turnNumber":2,"phase":"play"}'::jsonb,
    'digest-1', null, null);
  if committed.outcome <> 'committed' then raise exception 'human command did not commit'; end if;
  select * into ctx from public.get_live_game_engine_context(created.room_id);
  if not ctx.active_side_is_bot or ctx.bot_difficulty <> 'super' then
    raise exception 'engine context wrong on the bot turn';
  end if;

  -- a non-admin cannot disable
  begin
    perform public.admin_set_bot_enabled('authur_strong', false, 'nope');
    raise exception 'EXPECTED: player disabled a bot';
  exception when others then
    if sqlerrm <> 'admin access required' then raise; end if;
  end;

  perform pg_temp.act_as(admin_id);
  perform public.admin_set_bot_enabled('authur_strong', false, 'smoke test');

  perform pg_temp.act_as(player);
  begin
    perform * from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B', pg_temp.bot_state(),
      'public', 'public', null, 'invite_only', null, 'credit');
    raise exception 'EXPECTED: disabled bot accepted a new room';
  exception when others then
    if sqlerrm not like 'bot_disabled:%' then raise; end if;
  end;
  begin
    perform * from public.get_live_game_engine_context(created.room_id);
    raise exception 'EXPECTED: engine context served a disabled bot turn';
  exception when others then
    if sqlerrm not like 'bot_disabled:%' then raise; end if;
  end;
  begin
    perform * from public.commit_live_game_command(
      created.room_id, 1, 'smoke-bot-1', 'B',
      '{"kind":"place"}'::jsonb, '{"activeSide":"A","turnNumber":3,"phase":"play"}'::jsonb,
      'digest-2', null, null);
    raise exception 'EXPECTED: bot-side command committed while disabled';
  exception when others then
    if sqlerrm not like 'bot_disabled:%' then raise; end if;
  end;
  -- a modified client relabelling the bot move as the human's is refused too
  begin
    perform * from public.commit_live_game_command(
      created.room_id, 1, 'smoke-bot-1b', 'A',
      '{"kind":"place"}'::jsonb, '{"activeSide":"A","turnNumber":3,"phase":"play"}'::jsonb,
      'digest-2', null, null);
    raise exception 'EXPECTED: command on the bot turn committed while disabled';
  exception when others then
    if sqlerrm not like 'bot_disabled:%' then raise; end if;
  end;
  -- the room itself is untouched
  perform pg_temp.act_as_owner();
  if (select revision from public.room_live where room_id = created.room_id) <> 1 then
    raise exception 'a refused command moved the revision';
  end if;
  if not exists (select 1 from public.bot_catalog_audit
                  where bot_key = 'authur_strong' and action = 'disable' and actor_id = admin_id
                    and reason = 'smoke test') then
    raise exception 'disable was not audited';
  end if;

  -- ── 9. Re-enable: the same room continues ────────────────────────────────
  perform pg_temp.act_as(admin_id);
  perform public.admin_set_bot_enabled('authur_strong', true, 'smoke test done');
  perform pg_temp.act_as(player);
  select * into ctx from public.get_live_game_engine_context(created.room_id);
  if not ctx.active_side_is_bot then raise exception 'context not restored after re-enable'; end if;
  select * into committed from public.commit_live_game_command(
    created.room_id, 1, 'smoke-bot-2', 'B',
    '{"kind":"place"}'::jsonb, '{"activeSide":"A","turnNumber":3,"phase":"play"}'::jsonb,
    'digest-3', null, null);
  if committed.outcome <> 'committed' or committed.revision <> 2 then
    raise exception 'bot command did not commit after re-enable';
  end if;
  perform * from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B', pg_temp.bot_state(),
    'public', 'public', null, 'invite_only', null, 'credit');

  -- ── 10. Catalog reads and admin edits ─────────────────────────────────────
  select count(*) into n from public.list_bots();
  if n <> 7 then raise exception 'list_bots returned % rows', n; end if;
  begin
    perform * from public.admin_list_bots();
    raise exception 'EXPECTED: player listed admin bot data';
  exception when others then
    if sqlerrm <> 'admin access required' then raise; end if;
  end;
  perform pg_temp.act_as(admin_id);
  begin
    perform public.admin_upsert_bot('authur_strong', 'Authur', 'aether', 'max', 'aether_max',
      'SERVER', 'pro', true, 10, 'swap engine');
    raise exception 'EXPECTED: engine identity of an existing bot changed';
  exception when others then
    if sqlerrm <> 'engine family, difficulty and mode of an existing bot cannot change' then raise; end if;
  end;
  perform public.admin_upsert_bot('authur_strong', 'Authur', 'authur', 'super', 'authur_strong',
    'SERVER', 'pro', true, 10, 'rename only');
  perform pg_temp.act_as_owner();
  if (select config_version from public.bot_catalog where bot_key = 'authur_strong') <> 2
     or (select access_tier_status from public.bot_catalog where bot_key = 'authur_strong') <> 'decided' then
    raise exception 'a metadata-only edit changed the version or classification';
  end if;
  -- existing rooms keep the config they were created with
  if (select bot_config_version from public.room_live where room_id = created.room_id) <> 2 then
    raise exception 'room config version changed';
  end if;

  raise notice 'bot catalog smoke test passed';
end
$smoke$;

rollback;
