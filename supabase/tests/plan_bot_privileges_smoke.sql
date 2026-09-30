-- Local/staging-only: the EXACT privileges of every object the bot catalog
-- (Phase 1), plan timeline (Phase 2) and economy / boards / Stage (Phase 3)
-- migrations own. A grant that appears,
-- or disappears, fails this test. Read-only; rolls back.
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/plan_bot_privileges_smoke.sql

begin;

do $priv$
declare
  obj text;
  expected text[];
  actual text[];
  fn record;
  problems text := '';
begin
  -- Tables and sequences: the owner only. No API role, not even service_role.
  foreach obj in array array[
    'bot_catalog', 'bot_catalog_audit', 'room_creation_requests',
    'plan_catalog', 'plan_capability_defs', 'plan_capabilities', 'plan_passes', 'plan_segments',
    'economy_entries', 'economy_balances', 'probot_allowance_state', 'probot_consumptions',
    'bot_stat_folders', 'bot_stat_games'] loop
    select array_agg(a::text order by a::text) into actual
      from pg_class c, unnest(c.relacl) a
     where c.oid = ('public.' || obj)::regclass;
    if actual is distinct from array['postgres=arwdDxtm/postgres'] then
      problems := problems || format('table %s has %s; ', obj, actual);
    end if;
  end loop;
  foreach obj in array array['public.bot_catalog_audit_id_seq',
                             pg_get_serial_sequence('public.plan_passes', 'seq'),
                             pg_get_serial_sequence('public.economy_entries', 'seq'),
                             pg_get_serial_sequence('public.probot_consumptions', 'seq')] loop
    select array_agg(a::text order by a::text) into actual
      from pg_class c, unnest(c.relacl) a
     where c.oid = obj::regclass;
    if actual is distinct from array['postgres=rwU/postgres'] then
      problems := problems || format('sequence %s has %s; ', obj, actual);
    end if;
  end loop;

  -- Tables an API role may touch, exactly.
  for fn in
    select * from (values
      ('system_settings', '{postgres=arwdDxtm/postgres,service_role=rm/postgres}'),
      ('room_live', '{postgres=arwdDxtm/postgres,service_role=rwdm/postgres}'),
      ('ranked_matches', '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'),
      ('survival_levels', '{postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=r/postgres}'),
      ('survival_attempts', '{postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=r/postgres}')
    ) as v(tbl, acl)
  loop
    select array_agg(a::text order by a::text) into actual
      from pg_class c, unnest(c.relacl) a where c.oid = ('public.' || fn.tbl)::regclass;
    if actual is distinct from (select array_agg(x order by x) from unnest(fn.acl::text[]) x) then
      problems := problems || format('table %s has %s; ', fn.tbl, actual);
    end if;
  end loop;
  -- Stage terminal capture removed the old browser result writes entirely.
  select array_agg(attname || '=' || a::text order by attname, a::text) into actual
    from pg_attribute, unnest(attacl) a
   where attrelid = 'public.survival_attempts'::regclass and attacl is not null;
  if actual is not null then
    problems := problems || format('survival_attempts columns %s; ', actual);
  end if;
  if exists (select 1 from pg_attribute, unnest(attacl) a
              where attrelid = 'public.survival_levels'::regclass
                and ((attname in ('start_canonical', 'start_sealed_at', 'start_sealed_by') and a::text ~ '=[a-z]*[aw]')
                  or (attname = 'seed' and a::text ~ '=[a-z]*w'))) then
    problems := problems || 'survival_levels seed/start is writable by an API role; ';
  end if;
  if exists (select 1 from pg_attribute, unnest(attacl) a
              where attrelid = 'public.room_live'::regclass and a::text like 'authenticated=%w%') then
    problems := problems || 'room_live has a browser-writable column; ';
  end if;

  -- Functions: exactly these roles may execute, besides the owner.
  for fn in
    select * from (values
      ('create_bot_game(uuid,text,text,jsonb,text,text,uuid,text,uuid,text)', '{authenticated}'),
      ('create_live_game(jsonb,text,text,uuid,text,uuid)', '{authenticated}'),
      ('create_live_game_core(jsonb,text,text,uuid,text,uuid,text,text,text,uuid)', '{}'),
      ('commit_live_game_command(uuid,bigint,text,text,jsonb,jsonb,text,jsonb,jsonb)', '{authenticated}'),
      ('finalize_live_game(uuid,jsonb,text,text,text)', '{authenticated,service_role}'),
      -- Phase 3: economy
      ('protect_economy_fact()', '{}'),
      ('bangkok_week_start(timestamptz)', '{}'),
      ('plan_capability_int(text,text)', '{}'),
      ('plan_epoch_start(uuid,timestamptz,text)', '{}'),
      ('probot_now(uuid)', '{}'),
      ('probot_allowance_at(uuid,timestamptz)', '{}'),
      ('economy_post(uuid,text,integer,text,text,text,text,uuid,text)', '{}'),
      ('probot_charge(uuid,uuid,uuid,text,text,timestamptz)', '{}'),
      ('admin_grant_credits(uuid,integer,text,uuid)', '{authenticated}'),
      ('probot_status_for(uuid)', '{}'),
      ('get_my_probot_status()', '{authenticated}'),
      ('admin_get_user_economy(uuid)', '{authenticated}'),
      -- Phase 3: boards
      ('active_board_limit()', '{}'),
      ('room_counts_as_board(text,timestamptz,timestamptz)', '{}'),
      ('ranked_counts_as_board(text,timestamptz,timestamptz)', '{}'),
      ('active_board_count(uuid,timestamptz,uuid,uuid)', '{}'),
      ('lock_board_users(uuid[])', '{}'),
      ('assert_board_capacity(uuid[],timestamptz,uuid,uuid)', '{}'),
      ('enforce_room_board_limit()', '{}'),
      ('enforce_ranked_board_limit()', '{}'),
      ('freeze_bot_room_seats()', '{}'),
      ('admin_set_active_board_limit(integer,text)', '{authenticated}'),
      -- Phase 3: Stage
      ('check_stage_commit(room_live,jsonb)', '{}'),
      ('admin_seal_stage_start(uuid,jsonb)', '{authenticated}'),
      ('create_stage_attempt(uuid,uuid,jsonb)', '{authenticated}'),
      -- Phase 3: statistics (admin reads; recording is server-side only)
      ('record_bot_stat_from_room(room_live,text,text)', '{}'),
      ('record_bot_game(text,uuid,text,text,text,text,integer,integer,text,integer,timestamptz)', '{authenticated}'),
      ('record_bot_game_v2(text,uuid,text,text,text,text,text,integer,integer,text,integer,timestamptz)', '{authenticated}'),
      ('bot_folder_open_id()', '{}'),
      ('create_bot_folder(text,boolean)', '{authenticated}'),
      ('open_bot_folder(uuid)', '{authenticated}'),
      ('close_bot_folder(uuid)', '{authenticated}'),
      ('admin_list_bot_stat_folders()', '{authenticated}'),
      ('admin_list_bot_stat_games(uuid)', '{authenticated}'),
      ('admin_delete_bot_stat_folder(uuid)', '{authenticated}'),
      ('get_live_game_engine_context(uuid)', '{authenticated}'),
      ('list_bots()', '{authenticated}'),
      ('admin_list_bots()', '{authenticated}'),
      ('admin_set_bot_enabled(text,boolean,text)', '{authenticated}'),
      ('admin_upsert_bot(text,text,text,text,text,text,text,boolean,integer,text)', '{authenticated}'),
      ('derive_live_bot_config()', '{}'),
      ('freeze_live_bot_config()', '{}'),
      ('get_my_plan(timestamptz)', '{authenticated}'),
      ('get_my_plan_timeline()', '{authenticated}'),
      ('admin_grant_plan(uuid,text,integer,text,uuid)', '{authenticated}'),
      ('admin_revoke_pass(uuid,text)', '{authenticated}'),
      ('admin_get_user_plan(uuid,timestamptz)', '{authenticated}'),
      ('plan_add_months(timestamptz,integer)', '{}'),
      ('plan_capability_value_ok(text,jsonb)', '{}'),
      ('check_plan_capability_value()', '{}'),
      ('protect_plan_pass()', '{}'),
      ('write_plan_segment(uuid,text,timestamptz,timestamptz,timestamptz,integer)', '{}'),
      ('rebuild_plan_timeline(uuid)', '{}'),
      ('plan_capability(text,text)', '{}'),
      ('plan_effective(uuid,timestamptz)', '{}')
    ) as v(signature, grantees)
  loop
    select coalesce(array_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end
                              order by 1), '{}')
      into actual
      from pg_proc p, aclexplode(p.proacl) a
     where p.oid = ('public.' || fn.signature)::regprocedure
       and a.privilege_type = 'EXECUTE'
       and a.grantee <> p.proowner;
    if actual is distinct from fn.grantees::text[] then
      problems := problems || format('function %s executable by %s (expected %s); ', fn.signature, actual, fn.grantees);
    end if;
  end loop;

  -- Every SECURITY DEFINER function these phases added or replaced pins its
  -- search_path with pg_temp last.
  for fn in
    select p.oid::regprocedure::text as signature, p.proconfig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prosecdef
       and p.proname in ('create_bot_game', 'create_live_game', 'create_live_game_core',
         'get_live_game_engine_context', 'commit_live_game_command', 'update_live_game_state',
         'join_live_game', 'list_bots', 'admin_list_bots', 'admin_set_bot_enabled',
         'admin_upsert_bot', 'derive_live_bot_config', 'freeze_live_bot_config',
         'get_my_plan', 'get_my_plan_timeline', 'admin_grant_plan', 'admin_revoke_pass',
         'admin_get_user_plan', 'plan_capability_value_ok', 'check_plan_capability_value',
         'protect_plan_pass', 'write_plan_segment', 'rebuild_plan_timeline', 'plan_capability',
         'plan_effective', 'finalize_live_game', 'protect_economy_fact', 'plan_capability_int',
         'plan_epoch_start', 'probot_now', 'probot_allowance_at', 'economy_post', 'probot_charge',
         'admin_grant_credits', 'probot_status_for', 'get_my_probot_status', 'admin_get_user_economy',
         'active_board_limit', 'active_board_count', 'lock_board_users', 'assert_board_capacity',
         'enforce_room_board_limit', 'enforce_ranked_board_limit', 'freeze_bot_room_seats',
         'admin_set_active_board_limit', 'check_stage_commit', 'admin_seal_stage_start',
         'create_stage_attempt', 'record_bot_stat_from_room', 'bot_folder_open_id', 'create_bot_folder',
         'open_bot_folder', 'close_bot_folder', 'admin_list_bot_stat_folders', 'admin_list_bot_stat_games',
         'admin_delete_bot_stat_folder')
  loop
    if not (fn.proconfig @> array['search_path=public, pg_temp']) then
      problems := problems || format('%s search_path %s; ', fn.signature, fn.proconfig);
    end if;
  end loop;
  -- The client-callable legacy stat recorders are inert invoker no-ops.
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname in ('record_bot_game', 'record_bot_game_v2') and p.prosecdef) then
    problems := problems || 'a legacy stat recorder is SECURITY DEFINER; ';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
        and p.proname in ('derive_live_bot_config', 'freeze_live_bot_config', 'rebuild_plan_timeline',
                          'plan_effective', 'admin_grant_plan', 'get_my_plan', 'probot_charge',
                          'economy_post', 'create_stage_attempt', 'create_bot_game')) <> 10 then
    problems := problems || 'an expected SECURITY DEFINER function is not definer; ';
  end if;

  if problems <> '' then
    raise exception 'privilege drift: %', problems;
  end if;
  raise notice 'plan and bot privileges are exactly as designed';
end
$priv$;

rollback;
