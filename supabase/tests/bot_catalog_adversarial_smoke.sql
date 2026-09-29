-- Local/staging-only adversarial test for 20260927120000_bot_catalog.sql.
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bot_catalog_adversarial_smoke.sql
-- Tries to give a room bot behaviour without the catalog, and to rewrite a bot
-- room's frozen identity, as each role that can reach room_live. Rolls back.
-- The concurrent cases are in bot_catalog_race.sh.

begin;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role service_role';
end $$;

create function pg_temp.act_as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
end $$;

-- What a hostile client writes into a human room's state to look like a bot room.
create function pg_temp.forged_bot_state() returns jsonb language sql as $$
  select jsonb_build_object(
    'name', 'Survival test · seed 424242', 'gameMode', 'versus',
    'players', jsonb_build_object('A', 'Me', 'B', 'Authur'),
    'botSide', 'B', 'botEngine', 'authur', 'botDifficulty', 'super',
    'botKey', 'authur_strong', 'botAccessTier', 'pro', 'botExecutionType', 'SERVER')
$$;

insert into private.runtime_secrets (key, value)
values ('room_code_secret', repeat('s', 40))
on conflict (key) do nothing;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000000d1', 'adv-player@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000d2', 'adv-admin@example.test', 'authenticated', 'authenticated');
update public.profiles set status = 'approved'
 where id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2');
update public.profiles set is_admin = true where id = '00000000-0000-4000-8000-0000000000d2';

-- An approved Survival level whose room name the forged state imitates.
insert into public.survival_levels (
  season_key, level_no, seed, sample_policy, sample_count, win_count,
  immediate_winning_moves, shortest_winning_replay_turns, winning_replays,
  status, admin_note, approved_by, approved_at
) values (
  'adversarial', 99, 424242, 'test', 10, 5, 0, 6, '[1,2,3]'::jsonb,
  'approved', 'adversarial test level', '00000000-0000-4000-8000-0000000000d2', now()
);

grant execute on function pg_temp.act_as(uuid), pg_temp.act_as_service(),
  pg_temp.act_as_owner(), pg_temp.forged_bot_state()
  to authenticated, service_role;

do $adv$
declare
  player constant uuid := '00000000-0000-4000-8000-0000000000d1';
  admin_id constant uuid := '00000000-0000-4000-8000-0000000000d2';
  human record;
  bot record;
  room public.room_live%rowtype;
  ctx record;
  committed record;
  col text;
  level_id uuid := (select id from public.survival_levels where season_key = 'adversarial');
begin
  perform public.economy_post(player, 'probot_credit', 20, 'admin_grant', 'admin_request', 'adv', 'adv:p1:' || player, admin_id, 'adv');
  -- ── A. A human room cannot become a bot room ──────────────────────────────
  perform pg_temp.act_as(player);
  select * into human from public.create_live_game(
    jsonb_build_object('name', 'Friends', 'gameMode', 'versus',
      'players', jsonb_build_object('A', 'Me', 'B', 'Friend')),
    'public', 'public', null, 'invite_only', null);

  -- A1. owner rewrites the state blob through the configuration path
  perform public.update_live_game_state(human.room_id, pg_temp.forged_bot_state());
  -- A2. and through the command path, handing the turn to "the bot"
  select * into committed from public.commit_live_game_command(
    human.room_id, 0, 'adv-forge-1', 'A', '{"kind":"place"}'::jsonb,
    '{"activeSide":"B","turnNumber":2,"phase":"play"}'::jsonb, 'd1',
    pg_temp.forged_bot_state(), null);
  if committed.outcome <> 'committed' then raise exception 'setup commit failed'; end if;

  perform pg_temp.act_as_owner();
  select * into room from public.room_live where room_id = human.room_id;
  if room.bot_side is not null or room.bot_key is not null or room.bot_difficulty is not null
     or room.bot_access_tier is not null or room.bot_execution_type is not null
     or room.bot_config_version is not null then
    raise exception 'A: human room acquired bot columns';
  end if;
  if room.mode_key ~ '^(aether|authur)_' then
    raise exception 'A: human room acquired bot mode %', room.mode_key;
  end if;
  -- the forged fields sit in the state blob, and nothing authoritative reads them
  if room.state ->> 'botSide' <> 'B' then raise exception 'A: test did not reach the blob'; end if;

  perform pg_temp.act_as(player);
  select * into ctx from public.get_live_game_engine_context(human.room_id);
  if ctx.bot_side is not null or ctx.bot_difficulty is not null or ctx.active_side_is_bot
     or ctx.mode_key ~ '^(aether|authur)_' then
    raise exception 'A: engine context treats the human room as a bot room';
  end if;
  if exists (select 1 from public.get_game_mode_tools(ctx.mode_key) where tool_key = 'bot_insight') then
    raise exception 'A: human room unlocked bot tools';
  end if;
  -- the Survival policy trusts mode_key = authur_strong: a forged attempt must fail
  begin
    insert into public.survival_attempts (level_id, room_id, player_id)
    values (level_id, human.room_id, player);
    raise exception 'EXPECTED: forged Survival attempt accepted';
  exception when insufficient_privilege then null;
  end;
  -- a bot-side command in a human room is just a human command: no bot gate applies
  -- (the owner of a pass-and-play room already controls both sides)

  -- ── B. Direct UPDATEs by the browser role: no privilege at all ────────────
  perform pg_temp.act_as(player);
  select * into bot from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B',
    pg_temp.forged_bot_state(), 'public', 'public', null, 'invite_only', null, 'credit');
  foreach col in array array['bot_key', 'bot_access_tier', 'bot_execution_type',
                             'bot_config_version', 'bot_side', 'bot_difficulty',
                             'mode_key', 'state', 'game_mode'] loop
    begin
      execute format('update public.room_live set %I = %I where room_id = %L', col, col, bot.room_id);
      raise exception 'EXPECTED: authenticated updated room_live.%', col;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    insert into public.room_live (room_id, owner_id, name, player_a, player_b, status,
      access_scope, archive_policy, join_policy, room_code_hash, game_mode, mode_key,
      starting_side, turn_number, score_a, score_b, state, created_at, last_activity_at,
      updated_at, bot_side, bot_key)
    values (gen_random_uuid(), player, 'x', 'A', 'B', 'playing', 'public', 'public',
      'invite_only', 'x', 'versus', 'authur_strong', 'A', 1, 0, 0, '{}', now(), now(), now(),
      'B', 'authur_strong');
    raise exception 'EXPECTED: authenticated inserted into room_live';
  exception when insufficient_privilege then null;
  end;
  -- the configuration RPC cannot move a bot room's mode either
  -- (the player's seat is kept: vacating a bot room's seat is refused on its own)
  perform public.update_live_game_state(bot.room_id,
    pg_temp.forged_bot_state() || '{"botEngine":"aether","botDifficulty":"max"}'::jsonb
      || jsonb_build_object('playerUserIds', jsonb_build_object('A', player::text)));

  perform pg_temp.act_as_owner();
  select * into room from public.room_live where room_id = bot.room_id;
  if room.mode_key <> 'authur_strong' or room.bot_difficulty <> 'super'
     or room.bot_access_tier <> 'pro' or room.bot_execution_type <> 'SERVER' then
    raise exception 'B: bot room identity moved: % % % %',
      room.mode_key, room.bot_difficulty, room.bot_access_tier, room.bot_execution_type;
  end if;

  -- ── C. service_role (has ALL on room_live): the trigger binds it ──────────
  perform pg_temp.act_as_service();
  foreach col in array array['bot_key', 'bot_access_tier', 'bot_execution_type',
                             'bot_config_version', 'bot_side', 'bot_difficulty', 'mode_key'] loop
    begin
      execute format(
        'update public.room_live set %I = %s where room_id = %L', col,
        case col
          when 'bot_key' then quote_literal('aether_max')
          when 'bot_access_tier' then quote_literal('free')
          when 'bot_execution_type' then quote_literal('CLIENT_WASM')
          when 'bot_config_version' then '9'
          when 'bot_side' then quote_literal('A')
          when 'bot_difficulty' then quote_literal('hard')
          else quote_literal('hosted_versus') -- mode_key: any change, even to a human mode
        end,
        bot.room_id);
      raise exception 'EXPECTED: service_role rewrote room_live.%', col;
    exception when others then
      -- bot_key -> aether_* also trips the older Aether-retirement trigger first
      if sqlerrm <> 'bot configuration is fixed for the life of a game'
         and not (col = 'bot_key' and sqlerrm = 'Aether is retired; create an Authur room.') then
        raise;
      end if;
    end;
  end loop;
  begin
    update public.room_live set mode_key = 'authur_strong' where room_id = human.room_id;
    raise exception 'EXPECTED: service_role gave a human room a bot mode';
  exception when others then
    if sqlerrm not like 'bot_room_requires_catalog%' then raise; end if;
  end;
  begin
    update public.room_live set bot_side = 'B', bot_difficulty = 'super' where room_id = human.room_id;
    raise exception 'EXPECTED: service_role gave a human room a bot side';
  exception when others then
    if sqlerrm <> 'bot configuration is fixed for the life of a game' then raise; end if;
  end;
  -- human-to-human mode changes still work
  update public.room_live set mode_key = 'hosted_versus' where room_id = human.room_id;
  -- Phase 3: service_role may not insert rooms at all (every room is made by
  -- a creation RPC, which charges it)
  begin
    insert into public.room_live (room_id, owner_id, name, player_a, player_b, status,
      access_scope, archive_policy, join_policy, room_code_hash, game_mode, mode_key,
      starting_side, state, bot_side, bot_key)
    values (gen_random_uuid(), player, 'x', 'A', 'B', 'playing', 'public', 'public',
      'invite_only', 'x', 'versus', 'authur_strong', 'A', '{}', 'B', 'authur_strong');
    raise exception 'EXPECTED: service_role inserted a room';
  exception when insufficient_privilege then null;
  end;
  -- the table owner's direct insert must name a catalog bot, and gets the catalog's config
  perform pg_temp.act_as_owner();
  begin
    insert into public.room_live (room_id, owner_id, name, player_a, player_b, status,
      access_scope, archive_policy, join_policy, room_code_hash, game_mode, mode_key,
      starting_side, turn_number, score_a, score_b, state, created_at, last_activity_at,
      updated_at, bot_side, bot_difficulty)
    values (gen_random_uuid(), player, 'x', 'A', 'B', 'playing', 'public', 'public',
      'invite_only', 'x', 'versus', 'authur_strong', 'A', 1, 0, 0, pg_temp.forged_bot_state(),
      now(), now(), now(), 'B', 'super');
    raise exception 'EXPECTED: a bot room inserted without the catalog';
  exception when others then
    if sqlerrm not like 'bot_room_requires_catalog%' then raise; end if;
  end;
  insert into public.room_live (room_id, owner_id, name, player_a, player_b, status,
    access_scope, archive_policy, join_policy, room_code_hash, game_mode, mode_key,
    starting_side, turn_number, score_a, score_b, state, created_at, last_activity_at,
    updated_at, bot_side, bot_key, bot_difficulty, bot_access_tier, bot_execution_type)
  values ('00000000-0000-4000-8000-0000000000f1', player, 'x', 'A', 'B', 'playing', 'public',
    'public', 'invite_only', 'x', 'versus', 'local_versus', 'A', 1, 0, 0, '{}', now(), now(),
    now(), 'B', 'authur_strong', 'hard', 'pro', 'CLIENT_WASM');
  select * into room from public.room_live where room_id = '00000000-0000-4000-8000-0000000000f1';
  if room.bot_difficulty <> 'super' or room.bot_access_tier <> 'pro'
     or room.bot_execution_type <> 'SERVER' or room.mode_key <> 'authur_strong' then
    raise exception 'C: direct insert kept caller-supplied bot config';
  end if;

  -- ── D. The table owner: bound by the trigger in normal DML… ───────────────
  begin
    update public.room_live set bot_access_tier = 'free' where room_id = bot.room_id;
    raise exception 'EXPECTED: owner DML rewrote a frozen column';
  exception when others then
    if sqlerrm <> 'bot configuration is fixed for the life of a game' then raise; end if;
  end;
  -- …but NOT against itself disabling the trigger. This is the documented,
  -- trusted maintenance path, asserted here so the claim stays honest.
  alter table public.room_live disable trigger room_live_bot_config_frozen;
  update public.room_live set bot_access_tier = 'free' where room_id = bot.room_id;
  if (select bot_access_tier from public.room_live where room_id = bot.room_id) <> 'free' then
    raise exception 'D: expected the owner to be able to bypass a disabled trigger';
  end if;
  alter table public.room_live enable trigger room_live_bot_config_frozen;
end
$adv$;

-- ── E. Admin catalog edits never reach frozen room config ───────────────────
do $admin$
declare
  player constant uuid := '00000000-0000-4000-8000-0000000000d1';
  admin_id constant uuid := '00000000-0000-4000-8000-0000000000d2';
  bot record;
  ctx record;
  committed record;
begin
  perform pg_temp.act_as(player);
  select * into bot from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B',
    pg_temp.forged_bot_state(), 'public', 'public', null, 'invite_only', null, 'credit');
  perform pg_temp.act_as(admin_id);
  perform public.admin_upsert_bot('authur_strong', 'Authur', 'authur', 'super', 'authur_strong',
    'HYBRID', 'pro', true, 10, 'adversarial reclassify');
  perform pg_temp.act_as_owner();
  if (select bot_access_tier || '/' || bot_execution_type || '/' || bot_config_version
        from public.room_live where room_id = bot.room_id) <> 'pro/SERVER/2' then
    raise exception 'E: a catalog edit changed an existing room';
  end if;

  -- ── F. Disable during a bot turn: the computed move cannot commit ──────────
  perform pg_temp.act_as(player);
  select * into committed from public.commit_live_game_command(
    bot.room_id, 0, 'adv-f-1', 'A', '{"kind":"place"}'::jsonb,
    '{"activeSide":"B","turnNumber":2,"phase":"play"}'::jsonb, 'df1', null, null);
  select * into ctx from public.get_live_game_engine_context(bot.room_id); -- engine starts: allowed
  if not ctx.active_side_is_bot then raise exception 'F: setup'; end if;
  perform pg_temp.act_as(admin_id);
  perform public.admin_set_bot_enabled('authur_strong', false, 'adversarial race');
  perform pg_temp.act_as(player);
  begin
    perform * from public.commit_live_game_command(
      bot.room_id, 1, 'adv-f-bot', 'B', '{"kind":"place"}'::jsonb,
      '{"activeSide":"A","turnNumber":3,"phase":"play"}'::jsonb, 'df2', null, null);
    raise exception 'EXPECTED: move computed before the disable was committed after it';
  exception when others then
    if sqlerrm not like 'bot_disabled:%' then raise; end if;
  end;
  -- the retry of that same command id is refused too, not reported as a duplicate
  begin
    perform * from public.commit_live_game_command(
      bot.room_id, 1, 'adv-f-bot', 'B', '{"kind":"place"}'::jsonb,
      '{"activeSide":"A","turnNumber":3,"phase":"play"}'::jsonb, 'df2', null, null);
    raise exception 'EXPECTED: retried bot command committed while disabled';
  exception when others then
    if sqlerrm not like 'bot_disabled:%' then raise; end if;
  end;
  -- the branching path goes through the same gate
  begin
    perform * from public.commit_live_game_timeline(
      bot.room_id, 1, 'adv-f-branch', 'B', '{"kind":"place"}'::jsonb,
      '{"activeSide":"A","turnNumber":3,"phase":"play"}'::jsonb, 'df3',
      '{"timelineRef":{"version":1}}'::jsonb, null, '{"v":1,"lines":[]}'::jsonb, 0);
    raise exception 'EXPECTED: branch commit on a disabled bot turn';
  exception when others then
    if sqlerrm not like 'bot_disabled:%' then raise; end if;
  end;
  perform pg_temp.act_as_owner();
  if (select revision from public.room_live where room_id = bot.room_id) <> 1 then
    raise exception 'F: a refused command moved the revision';
  end if;

  raise notice 'bot catalog adversarial smoke test passed';
end
$admin$;

rollback;
