-- A participant's History row proves a seat, not continued replay access.
-- Save requires their own Recent relation or an archive they may open.
begin;

-- A source cannot silently change from a frozen legacy Saved replay to a
-- different Compact payload (or vice versa) after someone retained it.
create function public.prevent_mixed_completed_payloads()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('eq-payload:' || new.source_id::text, 0));
  if tg_table_name = 'recent_game_payloads' and exists (
    select 1 from public.saved_legacy_payloads l
    where l.source_kind = new.source_kind and l.source_id = new.source_id
  ) then
    raise exception 'source already has a frozen legacy payload' using errcode = '23514';
  elsif tg_table_name = 'saved_legacy_payloads' and exists (
    select 1 from public.recent_game_payloads p
    where p.source_kind = new.source_kind and p.source_id = new.source_id
  ) then
    raise exception 'source already has a Compact payload' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.prevent_mixed_completed_payloads()
  from public, anon, authenticated, service_role;
create trigger prevent_mixed_recent_payload before insert
  on public.recent_game_payloads for each row
  execute function public.prevent_mixed_completed_payloads();
create trigger prevent_mixed_saved_legacy_payload before insert
  on public.saved_legacy_payloads for each row
  execute function public.prevent_mixed_completed_payloads();

create or replace function public.freeze_recent_game_payload()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' and (
    (tg_table_name = 'recent_game_payloads'
      and current_setting('app.allow_recent_payload_cleanup', true) = '1')
    or (tg_table_name = 'saved_legacy_payloads'
      and current_setting('app.allow_saved_legacy_cleanup', true) = '1')
  ) and not exists (select 1 from public.recent_game_items r
      where r.source_kind = old.source_kind and r.source_id = old.source_id)
    and not exists (select 1 from public.saved_game_items s
      where s.source_kind = old.source_kind and s.source_id = old.source_id) then
    return old;
  end if;
  raise exception 'completed payload is immutable or retained' using errcode = '42501';
end $$;

create function public.cleanup_unreferenced_saved_legacy_payload(p_source_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' or p_source_id is null then
    raise exception 'trusted payload cleanup required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('eq-payload:' || p_source_id::text, 0));
  perform set_config('app.allow_saved_legacy_cleanup', '1', true);
  delete from public.saved_legacy_payloads l
    where l.source_kind = 'normal' and l.source_id = p_source_id
      and not exists (select 1 from public.recent_game_items r
        where r.source_kind = l.source_kind and r.source_id = l.source_id)
      and not exists (select 1 from public.saved_game_items s
        where s.source_kind = l.source_kind and s.source_id = l.source_id);
  return found;
end $$;
revoke all on function public.cleanup_unreferenced_saved_legacy_payload(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_unreferenced_saved_legacy_payload(uuid) to service_role;

create function public.saved_legacy_source_for_user(p_game_id uuid, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select candidate.snapshot from (
    select p.snapshot, 1 as priority, p.archived_at as sort_at, p.game_id as sort_id
      from public.public_game_snapshots p
      where p.game_id = p_game_id and exists (
        select 1 from public.profiles v where v.id = p_viewer
          and (v.status = 'approved' or v.is_admin))
    union all
    select r.snapshot, 2, r.archived_at, r.game_id
      from public.region_game_snapshots r
      where r.game_id = p_game_id and exists (
        select 1 from public.profiles v where v.id = p_viewer
          and (v.is_admin or (v.status = 'approved' and v.region_id = r.region_id)))
    union all
    select v.snapshot, 3, v.created_at, v.id
      from public.private_library_items v
      where v.game_id = p_game_id and v.item_type = 'game'
        and v.trashed_at is null and (
          v.owner_id = p_viewer or exists (
            select 1 from public.game_history h
            where h.source_kind = 'normal' and h.game_id = p_game_id
              and h.participant_id = p_viewer
              and h.source_owner_id = v.owner_id
          )
        )
  ) candidate
  where candidate.snapshot ->> 'v' = '3'
    and candidate.snapshot ->> 'gameId' = p_game_id::text
    and candidate.snapshot ->> 'status' = 'finished'
    and jsonb_typeof(candidate.snapshot -> 'history') = 'array'
    and jsonb_typeof(candidate.snapshot -> 'logs') = 'array'
  order by candidate.priority, candidate.sort_at, candidate.sort_id limit 1
$$;
revoke all on function public.saved_legacy_source_for_user(uuid, uuid)
  from public, anon, authenticated, service_role;

alter function public.save_completed_game(text, uuid)
  rename to save_completed_game_before_source_eligibility;
revoke all on function public.save_completed_game_before_source_eligibility(text, uuid)
  from public, anon, authenticated, service_role;
create function public.save_completed_game(p_source_kind text, p_source_id uuid)
returns table (saved_at timestamptz, already_saved boolean, active_count bigint,
  capacity integer, plan_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare id uuid; viewer uuid := auth.uid();
begin
  if auth.role() is distinct from 'authenticated' or viewer is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_source_kind = 'normal' and p_source_id is not null then
    select h.game_id into id from public.game_history h
      where h.source_kind = 'normal' and h.source_id = p_source_id
        and h.participant_id = viewer;
    if id is not null
      and not exists (select 1 from public.saved_game_items s
        where s.source_kind = 'normal' and s.source_id = p_source_id
          and s.participant_id = viewer)
      and not exists (select 1 from public.recent_game_items r
        where r.source_kind = 'normal' and r.source_id = p_source_id
          and r.participant_id = viewer)
      and public.saved_legacy_source_for_user(id, viewer) is null then
      raise exception 'replay unavailable for Saved' using errcode = '22023';
    end if;
  end if;
  return query select * from public.save_completed_game_before_source_eligibility(
    p_source_kind, p_source_id);
end $$;
revoke all on function public.save_completed_game(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.save_completed_game(text, uuid) to authenticated;

create or replace function public.read_legacy_save_candidate(p_source_id uuid, p_user_id uuid)
returns table (game_id uuid, snapshot jsonb, source_digest text,
  participant_side text, score_for integer, score_against integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare history_row public.game_history%rowtype; candidate jsonb; frozen jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'trusted legacy validation required' using errcode = '42501';
  end if;
  select * into history_row from public.game_history h
    where h.source_kind = 'normal' and h.source_id = p_source_id
      and h.participant_id = p_user_id;
  if history_row.game_id is null then return; end if;
  candidate := public.saved_legacy_source_for_user(history_row.game_id, p_user_id);
  if candidate is null then return; end if;
  select l.snapshot into frozen from public.saved_legacy_payloads l
    where l.source_kind = 'normal' and l.source_id = p_source_id;
  if frozen is not null then candidate := frozen; end if;
  return query select history_row.game_id, candidate,
    encode(extensions.digest(candidate::text, 'sha256'), 'hex'),
    history_row.participant_side, history_row.score_for, history_row.score_against;
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
  if cap is null or cap < 0 then
    raise exception 'Saved capacity is not configured' using errcode = '22023';
  end if;
  select count(*) into used from public.saved_game_items i where i.participant_id = p_user_id;
  if existing is not null then
    return query select existing, true, used, cap, resolved_name;
    return;
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
    raise exception 'legacy source changed during validation; retry Save'
      using errcode = '40001';
  end if;
  insert into public.saved_legacy_payloads (source_id, game_id, snapshot)
    values (p_source_id, id, candidate) on conflict do nothing;
  insert into public.saved_game_items (source_kind, source_id, participant_id)
    values ('normal', p_source_id, p_user_id)
    returning saved_game_items.saved_at into existing;
  return query select existing, false, used + 1, cap, resolved_name;
end $$;

-- A Host-owned Private archive is Save-eligible for its seated player, but it
-- is not an open replay until the player explicitly Saves it. Keep those two
-- facts separate in History instead of making an unavailable link look live.
drop function public.list_my_game_history(integer, timestamptz, text, uuid);
create function public.list_my_game_history(
  p_limit integer default 20, p_before_at timestamptz default null,
  p_before_kind text default null, p_before_id uuid default null
) returns table (
  source_kind text, source_id uuid, game_id uuid, participant_side text,
  game_name text, mode_key text, game_mode text, opponent_label text, bot_key text,
  score_for integer, score_against integer, outcome text, completed_at timestamptz,
  rules_version text, result_authority text, replay_availability text,
  is_recent boolean, is_saved boolean, can_save boolean
) language sql stable security definer set search_path = public, pg_temp as $$
  select h.source_kind, h.source_id, h.game_id, h.participant_side,
    h.game_name, h.mode_key, h.game_mode, h.opponent_label, h.bot_key,
    h.score_for, h.score_against, h.outcome, h.completed_at, h.rules_version,
    h.result_authority,
    case when i.participant_id is not null then
      case when h.source_kind = 'stage' or p.source_id is not null
        then 'compact_available' else 'legacy_available' end
      else h.replay_availability end,
    h.is_recent, i.participant_id is not null,
    i.participant_id is null and (
      h.replay_availability in ('compact_available', 'legacy_available')
      or host_legacy.eligible is not null
    )
  from public.list_my_game_history_before_saved(p_limit, p_before_at, p_before_kind, p_before_id) h
  left join public.saved_game_items i on i.source_kind = h.source_kind
    and i.source_id = h.source_id and i.participant_id = auth.uid()
  left join public.recent_game_payloads p on p.source_kind = i.source_kind
    and p.source_id = i.source_id
  left join lateral (
    select true as eligible from public.game_history seat
    join public.private_library_items v on v.game_id = seat.game_id
      and v.owner_id = seat.source_owner_id
    where seat.source_kind = 'normal' and seat.source_id = h.source_id
      and seat.participant_id = auth.uid()
      and v.item_type = 'game' and v.trashed_at is null
      and v.snapshot ->> 'v' = '3'
      and v.snapshot ->> 'gameId' = h.game_id::text
      and v.snapshot ->> 'status' = 'finished'
      and jsonb_typeof(v.snapshot -> 'history') = 'array'
      and jsonb_typeof(v.snapshot -> 'logs') = 'array'
    limit 1
  ) host_legacy on h.source_kind = 'normal'
$$;
revoke all on function public.list_my_game_history(integer, timestamptz, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_my_game_history(integer, timestamptz, text, uuid)
  to authenticated;

commit;
