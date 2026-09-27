-- Phase 2 of the plan architecture: plan catalog, pass facts, plan timeline and
-- the effective plan at an instant.
--
-- Answers one question on the server: what plan does this account have at this
-- exact instant? Nothing here charges money, meters usage or gates a feature.
--
--   plan_catalog / plan_capability_defs / plan_capabilities
--       Server-owned plans (free, plus, pro) and what each one allows. A value
--       is `decided`, `undecided` (not configured) or `same_as` another plan's
--       value. Only `decided` configures anything.
--   plan_passes
--       Durable, immutable facts: who received which plan, for how many
--       calendar months, activated when, by whom, why. The only later change
--       is one revocation. Rows are never deleted.
--   plan_segments
--       The timeline DERIVED from the passes by rebuild_plan_timeline(). A pure
--       function of the facts; never of the current time. Expiry needs no job:
--       a segment simply stops covering the instant being asked about.
--
-- Months are calendar months in Asia/Bangkok, counted from a chain's anchor
-- (plan_add_months). A chain is a run of back-to-back passes of one plan.
--
-- Deliberately NOT here: purchases, the Plus → Pro upgrade (its value formula
-- is undecided, so there is no conversion fact and no upgrade path), refunds,
-- quotas, and any purchase month range. Idempotent: safe to re-run.
begin;

-- ── Calendar months ─────────────────────────────────────────────────────────

-- `n` calendar months after `anchor`, on Bangkok's calendar, at the anchor's
-- Bangkok time of day. A day that does not exist in the target month clamps to
-- that month's last day (Jan 31 + 1 → Feb 28/29). Callers always pass a
-- chain's ORIGINAL anchor and its TOTAL months, so a clamp never carries into
-- a later month (Jan 31 + 2 is Mar 31, not Mar 28). Thailand has no DST, so
-- every Bangkok wall time is one exact instant. Independent of the session's
-- TimeZone setting.
create or replace function public.plan_add_months(anchor timestamptz, n integer)
returns timestamptz
language sql immutable strict parallel safe set search_path = pg_catalog, pg_temp as $$
  select ((anchor at time zone 'Asia/Bangkok') + make_interval(months => n))
           at time zone 'Asia/Bangkok'
$$;

-- ── Catalog ─────────────────────────────────────────────────────────────────

create table if not exists public.plan_catalog (
  plan_key text primary key check (plan_key ~ '^[a-z][a-z0-9_]{1,30}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 60),
  rank integer not null unique check (rank >= 0),
  purchasable boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.plan_catalog (plan_key, display_name, rank, purchasable) values
  ('free', 'Free', 0, false),
  ('plus', 'EQ Plus', 10, true),
  ('pro', 'EQ Pro', 20, true)
on conflict (plan_key) do nothing;

create table if not exists public.plan_capability_defs (
  capability_key text primary key check (capability_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  value_type text not null check (value_type in ('integer', 'boolean')),
  description text not null
);

-- Only capabilities a plan actually changes. Host, Annotate, Ranked, normal and
-- friend games, Study, Analysis, Lock and Free-tier bots are core features and
-- deliberately have no capability: nothing can gate them by plan by accident.
insert into public.plan_capability_defs (capability_key, value_type, description) values
  ('stage_plan_ceiling', 'integer', 'Highest Stage number the plan allows. Progression gates apply separately.'),
  ('private_drive_limit', 'integer', 'Private Drive active-record capacity.')
on conflict (capability_key) do nothing;

create table if not exists public.plan_capabilities (
  plan_key text not null references public.plan_catalog (plan_key) on update restrict on delete restrict,
  capability_key text not null
    references public.plan_capability_defs (capability_key) on update restrict on delete restrict,
  status text not null check (status in ('decided', 'undecided', 'same_as')),
  value jsonb,
  same_as_plan text references public.plan_catalog (plan_key) on update restrict on delete restrict,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (plan_key, capability_key),
  constraint plan_capability_shape check (
    (status = 'decided' and value is not null and same_as_plan is null)
    or (status = 'undecided' and value is null and same_as_plan is null)
    or (status = 'same_as' and value is null and same_as_plan is not null and same_as_plan <> plan_key)
  )
);

-- True when `value` has the JSON type the capability declares.
create or replace function public.plan_capability_value_ok(target_capability text, value jsonb)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case d.value_type
             when 'integer' then jsonb_typeof(value) = 'number'
                                 and (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
             when 'boolean' then jsonb_typeof(value) = 'boolean'
             else false
           end
      from public.plan_capability_defs d where d.capability_key = target_capability
  ), false)
$$;

create or replace function public.check_plan_capability_value()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'decided' and not public.plan_capability_value_ok(new.capability_key, new.value) then
    raise exception 'capability % has a value of the wrong type', new.capability_key using errcode = '22023';
  end if;
  return new;
end; $$;
drop trigger if exists plan_capability_value_check on public.plan_capabilities;
create trigger plan_capability_value_check before insert or update on public.plan_capabilities
  for each row execute function public.check_plan_capability_value();

insert into public.plan_capabilities (plan_key, capability_key, status, value, same_as_plan, note) values
  ('free', 'stage_plan_ceiling', 'decided', '20', null, ''),
  ('plus', 'stage_plan_ceiling', 'decided', '40', null, ''),
  ('pro', 'stage_plan_ceiling', 'decided', '50', null, ''),
  ('free', 'private_drive_limit', 'undecided', null, null, 'Numeric limit not decided by the Product Owner.'),
  ('plus', 'private_drive_limit', 'undecided', null, null, 'Numeric limit not decided by the Product Owner.'),
  ('pro', 'private_drive_limit', 'same_as', null, 'plus', 'Product Owner: same as EQ Plus.')
on conflict (plan_key, capability_key) do nothing;

-- ── Pass facts ──────────────────────────────────────────────────────────────

create table if not exists public.plan_passes (
  id uuid primary key default gen_random_uuid(),
  -- Recording order. Breaks ties between facts activated at the same instant:
  -- each fact was decided against the facts recorded before it.
  seq bigint generated always as identity unique,
  user_id uuid not null references public.profiles (id) on update restrict on delete restrict,
  plan_key text not null references public.plan_catalog (plan_key) on update restrict on delete restrict,
  -- `grant` = `months` calendar months of `plan_key`, joining that plan's
  -- current chain or starting one. The only kind so far; a future kind needs
  -- a Product Owner rule and a rebuild rule of its own.
  kind text not null check (kind in ('grant')),
  months integer not null,
  -- Who established the fact. Payments will add their own source.
  source text not null check (source in ('admin')),
  idempotency_key text not null unique,
  activated_at timestamptz not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  -- A revocation is itself a small fact: when, by whom, why. Set once.
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  constraint plan_pass_paid_plan check (plan_key <> 'free'),
  constraint plan_pass_months_positive check (months >= 1),
  constraint plan_pass_revocation_shape check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or (revoked_at is not null and revoked_by is not null
        and length(btrim(coalesce(revoke_reason, ''))) between 1 and 500)
  )
);
create index if not exists plan_passes_user_idx on public.plan_passes (user_id, activated_at, seq);

-- Facts are immutable. The only change ever allowed is recording a revocation,
-- once, and nothing else in the same statement. Deleting a fact is refused.
-- (Binds every role in normal DML, the table owner included; the owner or a
-- superuser can disable the trigger — the trusted maintenance path.)
create or replace function public.protect_plan_pass()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'plan passes are durable facts and cannot be deleted' using errcode = '42501';
  end if;
  if old.revoked_at is not null
     or new.revoked_at is null
     or new.id is distinct from old.id or new.seq is distinct from old.seq
     or new.user_id is distinct from old.user_id
     or new.plan_key is distinct from old.plan_key or new.kind is distinct from old.kind
     or new.months is distinct from old.months or new.source is distinct from old.source
     or new.idempotency_key is distinct from old.idempotency_key
     or new.activated_at is distinct from old.activated_at
     or new.reason is distinct from old.reason or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'a plan pass is immutable except for a single revocation' using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists plan_pass_protected on public.plan_passes;
create trigger plan_pass_protected before update or delete on public.plan_passes
  for each row execute function public.protect_plan_pass();

-- ── Derived timeline ────────────────────────────────────────────────────────

create table if not exists public.plan_segments (
  user_id uuid not null references public.profiles (id) on update restrict on delete cascade,
  plan_key text not null references public.plan_catalog (plan_key) on update restrict on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  chain_anchor timestamptz not null,
  chain_months integer not null check (chain_months >= 1),
  rebuilt_at timestamptz not null default now(),
  primary key (user_id, plan_key, starts_at),
  check (ends_at > starts_at)
);
create index if not exists plan_segments_cover_idx on public.plan_segments (user_id, starts_at, ends_at);

alter table public.plan_catalog enable row level security;
alter table public.plan_capability_defs enable row level security;
alter table public.plan_capabilities enable row level security;
alter table public.plan_passes enable row level security;
alter table public.plan_segments enable row level security;
revoke all on table public.plan_catalog, public.plan_capability_defs, public.plan_capabilities,
  public.plan_passes, public.plan_segments
  from public, anon, authenticated, service_role;
-- The recording-order sequence decides replay order: nobody but the owner may
-- read or move it (setval).
do $$
begin
  execute format('revoke all on sequence %s from public, anon, authenticated, service_role',
                 pg_get_serial_sequence('public.plan_passes', 'seq'));
end $$;

create or replace function public.write_plan_segment(
  target_user uuid, target_plan text, seg_start timestamptz, seg_end timestamptz,
  seg_anchor timestamptz, seg_months integer
) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.plan_segments (user_id, plan_key, starts_at, ends_at, chain_anchor, chain_months)
  select target_user, target_plan, seg_start, seg_end, seg_anchor, seg_months
   where seg_end > seg_start
$$;

-- Rebuild one account's timeline from its facts. Deterministic: the same
-- non-revoked facts always give the same segments, whatever the current time,
-- the session time zone or the account's current approval status (none of
-- them is read).
--
-- Facts are replayed in (activated_at, seq) order — seq is recording order:
--   * Pro grant — extends the Pro chain if it is still running at activation,
--     otherwise starts one there. Extending moves a Plus chain that is waiting
--     behind Pro so it starts at the new Pro end.
--   * Plus grant — extends the Plus chain if it has not ended (running or
--     waiting); otherwise starts one at activation, or at the end of Pro if
--     Pro is running then (the approved Pro → Plus rule: paid Pro is never
--     cut short, Plus follows it).
-- Chain end = plan_add_months(chain anchor, total chain months), always.
--
-- The admin API never records a Pro grant while Plus is effective (that is the
-- undecided Plus → Pro upgrade). If a revocation leaves such an ordering in
-- the facts, both chains are laid down as recorded and the higher plan is the
-- effective one where they overlap. That is a deterministic replay rule, not a
-- product rule for upgrades.
create or replace function public.rebuild_plan_timeline(target_user uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  fact record;
  t timestamptz;
  pro_on boolean := false; pro_anchor timestamptz; pro_months int; pro_start timestamptz; pro_end timestamptz;
  plus_on boolean := false; plus_anchor timestamptz; plus_months int; plus_start timestamptz; plus_end timestamptz;
  written int;
begin
  delete from public.plan_segments where user_id = target_user;

  for fact in
    select p.* from public.plan_passes p
     where p.user_id = target_user and p.revoked_at is null
     order by p.activated_at, p.seq
  loop
    t := fact.activated_at;
    if fact.kind <> 'grant' then
      raise exception 'no timeline rule for pass kind %', fact.kind using errcode = '22023';
    end if;

    if fact.plan_key = 'pro' then
      if pro_on and pro_end > t then
        pro_months := pro_months + fact.months;
        if plus_on and plus_start >= pro_end and plus_start > t then
          -- Plus is waiting behind this Pro chain: it moves with the new end.
          pro_end := public.plan_add_months(pro_anchor, pro_months);
          plus_anchor := pro_end; plus_start := pro_end;
          plus_end := public.plan_add_months(plus_anchor, plus_months);
        else
          pro_end := public.plan_add_months(pro_anchor, pro_months);
        end if;
      else
        if pro_on then
          perform public.write_plan_segment(target_user, 'pro', pro_start, pro_end, pro_anchor, pro_months);
        end if;
        pro_on := true; pro_anchor := t; pro_months := fact.months; pro_start := t;
        pro_end := public.plan_add_months(t, fact.months);
      end if;
    elsif fact.plan_key = 'plus' then
      if plus_on and plus_end > t then
        plus_months := plus_months + fact.months;
        plus_end := public.plan_add_months(plus_anchor, plus_months);
      else
        if plus_on then
          perform public.write_plan_segment(target_user, 'plus', plus_start, plus_end, plus_anchor, plus_months);
        end if;
        plus_on := true; plus_months := fact.months;
        plus_anchor := case when pro_on and pro_end > t then pro_end else t end;
        plus_start := plus_anchor;
        plus_end := public.plan_add_months(plus_anchor, plus_months);
      end if;
    else
      raise exception 'no timeline rule for plan %', fact.plan_key using errcode = '22023';
    end if;
  end loop;

  if pro_on then
    perform public.write_plan_segment(target_user, 'pro', pro_start, pro_end, pro_anchor, pro_months);
  end if;
  if plus_on then
    perform public.write_plan_segment(target_user, 'plus', plus_start, plus_end, plus_anchor, plus_months);
  end if;

  select count(*) into written from public.plan_segments where user_id = target_user;
  return written;
end; $$;

-- ── Effective plan ──────────────────────────────────────────────────────────

-- A capability's value for a plan, failing closed:
--   {"status":"decided","value":…}   the only state that configures anything
--   {"status":"undecided"}           not configured (missing row, undecided,
--                                    or a same_as chain that ends undecided)
--   {"status":"invalid"}             a stored value of the wrong type, a
--                                    same_as cycle, or an unknown capability
-- `via` lists the plans a same_as passed through. Callers must treat anything
-- but `decided` as "not granted": never unlimited, never zero-as-allowed.
create or replace function public.plan_capability(target_plan text, target_capability text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  current_plan text := target_plan;
  row_ public.plan_capabilities%rowtype;
  via text[] := '{}';
  suffix jsonb;
begin
  if not exists (select 1 from public.plan_capability_defs where capability_key = target_capability) then
    return jsonb_build_object('status', 'invalid');
  end if;
  for hop in 1..4 loop
    suffix := case when cardinality(via) > 0 then jsonb_build_object('via', to_jsonb(via)) else '{}'::jsonb end;
    select * into row_ from public.plan_capabilities
     where plan_key = current_plan and capability_key = target_capability;
    if not found or row_.status = 'undecided' then
      return jsonb_build_object('status', 'undecided') || suffix;
    end if;
    if row_.status = 'decided' then
      if not public.plan_capability_value_ok(target_capability, row_.value) then
        return jsonb_build_object('status', 'invalid') || suffix;
      end if;
      return jsonb_build_object('status', 'decided', 'value', row_.value) || suffix;
    end if;
    if row_.same_as_plan = any (via) or row_.same_as_plan = target_plan then
      return jsonb_build_object('status', 'invalid', 'via', to_jsonb(via || row_.same_as_plan));
    end if;
    via := via || row_.same_as_plan;
    current_plan := row_.same_as_plan;
  end loop;
  return jsonb_build_object('status', 'invalid', 'via', to_jsonb(via));
end; $$;

-- The plan in effect for an account at an instant, from its timeline only.
-- effective_start/end bound the stretch in which this plan stays the effective
-- one (a higher plan starting, or the chain ending, closes it). Free's bounds
-- are the neighbouring paid stretches, or null. Where segments overlap, the
-- higher rank wins, then the earlier start: deterministic.
create or replace function public.plan_effective(target_user uuid, at_instant timestamptz)
returns table (plan_key text, display_name text, rank integer,
               effective_start timestamptz, effective_end timestamptz, capabilities jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  chosen record;
  eff_start timestamptz;
  eff_end timestamptz;
  next_end timestamptz;
  guard int := 0;
begin
  select s.plan_key, s.starts_at, s.ends_at, c.rank, c.display_name
    into chosen
    from public.plan_segments s join public.plan_catalog c on c.plan_key = s.plan_key
   where s.user_id = target_user and s.starts_at <= at_instant and at_instant < s.ends_at
   order by c.rank desc, s.starts_at
   limit 1;

  if not found then
    select max(s.ends_at) into eff_start from public.plan_segments s
     where s.user_id = target_user and s.ends_at <= at_instant;
    select min(s.starts_at) into eff_end from public.plan_segments s
     where s.user_id = target_user and s.starts_at > at_instant;
    return query
      select c.plan_key, c.display_name, c.rank, eff_start, eff_end,
             (select coalesce(jsonb_object_agg(d.capability_key, public.plan_capability('free', d.capability_key)), '{}'::jsonb)
                from public.plan_capability_defs d)
        from public.plan_catalog c where c.plan_key = 'free';
    return;
  end if;

  select greatest(chosen.starts_at, coalesce(max(h.ends_at), chosen.starts_at)) into eff_start
    from public.plan_segments h join public.plan_catalog hc on hc.plan_key = h.plan_key
   where h.user_id = target_user and hc.rank > chosen.rank
     and h.ends_at <= at_instant and h.ends_at > chosen.starts_at;

  eff_end := chosen.ends_at;
  loop
    guard := guard + 1;
    select s.ends_at into next_end from public.plan_segments s
     where s.user_id = target_user and s.plan_key = chosen.plan_key and s.starts_at = eff_end;
    exit when not found or guard > 50;
    eff_end := next_end;
  end loop;
  select least(eff_end, coalesce(min(h.starts_at), eff_end)) into eff_end
    from public.plan_segments h join public.plan_catalog hc on hc.plan_key = h.plan_key
   where h.user_id = target_user and hc.rank > chosen.rank
     and h.starts_at > at_instant and h.starts_at < eff_end;

  return query
    select chosen.plan_key, chosen.display_name, chosen.rank, eff_start, eff_end,
           (select coalesce(jsonb_object_agg(d.capability_key, public.plan_capability(chosen.plan_key, d.capability_key)), '{}'::jsonb)
              from public.plan_capability_defs d);
end; $$;

-- The caller's own plan. It takes no account id: the account is auth.uid().
-- `at_instant` lets a client ask about its own future or past.
create or replace function public.get_my_plan(at_instant timestamptz default null)
returns table (plan_key text, display_name text, rank integer,
               effective_start timestamptz, effective_end timestamptz, capabilities jsonb,
               evaluated_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  caller uuid := auth.uid();
  instant timestamptz := coalesce(at_instant, now());
begin
  if caller is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  return query
    select e.plan_key, e.display_name, e.rank, e.effective_start, e.effective_end, e.capabilities, instant
      from public.plan_effective(caller, instant) e;
end; $$;

create or replace function public.get_my_plan_timeline()
returns table (plan_key text, starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  return query
    select s.plan_key, s.starts_at, s.ends_at from public.plan_segments s
     where s.user_id = caller order by s.starts_at, s.plan_key;
end; $$;

-- ── Administration (testing Plus/Pro before payments exist) ─────────────────

-- Grants `months` calendar months of a paid plan, activated now, through the
-- same facts and rebuild as every other pass. Not a trial: an administrative,
-- zero-price fact with a required reason.
--
-- Idempotency: the request id is the key. The same request (same admin,
-- account, plan, months and reason) returns the pass it already made; the
-- same id with anything different is an explicit conflict, never a silent
-- replay of another operation.
--
-- Month count: at least 1. No product maximum here — the purchase range is a
-- Product Owner decision for the payment phase. The only upper bound is a
-- technical guard: the resulting timeline must end before year 10000, which
-- keeps every instant inside PostgreSQL's arithmetic and the 4-digit-year
-- ISO-8601 strings clients parse. A grant beyond it is refused and records
-- nothing.
create or replace function public.admin_grant_plan(
  target_user uuid,
  target_plan text,
  target_months integer,
  target_reason text,
  target_request_id uuid
) returns table (pass_id uuid, replayed boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := auth.uid();
  key text;
  clean_reason text := btrim(coalesce(target_reason, ''));
  previous public.plan_passes%rowtype;
  current_plan text;
  new_id uuid;
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
  if target_months is null or target_months < 1 then
    raise exception 'months must be at least 1' using errcode = '22023';
  end if;
  if not exists (select 1 from public.plan_catalog where plan_key = target_plan and purchasable) then
    raise exception 'unknown paid plan' using errcode = '22023';
  end if;
  key := 'admin:' || target_request_id::text;

  -- A replay is answered before anything about the account is re-checked: the
  -- request already happened.
  select * into previous from public.plan_passes where idempotency_key = key;
  if not found then
    if not exists (select 1 from public.profiles where id = target_user and status = 'approved') then
      raise exception 'plans can only be granted to approved accounts' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(target_user::text, 41));

    select e.plan_key into current_plan from public.plan_effective(target_user, now()) e;
    if target_plan = 'pro' and current_plan = 'plus' then
      raise exception 'plus_active: EQ Plus is active; a Plus to Pro upgrade is not available until its terms are decided'
        using errcode = '22023';
    end if;

    insert into public.plan_passes (user_id, plan_key, kind, months, source, idempotency_key,
                                    activated_at, reason, created_by)
    values (target_user, target_plan, 'grant', target_months, 'admin', key,
            now(), clean_reason, caller)
    on conflict (idempotency_key) do nothing
    returning id into new_id;

    if new_id is not null then
      begin
        perform public.rebuild_plan_timeline(target_user);
      exception when datetime_field_overflow or numeric_value_out_of_range or interval_field_overflow then
        raise exception 'technical guard: this grant would take the plan timeline out of range'
          using errcode = '22023';
      end;
      if exists (select 1 from public.plan_segments
                  where user_id = target_user and ends_at >= timestamptz '10000-01-01 00:00+07') then
        raise exception 'technical guard: the plan timeline must end before year 10000'
          using errcode = '22023';
      end if;
      return query select new_id, false;
      return;
    end if;
    -- Lost a race to a concurrent request with the same id: compare with it.
    select * into previous from public.plan_passes where idempotency_key = key;
  end if;

  if previous.user_id is distinct from target_user or previous.plan_key is distinct from target_plan
     or previous.months is distinct from target_months or previous.kind is distinct from 'grant'
     or previous.reason is distinct from clean_reason or previous.created_by is distinct from caller then
    raise exception 'idempotency_conflict: this request id was already used for a different grant'
      using errcode = '22023';
  end if;
  return query select previous.id, true;
end; $$;

create or replace function public.admin_revoke_pass(target_pass uuid, target_reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  owner_id uuid;
  clean_reason text := btrim(coalesce(target_reason, ''));
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if clean_reason = '' then
    raise exception 'a revocation needs a reason' using errcode = '22023';
  end if;
  if length(clean_reason) > 500 then
    raise exception 'a reason is at most 500 characters' using errcode = '22023';
  end if;
  select user_id into owner_id from public.plan_passes where id = target_pass;
  if owner_id is null then
    raise exception 'unknown pass' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 41));
  update public.plan_passes
     set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = clean_reason
   where id = target_pass and revoked_at is null;
  if not found then
    raise exception 'pass already revoked' using errcode = '22023';
  end if;
  perform public.rebuild_plan_timeline(owner_id);
end; $$;

create or replace function public.admin_get_user_plan(target_user uuid, at_instant timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  instant timestamptz := coalesce(at_instant, now());
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'evaluated_at', instant,
    'effective', (select to_jsonb(e) from public.plan_effective(target_user, instant) e),
    'segments', coalesce((select jsonb_agg(jsonb_build_object(
        'plan_key', s.plan_key, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
        'chain_anchor', s.chain_anchor, 'chain_months', s.chain_months) order by s.starts_at, s.plan_key)
      from public.plan_segments s where s.user_id = target_user), '[]'::jsonb),
    'passes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'plan_key', p.plan_key, 'kind', p.kind, 'months', p.months, 'source', p.source,
        'activated_at', p.activated_at, 'reason', p.reason, 'created_by', p.created_by,
        'revoked_at', p.revoked_at, 'revoked_by', p.revoked_by,
        'revoke_reason', p.revoke_reason) order by p.activated_at, p.seq)
      from public.plan_passes p where p.user_id = target_user), '[]'::jsonb)
  );
end; $$;

-- ── Grants ──────────────────────────────────────────────────────────────────

revoke all on function public.plan_add_months(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.plan_capability_value_ok(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.check_plan_capability_value() from public, anon, authenticated, service_role;
revoke all on function public.protect_plan_pass() from public, anon, authenticated, service_role;
revoke all on function public.write_plan_segment(uuid, text, timestamptz, timestamptz, timestamptz, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.rebuild_plan_timeline(uuid) from public, anon, authenticated, service_role;
revoke all on function public.plan_capability(text, text) from public, anon, authenticated, service_role;
revoke all on function public.plan_effective(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.get_my_plan(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.get_my_plan_timeline() from public, anon, authenticated, service_role;
revoke all on function public.admin_grant_plan(uuid, text, integer, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_revoke_pass(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_get_user_plan(uuid, timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.get_my_plan(timestamptz) to authenticated;
grant execute on function public.get_my_plan_timeline() to authenticated;
grant execute on function public.admin_grant_plan(uuid, text, integer, text, uuid) to authenticated;
grant execute on function public.admin_revoke_pass(uuid, text) to authenticated;
grant execute on function public.admin_get_user_plan(uuid, timestamptz) to authenticated;

commit;
