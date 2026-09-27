-- Local/staging-only adversarial test for 20260928120000_plan_timeline.sql.
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/plan_timeline_adversarial_smoke.sql
-- Tries to give an account Plus/Pro, or change plan facts, without the admin
-- API, as each role. Concurrent grants are in plan_timeline_race.sh. Rolls back.

begin;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.act_as_role(r text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', r)::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute format('set local role %I', r);
end $$;
create function pg_temp.act_as_owner() returns void language plpgsql as $$
begin execute 'reset role'; end $$;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-000000000301', 'plan-adv-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000302', 'plan-adv-user@example.test', 'authenticated', 'authenticated');
update public.profiles set status = 'approved'
 where id in ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000302');
update public.profiles set is_admin = true where id = '00000000-0000-4000-8000-000000000301';

do $adv$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000301';
  victim constant uuid := '00000000-0000-4000-8000-000000000302';
  pass uuid;
  stmt text;
  r text;
  fn text;
begin
  -- ── Privileges, asserted directly (RLS would also stop most writes) ───────
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    foreach fn in array array['plan_catalog', 'plan_capability_defs', 'plan_capabilities',
                              'plan_passes', 'plan_segments'] loop
      if has_table_privilege(r, 'public.' || fn,
           'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
        raise exception '% has a privilege on %', r, fn;
      end if;
    end loop;
    foreach fn in array array['plan_add_months(timestamptz,integer)', 'rebuild_plan_timeline(uuid)',
        'write_plan_segment(uuid,text,timestamptz,timestamptz,timestamptz,integer)',
        'plan_effective(uuid,timestamptz)', 'plan_capability(text,text)',
        'check_plan_capability_value()', 'protect_plan_pass()', 'plan_capability_value_ok(text,jsonb)'] loop
      if has_function_privilege(r, 'public.' || fn, 'EXECUTE') then
        raise exception '% can execute %', r, fn;
      end if;
    end loop;
  end loop;
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if has_sequence_privilege(r, pg_get_serial_sequence('public.plan_passes', 'seq'), 'USAGE, SELECT, UPDATE') then
      raise exception '% can use or move the pass recording sequence', r;
    end if;
  end loop;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname = 'admin_upgrade_plus_to_pro') then
    raise exception 'an upgrade RPC exists although the upgrade terms are undecided';
  end if;
  foreach fn in array array['get_my_plan(timestamptz)', 'get_my_plan_timeline()',
      'admin_grant_plan(uuid,text,integer,text,uuid)',
      'admin_revoke_pass(uuid,text)', 'admin_get_user_plan(uuid,timestamptz)'] loop
    if has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       or has_function_privilege('service_role', 'public.' || fn, 'EXECUTE')
       or not has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') then
      raise exception 'wrong grants on %', fn;
    end if;
  end loop;

  -- a real pass to aim at
  perform pg_temp.act_as(admin_id);
  select pass_id into pass from public.admin_grant_plan(victim, 'plus', 1, 'adversarial', gen_random_uuid());

  -- ── Browser and service roles: no table access at all ─────────────────────
  foreach r in array array['authenticated', 'anon', 'service_role'] loop
    if r = 'authenticated' then perform pg_temp.act_as(victim); else perform pg_temp.act_as_role(r); end if;
    foreach stmt in array array[
      format($q$insert into public.plan_passes (user_id, plan_key, kind, months, source, idempotency_key, activated_at, reason)
                values (%L, 'pro', 'grant', 120, 'admin', 'forged', now() - interval '1 day', 'forged')$q$, victim),
      format($q$update public.plan_passes set months = 120, activated_at = now() + interval '10 years' where id = %L$q$, pass),
      format($q$update public.plan_passes set revoked_at = now(), revoke_reason = 'x' where id = %L$q$, pass),
      format($q$delete from public.plan_passes where id = %L$q$, pass),
      format($q$insert into public.plan_segments (user_id, plan_key, starts_at, ends_at, chain_anchor, chain_months)
                values (%L, 'pro', now(), now() + interval '100 years', now(), 1200)$q$, victim),
      format($q$update public.plan_segments set ends_at = ends_at + interval '10 years' where user_id = %L$q$, victim),
      format($q$delete from public.plan_segments where user_id = %L$q$, victim),
      $q$update public.plan_capabilities set value = '999' where capability_key = 'stage_plan_ceiling'$q$,
      $q$insert into public.plan_capabilities (plan_key, capability_key, status, value) values ('free', 'private_drive_limit', 'decided', '1000000')$q$,
      $q$update public.plan_catalog set rank = 99 where plan_key = 'free'$q$,
      $q$insert into public.plan_capability_defs (capability_key, value_type, description) values ('host_role', 'boolean', 'x')$q$,
      $q$select * from public.plan_passes$q$,
      $q$select * from public.plan_segments$q$,
      $q$select * from public.plan_capabilities$q$
    ] loop
      begin
        execute stmt;
        raise exception 'EXPECTED (%): %', r, stmt;
      exception when insufficient_privilege then null;
      end;
    end loop;

    -- internal functions are not callable
    foreach stmt in array array[
      format('select public.rebuild_plan_timeline(%L)', victim),
      format($q$select public.write_plan_segment(%L, 'pro', now(), now() + interval '99 years', now(), 1188)$q$, victim),
      format('select * from public.plan_effective(%L, now())', victim),
      $q$select public.plan_capability('pro', 'stage_plan_ceiling')$q$,
      $q$select public.plan_add_months(now(), 1)$q$
    ] loop
      begin
        execute stmt;
        raise exception 'EXPECTED (%): %', r, stmt;
      exception when insufficient_privilege then null;
      end;
    end loop;

    -- admin RPCs: anon and service_role have no grant; authenticated is refused inside
    begin
      perform * from public.admin_grant_plan(victim, 'pro', 120, 'self grant', gen_random_uuid());
      raise exception 'EXPECTED (%): admin_grant_plan', r;
    exception
      when insufficient_privilege then null;
      when others then if sqlerrm <> 'admin access required' then raise; end if;
    end;
    begin
      perform public.admin_revoke_pass(pass, 'x');
      raise exception 'EXPECTED (%): admin_revoke_pass', r;
    exception
      when insufficient_privilege then null;
      when others then if sqlerrm <> 'admin access required' then raise; end if;
    end;
  end loop;

  -- anon cannot even ask for its plan; the caller's own plan takes no user id
  perform pg_temp.act_as_role('anon');
  begin
    perform * from public.get_my_plan();
    raise exception 'EXPECTED: anon read a plan';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.act_as_owner();
  foreach fn in array array['get_my_plan', 'get_my_plan_timeline', 'admin_grant_plan'] loop
    if exists (select 1 from pg_proc where proname = fn and pronamespace = 'public'::regnamespace
                and pg_get_function_arguments(oid) ~* '(activated|ends_at|starts_at|expir)') then
      raise exception '% accepts a caller-supplied activation or expiry', fn;
    end if;
  end loop;
  if exists (select 1 from pg_proc where proname in ('get_my_plan', 'get_my_plan_timeline')
              and pronamespace = 'public'::regnamespace
              and pg_get_function_arguments(oid) ~* 'uuid') then
    raise exception 'a self-service plan read takes a user id';
  end if;

  -- ── Table owner, normal DML: facts stay immutable ─────────────────────────
  begin
    update public.plan_passes set activated_at = activated_at - interval '1 year' where id = pass;
    raise exception 'EXPECTED: activated_at rewritten';
  exception when others then
    if sqlerrm <> 'a plan pass is immutable except for a single revocation' then raise; end if;
  end;
  begin
    update public.plan_passes set months = 120 where id = pass;
    raise exception 'EXPECTED: months rewritten';
  exception when others then
    if sqlerrm <> 'a plan pass is immutable except for a single revocation' then raise; end if;
  end;
  begin
    delete from public.plan_passes where id = pass;
    raise exception 'EXPECTED: fact deleted';
  exception when others then
    if sqlerrm <> 'plan passes are durable facts and cannot be deleted' then raise; end if;
  end;
  -- revoking while rewriting a historical field in the same statement
  foreach stmt in array array[
    format($q$update public.plan_passes set revoked_at = now(), revoked_by = %L, revoke_reason = 'r', months = 99 where id = %L$q$, admin_id, pass),
    format($q$update public.plan_passes set revoked_at = now(), revoked_by = %L, revoke_reason = 'r', user_id = %L where id = %L$q$, admin_id, admin_id, pass),
    format($q$update public.plan_passes set revoked_at = now(), revoked_by = %L, revoke_reason = 'r', plan_key = 'pro' where id = %L$q$, admin_id, pass),
    format($q$update public.plan_passes set revoked_at = now(), revoked_by = %L, revoke_reason = 'r', activated_at = now() - interval '1 year' where id = %L$q$, admin_id, pass),
    format($q$update public.plan_passes set revoked_at = now(), revoked_by = %L, revoke_reason = 'r', idempotency_key = 'other' where id = %L$q$, admin_id, pass),
    format($q$update public.plan_passes set revoked_at = now(), revoked_by = %L, revoke_reason = 'r', created_by = %L where id = %L$q$, admin_id, victim, pass),
    format($q$update public.plan_passes set revoked_at = now(), revoked_by = %L, revoke_reason = 'r', reason = 'rewritten' where id = %L$q$, admin_id, pass),
    format($q$update public.plan_passes set revoked_at = now(), revoked_by = %L, revoke_reason = 'r', created_at = now() - interval '1 day' where id = %L$q$, admin_id, pass),
    -- touching nothing but a historical field, with no revocation
    format($q$update public.plan_passes set reason = 'rewritten' where id = %L$q$, pass)
  ] loop
    begin
      execute stmt;
      raise exception 'EXPECTED: %', stmt;
    exception when others then
      if sqlerrm <> 'a plan pass is immutable except for a single revocation' then raise; end if;
    end;
  end loop;
  -- seq is an identity: it cannot be written at all
  begin
    execute format($q$update public.plan_passes set revoked_at = now(), revoked_by = %L, revoke_reason = 'r', seq = 1 where id = %L$q$, admin_id, pass);
    raise exception 'EXPECTED: seq rewritten';
  exception when generated_always then null;
  end;
  -- a revocation must say who and why
  begin
    update public.plan_passes set revoked_at = now(), revoke_reason = 'no one' where id = pass;
    raise exception 'EXPECTED: revocation without revoked_by';
  exception when check_violation then null;
  end;
  begin
    update public.plan_passes set revoked_at = now(), revoked_by = admin_id where id = pass;
    raise exception 'EXPECTED: revocation without a reason';
  exception when check_violation then null;
  end;
  -- revoke once
  update public.plan_passes set revoked_at = now(), revoked_by = admin_id, revoke_reason = 'once' where id = pass;
  -- a second, conflicting revocation and an un-revoke are both refused
  foreach stmt in array array[
    format($q$update public.plan_passes set revoke_reason = 'changed my mind' where id = %L$q$, pass),
    format($q$update public.plan_passes set revoked_at = now() + interval '1 day', revoked_by = %L, revoke_reason = 'again' where id = %L$q$, victim, pass),
    format($q$update public.plan_passes set revoked_at = null, revoked_by = null, revoke_reason = null where id = %L$q$, pass)
  ] loop
    begin
      execute stmt;
      raise exception 'EXPECTED: %', stmt;
    exception when others then
      if sqlerrm <> 'a plan pass is immutable except for a single revocation' then raise; end if;
    end;
  end loop;
  if (select revoke_reason || '/' || revoked_by::text from public.plan_passes where id = pass)
     <> 'once/' || admin_id::text then
    raise exception 'the first revocation did not survive';
  end if;
  begin
    insert into public.plan_passes (user_id, plan_key, kind, months, source, idempotency_key, activated_at, reason, created_by)
    values (victim, 'free', 'grant', 1, 'admin', 'free-pass', now(), 'x', admin_id);
    raise exception 'EXPECTED: a Free pass';
  exception when check_violation then null;
  end;
  begin
    insert into public.plan_passes (user_id, plan_key, kind, months, source, idempotency_key, activated_at, reason, created_by)
    values (victim, 'pro', 'grant', 1, 'trial', 'trial-pass', now(), 'x', admin_id);
    raise exception 'EXPECTED: a trial source';
  exception when check_violation then null;
  end;

  -- capability values are typed, and undecided never carries a value
  begin
    update public.plan_capabilities set value = '"unlimited"' where plan_key = 'plus' and capability_key = 'stage_plan_ceiling';
    raise exception 'EXPECTED: non-integer capability';
  exception when others then if sqlerrm <> 'capability stage_plan_ceiling has a value of the wrong type' then raise; end if;
  end;
  begin
    update public.plan_capabilities set value = '1000' where plan_key = 'free' and capability_key = 'private_drive_limit';
    raise exception 'EXPECTED: undecided capability given a value';
  exception when check_violation then null;
  end;

  -- ── No accidental gating of core features ─────────────────────────────────
  if (select array_agg(capability_key order by capability_key) from public.plan_capability_defs)
     <> array['private_drive_limit', 'probot_allowance_capacity', 'probot_regen_minutes',
              'probot_weekly_allowance_cap', 'stage_plan_ceiling'] then
    raise exception 'unexpected capability set: %', (select array_agg(capability_key) from public.plan_capability_defs);
  end if;
  -- nothing outside the plan functions reads plans: no existing feature is gated yet
  if exists (
    select 1 from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prosrc ~ '(plan_effective|plan_capability\(|plan_segments|plan_passes|get_my_plan)'
       and p.proname not in ('plan_effective', 'plan_capability', 'get_my_plan', 'get_my_plan_timeline',
                             'rebuild_plan_timeline', 'write_plan_segment', 'protect_plan_pass',
                             'admin_grant_plan', 'admin_revoke_pass', 'check_plan_capability_value', 'plan_capability_value_ok',
                             'plan_capability_int', 'plan_epoch_start', 'probot_allowance_at',
                             'probot_charge', 'probot_status_for',
                             'admin_get_user_plan')) then
    raise exception 'a non-plan function reads plans: %', (
      select string_agg(p.proname, ', ') from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.prosrc ~ '(plan_effective|plan_capability\(|plan_segments|plan_passes|get_my_plan)'
         and p.proname not in ('plan_effective', 'plan_capability', 'get_my_plan', 'get_my_plan_timeline',
                               'rebuild_plan_timeline', 'write_plan_segment', 'protect_plan_pass',
                               'admin_grant_plan', 'admin_revoke_pass', 'check_plan_capability_value', 'plan_capability_value_ok',
                             'plan_capability_int', 'plan_epoch_start', 'probot_allowance_at',
                             'probot_charge', 'probot_status_for',
                               'admin_get_user_plan'));
  end if;

  raise notice 'plan timeline adversarial smoke test passed';
end
$adv$;

rollback;
