-- Local/staging-only: the EXACT privileges of every object the bot catalog
-- (Phase 1) and plan timeline (Phase 2) migrations own. A grant that appears,
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
    'plan_catalog', 'plan_capability_defs', 'plan_capabilities', 'plan_passes', 'plan_segments'] loop
    select array_agg(a::text order by a::text) into actual
      from pg_class c, unnest(c.relacl) a
     where c.oid = ('public.' || obj)::regclass;
    if actual is distinct from array['postgres=arwdDxtm/postgres'] then
      problems := problems || format('table %s has %s; ', obj, actual);
    end if;
  end loop;
  foreach obj in array array['public.bot_catalog_audit_id_seq',
                             pg_get_serial_sequence('public.plan_passes', 'seq')] loop
    select array_agg(a::text order by a::text) into actual
      from pg_class c, unnest(c.relacl) a
     where c.oid = obj::regclass;
    if actual is distinct from array['postgres=rwU/postgres'] then
      problems := problems || format('sequence %s has %s; ', obj, actual);
    end if;
  end loop;

  -- Functions: exactly these roles may execute, besides the owner.
  for fn in
    select * from (values
      ('create_bot_game(uuid,text,text,jsonb,text,text,uuid,text,uuid)', '{authenticated}'),
      ('create_live_game(jsonb,text,text,uuid,text,uuid)', '{authenticated,service_role}'),
      ('create_live_game_core(jsonb,text,text,uuid,text,uuid,text,text)', '{}'),
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
         'plan_effective')
  loop
    if not (fn.proconfig @> array['search_path=public, pg_temp']) then
      problems := problems || format('%s search_path %s; ', fn.signature, fn.proconfig);
    end if;
  end loop;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
        and p.proname in ('derive_live_bot_config', 'freeze_live_bot_config', 'rebuild_plan_timeline',
                          'plan_effective', 'admin_grant_plan', 'get_my_plan')) <> 6 then
    problems := problems || 'an expected SECURITY DEFINER function is not definer; ';
  end if;

  if problems <> '' then
    raise exception 'privilege drift: %', problems;
  end if;
  raise notice 'plan and bot privileges are exactly as designed';
end
$priv$;

rollback;
