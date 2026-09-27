-- Local/staging-only adversarial test for Phase 3: every way an anon,
-- authenticated or service_role caller might forge a plan, an allowance,
-- weekly usage, a Credit balance or ledger entry, a consumption, a funding
-- choice, a bot's tier, a Stage purpose, a statistic or a board count.
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/phase3_adversarial_smoke.sql
-- Always rolls back.

begin;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
end $$;
create function pg_temp.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role service_role';
end $$;
create function pg_temp.act_as_owner() returns void language plpgsql as $$
begin execute 'reset role'; end $$;
create function pg_temp.expect(label text, actual anyelement, expected anyelement) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then raise exception '%: expected %, got %', label, expected, actual; end if;
end $$;
create function pg_temp.refused(sql text, pattern text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'EXPECTED refusal: %', sql;
exception when others then
  if sqlerrm not like pattern then
    raise exception 'wrong refusal for %: %', sql, sqlerrm;
  end if;
end $$;
create function pg_temp.fact(sql text) returns bigint language plpgsql security definer as $$
declare n bigint;
begin execute sql into n; return n; end $$;
create function pg_temp.bot_state() returns jsonb language sql as $$
  select '{"name":"adv","gameMode":"versus","players":{"A":"Me","B":"Authur"},"botSide":"B"}'::jsonb
$$;

insert into private.runtime_secrets (key, value) values ('room_code_secret', repeat('s', 40))
on conflict (key) do nothing;
insert into auth.users (id, email, aud, role)
select ('00000000-0000-4000-8000-0000000009' || lpad(n::text, 2, '0'))::uuid,
       'adv3-' || n || '@example.test', 'authenticated', 'authenticated'
  from generate_series(1, 6) n;
update public.profiles set status = 'approved' where id::text like '00000000-0000-4000-8000-0000000009%';
update public.profiles set is_admin = true where id = '00000000-0000-4000-8000-000000000901';

do $adv$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000901';
  mallory constant uuid := '00000000-0000-4000-8000-000000000902';
  victim constant uuid := '00000000-0000-4000-8000-000000000903';
  facts constant text[] := array['economy_entries', 'economy_balances', 'probot_allowance_state',
    'probot_consumptions', 'bot_stat_folders', 'bot_stat_games', 'room_creation_requests'];
  tbl text;
  role_name text;
  sql text;
  r record;
  folder record;
  before_facts bigint;
begin
  -- a paid-up Pro victim with Credits, for cross-user attempts
  perform pg_temp.act_as_owner();
  insert into public.plan_passes (user_id, plan_key, kind, months, source, idempotency_key, activated_at, reason, created_by)
  values (victim, 'pro', 'grant', 1, 'admin', 'adv3:' || gen_random_uuid(), now() - interval '1 hour', 'adv', admin_id);
  perform public.rebuild_plan_timeline(victim);
  perform pg_temp.act_as(admin_id);
  perform public.admin_grant_credits(victim, 5, 'adv', gen_random_uuid());
  perform pg_temp.act_as_owner();
  before_facts := pg_temp.fact('select (select count(*) from public.economy_entries)
    + (select count(*) from public.probot_consumptions) + (select sum(balance) from public.economy_balances)');

  -- ── 1. Economy and statistics tables: no API role reads or writes them ──
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    foreach tbl in array facts loop
      if role_name = 'anon' then perform pg_temp.act_as_anon();
      elsif role_name = 'service_role' then perform pg_temp.act_as_service();
      else perform pg_temp.act_as(mallory); end if;
      perform pg_temp.refused(format('select count(*) from public.%I', tbl), 'permission denied%');
      perform pg_temp.refused(format('delete from public.%I', tbl), 'permission denied%');
      perform pg_temp.refused(format('truncate public.%I', tbl), 'permission denied%');
    end loop;
    perform pg_temp.refused(format($q$insert into public.economy_balances (user_id, currency, balance)
      values (%L, 'probot_credit', 1000)$q$, mallory), 'permission denied%');
    perform pg_temp.refused(format($q$insert into public.economy_entries (user_id, currency, delta, reason, source_type,
      idempotency_key, balance_after) values (%L, 'probot_credit', 1000, 'admin_grant', 'admin_request', 'x', 1000)$q$,
      mallory), 'permission denied%');
    perform pg_temp.refused(format($q$insert into public.probot_allowance_state (user_id, epoch_plan, epoch_start, units, anchor_at)
      values (%L, 'pro', now(), 10, now())$q$, mallory), 'permission denied%');
    perform pg_temp.refused(format($q$update public.probot_allowance_state set units = 10 where user_id = %L$q$, mallory),
      'permission denied%');
    perform pg_temp.refused(format($q$delete from public.probot_consumptions where user_id = %L$q$, mallory),
      'permission denied%');
    -- plans stay forged-proof (Phase 2), re-checked here with the economy on
    perform pg_temp.refused(format($q$insert into public.plan_passes (user_id, plan_key, kind, months, source,
      idempotency_key, activated_at, reason, created_by) values (%L, 'pro', 'grant', 120, 'admin', 'x', now(), 'x', %L)$q$,
      mallory, mallory), 'permission denied%');
    perform pg_temp.refused(format($q$insert into public.plan_segments (user_id, plan_key, starts_at, ends_at)
      values (%L, 'pro', now(), now() + interval '1 year')$q$, mallory), 'permission denied%');
    perform pg_temp.refused($q$update public.plan_capabilities set value = '100000'::jsonb
      where capability_key = 'probot_allowance_capacity'$q$, 'permission denied%');
    perform pg_temp.refused($q$update public.system_settings set value_int = 1000 where key = 'max_active_boards_per_user'$q$,
      'permission denied%');
    perform pg_temp.refused($q$update public.bot_catalog set access_tier = 'free' where bot_key = 'authur_strong'$q$,
      'permission denied%');
  end loop;

  -- ── 2. Internal economy functions are not callable by any API role ──────
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if role_name = 'anon' then perform pg_temp.act_as_anon();
    elsif role_name = 'service_role' then perform pg_temp.act_as_service();
    else perform pg_temp.act_as(mallory); end if;
    foreach sql in array array[
      format('select public.economy_post(%L, %L, 1000, %L, %L, %L, %L, null, null)',
        mallory, 'probot_credit', 'admin_grant', 'admin_request', 'forged', 'forged'),
      format('select public.probot_charge(%L, gen_random_uuid(), gen_random_uuid(), %L, %L, now())',
        victim, 'authur_strong', 'credit'),
      format('select * from public.probot_allowance_at(%L, now())', victim),
      format('select public.probot_status_for(%L)', victim),
      format('select public.probot_now(%L)', victim),
      format('select public.plan_epoch_start(%L, now(), %L)', victim, 'pro'),
      format('select public.active_board_count(%L, now(), null, null)', victim),
      format('select public.lock_board_users(array[%L]::uuid[])', victim),
      format('select public.assert_board_capacity(array[%L]::uuid[], now(), null, null)', victim),
      'select public.active_board_limit()',
      'select public.bot_folder_open_id()',
      format('select public.create_live_game_core(%L, %L, %L, null, %L, null, %L, %L, %L, gen_random_uuid())',
        pg_temp.bot_state(), 'private', 'none', 'invite_only', 'authur_strong', 'B', 'stage')
    ] loop
      perform pg_temp.refused(sql, 'permission denied%');
    end loop;
  end loop;
  -- the public entry points refuse the wrong caller
  perform pg_temp.act_as_anon();
  perform pg_temp.refused('select public.get_my_probot_status()', 'permission denied%');
  perform pg_temp.refused(format('select * from public.create_bot_game(gen_random_uuid(), %L, %L, %L, %L, %L, null, %L, null, %L)',
    'authur_strong', 'B', pg_temp.bot_state(), 'private', 'none', 'invite_only', 'credit'), 'permission denied%');
  perform pg_temp.act_as_service();
  perform pg_temp.refused(format('select public.admin_grant_credits(%L, 100, %L, gen_random_uuid())', mallory, 'svc'),
    'permission denied%');
  perform pg_temp.refused(format('select * from public.create_stage_attempt(gen_random_uuid(), gen_random_uuid(), %L)', '{}'),
    'permission denied%');
  perform pg_temp.refused(format('select public.admin_seal_stage_start(gen_random_uuid(), %L)', '{}'), 'permission denied%');
  perform pg_temp.refused('select public.admin_set_active_board_limit(1000, $$svc$$)', 'permission denied%');
  perform pg_temp.act_as(mallory);
  perform pg_temp.refused(format('select public.admin_grant_credits(%L, 100, %L, gen_random_uuid())', mallory, 'me'),
    'admin access required');
  perform pg_temp.refused(format('select public.admin_get_user_economy(%L)', victim), 'admin access required');
  perform pg_temp.refused('select public.admin_set_active_board_limit(1000, $$me$$)', 'admin access required');
  perform pg_temp.refused('select * from public.admin_list_bot_stat_folders()', 'admin access required');
  -- a grant can only add, and only whole positive amounts
  perform pg_temp.act_as(admin_id);
  perform pg_temp.refused(format('select public.admin_grant_credits(%L, -5, %L, gen_random_uuid())', victim, 'claw back'),
    'amount must be a positive whole number');
  perform pg_temp.refused(format('select public.admin_grant_credits(%L, 0, %L, gen_random_uuid())', victim, 'zero'),
    'amount must be a positive whole number');

  -- ── 3. The status RPC reports only the caller ───────────────────────────
  perform pg_temp.act_as(mallory);
  perform pg_temp.expect('mallory sees her own zero credits',
    (public.get_my_probot_status() ->> 'credits')::int, 0);
  perform pg_temp.expect('and the Free plan', public.get_my_probot_status() ->> 'plan_key', 'free');

  -- ── 4. Funding and tier cannot be forged through the state blob ─────────
  perform pg_temp.refused(format($q$select * from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B',
      %L::jsonb || '{"botAccessTier":"free","accessTier":"free","funding":"free","botExecutionType":"CLIENT","botEngine":"stage5b"}',
      'private', 'none', null, 'invite_only', null, null)$q$, pg_temp.bot_state()), 'funding_required:%');
  perform pg_temp.refused(format($q$select * from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B', %L,
      'private', 'none', null, 'invite_only', null, 'free')$q$, pg_temp.bot_state()), 'funding must be allowance or credit');
  perform pg_temp.refused(format($q$select * from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B', %L,
      'private', 'none', null, 'invite_only', null, 'credit')$q$, pg_temp.bot_state()), 'insufficient_credits:%');
  perform pg_temp.refused(format($q$select * from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B', %L,
      'private', 'none', null, 'invite_only', null, 'allowance')$q$, pg_temp.bot_state()), 'allowance_free_plan:%');
  -- a bot room through the generic path, or disguised as Stage 5B / Stage
  perform pg_temp.refused(format($q$select * from public.create_live_game(%L::jsonb || '{"botDifficulty":"super","botEngine":"authur"}',
      'private', 'none', null, 'invite_only', null)$q$, pg_temp.bot_state()), 'bot_room_requires_catalog:%');
  perform pg_temp.refused(format($q$select * from public.create_bot_game(gen_random_uuid(), 'stage5b', 'B', %L,
      'private', 'none', null, 'invite_only', null, null)$q$, pg_temp.bot_state()), 'bot_pending:%');
  perform pg_temp.refused(format($q$select * from public.create_bot_game(gen_random_uuid(), 'aether_super', 'B', %L,
      'private', 'none', null, 'invite_only', null, null)$q$, pg_temp.bot_state()), 'bot_closed:%');
  -- the victim's allowance/credits are not reachable by naming them
  perform pg_temp.refused(format($q$select * from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B',
      %L::jsonb || jsonb_build_object('playerUserIds', jsonb_build_object('A', %L::text), 'ownerId', %L::text),
      'private', 'none', null, 'invite_only', null, 'credit')$q$, pg_temp.bot_state(), victim, victim), 'insufficient_credits:%');
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('no economy fact moved', pg_temp.fact('select (select count(*) from public.economy_entries)
    + (select count(*) from public.probot_consumptions) + (select sum(balance) from public.economy_balances)'), before_facts);

  -- ── 5. service_role cannot mint a bot room, a Stage, or seat past limits ─
  perform pg_temp.act_as_service();
  perform pg_temp.refused(format($q$insert into public.room_live (room_id, owner_id, name, player_a, player_b, status,
      access_scope, archive_policy, join_policy, game_mode, mode_key, player_a_user_id, state, room_code_hash,
      bot_key, bot_side, room_purpose)
    values (gen_random_uuid(), %L, 'svc', 'Me', 'Authur', 'playing', 'private', 'none', 'invite_only', 'versus',
      'authur_strong', %L, '{}', md5(random()::text), 'authur_strong', 'B', 'stage')$q$, mallory, mallory),
    'permission denied%');
  perform pg_temp.refused(format($q$insert into public.room_live (room_id, owner_id, name, player_a, player_b, status,
      access_scope, archive_policy, join_policy, game_mode, mode_key, player_a_user_id, state, room_code_hash, room_purpose)
    values (gen_random_uuid(), %L, 'svc', 'Me', 'Authur', 'playing', 'private', 'none', 'invite_only', 'versus',
      'versus', %L, '{}', md5(random()::text), 'stage')$q$, mallory, mallory),
    'permission denied%');
  -- and even the owner's direct insert cannot make a bot-less Stage
  perform pg_temp.act_as_owner();
  perform pg_temp.refused(format($q$insert into public.room_live (room_id, owner_id, name, player_a, player_b, status,
      access_scope, archive_policy, join_policy, game_mode, mode_key, player_a_user_id, state, room_code_hash,
      room_purpose, starting_side)
    values (gen_random_uuid(), %L, 'svc', 'Me', 'Authur', 'playing', 'private', 'none', 'invite_only', 'versus',
      'versus', %L, '{}', md5(random()::text), 'stage', 'A')$q$, mallory, mallory),
    'a Stage room must name its catalog bot');

  -- ── 6. A paid bot room cannot be converted, re-seated or re-tiered ──────
  perform pg_temp.act_as(victim);
  select * into r from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B', pg_temp.bot_state(),
    'private', 'none', null, 'invite_only', null, 'credit');
  perform pg_temp.act_as_service();
  foreach sql in array array[
    format($q$update public.room_live set room_purpose = 'stage' where room_id = %L$q$, r.room_id),
    format($q$update public.room_live set bot_access_tier = 'free' where room_id = %L$q$, r.room_id),
    format($q$update public.room_live set bot_key = 'stage5b' where room_id = %L$q$, r.room_id),
    format($q$update public.room_live set bot_config_version = 0 where room_id = %L$q$, r.room_id)
  ] loop
    perform pg_temp.refused(sql, 'bot configuration is fixed%');
  end loop;
  perform pg_temp.refused(format($q$update public.room_live set player_a_user_id = %L where room_id = %L$q$, mallory, r.room_id),
    'bot_room_seat_fixed:%');
  perform pg_temp.refused(format($q$update public.room_live set player_a_user_id = null where room_id = %L$q$, r.room_id),
    'bot_room_seat_fixed:%');
  perform pg_temp.act_as(mallory);
  perform pg_temp.refused(format($q$update public.room_live set room_purpose = 'stage' where room_id = %L$q$, r.room_id),
    'permission denied%');
  -- someone else's paid room is not joinable as a player
  perform pg_temp.refused(format($q$select * from public.join_live_game(null, %L)$q$, r.room_id), 'live game not found');

  -- ── 7. Deleting a room never erases its consumption ─────────────────────
  perform pg_temp.act_as(victim);
  perform public.cancel_live_game(r.room_id);
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('consumption survives the room',
    pg_temp.fact(format('select count(*) from public.probot_consumptions where room_id = %L', r.room_id)), 1::bigint);
  perform pg_temp.refused(format('delete from public.probot_consumptions where room_id = %L', r.room_id), '%immutable%');
  perform pg_temp.refused(format('update public.economy_entries set delta = 1 where user_id = %L', victim), '%immutable%');
  perform pg_temp.refused(format('delete from public.economy_entries where user_id = %L', victim), '%immutable%');

  -- ── 8. Statistics: client recorders are inert; Stage never counts ───────
  perform pg_temp.act_as(admin_id);
  select * into folder from public.create_bot_folder('adv3', true);
  perform pg_temp.act_as(victim);
  select * into r from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B', pg_temp.bot_state(),
    'private', 'none', null, 'invite_only', null, 'credit');
  perform pg_temp.expect('v1 inert', public.record_bot_game('forged', r.room_id, 'Me', null, 'B', 'authur', 0, 999,
    'bot_loss', 1, now()), null::uuid);
  perform pg_temp.expect('v2 inert', public.record_bot_game_v2('forged', r.room_id, 'Me', null, 'B', 'authur', 'super',
    0, 999, 'bot_loss', 1, now()), null::uuid);
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('nothing recorded by the client',
    pg_temp.fact(format('select count(*) from public.bot_stat_games where folder_id = %L', folder.id)), 0::bigint);
  -- a stats folder never feeds the economy: no economy function reads it
  perform pg_temp.expect('economy functions never read statistics', (select count(*)::int from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('probot_charge', 'probot_allowance_at', 'economy_post', 'create_bot_game',
                         'probot_status_for', 'active_board_count', 'plan_effective', 'create_stage_attempt')
       and p.prosrc ~ 'bot_stat'), 0);

  raise notice 'phase 3 adversarial smoke test passed';
end
$adv$;

rollback;
