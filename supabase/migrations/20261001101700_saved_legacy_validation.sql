-- A v3 shape check alone cannot prove that a client-submitted legacy snapshot
-- is replayable. Its first Save therefore requires trusted decoder validation.
begin;

alter function public.save_completed_game(text, uuid)
  rename to save_completed_game_before_legacy_validation;
revoke all on function public.save_completed_game_before_legacy_validation(text, uuid)
  from public, anon, authenticated, service_role;
create function public.save_completed_game(p_source_kind text, p_source_id uuid)
returns table (saved_at timestamptz, already_saved boolean, active_count bigint,
  capacity integer, plan_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_source_kind = 'normal' and p_source_id is not null
    and exists (select 1 from public.game_history h
      where h.source_kind = 'normal' and h.source_id = p_source_id
        and h.participant_id = auth.uid())
    and not exists (select 1 from public.recent_game_payloads p
      where p.source_kind = 'normal' and p.source_id = p_source_id)
    and not exists (select 1 from public.saved_legacy_payloads l
      where l.source_kind = 'normal' and l.source_id = p_source_id) then
    raise exception 'legacy_validation_required' using errcode = '22023';
  end if;
  return query select * from public.save_completed_game_before_legacy_validation(
    p_source_kind, p_source_id);
end $$;
revoke all on function public.save_completed_game(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.save_completed_game(text, uuid) to authenticated;

create function public.read_legacy_save_candidate(p_source_id uuid, p_user_id uuid)
returns table (game_id uuid, snapshot jsonb, source_digest text,
  participant_side text, score_for integer, score_against integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare history_row public.game_history%rowtype; candidate jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'trusted legacy validation required' using errcode = '42501';
  end if;
  select * into history_row from public.game_history h
    where h.source_kind = 'normal' and h.source_id = p_source_id
      and h.participant_id = p_user_id;
  if history_row.game_id is null then return; end if;
  select l.snapshot into candidate from public.saved_legacy_payloads l
    where l.source_kind = 'normal' and l.source_id = p_source_id;
  if candidate is null then candidate := public.saved_legacy_source(history_row.game_id); end if;
  if candidate is null then return; end if;
  return query select history_row.game_id, candidate,
    encode(extensions.digest(candidate::text, 'sha256'), 'hex'),
    history_row.participant_side, history_row.score_for, history_row.score_against;
end $$;
revoke all on function public.read_legacy_save_candidate(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_legacy_save_candidate(uuid, uuid) to service_role;

create function public.save_validated_legacy_game(
  p_source_id uuid, p_user_id uuid, p_source_digest text
) returns table (saved_at timestamptz, already_saved boolean, active_count bigint,
  capacity integer, plan_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare id uuid; existing timestamptz; candidate jsonb;
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
  select l.snapshot into candidate from public.saved_legacy_payloads l
    where l.source_kind = 'normal' and l.source_id = p_source_id;
  if candidate is null then candidate := public.saved_legacy_source(id); end if;
  if candidate is null or
    encode(extensions.digest(candidate::text, 'sha256'), 'hex') <> p_source_digest then
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
revoke all on function public.save_validated_legacy_game(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_validated_legacy_game(uuid, uuid, text) to service_role;

commit;
