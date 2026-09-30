-- Bounded, service-validated migration from original Private Library archives.
-- No old row is deleted or rewritten. Decoder validation happens in the Edge
-- worker before this hash-bound writer is called.
begin;

create table public.saved_legacy_migration_ledger (
  legacy_item_id uuid primary key,
  owner_id uuid not null,
  source_id uuid,
  outcome text not null check (outcome in
    ('active', 'overflow', 'trashed', 'duplicate', 'ineligible')),
  processed_at timestamptz not null default now()
);
alter table public.saved_legacy_migration_ledger enable row level security;
revoke all on public.saved_legacy_migration_ledger from public, anon, authenticated, service_role;
create index saved_legacy_migration_owner_idx on public.saved_legacy_migration_ledger
  (owner_id, processed_at);

create function public.saved_migration_context(p_user_id uuid)
returns table (capacity integer, active_count bigint, in_progress_count bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare plan text;
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null then
    raise exception 'trusted migration report required' using errcode = '42501';
  end if;
  select e.plan_key into plan from public.plan_effective(p_user_id, now()) e;
  capacity := public.plan_capability_int(plan, 'private_drive_limit');
  select count(*) into active_count from public.saved_game_items i
    where i.participant_id = p_user_id and i.state = 'active';
  select count(*) into in_progress_count from public.room_live r
    where r.owner_id = p_user_id and r.legacy_private_autosave;
  return next;
end $$;
revoke all on function public.saved_migration_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.saved_migration_context(uuid) to service_role;

create function public.list_private_migration_candidates(
  p_user_id uuid, p_after_at timestamptz default null,
  p_after_id uuid default null, p_limit integer default 50
) returns table (
  item_id uuid, source_id uuid, game_id uuid, created_at timestamptz,
  trashed_at timestamptz, source_scope text, snapshot jsonb, source_digest text,
  participant_side text, score_for integer, score_against integer,
  ledger_outcome text, saved_state text
) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null
    or p_limit not between 1 and 50
    or ((p_after_at is null) <> (p_after_id is null)) then
    raise exception 'trusted bounded migration read required' using errcode = '42501';
  end if;
  return query
    select v.id, v.source_game_id, v.game_id, v.created_at, v.trashed_at,
      v.source_scope, v.snapshot,
      encode(extensions.digest(v.snapshot::text, 'sha256'), 'hex'),
      h.participant_side, h.score_for, h.score_against,
      m.outcome, i.state
    from public.private_library_items v
    left join public.game_history h on h.source_kind = 'normal'
      and h.source_id = v.source_game_id and h.game_id = v.game_id
      and h.participant_id = v.owner_id
    left join public.saved_legacy_migration_ledger m on m.legacy_item_id = v.id
    left join public.saved_game_items i on i.source_kind = 'normal'
      and i.source_id = v.source_game_id and i.participant_id = v.owner_id
    where v.owner_id = p_user_id and v.item_type = 'game'
      and (p_after_at is null or (v.created_at, v.id) > (p_after_at, p_after_id))
    order by v.created_at, v.id limit p_limit;
end $$;
revoke all on function public.list_private_migration_candidates(uuid, timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_private_migration_candidates(uuid, timestamptz, uuid, integer)
  to service_role;

create function public.migrate_validated_private_item(p_item_id uuid, p_digest text)
returns table (outcome text, source_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.private_library_items%rowtype; prior text;
  plan text; cap integer; used bigint; target_state text;
begin
  if auth.role() is distinct from 'service_role' or p_item_id is null
    or p_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'trusted validated migration required' using errcode = '42501';
  end if;
  select * into v from public.private_library_items where id = p_item_id;
  if not found then raise exception 'legacy item not found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v.owner_id::text, 41));
  select m.outcome into prior from public.saved_legacy_migration_ledger m
    where m.legacy_item_id = p_item_id;
  if prior is not null then
    outcome := prior; source_id := v.source_game_id; return next; return;
  end if;
  select * into v from public.private_library_items where id = p_item_id for update;
  if v.item_type <> 'game' or v.source_scope <> 'private'
    or v.source_game_id is null or v.game_id is distinct from v.source_game_id
    or v.snapshot ->> 'v' is distinct from '3'
    or v.snapshot ->> 'status' is distinct from 'finished'
    or coalesce(v.snapshot ->> 'gameId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or not exists (select 1 from public.game_history h
      where h.source_kind = 'normal' and h.source_id = v.source_game_id
        and h.game_id = v.game_id and h.participant_id = v.owner_id)
    or encode(extensions.digest(v.snapshot::text, 'sha256'), 'hex') <> p_digest then
    raise exception 'legacy item changed or is ineligible' using errcode = '22023';
  end if;
  source_id := v.source_game_id;
  if exists (select 1 from public.saved_game_items i where i.source_kind = 'normal'
    and i.source_id = v.source_game_id and i.participant_id = v.owner_id) then
    outcome := 'duplicate';
  else
    perform public.reconcile_saved_capacity(v.owner_id);
    select e.plan_key into plan from public.plan_effective(v.owner_id, now()) e;
    cap := public.plan_capability_int(plan, 'private_drive_limit');
    select count(*) into used from public.saved_game_items i
      where i.participant_id = v.owner_id and i.state = 'active';
    target_state := case when v.trashed_at is not null then 'trashed'
      when used < cap then 'active' else 'overflow' end;
    perform pg_advisory_xact_lock(hashtextextended('eq-payload:' || v.source_game_id::text, 0));
    if not exists (select 1 from public.recent_game_payloads p
      where p.source_kind = 'normal' and p.source_id = v.source_game_id) then
      insert into public.saved_legacy_payloads (source_id, game_id, snapshot)
        values (v.source_game_id, v.game_id, v.snapshot) on conflict do nothing;
      if not exists (select 1 from public.saved_legacy_payloads l
        where l.source_kind = 'normal' and l.source_id = v.source_game_id
          and l.snapshot = v.snapshot) then
        raise exception 'frozen legacy source differs' using errcode = '23514';
      end if;
    end if;
    insert into public.saved_game_items
      (source_kind, source_id, participant_id, state, state_changed_at,
        saved_at, origin, legacy_item_id)
      values ('normal', v.source_game_id, v.owner_id, target_state,
        coalesce(v.trashed_at, now()), v.created_at, 'legacy_migration', v.id);
    outcome := target_state;
  end if;
  insert into public.saved_legacy_migration_ledger
    (legacy_item_id, owner_id, source_id, outcome)
    values (v.id, v.owner_id, v.source_game_id, outcome);
  return next;
end $$;
revoke all on function public.migrate_validated_private_item(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.migrate_validated_private_item(uuid, text) to service_role;

commit;
