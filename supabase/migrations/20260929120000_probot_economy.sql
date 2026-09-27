-- Phase 3: the Pro-Bot economy — regenerating allowance, weekly allowance cap,
-- permanent Pro-Bot Credits, and an immutable record of every funded room.
--
-- A Pro-tier bot room is funded by exactly one of:
--   ALLOWANCE — an active paid plan's regenerating allowance (lazy: no job);
--   CREDIT    — one permanent Pro-Bot Credit (any approved account, Free too).
-- The caller chooses; the server never switches one for the other. Free-tier
-- bots and Stage attempts are never charged. Funding follows the bot's ACCESS
-- TIER only — never its execution location.
--
-- Time: every decision uses one instant T taken AFTER the per-user lock, never
-- earlier than anything already recorded for the account (probot_now), so a
-- transaction that waited for the lock cannot see time run backwards.
-- Weeks are Bangkok calendar weeks, [Monday 00:00, next Monday 00:00).
-- Idempotent.
begin;

-- ── Plan capabilities ───────────────────────────────────────────────────────

insert into public.plan_capability_defs (capability_key, value_type, description) values
  ('probot_allowance_capacity', 'integer', 'Pro-Bot allowance units held when full. 0 = no allowance.'),
  ('probot_regen_minutes', 'integer', 'Minutes per regenerated Pro-Bot allowance unit.'),
  ('probot_weekly_allowance_cap', 'integer', 'Allowance-funded Pro-Bot rooms per Bangkok week. Credits do not count.')
on conflict (capability_key) do nothing;

insert into public.plan_capabilities (plan_key, capability_key, status, value, same_as_plan, note) values
  ('free', 'probot_allowance_capacity', 'decided', '0', null, 'Free has no regenerating allowance.'),
  -- Free's regeneration is NULL = not applicable: with capacity 0 it has no
  -- observable effect, and probot_allowance_at refuses the Free plan before
  -- it reads the interval, so Free can never receive allowance.
  ('free', 'probot_regen_minutes', 'undecided', null, null, 'No allowance to regenerate.'),
  ('free', 'probot_weekly_allowance_cap', 'decided', '0', null, ''),
  ('plus', 'probot_allowance_capacity', 'decided', '3', null, ''),
  ('plus', 'probot_regen_minutes', 'decided', '30', null, ''),
  ('plus', 'probot_weekly_allowance_cap', 'decided', '30', null, ''),
  ('pro', 'probot_allowance_capacity', 'decided', '10', null, ''),
  ('pro', 'probot_regen_minutes', 'decided', '30', null, ''),
  ('pro', 'probot_weekly_allowance_cap', 'decided', '300', null, '')
on conflict (plan_key, capability_key) do nothing;

-- ── Credit ledger (generic; only probot_credit is active) ───────────────────

create table if not exists public.economy_entries (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  user_id uuid not null references public.profiles (id) on update restrict on delete restrict,
  -- Widening this list (e.g. 'exp') is how a new currency is introduced.
  currency text not null check (currency in ('probot_credit')),
  delta integer not null check (delta <> 0),
  -- Active reasons. Future sources (event_reward, mission_reward, promotion,
  -- admin_adjust, reversal) are added by widening this list.
  reason text not null check (reason in ('admin_grant', 'probot_room')),
  source_type text not null check (source_type in ('admin_request', 'bot_room')),
  source_id text not null,
  idempotency_key text not null unique,
  note text not null default '' check (length(note) <= 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  balance_after bigint not null check (balance_after >= 0)
);
create index if not exists economy_entries_user_idx on public.economy_entries (user_id, currency, seq);

create table if not exists public.economy_balances (
  user_id uuid not null references public.profiles (id) on update restrict on delete restrict,
  currency text not null check (currency in ('probot_credit')),
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, currency)
);

-- ── Allowance state and consumption record ──────────────────────────────────

-- A small cache of the allowance at `anchor_at`. The consumption record is the
-- history; this row only avoids replaying it. Written only by probot_charge.
create table if not exists public.probot_allowance_state (
  user_id uuid primary key references public.profiles (id) on update restrict on delete cascade,
  epoch_plan text not null references public.plan_catalog (plan_key),
  epoch_start timestamptz not null,
  units integer not null check (units >= 0),
  anchor_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- One row per funded Pro-tier bot room. Rooms are deleted when they finish;
-- this record is not tied to the room row and outlives it.
create table if not exists public.probot_consumptions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  user_id uuid not null references public.profiles (id) on update restrict on delete restrict,
  room_id uuid not null unique,
  request_id uuid not null,
  bot_key text not null references public.bot_catalog (bot_key) on update restrict on delete restrict,
  funding text not null check (funding in ('allowance', 'credit')),
  plan_key_at_use text not null references public.plan_catalog (plan_key),
  allowance_epoch_plan text references public.plan_catalog (plan_key),
  allowance_epoch_start timestamptz,
  credit_entry_id uuid unique references public.economy_entries (id) on delete restrict,
  consumed_at timestamptz not null,
  unique (user_id, request_id),
  constraint probot_consumption_funding_shape check (
    (funding = 'allowance' and allowance_epoch_plan is not null and allowance_epoch_start is not null
      and credit_entry_id is null)
    or (funding = 'credit' and credit_entry_id is not null
      and allowance_epoch_plan is null and allowance_epoch_start is null)
  )
);
create index if not exists probot_consumptions_week_idx
  on public.probot_consumptions (user_id, funding, consumed_at);

-- Ledger rows are facts: no update, no delete (the owner/superuser can switch
-- this off for maintenance).
create or replace function public.protect_economy_fact()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception '% rows are immutable', tg_table_name using errcode = '42501';
end; $$;
drop trigger if exists economy_entries_immutable on public.economy_entries;
create trigger economy_entries_immutable before update or delete on public.economy_entries
  for each row execute function public.protect_economy_fact();
drop trigger if exists probot_consumptions_immutable on public.probot_consumptions;
create trigger probot_consumptions_immutable before update or delete on public.probot_consumptions
  for each row execute function public.protect_economy_fact();

alter table public.economy_entries enable row level security;
alter table public.economy_balances enable row level security;
alter table public.probot_allowance_state enable row level security;
alter table public.probot_consumptions enable row level security;
revoke all on table public.economy_entries, public.economy_balances,
  public.probot_allowance_state, public.probot_consumptions
  from public, anon, authenticated, service_role;
do $$
begin
  execute format('revoke all on sequence %s from public, anon, authenticated, service_role',
                 pg_get_serial_sequence('public.economy_entries', 'seq'));
  execute format('revoke all on sequence %s from public, anon, authenticated, service_role',
                 pg_get_serial_sequence('public.probot_consumptions', 'seq'));
end $$;

-- ── Primitives ──────────────────────────────────────────────────────────────

-- Monday 00:00 in Bangkok of the week containing `t`, as an instant.
create or replace function public.bangkok_week_start(t timestamptz)
returns timestamptz
language sql immutable strict parallel safe set search_path = pg_catalog, pg_temp as $$
  select date_trunc('week', t at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'
$$;

-- A decided integer capability, or null (not configured → nothing granted).
create or replace function public.plan_capability_int(target_plan text, target_capability text)
returns integer
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  resolved jsonb := public.plan_capability(target_plan, target_capability);
begin
  if resolved ->> 'status' <> 'decided' then
    return null;
  end if;
  return (resolved ->> 'value')::integer;
end; $$;

-- Start of the uninterrupted run of `target_plan` that contains `t`: walks
-- back across segment boundaries while the effective plan stays the same, so
-- a same-plan chain that continues exactly at a boundary is ONE epoch.
create or replace function public.plan_epoch_start(target_user uuid, t timestamptz, target_plan text)
returns timestamptz
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cursor_at timestamptz;
  earlier record;
  guard int := 0;
begin
  select e.effective_start into cursor_at from public.plan_effective(target_user, t) e
   where e.plan_key = target_plan;
  loop
    exit when cursor_at is null or guard > 200;
    guard := guard + 1;
    select e.plan_key, e.effective_start into earlier
      from public.plan_effective(target_user, cursor_at - interval '1 microsecond') e;
    exit when earlier.plan_key is distinct from target_plan or earlier.effective_start is null
      or earlier.effective_start >= cursor_at;
    cursor_at := earlier.effective_start;
  end loop;
  return cursor_at;
end; $$;

-- The instant used for this account's economy decision: now, but never
-- earlier than anything already recorded for it.
create or replace function public.probot_now(target_user uuid)
returns timestamptz
language sql volatile security definer set search_path = public, pg_temp as $$
  select greatest(
    clock_timestamp(),
    coalesce((select s.anchor_at from public.probot_allowance_state s where s.user_id = target_user), '-infinity'),
    coalesce((select max(c.consumed_at) from public.probot_consumptions c where c.user_id = target_user), '-infinity')
  )
$$;

-- The allowance of an account at instant `t`, computed without writing.
--   reason: ok | free_plan | not_configured | empty | weekly_cap
create or replace function public.probot_allowance_at(target_user uuid, t timestamptz)
returns table (
  plan_key text, capacity integer, regen_minutes integer, units integer, anchor_at timestamptz,
  next_unit_at timestamptz, epoch_plan text, epoch_start timestamptz,
  weekly_cap integer, weekly_used integer, week_start timestamptz, week_end timestamptz,
  reason text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  plan text;
  cap integer;
  regen integer;
  wcap integer;
  wstart timestamptz := public.bangkok_week_start(t);
  used integer;
  e_start timestamptz;
  st public.probot_allowance_state%rowtype;
  u integer;
  a timestamptz;
  k bigint;
begin
  select ef.plan_key into plan from public.plan_effective(target_user, t) ef;
  cap := coalesce(public.plan_capability_int(plan, 'probot_allowance_capacity'), 0);
  regen := public.plan_capability_int(plan, 'probot_regen_minutes');
  wcap := coalesce(public.plan_capability_int(plan, 'probot_weekly_allowance_cap'), 0);
  select count(*)::integer into used from public.probot_consumptions c
   where c.user_id = target_user and c.funding = 'allowance'
     and c.consumed_at >= wstart and c.consumed_at < wstart + interval '7 days';

  if plan = 'free' or cap <= 0 then
    return query select plan, 0, regen, 0, null::timestamptz, null::timestamptz, null::text,
      null::timestamptz, wcap, used, wstart, wstart + interval '7 days',
      case when plan = 'free' then 'free_plan' else 'not_configured' end;
    return;
  end if;
  if regen is null or regen <= 0 or wcap <= 0 then
    return query select plan, cap, regen, 0, null::timestamptz, null::timestamptz, null::text,
      null::timestamptz, wcap, used, wstart, wstart + interval '7 days', 'not_configured';
    return;
  end if;

  e_start := public.plan_epoch_start(target_user, t, plan);
  select * into st from public.probot_allowance_state s where s.user_id = target_user;
  if not found or st.epoch_plan is distinct from plan or st.epoch_start is distinct from e_start then
    -- A new uninterrupted paid-plan epoch starts full.
    u := cap; a := t;
  elsif st.units >= cap then
    u := cap; a := t;
  else
    k := floor(extract(epoch from (t - st.anchor_at)) / (regen * 60))::bigint;
    if k < 0 then k := 0; end if;
    u := least(cap::bigint, st.units + k)::integer;
    a := case when u >= cap then t else st.anchor_at + make_interval(mins => (k * regen)::integer) end;
  end if;

  return query select plan, cap, regen, u, a,
    case when u < cap then a + make_interval(mins => regen) else null end,
    plan, e_start, wcap, used, wstart, wstart + interval '7 days',
    case when used >= wcap then 'weekly_cap' when u < 1 then 'empty' else 'ok' end;
end; $$;

-- Post one ledger entry and move the balance with it, atomically. A spend
-- that would go below zero is refused and records nothing.
create or replace function public.economy_post(
  target_user uuid, target_currency text, target_delta integer, target_reason text,
  target_source_type text, target_source_id text, target_key text, target_created_by uuid,
  target_note text default ''
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  new_balance bigint;
  entry uuid;
begin
  insert into public.economy_balances (user_id, currency, balance)
  values (target_user, target_currency, 0)
  on conflict (user_id, currency) do nothing;
  update public.economy_balances
     set balance = balance + target_delta, updated_at = now()
   where user_id = target_user and currency = target_currency
     and balance + target_delta >= 0
  returning balance into new_balance;
  if not found then
    raise exception 'insufficient_credits: not enough Pro-Bot Credits' using errcode = 'P0001';
  end if;
  insert into public.economy_entries (user_id, currency, delta, reason, source_type, source_id,
                                      idempotency_key, note, created_by, balance_after)
  values (target_user, target_currency, target_delta, target_reason, target_source_type,
          target_source_id, target_key, coalesce(target_note, ''), target_created_by, new_balance)
  returning id into entry;
  return entry;
end; $$;

-- Charge one Pro-tier bot room. Called only inside room creation, after the
-- per-user lock, with the instant from probot_now. Returns the consumption id.
create or replace function public.probot_charge(
  target_user uuid, target_request uuid, target_room uuid, target_bot_key text,
  target_funding text, t timestamptz
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  al record;
  plan text;
  entry uuid;
  consumption uuid;
  next_anchor timestamptz;
begin
  -- Callers already hold this (per-user, re-entrant); taking it here too means
  -- no future caller can charge without serialising on the user.
  perform pg_advisory_xact_lock(hashtextextended(target_user::text, 41));
  if target_funding = 'allowance' then
    select * into al from public.probot_allowance_at(target_user, t);
    if al.reason = 'free_plan' then
      raise exception 'allowance_free_plan: the Free plan has no Pro-Bot allowance' using errcode = 'P0001';
    elsif al.reason = 'not_configured' then
      raise exception 'allowance_not_configured: this plan has no Pro-Bot allowance configured' using errcode = 'P0001';
    elsif al.reason = 'weekly_cap' then
      raise exception 'allowance_weekly_cap: weekly Pro-Bot allowance used (% of %)', al.weekly_used, al.weekly_cap
        using errcode = 'P0001';
    elsif al.reason = 'empty' then
      raise exception 'allowance_empty: no Pro-Bot allowance until %', al.next_unit_at using errcode = 'P0001';
    end if;
    -- A full allowance starts its regeneration clock at this spend.
    next_anchor := case when al.units >= al.capacity then t else al.anchor_at end;
    insert into public.probot_allowance_state as s (user_id, epoch_plan, epoch_start, units, anchor_at, updated_at)
    values (target_user, al.epoch_plan, al.epoch_start, al.units - 1, next_anchor, now())
    on conflict (user_id) do update
      set epoch_plan = excluded.epoch_plan, epoch_start = excluded.epoch_start,
          units = excluded.units, anchor_at = excluded.anchor_at, updated_at = excluded.updated_at;
    insert into public.probot_consumptions (user_id, room_id, request_id, bot_key, funding,
      plan_key_at_use, allowance_epoch_plan, allowance_epoch_start, consumed_at)
    values (target_user, target_room, target_request, target_bot_key, 'allowance',
      al.plan_key, al.epoch_plan, al.epoch_start, t)
    returning id into consumption;
    return consumption;
  elsif target_funding = 'credit' then
    select e.plan_key into plan from public.plan_effective(target_user, t) e;
    entry := public.economy_post(target_user, 'probot_credit', -1, 'probot_room', 'bot_room',
                                 target_room::text, 'probot_room:' || target_room::text, target_user, '');
    insert into public.probot_consumptions (user_id, room_id, request_id, bot_key, funding,
      plan_key_at_use, credit_entry_id, consumed_at)
    values (target_user, target_room, target_request, target_bot_key, 'credit', plan, entry, t)
    returning id into consumption;
    return consumption;
  end if;
  raise exception 'funding_required: choose ALLOWANCE or CREDIT for a Pro bot' using errcode = '22023';
end; $$;

-- ── Administration ──────────────────────────────────────────────────────────

-- Grants Pro-Bot Credits (support, testing, operational compensation). Not a
-- balance setter: every change is a ledger entry. Same request → same entry;
-- same id with anything different → idempotency_conflict.
create or replace function public.admin_grant_credits(
  target_user uuid, target_amount integer, target_reason text, target_request_id uuid
) returns table (entry_id uuid, replayed boolean, balance bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := auth.uid();
  key text;
  clean_reason text := btrim(coalesce(target_reason, ''));
  previous public.economy_entries%rowtype;
  new_entry uuid;
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if target_request_id is null then
    raise exception 'a grant needs a request id' using errcode = '22023';
  end if;
  if clean_reason = '' then
    raise exception 'a grant needs a reason' using errcode = '22023';
  end if;
  if length(clean_reason) > 500 then
    raise exception 'a reason is at most 500 characters' using errcode = '22023';
  end if;
  if target_amount is null or target_amount < 1 then
    raise exception 'amount must be a positive whole number' using errcode = '22023';
  end if;
  key := 'admin_credit:' || target_request_id::text;
  select * into previous from public.economy_entries where idempotency_key = key;
  if not found then
    if not exists (select 1 from public.profiles where id = target_user and status = 'approved') then
      raise exception 'credits can only be granted to approved accounts' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(target_user::text, 41));
    select * into previous from public.economy_entries where idempotency_key = key;
    if not found then
      new_entry := public.economy_post(target_user, 'probot_credit', target_amount, 'admin_grant',
                                       'admin_request', target_request_id::text, key, caller, clean_reason);
      return query select new_entry, false,
        (select b.balance from public.economy_balances b where b.user_id = target_user and b.currency = 'probot_credit');
      return;
    end if;
  end if;
  if previous.user_id is distinct from target_user or previous.delta is distinct from target_amount
     or previous.note is distinct from clean_reason or previous.created_by is distinct from caller
     or previous.reason is distinct from 'admin_grant' then
    raise exception 'idempotency_conflict: this request id was already used for a different grant'
      using errcode = '22023';
  end if;
  return query select previous.id, true,
    (select b.balance from public.economy_balances b where b.user_id = previous.user_id and b.currency = 'probot_credit');
end; $$;

revoke all on function public.protect_economy_fact() from public, anon, authenticated, service_role;
revoke all on function public.bangkok_week_start(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.plan_capability_int(text, text) from public, anon, authenticated, service_role;
revoke all on function public.plan_epoch_start(uuid, timestamptz, text) from public, anon, authenticated, service_role;
revoke all on function public.probot_now(uuid) from public, anon, authenticated, service_role;
revoke all on function public.probot_allowance_at(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.economy_post(uuid, text, integer, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.probot_charge(uuid, uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_grant_credits(uuid, integer, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_grant_credits(uuid, integer, text, uuid) to authenticated;

commit;
