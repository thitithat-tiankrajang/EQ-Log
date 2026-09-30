-- Explicit long-term participant retention. Old Private Library data is unchanged.
begin;

update public.plan_capabilities set status = 'decided', value = '100'::jsonb,
  same_as_plan = null, note = 'Product Owner: Free has 100 active Saved games.'
where plan_key = 'free' and capability_key = 'private_drive_limit';
update public.plan_capabilities set status = 'decided', value = '1000'::jsonb,
  same_as_plan = null, note = 'Product Owner: EQ Plus has 1000 active Saved games.'
where plan_key = 'plus' and capability_key = 'private_drive_limit';
-- Pro already resolves to Plus through same_as.

create table public.saved_legacy_payloads (
  source_kind text not null default 'normal' check (source_kind = 'normal'),
  source_id uuid not null,
  game_id uuid not null,
  snapshot jsonb not null check (
    snapshot ->> 'v' = '3' and snapshot ->> 'gameId' = game_id::text
    and snapshot ->> 'status' = 'finished'
    and jsonb_typeof(snapshot -> 'history') = 'array'
    and jsonb_typeof(snapshot -> 'logs') = 'array'
  ),
  captured_at timestamptz not null default now(),
  primary key (source_kind, source_id),
  constraint saved_legacy_source_is_game check (source_id = game_id)
);
comment on table public.saved_legacy_payloads is
  'Frozen v3 legacy snapshot for an explicitly Saved completed normal game; never labeled Compact.';
alter table public.saved_legacy_payloads enable row level security;
revoke all on public.saved_legacy_payloads from public, anon, authenticated, service_role;
create trigger freeze_saved_legacy_payload before update or delete
  on public.saved_legacy_payloads for each row execute function public.freeze_recent_game_payload();

create table public.saved_game_items (
  source_kind text not null check (source_kind in ('normal', 'stage')),
  source_id uuid not null,
  participant_id uuid not null,
  saved_at timestamptz not null default now(),
  primary key (source_kind, source_id, participant_id),
  foreign key (source_kind, source_id, participant_id)
    references public.game_history (source_kind, source_id, participant_id)
    on delete cascade
);
create index saved_game_items_page_idx on public.saved_game_items
  (participant_id, saved_at desc, source_kind desc, source_id desc);
comment on table public.saved_game_items is
  'Explicit active Saved ownership only. History, Recent, old Private Library and live reservations do not consume this capacity.';
alter table public.saved_game_items enable row level security;
revoke all on public.saved_game_items from public, anon, authenticated, service_role;

-- All source retention and cleanup use this lock. Recent must take it before
-- reading a normal payload; otherwise cleanup can race a late retention retry.
create or replace function public.recent_retain_completed_source(
  p_source_kind text, p_source_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare seat record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'trusted Recent retention required' using errcode = '42501';
  end if;
  if p_source_kind not in ('normal', 'stage') or p_source_id is null then
    raise exception 'unsupported Recent source' using errcode = '22023';
  end if;
  if p_source_kind = 'normal' then
    perform pg_advisory_xact_lock(hashtextextended('eq-payload:' || p_source_id::text, 0));
    if not exists (select 1 from public.recent_game_payloads p
      where p.source_kind = 'normal' and p.source_id = p_source_id) then
      raise exception 'trusted normal Compact capture required' using errcode = '22023';
    end if;
  elsif not exists (select 1 from public.stage_completed_attempts s
    where s.attempt_id = p_source_id and s.record ->> 'format' = '1'
      and s.record ->> 'digest' = s.record_digest
      and nullif(s.record #>> '{genesis,meta,gameId}', '') is not null
      and s.record #>> '{provenance,mode}' = 'stage') then
    raise exception 'Stage Compact capture required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.game_history h
    where h.source_kind = p_source_kind and h.source_id = p_source_id) then
    raise exception 'completed participant History required' using errcode = '22023';
  end if;
  for seat in select h.participant_id from public.game_history h
    where h.source_kind = p_source_kind and h.source_id = p_source_id
    order by h.participant_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('eq-recent:' || seat.participant_id::text, 0));
  end loop;
  for seat in select h.participant_id, h.completed_at from public.game_history h
    where h.source_kind = p_source_kind and h.source_id = p_source_id
    order by h.participant_id
  loop
    insert into public.recent_game_items
      (source_kind, source_id, participant_id, completed_at)
    values (p_source_kind, p_source_id, seat.participant_id, seat.completed_at)
    on conflict do nothing;
    delete from public.recent_game_items i using (
      select source_kind, source_id, row_number() over (
        order by completed_at desc, source_kind desc, source_id desc
      ) as ordinal
      from public.recent_game_items where participant_id = seat.participant_id
    ) ranked
    where i.participant_id = seat.participant_id
      and i.source_kind = ranked.source_kind and i.source_id = ranked.source_id
      and ranked.ordinal > 20;
  end loop;
end $$;

create or replace function public.freeze_recent_game_payload()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'recent_game_payloads' and tg_op = 'DELETE'
    and current_setting('app.allow_recent_payload_cleanup', true) = '1'
    and not exists (select 1 from public.recent_game_items r
      where r.source_kind = old.source_kind and r.source_id = old.source_id)
    and not exists (select 1 from public.saved_game_items s
      where s.source_kind = old.source_kind and s.source_id = old.source_id) then
    return old;
  end if;
  raise exception 'completed payload is immutable or retained' using errcode = '42501';
end $$;

-- Called only by a trusted maintenance process, never by an ordinary user.
-- The existing trigger checks references again under the same source lock.
create function public.cleanup_unreferenced_recent_payload(p_source_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' or p_source_id is null then
    raise exception 'trusted payload cleanup required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('eq-payload:' || p_source_id::text, 0));
  perform set_config('app.allow_recent_payload_cleanup', '1', true);
  delete from public.recent_game_payloads p
    where p.source_kind = 'normal' and p.source_id = p_source_id
      and not exists (select 1 from public.recent_game_items r
        where r.source_kind = p.source_kind and r.source_id = p.source_id)
      and not exists (select 1 from public.saved_game_items s
        where s.source_kind = p.source_kind and s.source_id = p.source_id);
  return found;
end $$;
revoke all on function public.cleanup_unreferenced_recent_payload(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_unreferenced_recent_payload(uuid) to service_role;

-- One source selection for the frozen legacy fallback. Compact always wins.
-- This is a participant's own History source, never an arbitrary archive copy.
create function public.saved_legacy_source(p_game_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select candidate.snapshot from (
    select p.snapshot, 1 as priority, p.archived_at as sort_at, p.game_id as sort_id
      from public.public_game_snapshots p where p.game_id = p_game_id
    union all
    select r.snapshot, 2, r.archived_at, r.game_id
      from public.region_game_snapshots r where r.game_id = p_game_id
    union all
    select v.snapshot, 3, v.created_at, v.id from public.private_library_items v
      where v.game_id = p_game_id and v.item_type = 'game' and v.trashed_at is null
  ) candidate
  where candidate.snapshot ->> 'v' = '3'
    and candidate.snapshot ->> 'gameId' = p_game_id::text
    and candidate.snapshot ->> 'status' = 'finished'
    and jsonb_typeof(candidate.snapshot -> 'history') = 'array'
    and jsonb_typeof(candidate.snapshot -> 'logs') = 'array'
  order by candidate.priority, candidate.sort_at, candidate.sort_id limit 1
$$;
revoke all on function public.saved_legacy_source(uuid)
  from public, anon, authenticated, service_role;

create function public.save_completed_game(p_source_kind text, p_source_id uuid)
returns table (saved_at timestamptz, already_saved boolean, active_count bigint,
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
  -- Same account lock as plan grant/revoke and room charging.
  perform pg_advisory_xact_lock(hashtextextended(viewer::text, 41));
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
  if cap is null or cap < 0 then
    raise exception 'Saved capacity is not configured' using errcode = '22023';
  end if;
  select count(*) into used from public.saved_game_items i where i.participant_id = viewer;
  if existing is not null then
    return query select existing, true, used, cap, resolved_name;
    return;
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
revoke all on function public.save_completed_game(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.save_completed_game(text, uuid) to authenticated;

create function public.saved_game_usage()
returns table (plan_name text, active_count bigint, capacity integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare viewer uuid := auth.uid(); plan text;
begin
  if auth.role() is distinct from 'authenticated' or viewer is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select e.plan_key, e.display_name into plan, plan_name
    from public.plan_effective(viewer, now()) e;
  capacity := public.plan_capability_int(plan, 'private_drive_limit');
  select count(*) into active_count from public.saved_game_items i where i.participant_id = viewer;
  return next;
end $$;
revoke all on function public.saved_game_usage() from public, anon, authenticated, service_role;
grant execute on function public.saved_game_usage() to authenticated;

create function public.list_my_saved_games(
  p_limit integer default 20, p_before_at timestamptz default null,
  p_before_kind text default null, p_before_id uuid default null
) returns table (
  source_kind text, source_id uuid, game_id uuid, game_name text, mode_key text,
  game_mode text, opponent_label text, score_for integer, score_against integer,
  completed_at timestamptz, saved_at timestamptz, result_authority text,
  replay_format text
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare viewer uuid := auth.uid();
begin
  if auth.role() is distinct from 'authenticated' or viewer is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 or
    ((p_before_at is null) <> (p_before_kind is null)) or
    ((p_before_at is null) <> (p_before_id is null)) or
    (p_before_kind is not null and p_before_kind not in ('normal', 'stage')) then
    raise exception 'invalid Saved page cursor' using errcode = '22023';
  end if;
  return query
    select i.source_kind, i.source_id, h.game_id, h.game_name, h.mode_key,
      h.game_mode, h.opponent_label, h.score_for, h.score_against,
      h.completed_at, i.saved_at, h.result_authority,
      case when i.source_kind = 'stage' or p.source_id is not null then 'compact'
        else 'legacy_v3' end
    from public.saved_game_items i
    join public.game_history h on h.source_kind = i.source_kind
      and h.source_id = i.source_id and h.participant_id = i.participant_id
    left join public.recent_game_payloads p on p.source_kind = i.source_kind
      and p.source_id = i.source_id
    where i.participant_id = viewer
      and (p_before_at is null or (i.saved_at, i.source_kind, i.source_id)
        < (p_before_at, p_before_kind, p_before_id))
    order by i.saved_at desc, i.source_kind desc, i.source_id desc limit p_limit;
end $$;
revoke all on function public.list_my_saved_games(integer, timestamptz, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_my_saved_games(integer, timestamptz, text, uuid)
  to authenticated;

-- Ownership and payload are read in one SQL statement for the safe Edge reader.
create function public.read_saved_game_payload(p_game_id uuid, p_user_id uuid)
returns table (game_id uuid, completed_at timestamptz, source_kind text, record jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'trusted Saved replay reader required' using errcode = '42501';
  end if;
  return query
    select h.game_id, h.completed_at, i.source_kind,
      case when i.source_kind = 'stage' then s.record
        else coalesce(p.record, l.snapshot) end
    from public.saved_game_items i
    join public.game_history h on h.source_kind = i.source_kind
      and h.source_id = i.source_id and h.participant_id = i.participant_id
    left join public.stage_completed_attempts s on i.source_kind = 'stage'
      and s.attempt_id = i.source_id and s.player_id = i.participant_id
    left join public.recent_game_payloads p on i.source_kind = 'normal'
      and p.source_kind = i.source_kind and p.source_id = i.source_id
    left join public.saved_legacy_payloads l on i.source_kind = 'normal'
      and l.source_kind = i.source_kind and l.source_id = i.source_id
    where i.participant_id = p_user_id and h.game_id = p_game_id
      and (s.record is not null or p.record is not null or l.snapshot is not null);
end $$;
revoke all on function public.read_saved_game_payload(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_saved_game_payload(uuid, uuid) to service_role;

-- Preserve the existing History query and its indexed payload probes. The
-- wrapper adds one indexed Saved lookup per metadata row, never raw payloads.
alter function public.list_my_game_history(integer, timestamptz, text, uuid)
  rename to list_my_game_history_before_saved;
revoke all on function public.list_my_game_history_before_saved(integer, timestamptz, text, uuid)
  from public, anon, authenticated, service_role;
create function public.list_my_game_history(
  p_limit integer default 20, p_before_at timestamptz default null,
  p_before_kind text default null, p_before_id uuid default null
) returns table (
  source_kind text, source_id uuid, game_id uuid, participant_side text,
  game_name text, mode_key text, game_mode text, opponent_label text, bot_key text,
  score_for integer, score_against integer, outcome text, completed_at timestamptz,
  rules_version text, result_authority text, replay_availability text,
  is_recent boolean, is_saved boolean
) language sql stable security definer set search_path = public, pg_temp as $$
  select h.source_kind, h.source_id, h.game_id, h.participant_side,
    h.game_name, h.mode_key, h.game_mode, h.opponent_label, h.bot_key,
    h.score_for, h.score_against, h.outcome, h.completed_at, h.rules_version,
    h.result_authority,
    case when i.participant_id is not null then
      case when h.source_kind = 'stage' or p.source_id is not null
        then 'compact_available' else 'legacy_available' end
      else h.replay_availability end,
    h.is_recent, i.participant_id is not null
  from public.list_my_game_history_before_saved(p_limit, p_before_at, p_before_kind, p_before_id) h
  left join public.saved_game_items i on i.source_kind = h.source_kind
    and i.source_id = h.source_id and i.participant_id = auth.uid()
  left join public.recent_game_payloads p on p.source_kind = i.source_kind
    and p.source_id = i.source_id
$$;
revoke all on function public.list_my_game_history(integer, timestamptz, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_my_game_history(integer, timestamptz, text, uuid)
  to authenticated;

commit;
