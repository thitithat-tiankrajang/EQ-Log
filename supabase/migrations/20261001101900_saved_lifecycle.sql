-- Explicit Saved ownership lifecycle. Payload retention follows the row in
-- every state; only ACTIVE consumes plan capacity.
begin;

alter table public.saved_game_items
  add column state text not null default 'active'
    check (state in ('active', 'trashed', 'overflow')),
  add column state_changed_at timestamptz not null default now(),
  add column origin text not null default 'explicit'
    check (origin in ('explicit', 'legacy_migration', 'legacy_finish')),
  add column legacy_item_id uuid;
create index saved_game_items_active_idx on public.saved_game_items
  (participant_id, saved_at, source_kind, source_id) where state = 'active';
create index saved_game_items_state_page_idx on public.saved_game_items
  (participant_id, state, state_changed_at desc, source_kind desc, source_id desc);
comment on column public.saved_game_items.state is
  'Active consumes capacity; Trash and Overflow retain replay without active capacity.';

-- The oldest explicit ownership remains active on a downgrade. This avoids a
-- new Save displacing a game the player has kept for longer. No promotion is
-- automatic when the limit later grows.
create function public.reconcile_saved_capacity(p_user_id uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare plan text; cap integer; changed integer;
begin
  if p_user_id is null then raise exception 'account required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 41));
  select e.plan_key into plan from public.plan_effective(p_user_id, now()) e;
  cap := public.plan_capability_int(plan, 'private_drive_limit');
  if cap is null or cap < 0 then raise exception 'Saved capacity is not configured' using errcode = '22023'; end if;
  with ranked as (
    select source_kind, source_id, row_number() over (
      order by saved_at, source_kind, source_id
    ) as ordinal from public.saved_game_items
    where participant_id = p_user_id and state = 'active'
  )
  update public.saved_game_items i set state = 'overflow', state_changed_at = now()
  from ranked r where i.participant_id = p_user_id
    and i.source_kind = r.source_kind and i.source_id = r.source_id
    and r.ordinal > cap;
  get diagnostics changed = row_count;
  return changed;
end $$;
revoke all on function public.reconcile_saved_capacity(uuid)
  from public, anon, authenticated, service_role;

-- Restore and Activate share the Save/plan account lock. A missing row is a
-- harmless repeat of delete; every other transition checks ownership/state.
create function public.change_my_saved_game(
  p_source_kind text, p_source_id uuid, p_action text
) returns table (state text, active_count bigint, capacity integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare viewer uuid := auth.uid(); current_state text; plan text; used bigint;
begin
  if auth.role() is distinct from 'authenticated' or viewer is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_source_kind is null or p_source_kind not in ('normal', 'stage') or p_source_id is null
    or p_action is null or p_action not in ('trash', 'restore', 'activate', 'delete') then
    raise exception 'invalid Saved transition' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(viewer::text, 41));
  perform public.reconcile_saved_capacity(viewer);
  select i.state into current_state from public.saved_game_items i
    where i.participant_id = viewer and i.source_kind = p_source_kind
      and i.source_id = p_source_id for update;
  select e.plan_key into plan from public.plan_effective(viewer, now()) e;
  capacity := public.plan_capability_int(plan, 'private_drive_limit');
  select count(*) into used from public.saved_game_items i
    where i.participant_id = viewer and i.state = 'active';
  if current_state is null then
    if p_action <> 'delete' then raise exception 'Saved game not found' using errcode = 'P0002'; end if;
    state := 'deleted'; active_count := used; return next; return;
  end if;
  if p_action = 'trash' then
    if current_state <> 'trashed' then
      update public.saved_game_items i set state = 'trashed', state_changed_at = now()
        where i.participant_id = viewer and i.source_kind = p_source_kind
          and i.source_id = p_source_id;
      if current_state = 'active' then used := used - 1; end if;
    end if;
    state := 'trashed';
  elsif p_action = 'delete' then
    if current_state <> 'trashed' then
      raise exception 'move to Trash before permanent deletion' using errcode = '22023';
    end if;
    delete from public.saved_game_items i where i.participant_id = viewer
      and i.source_kind = p_source_kind and i.source_id = p_source_id;
    state := 'deleted';
  else
    if current_state = 'active' then state := 'active';
    elsif (p_action = 'restore' and current_state <> 'trashed')
      or (p_action = 'activate' and current_state <> 'overflow') then
      raise exception 'invalid Saved transition' using errcode = '22023';
    elsif used >= capacity then
      raise exception 'Saved capacity reached (% of %). Item remains available.', used, capacity
        using errcode = 'P0001';
    else
      update public.saved_game_items i set state = 'active', state_changed_at = now()
        where i.participant_id = viewer and i.source_kind = p_source_kind
          and i.source_id = p_source_id;
      used := used + 1; state := 'active';
    end if;
  end if;
  active_count := used; return next;
end $$;
revoke all on function public.change_my_saved_game(text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.change_my_saved_game(text, uuid, text) to authenticated;

-- The underlying M9 Save paths count only ACTIVE items. Existing Trash or
-- Overflow ownership is idempotent and must be restored/activated explicitly.
create or replace function public.save_completed_game_before_legacy_validation(
  p_source_kind text, p_source_id uuid
) returns table (saved_at timestamptz, already_saved boolean, active_count bigint,
  capacity integer, plan_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare viewer uuid := auth.uid(); existing timestamptz;
  resolved_plan text; resolved_name text; cap integer; used bigint;
  history_row public.game_history%rowtype; legacy jsonb;
begin
  if auth.role() is distinct from 'authenticated' or viewer is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_source_kind not in ('normal', 'stage') or p_source_id is null then
    raise exception 'unsupported Saved source' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(viewer::text, 41));
  perform public.reconcile_saved_capacity(viewer);
  select * into history_row from public.game_history h
    where h.source_kind = p_source_kind and h.source_id = p_source_id
      and h.participant_id = viewer;
  if not found then raise exception 'completed participant History required' using errcode = '42501'; end if;
  select i.saved_at into existing from public.saved_game_items i
    where i.source_kind = p_source_kind and i.source_id = p_source_id
      and i.participant_id = viewer;
  select e.plan_key, e.display_name into resolved_plan, resolved_name
    from public.plan_effective(viewer, now()) e;
  cap := public.plan_capability_int(resolved_plan, 'private_drive_limit');
  if cap is null or cap < 0 then raise exception 'Saved capacity is not configured' using errcode = '22023'; end if;
  select count(*) into used from public.saved_game_items i
    where i.participant_id = viewer and i.state = 'active';
  if existing is not null then
    return query select existing, true, used, cap, resolved_name; return;
  end if;
  if used >= cap then
    raise exception 'Saved capacity reached (% of %). Existing games remain available.', used, cap
      using errcode = 'P0001';
  end if;
  if p_source_kind = 'stage' then
    if not exists (select 1 from public.stage_completed_attempts s
      where s.attempt_id = p_source_id and s.player_id = viewer
        and s.room_id = history_row.game_id
        and s.record ->> 'format' = '1' and s.record ->> 'digest' = s.record_digest
        and s.record #>> '{provenance,mode}' = 'stage') then
      raise exception 'Stage replay unavailable' using errcode = '22023';
    end if;
  else
    perform pg_advisory_xact_lock(hashtextextended('eq-payload:' || p_source_id::text, 0));
    if not exists (select 1 from public.recent_game_payloads p
      where p.source_kind = 'normal' and p.source_id = p_source_id
        and p.game_id = history_row.game_id)
      and not exists (select 1 from public.saved_legacy_payloads l
        where l.source_kind = 'normal' and l.source_id = p_source_id) then
      legacy := public.saved_legacy_source(history_row.game_id);
      if legacy is null then
        raise exception 'complete replay unavailable for Saved' using errcode = '22023';
      end if;
      insert into public.saved_legacy_payloads (source_id, game_id, snapshot)
      values (p_source_id, history_row.game_id, legacy) on conflict do nothing;
    end if;
  end if;
  insert into public.saved_game_items (source_kind, source_id, participant_id)
    values (p_source_kind, p_source_id, viewer) returning saved_game_items.saved_at into existing;
  return query select existing, false, used + 1, cap, resolved_name;
end $$;

create or replace function public.save_validated_legacy_game(
  p_source_id uuid, p_user_id uuid, p_source_digest text
) returns table (saved_at timestamptz, already_saved boolean, active_count bigint,
  capacity integer, plan_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare id uuid; existing timestamptz; candidate jsonb; frozen jsonb;
  resolved_plan text; resolved_name text; cap integer; used bigint;
begin
  if auth.role() is distinct from 'service_role' or p_source_id is null
    or p_user_id is null or p_source_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'trusted validated legacy Save required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 41));
  perform public.reconcile_saved_capacity(p_user_id);
  select h.game_id into id from public.game_history h
    where h.source_kind = 'normal' and h.source_id = p_source_id
      and h.participant_id = p_user_id;
  if id is null then raise exception 'completed participant History required' using errcode = '42501'; end if;
  select i.saved_at into existing from public.saved_game_items i
    where i.source_kind = 'normal' and i.source_id = p_source_id
      and i.participant_id = p_user_id;
  select e.plan_key, e.display_name into resolved_plan, resolved_name
    from public.plan_effective(p_user_id, now()) e;
  cap := public.plan_capability_int(resolved_plan, 'private_drive_limit');
  if cap is null or cap < 0 then raise exception 'Saved capacity is not configured' using errcode = '22023'; end if;
  select count(*) into used from public.saved_game_items i
    where i.participant_id = p_user_id and i.state = 'active';
  if existing is not null then
    return query select existing, true, used, cap, resolved_name; return;
  end if;
  if used >= cap then
    raise exception 'Saved capacity reached (% of %). Existing games remain available.', used, cap
      using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('eq-payload:' || p_source_id::text, 0));
  candidate := public.saved_legacy_source_for_user(id, p_user_id);
  if candidate is null then
    raise exception 'replay unavailable for Saved' using errcode = '42501';
  end if;
  select l.snapshot into frozen from public.saved_legacy_payloads l
    where l.source_kind = 'normal' and l.source_id = p_source_id;
  if frozen is not null then candidate := frozen; end if;
  if encode(extensions.digest(candidate::text, 'sha256'), 'hex') <> p_source_digest then
    raise exception 'legacy source changed during validation; retry Save' using errcode = '40001';
  end if;
  insert into public.saved_legacy_payloads (source_id, game_id, snapshot)
    values (p_source_id, id, candidate) on conflict do nothing;
  insert into public.saved_game_items (source_kind, source_id, participant_id)
    values ('normal', p_source_id, p_user_id)
    returning saved_game_items.saved_at into existing;
  return query select existing, false, used + 1, cap, resolved_name;
end $$;

-- Read boundaries reconcile elapsed plan expiry before reporting usage/items.
create or replace function public.saved_game_usage()
returns table (plan_name text, active_count bigint, capacity integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare viewer uuid := auth.uid(); plan text;
begin
  if auth.role() is distinct from 'authenticated' or viewer is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  perform public.reconcile_saved_capacity(viewer);
  select e.plan_key, e.display_name into plan, plan_name
    from public.plan_effective(viewer, now()) e;
  capacity := public.plan_capability_int(plan, 'private_drive_limit');
  select count(*) into active_count from public.saved_game_items i
    where i.participant_id = viewer and i.state = 'active';
  return next;
end $$;

drop function public.list_my_saved_games(integer, timestamptz, text, uuid);
create function public.list_my_saved_games(
  p_limit integer default 20, p_before_at timestamptz default null,
  p_before_kind text default null, p_before_id uuid default null,
  p_state text default 'active'
) returns table (
  source_kind text, source_id uuid, game_id uuid, game_name text, mode_key text,
  game_mode text, opponent_label text, score_for integer, score_against integer,
  completed_at timestamptz, saved_at timestamptz, result_authority text,
  replay_format text, item_state text, state_changed_at timestamptz
) language plpgsql security definer set search_path = public, pg_temp as $$
declare viewer uuid := auth.uid();
begin
  if auth.role() is distinct from 'authenticated' or viewer is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50
    or p_state not in ('active', 'trashed', 'overflow') or
    ((p_before_at is null) <> (p_before_kind is null)) or
    ((p_before_at is null) <> (p_before_id is null)) or
    (p_before_kind is not null and p_before_kind not in ('normal', 'stage')) then
    raise exception 'invalid Saved page cursor' using errcode = '22023';
  end if;
  perform public.reconcile_saved_capacity(viewer);
  return query
    select i.source_kind, i.source_id, h.game_id, h.game_name, h.mode_key,
      h.game_mode, h.opponent_label, h.score_for, h.score_against,
      h.completed_at, i.saved_at, h.result_authority,
      case when i.source_kind = 'stage' or p.source_id is not null then 'compact'
        else 'legacy_v3' end, i.state, i.state_changed_at
    from public.saved_game_items i
    join public.game_history h on h.source_kind = i.source_kind
      and h.source_id = i.source_id and h.participant_id = i.participant_id
    left join public.recent_game_payloads p on p.source_kind = i.source_kind
      and p.source_id = i.source_id
    where i.participant_id = viewer and i.state = p_state
      and (p_before_at is null or (i.saved_at, i.source_kind, i.source_id)
        < (p_before_at, p_before_kind, p_before_id))
    order by i.saved_at desc, i.source_kind desc, i.source_id desc limit p_limit;
end $$;
revoke all on function public.list_my_saved_games(integer, timestamptz, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.list_my_saved_games(integer, timestamptz, text, uuid, text)
  to authenticated;

-- Existing History and replay readers already treat every Saved row as a
-- retention reference. Their one-statement payload read remains valid.

-- Plan revocation is an immediate downgrade boundary. Natural plan expiry is
-- reconciled lazily by all Saved read/write RPCs before they return.
alter function public.admin_revoke_pass(uuid, text) rename to admin_revoke_pass_before_saved;
revoke all on function public.admin_revoke_pass_before_saved(uuid, text)
  from public, anon, authenticated, service_role;
create function public.admin_revoke_pass(target_pass uuid, target_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare account uuid;
begin
  select user_id into account from public.plan_passes where id = target_pass;
  perform public.admin_revoke_pass_before_saved(target_pass, target_reason);
  if account is not null then perform public.reconcile_saved_capacity(account); end if;
end $$;
revoke all on function public.admin_revoke_pass(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_revoke_pass(uuid, text) to authenticated;

commit;
