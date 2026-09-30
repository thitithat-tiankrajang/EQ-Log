-- Archive/source ID is the room UUID; the encoded game's internal gameId is
-- a different UUID for actual normal rooms. Bind each independently.
begin;

alter table public.recent_game_payloads drop constraint recent_game_payloads_check;
alter table public.recent_game_payloads add constraint recent_game_payloads_check check (
  record ->> 'format' = '1' and record ->> 'digest' = record_digest
  and coalesce(record #>> '{genesis,meta,gameId}', '') ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);
alter table public.saved_legacy_payloads drop constraint saved_legacy_payloads_check;
alter table public.saved_legacy_payloads add constraint saved_legacy_payloads_check check (
  snapshot ->> 'v' = '3' and snapshot ->> 'status' = 'finished'
  and coalesce(snapshot ->> 'gameId', '') ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and jsonb_typeof(snapshot -> 'history') = 'array'
  and jsonb_typeof(snapshot -> 'logs') = 'array'
);

create or replace function public.saved_legacy_source_for_user(p_game_id uuid, p_viewer uuid)
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
    and candidate.snapshot ->> 'status' = 'finished'
    and coalesce(candidate.snapshot ->> 'gameId', '') ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and jsonb_typeof(candidate.snapshot -> 'history') = 'array'
    and jsonb_typeof(candidate.snapshot -> 'logs') = 'array'
  order by candidate.priority, candidate.sort_at, candidate.sort_id limit 1
$$;

-- History reports the exact retained state. Its replay access remains true
-- for Trash and Overflow because those states deliberately retain payloads.
drop function public.list_my_game_history(integer, timestamptz, text, uuid);
create function public.list_my_game_history(
  p_limit integer default 20, p_before_at timestamptz default null,
  p_before_kind text default null, p_before_id uuid default null
) returns table (
  source_kind text, source_id uuid, game_id uuid, participant_side text,
  game_name text, mode_key text, game_mode text, opponent_label text, bot_key text,
  score_for integer, score_against integer, outcome text, completed_at timestamptz,
  rules_version text, result_authority text, replay_availability text,
  is_recent boolean, is_saved boolean, can_save boolean, saved_state text
) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  perform public.reconcile_saved_capacity(auth.uid());
  return query select h.source_kind, h.source_id, h.game_id, h.participant_side,
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
    ), i.state
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
      and v.snapshot ->> 'status' = 'finished'
      and jsonb_typeof(v.snapshot -> 'history') = 'array'
      and jsonb_typeof(v.snapshot -> 'logs') = 'array'
    limit 1
  ) host_legacy on h.source_kind = 'normal';
end
$$;
revoke all on function public.list_my_game_history(integer, timestamptz, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_my_game_history(integer, timestamptz, text, uuid)
  to authenticated;

commit;
