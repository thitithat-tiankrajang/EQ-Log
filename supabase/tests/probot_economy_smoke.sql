-- Local/staging-only smoke test for the Phase 3 Pro-Bot economy.
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/probot_economy_smoke.sql
-- Allowance timing is tested through the owner-only primitives at chosen
-- instants (probot_allowance_at / probot_charge); funding, idempotency,
-- rollback and statistics through the real RPCs. Always rolls back.

begin;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.act_as_owner() returns void language plpgsql as $$
begin execute 'reset role'; end $$;
create function pg_temp.expect(label text, actual anyelement, expected anyelement) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception '%: expected %, got %', label, expected, actual;
  end if;
end $$;
create function pg_temp.pass(target uuid, plan text, months int, at_ timestamptz) returns void
language plpgsql as $$
begin
  insert into public.plan_passes (user_id, plan_key, kind, months, source, idempotency_key,
                                  activated_at, reason, created_by)
  values (target, plan, 'grant', months, 'admin', 'eco:' || gen_random_uuid(), at_, 'eco',
          '00000000-0000-4000-8000-000000000601');
  perform public.rebuild_plan_timeline(target);
end $$;
create function pg_temp.units(target uuid, t timestamptz) returns int language sql as $$
  select units from public.probot_allowance_at(target, t)
$$;
create function pg_temp.reason(target uuid, t timestamptz) returns text language sql as $$
  select reason from public.probot_allowance_at(target, t)
$$;
create function pg_temp.spend(target uuid, t timestamptz, funding text default 'allowance') returns uuid
language sql as $$
  select public.probot_charge(target, gen_random_uuid(), gen_random_uuid(), 'authur_strong', funding, t)
$$;
create function pg_temp.bot_state() returns jsonb language sql as $$
  select '{"name":"eco","gameMode":"versus","players":{"A":"Me","B":"Authur"},"botSide":"B"}'::jsonb
$$;
-- Reads as the table owner (browser roles have no access to balances).
create function pg_temp.balance(target uuid) returns bigint language sql security definer as $$
  select coalesce((select balance from public.economy_balances where user_id = target and currency = 'probot_credit'), 0)
$$;

insert into private.runtime_secrets (key, value) values ('room_code_secret', repeat('s', 40))
on conflict (key) do nothing;
insert into auth.users (id, email, aud, role)
select ('00000000-0000-4000-8000-0000000006' || lpad(n::text, 2, '0'))::uuid,
       'eco-' || n || '@example.test', 'authenticated', 'authenticated'
  from generate_series(1, 20) n;
update public.profiles set status = 'approved' where id::text like '00000000-0000-4000-8000-0000000006%';
update public.profiles set is_admin = true
 where id in ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000620');
update public.profiles set status = 'pending' where id = '00000000-0000-4000-8000-000000000619';

do $eco$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000601';
  admin2 constant uuid := '00000000-0000-4000-8000-000000000620';
  u_plus constant uuid := '00000000-0000-4000-8000-000000000602';
  u_chain constant uuid := '00000000-0000-4000-8000-000000000603';
  u_sched constant uuid := '00000000-0000-4000-8000-000000000604';
  u_week constant uuid := '00000000-0000-4000-8000-000000000605';
  u_switch constant uuid := '00000000-0000-4000-8000-000000000606';
  u_free constant uuid := '00000000-0000-4000-8000-000000000607';
  u_api constant uuid := '00000000-0000-4000-8000-000000000608';
  u_limit constant uuid := '00000000-0000-4000-8000-000000000609';
  u_stats constant uuid := '00000000-0000-4000-8000-000000000610';
  u_pending constant uuid := '00000000-0000-4000-8000-000000000619';
  t0 constant timestamptz := '2027-01-04 10:00+07';   -- a Monday
  t timestamptz;
  r record;
  g record;
  e_end timestamptz;
  n int;
  before_balance bigint;
  k1 constant uuid := '44444444-0000-4000-8000-000000000001';
  folder record;
begin
  -- ── Catalog and capabilities ──────────────────────────────────────────────
  perform pg_temp.expect('Authur is Pro/server',
    (select access_tier || '/' || execution_type || '/' || lifecycle from public.bot_catalog where bot_key = 'authur_strong'),
    'pro/SERVER/active');
  perform pg_temp.expect('Stage 5B is Free/client, pending',
    (select access_tier || '/' || execution_type || '/' || lifecycle || '/' || enabled || '/' || new_rooms_allowed
       from public.bot_catalog where bot_key = 'stage5b'),
    'free/CLIENT/pending/false/false');
  perform pg_temp.expect('Aether retired',
    (select count(*)::int from public.bot_catalog where engine_family = 'aether' and (lifecycle <> 'retired' or new_rooms_allowed)), 0);
  perform pg_temp.expect('free capacity', public.plan_capability_int('free', 'probot_allowance_capacity'), 0);
  perform pg_temp.expect('free weekly', public.plan_capability_int('free', 'probot_weekly_allowance_cap'), 0);
  perform pg_temp.expect('plus capacity', public.plan_capability_int('plus', 'probot_allowance_capacity'), 3);
  perform pg_temp.expect('plus regen', public.plan_capability_int('plus', 'probot_regen_minutes'), 30);
  perform pg_temp.expect('plus weekly', public.plan_capability_int('plus', 'probot_weekly_allowance_cap'), 30);
  perform pg_temp.expect('pro capacity', public.plan_capability_int('pro', 'probot_allowance_capacity'), 10);
  perform pg_temp.expect('pro regen', public.plan_capability_int('pro', 'probot_regen_minutes'), 30);
  perform pg_temp.expect('pro weekly', public.plan_capability_int('pro', 'probot_weekly_allowance_cap'), 300);
  perform pg_temp.expect('undecided is not a number', public.plan_capability_int('free', 'probot_regen_minutes'), null::int);

  -- ── Allowance: full start, spend, exact regeneration boundary, cap ────────
  perform pg_temp.pass(u_plus, 'plus', 2, t0);
  perform pg_temp.expect('new epoch starts full', pg_temp.units(u_plus, t0 + interval '1 minute'), 3);
  perform pg_temp.spend(u_plus, t0 + interval '1 minute');
  perform pg_temp.spend(u_plus, t0 + interval '2 minutes');
  perform pg_temp.spend(u_plus, t0 + interval '3 minutes');
  perform pg_temp.expect('empty', pg_temp.reason(u_plus, t0 + interval '4 minutes'), 'empty');
  begin
    perform pg_temp.spend(u_plus, t0 + interval '4 minutes');
    raise exception 'EXPECTED: spend from empty allowance';
  exception when others then if sqlerrm not like 'allowance_empty:%' then raise; end if;
  end;
  -- the clock started at the first spend from full (t0+1m)
  perform pg_temp.expect('1 µs before regen', pg_temp.units(u_plus, t0 + interval '31 minutes' - interval '1 microsecond'), 0);
  perform pg_temp.expect('exactly at regen', pg_temp.units(u_plus, t0 + interval '31 minutes'), 1);
  perform pg_temp.expect('next unit time', (select next_unit_at from public.probot_allowance_at(u_plus, t0 + interval '31 minutes')),
    t0 + interval '61 minutes');
  perform pg_temp.expect('two units', pg_temp.units(u_plus, t0 + interval '61 minutes'), 2);
  perform pg_temp.expect('capped at capacity', pg_temp.units(u_plus, t0 + interval '10 hours'), 3);
  perform pg_temp.expect('full has no next unit', (select next_unit_at from public.probot_allowance_at(u_plus, t0 + interval '10 hours')), null::timestamptz);
  -- partial progress survives a spend: spend at +45m (1 unit, anchor +31m) → next at +61m
  perform pg_temp.spend(u_plus, t0 + interval '45 minutes');
  perform pg_temp.expect('after spending the regenerated unit', pg_temp.units(u_plus, t0 + interval '46 minutes'), 0);
  perform pg_temp.expect('partial interval kept', pg_temp.units(u_plus, t0 + interval '61 minutes'), 1);
  -- same-plan extension does not refill
  perform pg_temp.spend(u_plus, t0 + interval '10 hours');   -- 3 → 2
  perform pg_temp.pass(u_plus, 'plus', 1, t0 + interval '10 hours 1 minute');
  perform pg_temp.expect('extension does not refill', pg_temp.units(u_plus, t0 + interval '10 hours 2 minutes'), 2);
  -- rebuilding the same facts does not refill
  perform public.rebuild_plan_timeline(u_plus);
  perform pg_temp.expect('rebuild does not refill', pg_temp.units(u_plus, t0 + interval '10 hours 2 minutes'), 2);

  -- ── A contiguous same-plan chain is one epoch ─────────────────────────────
  perform pg_temp.pass(u_chain, 'plus', 1, t0);
  e_end := public.plan_add_months(t0, 1);
  perform pg_temp.pass(u_chain, 'plus', 1, e_end);          -- starts exactly at the old end: new chain row
  perform pg_temp.expect('two contiguous segments', (select count(*)::int from public.plan_segments where user_id = u_chain), 2);
  perform pg_temp.spend(u_chain, e_end - interval '1 minute');
  perform pg_temp.expect('no refill across a contiguous boundary', pg_temp.units(u_chain, e_end + interval '1 minute'), 2);
  perform pg_temp.expect('epoch reaches back to the first chain',
    public.plan_epoch_start(u_chain, e_end + interval '1 minute', 'plus'), t0);

  -- ── Pro → scheduled Plus: a new epoch, full; expiry → Free; reactivation full
  perform pg_temp.pass(u_sched, 'pro', 1, t0);
  perform pg_temp.pass(u_sched, 'plus', 1, t0 + interval '1 day');   -- waits behind Pro
  perform pg_temp.expect('Pro full', pg_temp.units(u_sched, t0 + interval '1 hour'), 10);
  perform pg_temp.spend(u_sched, t0 + interval '1 hour');
  perform pg_temp.expect('Pro spent', pg_temp.units(u_sched, t0 + interval '1 hour 1 minute'), 9);
  e_end := public.plan_add_months(t0, 1);
  perform pg_temp.expect('Plus becomes effective after Pro, full', pg_temp.units(u_sched, e_end + interval '1 minute'), 3);
  perform pg_temp.expect('Plus plan', (select plan_key from public.probot_allowance_at(u_sched, e_end + interval '1 minute')), 'plus');
  t := public.plan_add_months(e_end, 1) + interval '1 hour';
  perform pg_temp.expect('expired → Free', pg_temp.reason(u_sched, t), 'free_plan');
  perform pg_temp.expect('Free has no units', pg_temp.units(u_sched, t), 0);
  begin
    perform pg_temp.spend(u_sched, t);
    raise exception 'EXPECTED: Free spent allowance';
  exception when others then if sqlerrm not like 'allowance_free_plan:%' then raise; end if;
  end;
  perform pg_temp.pass(u_sched, 'plus', 1, t + interval '1 day');
  perform pg_temp.expect('new paid epoch starts full', pg_temp.units(u_sched, t + interval '1 day 1 minute'), 3);

  -- ── Weekly cap: 30 per Bangkok week, [Mon 00:00, Mon 00:00) ─────────────
  perform pg_temp.pass(u_week, 'plus', 2, '2027-01-04 00:00+07');
  t := '2027-01-11 00:00+07';                            -- Monday 00:00 Bangkok
  perform pg_temp.expect('week start is Monday 00:00 Bangkok', public.bangkok_week_start(t + interval '3 days'), t);
  perform pg_temp.expect('Sunday 23:59:59 belongs to the old week',
    public.bangkok_week_start(t - interval '1 second'), t - interval '7 days');
  for n in 0 .. 29 loop
    perform pg_temp.spend(u_week, t + n * interval '30 minutes');
  end loop;
  perform pg_temp.expect('30 used', (select weekly_used from public.probot_allowance_at(u_week, t + interval '20 hours')), 30);
  perform pg_temp.expect('units still available', pg_temp.units(u_week, t + interval '20 hours'), 3);
  perform pg_temp.expect('but the weekly cap stops it', pg_temp.reason(u_week, t + interval '20 hours'), 'weekly_cap');
  begin
    perform pg_temp.spend(u_week, t + interval '20 hours');
    raise exception 'EXPECTED: spend past the weekly cap';
  exception when others then if sqlerrm not like 'allowance_weekly_cap:%' then raise; end if;
  end;
  perform pg_temp.expect('still capped 1 µs before the reset',
    pg_temp.reason(u_week, t + interval '7 days' - interval '1 microsecond'), 'weekly_cap');
  perform pg_temp.expect('free again exactly at Monday 00:00', pg_temp.reason(u_week, t + interval '7 days'), 'ok');
  -- Credits never count toward the weekly cap
  perform public.economy_post(u_week, 'probot_credit', 1, 'admin_grant', 'admin_request', 'w', 'eco-week-credit', admin_id, 'x');
  perform pg_temp.spend(u_week, t + interval '21 hours', 'credit');
  perform pg_temp.expect('credit spend not counted', (select weekly_used from public.probot_allowance_at(u_week, t + interval '22 hours')), 30);

  -- ── Weekly usage is per user across plans (Plus 30 used → Pro 270 left) ──
  t := '2027-02-01 00:00+07';                            -- Monday
  perform pg_temp.pass(u_switch, 'plus', 1, t - interval '1 month' + interval '1 hour');   -- ends Feb 1 01:00
  for n in 0 .. 1 loop
    perform pg_temp.spend(u_switch, t + interval '1 minute' + n * interval '1 minute');
  end loop;
  perform pg_temp.pass(u_switch, 'pro', 1, t + interval '2 hours');
  select * into r from public.probot_allowance_at(u_switch, t + interval '3 hours');
  perform pg_temp.expect('now Pro', r.plan_key, 'pro');
  perform pg_temp.expect('usage carried within the week', r.weekly_used, 2);
  perform pg_temp.expect('Pro cap', r.weekly_cap, 300);
  perform pg_temp.expect('Pro epoch starts full', r.units, 10);

  -- ── Credits: grants, idempotency, never negative, immutable ──────────────
  perform pg_temp.act_as(u_free);
  begin
    perform * from public.admin_grant_credits(u_free, 100, 'self', gen_random_uuid());
    raise exception 'EXPECTED: user granted credits';
  exception when others then if sqlerrm <> 'admin access required' then raise; end if;
  end;
  perform pg_temp.act_as(admin_id);
  foreach n in array array[0, -5] loop
    begin
      perform * from public.admin_grant_credits(u_free, n, 'x', gen_random_uuid());
      raise exception 'EXPECTED: % credits', n;
    exception when others then if sqlerrm <> 'amount must be a positive whole number' then raise; end if;
    end;
  end loop;
  begin
    perform * from public.admin_grant_credits(u_free, 1, ' ', gen_random_uuid());
    raise exception 'EXPECTED: no reason';
  exception when others then if sqlerrm <> 'a grant needs a reason' then raise; end if;
  end;
  begin
    perform * from public.admin_grant_credits(u_pending, 1, 'x', gen_random_uuid());
    raise exception 'EXPECTED: unapproved';
  exception when others then if sqlerrm <> 'credits can only be granted to approved accounts' then raise; end if;
  end;
  select * into g from public.admin_grant_credits(u_free, 2, 'support', k1);
  perform pg_temp.expect('granted', g.balance, 2::bigint);
  select * into r from public.admin_grant_credits(u_free, 2, 'support', k1);
  perform pg_temp.expect('replayed', r.replayed, true);
  perform pg_temp.expect('same entry', r.entry_id, g.entry_id);
  perform pg_temp.expect('no double grant', pg_temp.balance(u_free), 2::bigint);
  begin
    perform * from public.admin_grant_credits(u_free, 3, 'support', k1);
    raise exception 'EXPECTED: conflicting amount';
  exception when others then if sqlerrm not like 'idempotency_conflict:%' then raise; end if;
  end;
  begin
    perform * from public.admin_grant_credits(u_api, 2, 'support', k1);
    raise exception 'EXPECTED: conflicting user';
  exception when others then if sqlerrm not like 'idempotency_conflict:%' then raise; end if;
  end;
  perform pg_temp.act_as(admin2);
  begin
    perform * from public.admin_grant_credits(u_free, 2, 'support', k1);
    raise exception 'EXPECTED: conflicting admin';
  exception when others then if sqlerrm not like 'idempotency_conflict:%' then raise; end if;
  end;
  perform pg_temp.act_as_owner();
  begin
    perform public.economy_post(u_free, 'probot_credit', -5, 'probot_room', 'bot_room', 'x', 'eco-neg', u_free, '');
    raise exception 'EXPECTED: negative balance';
  exception when others then if sqlerrm not like 'insufficient_credits:%' then raise; end if;
  end;
  perform pg_temp.expect('refused spend left nothing', (select count(*)::int from public.economy_entries where idempotency_key = 'eco-neg'), 0);
  begin
    update public.economy_entries set delta = 999 where id = g.entry_id;
    raise exception 'EXPECTED: ledger edited';
  exception when others then if sqlerrm <> 'economy_entries rows are immutable' then raise; end if;
  end;

  -- ── Room creation funding (real RPC) ──────────────────────────────────────
  perform pg_temp.act_as(u_free);
  begin
    perform * from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B', pg_temp.bot_state(),
      'public', 'public', null, 'invite_only', null, null);
    raise exception 'EXPECTED: no funding';
  exception when others then if sqlerrm not like 'funding_required:%' then raise; end if;
  end;
  begin
    perform * from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B', pg_temp.bot_state(),
      'public', 'public', null, 'invite_only', null, 'allowance');
    raise exception 'EXPECTED: Free allowance';
  exception when others then if sqlerrm not like 'allowance_free_plan:%' then raise; end if;
  end;
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('refused allowance did not touch credits', pg_temp.balance(u_free), 2::bigint);
  perform pg_temp.act_as(u_free);
  select * into r from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B', pg_temp.bot_state(),
    'public', 'public', null, 'invite_only', null, 'credit');
  perform pg_temp.expect('Free plays Authur with a credit', r.funding, 'credit');
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('one credit spent', pg_temp.balance(u_free), 1::bigint);
  perform pg_temp.expect('consumption recorded', (select funding || '/' || plan_key_at_use || '/' || bot_key
     from public.probot_consumptions where room_id = r.room_id), 'credit/free/authur_strong');
  perform pg_temp.expect('credit entry linked', (select e.delta from public.economy_entries e
     join public.probot_consumptions c on c.credit_entry_id = e.id where c.room_id = r.room_id), -1);

  -- idempotent retry, then conflicts
  perform pg_temp.act_as_owner();
  perform public.economy_post(u_api, 'probot_credit', 5, 'admin_grant', 'admin_request', 'x', 'eco-api', admin_id, '');
  perform pg_temp.act_as(u_api);
  select * into g from public.create_bot_game('55555555-0000-4000-8000-000000000001', 'authur_strong', 'B',
    pg_temp.bot_state(), 'public', 'public', null, 'invite_only', null, 'credit');
  select * into r from public.create_bot_game('55555555-0000-4000-8000-000000000001', 'authur_strong', 'B',
    pg_temp.bot_state(), 'public', 'public', null, 'invite_only', null, 'credit');
  perform pg_temp.expect('replay: same room', r.room_id, g.room_id);
  perform pg_temp.expect('replay: same consumption', r.consumption_id, g.consumption_id);
  perform pg_temp.expect('replay flagged', r.replayed, true);
  begin
    perform * from public.create_bot_game('55555555-0000-4000-8000-000000000001', 'authur_strong', 'B',
      pg_temp.bot_state(), 'public', 'public', null, 'invite_only', null, 'allowance');
    raise exception 'EXPECTED: other funding, same id';
  exception when others then if sqlerrm not like 'idempotency_conflict:%' then raise; end if;
  end;
  begin
    perform * from public.create_bot_game('55555555-0000-4000-8000-000000000001', 'authur_strong', 'A',
      pg_temp.bot_state(), 'public', 'public', null, 'invite_only', null, 'credit');
    raise exception 'EXPECTED: other side, same id';
  exception when others then if sqlerrm not like 'idempotency_conflict:%' then raise; end if;
  end;
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('one charge for the request', pg_temp.balance(u_api), 4::bigint);

  -- no silent fallback: allowance empty, credits available → refused, credits untouched
  perform pg_temp.act_as_owner();
  perform pg_temp.pass(u_limit, 'plus', 1, now() - interval '1 hour');
  perform public.economy_post(u_limit, 'probot_credit', 5, 'admin_grant', 'admin_request', 'x', 'eco-limit', admin_id, '');
  perform pg_temp.act_as(u_limit);
  for n in 1 .. 3 loop
    perform * from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B', pg_temp.bot_state(),
      'public', 'public', null, 'invite_only', null, 'allowance');
  end loop;
  -- 3 boards now; the 4th fails at the board limit AFTER the charge — which rolls back
  begin
    perform * from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B', pg_temp.bot_state(),
      'public', 'public', null, 'invite_only', null, 'credit');
    raise exception 'EXPECTED: 4th board';
  exception when others then if sqlerrm not like 'active_board_limit:%' then raise; end if;
  end;
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('rolled back: no credit spent', pg_temp.balance(u_limit), 5::bigint);
  perform pg_temp.expect('rolled back: no extra consumption',
    (select count(*)::int from public.probot_consumptions where user_id = u_limit), 3);
  -- free a board, then allowance is empty: explicit refusal, no credit
  delete from public.room_live where room_id = (select room_id from public.room_live where player_a_user_id = u_limit limit 1);
  perform pg_temp.act_as(u_limit);
  begin
    perform * from public.create_bot_game(gen_random_uuid(), 'authur_strong', 'B', pg_temp.bot_state(),
      'public', 'public', null, 'invite_only', null, 'allowance');
    raise exception 'EXPECTED: empty allowance';
  exception when others then if sqlerrm not like 'allowance_empty:%' then raise; end if;
  end;
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('no fallback to credit', pg_temp.balance(u_limit), 5::bigint);

  -- ── Tier decides funding, execution does not ──────────────────────────────
  insert into public.bot_catalog (bot_key, display_name, engine_family, difficulty, mode_key,
    execution_type, access_tier, access_tier_status, enabled, new_rooms_allowed, lifecycle)
  values ('test_free_server', 'Test Free Server', 'stage5b', 'stage5b64', 'stage5b_standard',
          'SERVER', 'free', 'decided', true, true, 'active'),
         ('test_pro_client', 'Test Pro Client', 'stage5b', 'stage5b64', 'stage5b_standard',
          'CLIENT', 'pro', 'decided', true, true, 'active');
  perform pg_temp.act_as(u_stats);
  select * into r from public.create_bot_game(gen_random_uuid(), 'test_free_server', 'B', pg_temp.bot_state(),
    'public', 'public', null, 'invite_only', null, null);
  perform pg_temp.expect('free SERVER bot: no charge', r.consumption_id, null::uuid);
  begin
    perform * from public.create_bot_game(gen_random_uuid(), 'test_free_server', 'B', pg_temp.bot_state(),
      'public', 'public', null, 'invite_only', null, 'credit');
    raise exception 'EXPECTED: funding a free bot';
  exception when others then if sqlerrm not like 'funding_not_applicable:%' then raise; end if;
  end;
  begin
    perform * from public.create_bot_game(gen_random_uuid(), 'test_pro_client', 'B', pg_temp.bot_state(),
      'public', 'public', null, 'invite_only', null, null);
    raise exception 'EXPECTED: unfunded Pro CLIENT bot';
  exception when others then if sqlerrm not like 'funding_required:%' then raise; end if;
  end;
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('no consumption for the free bot',
    (select count(*)::int from public.probot_consumptions where user_id = u_stats), 0);

  -- Stage 5B (pending) and Aether (retired) cannot be created
  perform pg_temp.act_as(u_stats);
  begin
    perform * from public.create_bot_game(gen_random_uuid(), 'stage5b', 'B', pg_temp.bot_state(),
      'public', 'public', null, 'invite_only', null, null);
    raise exception 'EXPECTED: Stage 5B created';
  exception when others then if sqlerrm not like 'bot_pending:%' then raise; end if;
  end;
  begin
    perform * from public.create_bot_game(gen_random_uuid(), 'aether_super', 'B', pg_temp.bot_state(),
      'public', 'public', null, 'invite_only', null, null);
    raise exception 'EXPECTED: Aether created';
  exception when others then if sqlerrm not like 'bot_closed:%' then raise; end if;
  end;

  -- ── Server-recorded bot statistics ────────────────────────────────────────
  perform pg_temp.act_as(admin_id);
  select * into folder from public.create_bot_folder('eco smoke', true);
  perform pg_temp.act_as(u_stats);
  perform public.record_bot_game_v2('forged', r.room_id, 'Me', null, 'B', 'authur', 'max', 999, 0,
    'bot_loss', 1, now());
  perform public.finalize_live_game(r.room_id, '{"status":"finished","scores":{"A":10,"B":20}}'::jsonb,
    'terminated', 'manual', null);
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('one server row, no forged row',
    (select count(*)::int from public.bot_stat_games where folder_id = folder.id), 1);
  perform pg_temp.expect('identity from the frozen room',
    (select bot_key || '/' || bot_engine || '/' || bot_difficulty || '/' || recorded_by_server
       from public.bot_stat_games where folder_id = folder.id),
    'test_free_server/stage5b/stage5b64/true');

  -- ── Status RPC ────────────────────────────────────────────────────────────
  perform pg_temp.act_as(u_limit);
  select public.get_my_probot_status() as s into g;
  perform pg_temp.expect('status plan', g.s ->> 'plan_key', 'plus');
  perform pg_temp.expect('status credits', (g.s ->> 'credits')::int, 5);
  perform pg_temp.expect('status allowance', g.s #>> '{allowance,reason}', 'empty');
  perform pg_temp.expect('status weekly used', (g.s #>> '{weekly,used}')::int, 3);
  perform pg_temp.expect('status boards', (g.s #>> '{boards,active}')::int || '/' || (g.s #>> '{boards,limit}'), '2/3');

  raise notice 'probot economy smoke test passed';
end
$eco$;

rollback;
