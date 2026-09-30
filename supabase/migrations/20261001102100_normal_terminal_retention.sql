-- Atomic normal completion + optional Compact Recent capture. Intermediate
-- gameplay is still client-submitted; this is a terminal storage boundary.
begin;

create function public.capture_normal_terminal(
  p_room_id uuid, p_actor_id uuid, p_expected_revision bigint,
  p_timeline_version bigint,
  p_state jsonb, p_record jsonb, p_completion_kind text,
  p_completion_reason text, p_surrendered_side text default null
) returns table (archive_scope text, archive_game_id uuid, private_item_id uuid,
  record_digest text, recent_retained boolean, legacy_saved_state text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare live public.room_live%rowtype; result_row record; owner_plan text;
  owner_cap integer; owner_active bigint; claim_before text; sub_before text;
  captured_digest text; compact boolean := p_record is not null; parked_doc jsonb;
begin
  if auth.role() is distinct from 'service_role' or p_room_id is null
    or p_actor_id is null or p_expected_revision is null then
    raise exception 'trusted normal terminal capture required' using errcode = '42501';
  end if;
  select * into live from public.room_live where room_id = p_room_id for update;
  if not found then
    select p.record_digest into captured_digest from public.recent_game_payloads p
      where p.source_kind = 'normal' and p.source_id = p_room_id;
    if captured_digest is not null and exists (select 1 from public.game_history h
      where h.source_kind = 'normal' and h.source_id = p_room_id
        and (h.participant_id = p_actor_id or h.source_owner_id = p_actor_id)) then
      return query select 'none'::text, p_room_id, null::uuid,
        captured_digest, true, null::text;
      return;
    end if;
    if exists (select 1 from public.game_history h where h.source_kind = 'normal'
        and h.source_id = p_room_id and h.participant_id = p_actor_id)
      and exists (
      select 1 from public.saved_legacy_payloads l
      where l.source_kind = 'normal' and l.source_id = p_room_id) then
      select i.state into legacy_saved_state from public.saved_game_items i
        where i.source_kind = 'normal' and i.source_id = p_room_id
          and i.participant_id = p_actor_id;
      legacy_saved_state := coalesce(legacy_saved_state, 'legacy_archive_only');
      return query select 'private'::text, p_room_id, null::uuid,
        null::text, false, legacy_saved_state;
      return;
    end if;
    if exists (select 1 from public.private_library_items v
        where v.item_type = 'game' and v.source_scope = 'private'
          and v.source_game_id = p_room_id and v.game_id = p_room_id)
      and exists (select 1 from public.game_history h
        where h.source_kind = 'normal' and h.source_id = p_room_id
          and (h.participant_id = p_actor_id or h.source_owner_id = p_actor_id)) then
      return query select 'private'::text, p_room_id, null::uuid,
        null::text, false, 'legacy_archive_only'::text;
      return;
    end if;
    raise exception 'normal room not found' using errcode = 'P0002';
  end if;
  if live.room_purpose = 'stage' or live.revision is distinct from p_expected_revision
    or (select t.version from public.game_timelines t where t.game_id = p_room_id)
      is distinct from p_timeline_version
    or (p_actor_id is distinct from live.owner_id
      and p_actor_id is distinct from live.player_a_user_id
      and p_actor_id is distinct from live.player_b_user_id)
    or (compact and p_state ->> 'gameId' is distinct from
      p_record #>> '{genesis,meta,gameId}')
    or p_state ->> 'status' is distinct from 'finished'
    or (compact and (
      p_record ->> 'format' is distinct from '1'
      or coalesce(p_record #>> '{genesis,meta,gameId}', '') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(p_record ->> 'digest', '') !~ '^[0-9a-f]{64}$'
      or p_record #>> '{provenance,completionAuthority}' is distinct from 'client-reported'))
    or (not compact and (
      not live.legacy_private_autosave or live.archive_policy <> 'private'
      or p_state ->> 'v' is distinct from '3'
      or coalesce(p_state ->> 'gameId', '') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(p_state -> 'history') is distinct from 'array'
      or jsonb_typeof(p_state -> 'logs') is distinct from 'array'))
  then raise exception 'normal terminal state changed or is invalid' using errcode = '40001';
  end if;

  -- Legacy private ownership predates Saved. Lock its owner before the source
  -- lock so Save, downgrade and this compatibility insertion cannot deadlock.
  if live.legacy_private_autosave and live.archive_policy = 'private' then
    perform pg_advisory_xact_lock(hashtextextended(live.owner_id::text, 41));
  end if;
  if not compact then
    select t.doc into parked_doc from public.game_timelines t where t.game_id = p_room_id;
  end if;
  claim_before := current_setting('request.jwt.claims', true);
  sub_before := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);
  select * into result_row from public.finalize_live_game(
    p_room_id, p_state, p_completion_kind, p_completion_reason, p_surrendered_side);
  perform set_config('request.jwt.claims', coalesce(claim_before, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(sub_before, ''), true);

  recent_retained := false;
  captured_digest := p_record ->> 'digest';
  record_digest := captured_digest;
  if compact then
    begin
      insert into public.recent_game_payloads (source_id, game_id, record_digest, record)
        values (p_room_id, p_room_id, captured_digest, p_record)
        on conflict (source_kind, source_id) do nothing;
      if not exists (select 1 from public.recent_game_payloads p
        where p.source_kind = 'normal' and p.source_id = p_room_id
          and p.record_digest = captured_digest) then
        raise exception 'normal terminal payload conflict' using errcode = '23514';
      end if;
      perform public.recent_retain_completed_source('normal', p_room_id);
      recent_retained := true;
    exception when others then
      raise warning 'normal result retained without Recent Compact: %', sqlerrm;
      recent_retained := false;
      record_digest := null;
    end;
  end if;

  legacy_saved_state := null;
  if (recent_retained or not compact)
    and live.legacy_private_autosave and live.archive_policy = 'private'
    and exists (select 1 from public.game_history h where h.source_kind = 'normal'
      and h.source_id = p_room_id and h.participant_id = live.owner_id) then
    begin
      perform public.reconcile_saved_capacity(live.owner_id);
      if not compact then
        perform pg_advisory_xact_lock(hashtextextended('eq-payload:' || p_room_id::text, 0));
        insert into public.saved_legacy_payloads (source_id, game_id, snapshot)
          values (p_room_id, p_room_id,
            case when parked_doc is null then p_state
              else p_state || jsonb_build_object('timeline', parked_doc) end)
          on conflict do nothing;
      end if;
      select e.plan_key into owner_plan from public.plan_effective(live.owner_id, now()) e;
      owner_cap := public.plan_capability_int(owner_plan, 'private_drive_limit');
      select count(*) into owner_active from public.saved_game_items i
        where i.participant_id = live.owner_id and i.state = 'active';
      legacy_saved_state := case when owner_active < owner_cap then 'active' else 'overflow' end;
      insert into public.saved_game_items
        (source_kind, source_id, participant_id, state, origin)
        values ('normal', p_room_id, live.owner_id, legacy_saved_state, 'legacy_finish')
        on conflict do nothing;
    exception when others then
      raise warning 'legacy private archive retained without Saved relation: %', sqlerrm;
      legacy_saved_state := 'legacy_archive_only';
    end;
  end if;
  archive_scope := result_row.archive_scope;
  archive_game_id := result_row.archive_game_id;
  private_item_id := result_row.private_item_id;
  return next;
end $$;
revoke all on function public.capture_normal_terminal(uuid, uuid, bigint, bigint, jsonb, jsonb, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.capture_normal_terminal(uuid, uuid, bigint, bigint, jsonb, jsonb, text, text, text)
  to service_role;

comment on table public.recent_game_payloads is
  'Shared immutable Compact payload from the trusted normal terminal or Stage capture path; intermediate normal moves remain client-reported.';

commit;
