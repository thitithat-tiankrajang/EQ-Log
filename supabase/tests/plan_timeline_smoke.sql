-- Local/staging-only smoke test for 20260928120000_plan_timeline.sql.
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/plan_timeline_smoke.sql
-- Timeline cases record facts at chosen activation instants (as the table
-- owner, the way a future payment path would) and rebuild; API cases go through
-- the real RPCs. Always rolls back.

begin;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.act_as_owner() returns void language plpgsql as $$
begin execute 'reset role'; end $$;

-- A grant fact at a chosen instant, then a rebuild.
create function pg_temp.fact(target uuid, plan text, months int, at_ timestamptz) returns uuid
language plpgsql as $$
declare new_id uuid;
begin
  insert into public.plan_passes (user_id, plan_key, kind, months, source, idempotency_key,
                                  activated_at, reason, created_by)
  values (target, plan, 'grant', months, 'admin', 'test:' || gen_random_uuid(), at_,
          'smoke', '00000000-0000-4000-8000-000000000201')
  returning id into new_id;
  perform public.rebuild_plan_timeline(target);
  return new_id;
end $$;

create function pg_temp.plan_at(target uuid, at_ timestamptz) returns text language sql as $$
  select plan_key from public.plan_effective(target, at_)
$$;

create function pg_temp.expect(label text, actual anyelement, expected anyelement) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception '%: expected %, got %', label, expected, actual;
  end if;
end $$;

create function pg_temp.timeline(target uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_array(plan_key, starts_at, ends_at, chain_anchor, chain_months)
                            order by starts_at, plan_key), '[]'::jsonb)
    from public.plan_segments where user_id = target
$$;

create function pg_temp.segment(target uuid, plan text) returns text language sql as $$
  select string_agg(starts_at::text || ' → ' || ends_at::text, ' | ' order by starts_at)
    from public.plan_segments where user_id = target and plan_key = plan
$$;

-- Independent oracle for calendar-month addition: explicit year/month/day on
-- Bangkok's calendar, day clamped to the target month's length. Uses no
-- month interval arithmetic on the anchor itself.
create function pg_temp.oracle_add_months(anchor timestamptz, n int) returns timestamptz
language sql as $$
  with local as (select anchor at time zone 'Asia/Bangkok' as ts),
  parts as (
    select extract(year from ts)::int as y, extract(month from ts)::int as m,
           extract(day from ts)::int as d, ts::time as tod from local
  ),
  target as (
    select y + (m - 1 + n) / 12 as ty, ((m - 1 + n) % 12) + 1 as tm, d, tod from parts
  ),
  bounded as (
    select ty, tm, d, tod,
           extract(day from (make_date(ty, tm, 1) + interval '1 month' - interval '1 day'))::int as last_day
      from target
  )
  select (make_date(ty, tm, least(d, last_day)) + tod) at time zone 'Asia/Bangkok' from bounded
$$;

insert into auth.users (id, email, aud, role)
select ('00000000-0000-4000-8000-0000000002' || lpad(n::text, 2, '0'))::uuid,
       'plan-' || n || '@example.test', 'authenticated', 'authenticated'
  from generate_series(1, 30) n;
update public.profiles set status = 'approved'
 where id::text like '00000000-0000-4000-8000-0000000002%';
update public.profiles set is_admin = true
 where id in ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000220');
update public.profiles set status = 'pending' where id = '00000000-0000-4000-8000-000000000214';

do $smoke$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000201';
  admin2 constant uuid := '00000000-0000-4000-8000-000000000220';
  u_none constant uuid := '00000000-0000-4000-8000-000000000202';
  u_jan constant uuid := '00000000-0000-4000-8000-000000000203';
  u_leap constant uuid := '00000000-0000-4000-8000-000000000204';
  u_year constant uuid := '00000000-0000-4000-8000-000000000205';
  u_bkk constant uuid := '00000000-0000-4000-8000-000000000206';
  u_future constant uuid := '00000000-0000-4000-8000-000000000207';
  u_sched constant uuid := '00000000-0000-4000-8000-000000000208';
  u_long constant uuid := '00000000-0000-4000-8000-000000000209';
  u_det constant uuid := '00000000-0000-4000-8000-000000000210';
  u_api constant uuid := '00000000-0000-4000-8000-000000000211';
  u_api2 constant uuid := '00000000-0000-4000-8000-000000000212';
  u_other constant uuid := '00000000-0000-4000-8000-000000000213';
  u_pending constant uuid := '00000000-0000-4000-8000-000000000214';
  u_ov1 constant uuid := '00000000-0000-4000-8000-000000000215';
  u_ov2 constant uuid := '00000000-0000-4000-8000-000000000216';
  u_ov3 constant uuid := '00000000-0000-4000-8000-000000000217';
  u_rev constant uuid := '00000000-0000-4000-8000-000000000218';
  u_appr constant uuid := '00000000-0000-4000-8000-000000000219';
  u_guard constant uuid := '00000000-0000-4000-8000-000000000221';
  e record;
  before_rebuild jsonb;
  g record;
  g2 record;
  n int;
  a timestamptz;
  pro_id uuid;
  mismatches text := '';
  checked int := 0;
  two_months constant timestamptz := public.plan_add_months(now(), 2);
  one_month constant timestamptz := public.plan_add_months(now(), 1);
  k1 constant uuid := '33333333-0000-4000-8000-000000000001';
begin
  -- ── Calendar months against an independent oracle ─────────────────────────
  for a in
    select (d || ' ' || t || '+07')::timestamptz
      from unnest(array['2027-01-29', '2027-01-30', '2027-01-31', '2027-03-31', '2027-05-31',
                        '2027-08-31', '2027-10-31', '2027-12-31', '2027-02-28', '2028-02-29',
                        '2028-01-31', '2028-12-31']) d,
           unnest(array['00:00:00', '00:30:00', '10:00:00', '23:59:59']) t
  loop
    foreach n in array array[1, 2, 3, 5, 6, 11, 12, 13, 14, 23, 24, 25, 36, 48, 49, 121] loop
      checked := checked + 1;
      if public.plan_add_months(a, n) is distinct from pg_temp.oracle_add_months(a, n) then
        mismatches := mismatches || format('%s+%s=%s (oracle %s); ', a, n,
          public.plan_add_months(a, n), pg_temp.oracle_add_months(a, n));
      end if;
    end loop;
  end loop;
  if mismatches <> '' then raise exception 'calendar months disagree with the oracle: %', mismatches; end if;
  perform pg_temp.expect('oracle cases checked', checked, 12 * 4 * 16);
  perform pg_temp.expect('Jan 31 + 1', public.plan_add_months('2027-01-31 10:00+07', 1), '2027-02-28 10:00+07'::timestamptz);
  perform pg_temp.expect('Jan 31 + 2', public.plan_add_months('2027-01-31 10:00+07', 2), '2027-03-31 10:00+07'::timestamptz);
  perform pg_temp.expect('repeated clamped addition would drift',
    public.plan_add_months(public.plan_add_months('2027-01-31 10:00+07', 1), 1), '2027-03-28 10:00+07'::timestamptz);
  perform pg_temp.expect('leap', public.plan_add_months('2028-01-31 10:00+07', 1), '2028-02-29 10:00+07'::timestamptz);
  perform pg_temp.expect('Feb 29 + 12', public.plan_add_months('2028-02-29 10:00+07', 12), '2029-02-28 10:00+07'::timestamptz);
  perform pg_temp.expect('Feb 29 + 48', public.plan_add_months('2028-02-29 10:00+07', 48), '2032-02-29 10:00+07'::timestamptz);
  perform pg_temp.expect('Dec 31 + 2', public.plan_add_months('2026-12-31 23:30+07', 2), '2027-02-28 23:30+07'::timestamptz);
  -- Bangkok's calendar, not UTC's: these UTC instants are already the next Bangkok day.
  perform pg_temp.expect('UTC Jan 30 17:30 = Bangkok Jan 31',
    public.plan_add_months('2027-01-30 17:30Z', 1), '2027-02-28 00:30+07'::timestamptz);
  perform pg_temp.expect('UTC Mar 30 17:00 = Bangkok Mar 31 00:00',
    public.plan_add_months('2027-03-30 17:00Z', 1), '2027-04-30 00:00+07'::timestamptz);
  perform pg_temp.expect('UTC Feb 28 16:59:59 = Bangkok Feb 28 23:59:59',
    public.plan_add_months('2027-02-28 16:59:59Z', 12), '2028-02-28 23:59:59+07'::timestamptz);
  set local timezone = 'America/New_York';
  perform pg_temp.expect('session time zone does not matter',
    public.plan_add_months('2027-01-30 17:30Z', 1), '2027-02-28 00:30+07'::timestamptz);
  set local timezone = 'UTC';

  -- ── No pass → Free ────────────────────────────────────────────────────────
  select * into e from public.plan_effective(u_none, now());
  perform pg_temp.expect('no pass', e.plan_key, 'free');
  if e.effective_start is not null or e.effective_end is not null then
    raise exception 'Free with no history has no bounds';
  end if;
  perform pg_temp.expect('free stage ceiling', e.capabilities -> 'stage_plan_ceiling',
    '{"status":"decided","value":20}'::jsonb);
  perform pg_temp.expect('free drive limit undecided', e.capabilities -> 'private_drive_limit',
    '{"status":"undecided"}'::jsonb);

  -- ── Same-plan extension keeps the Jan 31 anchor ──────────────────────────
  perform pg_temp.fact(u_jan, 'plus', 1, '2027-01-31 10:00+07');
  perform pg_temp.expect('first month ends Feb 28', pg_temp.segment(u_jan, 'plus'),
    '2027-01-31 03:00:00+00 → 2027-02-28 03:00:00+00');
  perform pg_temp.fact(u_jan, 'plus', 1, '2027-02-15 09:00+07');   -- bought mid-chain
  perform pg_temp.expect('extension ends Mar 31, not Mar 28 or Mar 15', pg_temp.segment(u_jan, 'plus'),
    '2027-01-31 03:00:00+00 → 2027-03-31 03:00:00+00');
  perform pg_temp.expect('active at activation instant', pg_temp.plan_at(u_jan, '2027-01-31 10:00+07'), 'plus');
  perform pg_temp.expect('not before it', pg_temp.plan_at(u_jan, '2027-01-31 09:59:59.999999+07'), 'free');
  perform pg_temp.expect('active a microsecond before the end',
    pg_temp.plan_at(u_jan, '2027-03-31 09:59:59.999999+07'), 'plus');
  perform pg_temp.expect('expired exactly at the end', pg_temp.plan_at(u_jan, '2027-03-31 10:00+07'), 'free');
  select * into e from public.plan_effective(u_jan, '2027-04-10 00:00+07');
  perform pg_temp.expect('expired → Free since the end', e.effective_start, '2027-03-31 10:00+07'::timestamptz);
  select * into e from public.plan_effective(u_jan, '2027-03-01 00:00+07');
  perform pg_temp.expect('plus capability', e.capabilities -> 'stage_plan_ceiling', '{"status":"decided","value":40}'::jsonb);
  perform pg_temp.fact(u_jan, 'plus', 1, '2027-05-31 12:00+07');   -- after the chain ended: new chain
  perform pg_temp.expect('new chain after a gap', pg_temp.segment(u_jan, 'plus'),
    '2027-01-31 03:00:00+00 → 2027-03-31 03:00:00+00 | 2027-05-31 05:00:00+00 → 2027-06-30 05:00:00+00');

  -- 14 one-month grants inside one chain end exactly at anchor + 14 months
  for n in 1..14 loop
    perform pg_temp.fact(u_long, 'plus', 1, '2027-01-31 10:00+07'::timestamptz + (n - 1) * interval '1 day');
  end loop;
  perform pg_temp.expect('14 stacked grants = anchor + 14 months',
    (select ends_at from public.plan_segments where user_id = u_long),
    pg_temp.oracle_add_months('2027-01-31 10:00+07', 14));

  -- ── Leap year, year boundary, Bangkok instant ────────────────────────────
  perform pg_temp.fact(u_leap, 'plus', 1, '2028-01-31 10:00+07');
  perform pg_temp.fact(u_leap, 'plus', 12, '2028-02-10 10:00+07');
  perform pg_temp.expect('13 months from Jan 31 2028', (select ends_at from public.plan_segments where user_id = u_leap),
    '2029-02-28 10:00+07'::timestamptz);
  perform pg_temp.fact(u_year, 'pro', 2, '2026-12-31 23:30+07');
  perform pg_temp.expect('across the year', (select ends_at from public.plan_segments where user_id = u_year),
    '2027-02-28 23:30+07'::timestamptz);
  select * into e from public.plan_effective(u_year, '2027-01-15 00:00+07');
  perform pg_temp.expect('active Pro', e.plan_key, 'pro');
  perform pg_temp.expect('pro stage ceiling', e.capabilities -> 'stage_plan_ceiling', '{"status":"decided","value":50}'::jsonb);
  perform pg_temp.expect('pro drive limit follows plus (undecided)', e.capabilities -> 'private_drive_limit',
    '{"status":"undecided","via":["plus"]}'::jsonb);
  perform pg_temp.fact(u_bkk, 'plus', 1, '2027-01-30 17:30Z');
  perform pg_temp.expect('Bangkok chain end', (select ends_at from public.plan_segments where user_id = u_bkk),
    '2027-02-28 00:30+07'::timestamptz);

  -- ── A future activation does not apply early ──────────────────────────────
  perform pg_temp.fact(u_future, 'pro', 1, '2030-01-01 00:00+07');
  perform pg_temp.expect('free before activation', pg_temp.plan_at(u_future, '2029-12-31 23:59:59+07'), 'free');
  select * into e from public.plan_effective(u_future, '2029-12-31 00:00+07');
  perform pg_temp.expect('free until the scheduled start', e.effective_end, '2030-01-01 00:00+07'::timestamptz);
  perform pg_temp.expect('pro from activation', pg_temp.plan_at(u_future, '2030-01-01 00:00+07'), 'pro');

  -- ── Pro → Plus: Plus waits behind Pro, and moves when Pro is extended ─────
  perform pg_temp.fact(u_sched, 'pro', 1, '2027-01-10 12:00+07');
  perform pg_temp.fact(u_sched, 'plus', 1, '2027-01-20 12:00+07');
  perform pg_temp.expect('Plus scheduled at the Pro end', pg_temp.segment(u_sched, 'plus'),
    '2027-02-10 05:00:00+00 → 2027-03-10 05:00:00+00');
  select * into e from public.plan_effective(u_sched, '2027-02-01 00:00+07');
  perform pg_temp.expect('still Pro while Plus waits', e.plan_key, 'pro');
  perform pg_temp.expect('Pro ends at its own end', e.effective_end, '2027-02-10 12:00+07'::timestamptz);
  perform pg_temp.fact(u_sched, 'pro', 1, '2027-02-01 12:00+07');
  perform pg_temp.expect('Plus moved after the new Pro end', pg_temp.segment(u_sched, 'plus'),
    '2027-03-10 05:00:00+00 → 2027-04-10 05:00:00+00');
  perform pg_temp.fact(u_sched, 'plus', 2, '2027-02-20 12:00+07');
  perform pg_temp.expect('waiting Plus extended from its anchor', pg_temp.segment(u_sched, 'plus'),
    '2027-03-10 05:00:00+00 → 2027-06-10 05:00:00+00');

  -- ── Overlaps (only reachable by recording facts directly) ─────────────────
  -- Plus, then Pro while Plus runs: both chains stand; Pro wins the overlap.
  perform pg_temp.fact(u_ov1, 'plus', 3, '2027-01-01 00:00+07');
  perform pg_temp.fact(u_ov1, 'pro', 1, '2027-01-11 00:00+07');
  perform pg_temp.expect('overlap: Plus before', pg_temp.plan_at(u_ov1, '2027-01-05 00:00+07'), 'plus');
  perform pg_temp.expect('overlap: Pro wins', pg_temp.plan_at(u_ov1, '2027-01-20 00:00+07'), 'pro');
  perform pg_temp.expect('overlap: Plus after Pro ends', pg_temp.plan_at(u_ov1, '2027-02-20 00:00+07'), 'plus');
  select * into e from public.plan_effective(u_ov1, '2027-01-05 00:00+07');
  perform pg_temp.expect('Plus effective end = Pro start', e.effective_end, '2027-01-11 00:00+07'::timestamptz);
  select * into e from public.plan_effective(u_ov1, '2027-02-20 00:00+07');
  perform pg_temp.expect('Plus effective start = Pro end', e.effective_start, '2027-02-11 00:00+07'::timestamptz);
  -- Same instant: recording order decides. Pro recorded first → Plus waits.
  perform pg_temp.fact(u_ov2, 'pro', 1, '2027-06-01 00:00+07');
  perform pg_temp.fact(u_ov2, 'plus', 1, '2027-06-01 00:00+07');
  perform pg_temp.expect('same instant, Pro first', pg_temp.segment(u_ov2, 'plus'),
    '2027-06-30 17:00:00+00 → 2027-07-31 17:00:00+00');
  -- Plus recorded first → both start together, Pro effective.
  perform pg_temp.fact(u_ov3, 'plus', 1, '2027-06-01 00:00+07');
  perform pg_temp.fact(u_ov3, 'pro', 1, '2027-06-01 00:00+07');
  perform pg_temp.expect('same instant, Plus first: Pro effective', pg_temp.plan_at(u_ov3, '2027-06-01 00:00+07'), 'pro');
  perform pg_temp.expect('same instant, Plus first: Plus chain as recorded', pg_temp.segment(u_ov3, 'plus'),
    '2027-05-31 17:00:00+00 → 2027-06-30 17:00:00+00');
  -- Revocation then rebuild: a scheduled Plus falls back to its own activation.
  pro_id := pg_temp.fact(u_rev, 'pro', 1, '2027-01-10 12:00+07');
  perform pg_temp.fact(u_rev, 'plus', 1, '2027-01-20 12:00+07');
  update public.plan_passes set revoked_at = now(), revoked_by = admin_id, revoke_reason = 'smoke'
   where id = pro_id;
  perform public.rebuild_plan_timeline(u_rev);
  perform pg_temp.expect('revoked Pro: Plus starts at its activation', pg_temp.segment(u_rev, 'plus'),
    '2027-01-20 05:00:00+00 → 2027-02-20 05:00:00+00');
  perform pg_temp.expect('revoked Pro is gone', pg_temp.segment(u_rev, 'pro'), null::text);

  -- ── Determinism ───────────────────────────────────────────────────────────
  perform pg_temp.fact(u_det, 'pro', 2, '2027-05-31 10:00+07');
  perform pg_temp.fact(u_det, 'plus', 1, '2027-06-01 10:00+07');
  perform pg_temp.fact(u_det, 'pro', 1, '2027-06-15 10:00+07');
  perform pg_temp.fact(u_det, 'plus', 1, '2027-06-15 10:00+07');
  before_rebuild := pg_temp.timeline(u_det);
  for n in 1..3 loop perform public.rebuild_plan_timeline(u_det); end loop;
  perform pg_temp.expect('rebuild is stable', pg_temp.timeline(u_det), before_rebuild);
  delete from public.plan_segments where user_id = u_det;
  set local timezone = 'Pacific/Kiritimati';
  perform public.rebuild_plan_timeline(u_det);
  set local timezone = 'UTC';
  perform pg_temp.expect('rebuild from facts alone, any session time zone', pg_temp.timeline(u_det), before_rebuild);
  perform pg_temp.expect('Plus waits behind the whole Pro chain', pg_temp.segment(u_det, 'plus'),
    '2027-08-31 03:00:00+00 → 2027-10-31 03:00:00+00');

  -- ── Admin API ─────────────────────────────────────────────────────────────
  perform pg_temp.act_as(u_other);
  begin
    perform * from public.admin_grant_plan(u_other, 'pro', 12, 'self-service', gen_random_uuid());
    raise exception 'EXPECTED: non-admin granted a plan';
  exception when others then if sqlerrm <> 'admin access required' then raise; end if;
  end;
  begin
    perform public.admin_get_user_plan(u_api);
    raise exception 'EXPECTED: non-admin read another plan';
  exception when others then if sqlerrm <> 'admin access required' then raise; end if;
  end;

  perform pg_temp.act_as(admin_id);
  begin
    perform * from public.admin_grant_plan(u_api, 'free', 1, 'x', gen_random_uuid());
    raise exception 'EXPECTED: free granted as a pass';
  exception when others then if sqlerrm <> 'unknown paid plan' then raise; end if;
  end;
  foreach n in array array[0, -1, -2147483648] loop
    begin
      perform * from public.admin_grant_plan(u_api, 'plus', n, 'x', gen_random_uuid());
      raise exception 'EXPECTED: % months granted', n;
    exception when others then if sqlerrm <> 'months must be at least 1' then raise; end if;
    end;
  end loop;
  begin
    perform * from public.admin_grant_plan(u_api, 'plus', null, 'x', gen_random_uuid());
    raise exception 'EXPECTED: null months granted';
  exception when others then if sqlerrm <> 'months must be at least 1' then raise; end if;
  end;
  begin
    perform * from public.admin_grant_plan(u_api, 'plus', 1, '  ', gen_random_uuid());
    raise exception 'EXPECTED: grant without reason';
  exception when others then if sqlerrm <> 'a grant needs a reason' then raise; end if;
  end;
  begin
    perform * from public.admin_grant_plan(u_pending, 'plus', 1, 'x', gen_random_uuid());
    raise exception 'EXPECTED: grant to unapproved account';
  exception when others then if sqlerrm <> 'plans can only be granted to approved accounts' then raise; end if;
  end;

  -- technical guard: far beyond any plausible grant, nothing is recorded
  foreach n in array array[2147483647, 100000] loop
    begin
      perform * from public.admin_grant_plan(u_guard, 'plus', n, 'guard', gen_random_uuid());
      raise exception 'EXPECTED: % months accepted', n;
    exception when others then if sqlerrm not like 'technical guard:%' then raise; end if;
    end;
  end loop;
  select * into g from public.admin_grant_plan(u_guard, 'plus', 1200, 'a century is fine', gen_random_uuid());
  begin
    perform * from public.admin_grant_plan(u_guard, 'plus', 95000, 'chain past 9999', gen_random_uuid());
    raise exception 'EXPECTED: chain beyond year 10000';
  exception when others then if sqlerrm not like 'technical guard:%' then raise; end if;
  end;
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('guarded grants recorded nothing',
    (select count(*)::int from public.plan_passes where user_id = u_guard), 1);
  perform pg_temp.act_as(admin_id);

  -- idempotency: same request → same pass; anything different → explicit conflict
  select * into g from public.admin_grant_plan(u_api, 'plus', 2, 'Phase 2 testing', k1);
  if g.replayed then raise exception 'first grant reported as replay'; end if;
  select * into g2 from public.admin_grant_plan(u_api, 'plus', 2, '  Phase 2 testing ', k1);
  if not g2.replayed or g2.pass_id <> g.pass_id then raise exception 'duplicate grant not replayed'; end if;
  begin
    perform * from public.admin_grant_plan(u_api, 'plus', 3, 'Phase 2 testing', k1);
    raise exception 'EXPECTED: same key, other months';
  exception when others then if sqlerrm not like 'idempotency_conflict:%' then raise; end if;
  end;
  begin
    perform * from public.admin_grant_plan(u_api, 'pro', 2, 'Phase 2 testing', k1);
    raise exception 'EXPECTED: same key, other plan';
  exception when others then if sqlerrm not like 'idempotency_conflict:%' then raise; end if;
  end;
  begin
    perform * from public.admin_grant_plan(u_other, 'plus', 2, 'Phase 2 testing', k1);
    raise exception 'EXPECTED: same key, other account';
  exception when others then if sqlerrm not like 'idempotency_conflict:%' then raise; end if;
  end;
  begin
    perform * from public.admin_grant_plan(u_api, 'plus', 2, 'another reason', k1);
    raise exception 'EXPECTED: same key, other reason';
  exception when others then if sqlerrm not like 'idempotency_conflict:%' then raise; end if;
  end;
  perform pg_temp.act_as(admin2);
  begin
    perform * from public.admin_grant_plan(u_api, 'plus', 2, 'Phase 2 testing', k1);
    raise exception 'EXPECTED: same key, other administrator';
  exception when others then if sqlerrm not like 'idempotency_conflict:%' then raise; end if;
  end;
  perform pg_temp.act_as_owner();
  perform pg_temp.expect('one pass for the key', (select count(*)::int from public.plan_passes where user_id = u_api), 1);
  perform pg_temp.expect('nothing for the other account', (select count(*)::int from public.plan_passes where user_id = u_other), 0);
  perform pg_temp.expect('pass is administrative', (select source || '/' || kind || '/' || created_by::text
     from public.plan_passes where id = g.pass_id), 'admin/grant/' || admin_id::text);
  perform pg_temp.expect('activated by the server, now', (select activated_at from public.plan_passes where id = g.pass_id), now());

  perform pg_temp.act_as(u_api);
  select * into e from public.get_my_plan();
  perform pg_temp.expect('user sees Plus', e.plan_key, 'plus');
  perform pg_temp.expect('two calendar months from activation', e.effective_end, two_months);
  perform pg_temp.act_as(u_other);
  perform pg_temp.expect('others still Free', (select plan_key from public.get_my_plan()), 'free');

  -- no Plus → Pro path: a Pro grant over running Plus is refused
  perform pg_temp.act_as(admin_id);
  begin
    perform * from public.admin_grant_plan(u_api, 'pro', 1, 'x', gen_random_uuid());
    raise exception 'EXPECTED: Pro grant over running Plus';
  exception when others then if sqlerrm not like 'plus_active:%' then raise; end if;
  end;

  -- Pro → Plus through the API: Plus is scheduled after Pro
  perform * from public.admin_grant_plan(u_api2, 'pro', 1, 'x', gen_random_uuid());
  perform * from public.admin_grant_plan(u_api2, 'plus', 1, 'x', gen_random_uuid());
  perform pg_temp.act_as(u_api2);
  perform pg_temp.expect('still Pro', (select plan_key from public.get_my_plan()), 'pro');
  perform pg_temp.expect('Plus after Pro', (select plan_key from public.get_my_plan(one_month + interval '1 second')), 'plus');
  perform pg_temp.expect('timeline shows both',
    (select string_agg(plan_key, ',' order by starts_at) from public.get_my_plan_timeline()), 'pro,plus');

  -- revoke
  begin
    perform public.admin_revoke_pass(g.pass_id, 'nope');
    raise exception 'EXPECTED: non-admin revoked';
  exception when others then if sqlerrm <> 'admin access required' then raise; end if;
  end;
  perform pg_temp.act_as(admin_id);
  perform public.admin_revoke_pass(g.pass_id, 'undo grant');
  begin
    perform public.admin_revoke_pass(g.pass_id, 'again');
    raise exception 'EXPECTED: double revoke';
  exception when others then if sqlerrm <> 'pass already revoked' then raise; end if;
  end;
  perform pg_temp.act_as(u_api);
  perform pg_temp.expect('revoked → Free', (select plan_key from public.get_my_plan()), 'free');
  perform pg_temp.act_as(admin_id);
  if (public.admin_get_user_plan(u_api) -> 'passes' -> 0 ->> 'revoke_reason') <> 'undo grant'
     or (public.admin_get_user_plan(u_api) -> 'passes' -> 0 ->> 'revoked_by') <> admin_id::text then
    raise exception 'revocation not visible to admin';
  end if;
  -- replaying the original request after revocation returns the revoked pass, not a new grant
  select * into g2 from public.admin_grant_plan(u_api, 'plus', 2, 'Phase 2 testing', k1);
  if not g2.replayed or g2.pass_id <> g.pass_id then raise exception 'replay after revoke made a new pass'; end if;

  -- ── Approval changes do not touch plan history ────────────────────────────
  select * into g from public.admin_grant_plan(u_appr, 'plus', 1, 'approval test', '33333333-0000-4000-8000-0000000000a1');
  perform pg_temp.act_as_owner();
  update public.profiles set status = 'blocked' where id = u_appr;
  perform public.rebuild_plan_timeline(u_appr);
  perform pg_temp.expect('blocked account keeps its plan history', pg_temp.plan_at(u_appr, now()), 'plus');
  perform pg_temp.act_as(u_appr);
  perform pg_temp.expect('and reads it', (select plan_key from public.get_my_plan()), 'plus');
  perform pg_temp.act_as(admin_id);
  begin
    perform * from public.admin_grant_plan(u_appr, 'plus', 1, 'x', gen_random_uuid());
    raise exception 'EXPECTED: new grant to a blocked account';
  exception when others then if sqlerrm <> 'plans can only be granted to approved accounts' then raise; end if;
  end;

  raise notice 'plan timeline smoke test passed (% calendar cases)', checked;
end
$smoke$;

-- ── Capability resolution fails closed (maintenance-level corruption) ───────
reset role;
do $caps$
begin
  if public.plan_capability('plus', 'stage_plan_ceiling') <> '{"status":"decided","value":40}' then
    raise exception 'decided'; end if;
  if public.plan_capability('plus', 'private_drive_limit') <> '{"status":"undecided"}' then
    raise exception 'undecided'; end if;
  if public.plan_capability('pro', 'private_drive_limit') <> '{"status":"undecided","via":["plus"]}' then
    raise exception 'same_as'; end if;
  if public.plan_capability('plus', 'host_role') <> '{"status":"invalid"}' then
    raise exception 'unknown capability must be invalid'; end if;

  -- same_as target with no row → undecided
  delete from public.plan_capabilities where plan_key = 'plus' and capability_key = 'private_drive_limit';
  if public.plan_capability('pro', 'private_drive_limit') <> '{"status":"undecided","via":["plus"]}' then
    raise exception 'missing same_as target'; end if;
  if public.plan_capability('plus', 'private_drive_limit') <> '{"status":"undecided"}' then
    raise exception 'missing row'; end if;

  -- a same_as cycle → invalid, not a value
  insert into public.plan_capabilities (plan_key, capability_key, status, same_as_plan)
  values ('plus', 'private_drive_limit', 'same_as', 'pro');
  if public.plan_capability('pro', 'private_drive_limit') ->> 'status' <> 'invalid'
     or public.plan_capability('plus', 'private_drive_limit') ->> 'status' <> 'invalid' then
    raise exception 'cycle must be invalid'; end if;

  -- a wrong-typed value slipped past the trigger → invalid, never "unlimited"
  alter table public.plan_capabilities disable trigger plan_capability_value_check;
  update public.plan_capabilities set value = '"unlimited"' where plan_key = 'free' and capability_key = 'stage_plan_ceiling';
  alter table public.plan_capabilities enable trigger plan_capability_value_check;
  if public.plan_capability('free', 'stage_plan_ceiling') <> '{"status":"invalid"}' then
    raise exception 'wrong type must be invalid'; end if;
  if (select capabilities -> 'stage_plan_ceiling' ->> 'status'
        from public.plan_effective('00000000-0000-4000-8000-000000000202', now())) <> 'invalid' then
    raise exception 'effective plan must expose invalid'; end if;
  raise notice 'capability resolution fails closed';
end
$caps$;

rollback;
