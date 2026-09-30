-- Recent is an evictable per-participant relation, independent of permanent
-- History and future Saved ownership. Only Stage has an active Compact writer.
begin;

-- Dormant normal-source store for the later trusted Compact terminal writer.
-- One immutable payload can be retained by both seats. No normal finalizer
-- calls this table or the retention function in this milestone.
create table public.recent_game_payloads (
  source_kind text not null default 'normal' check (source_kind = 'normal'),
  source_id uuid not null,
  game_id uuid not null unique,
  constraint recent_normal_source_is_game check (source_id = game_id),
  record_digest text not null check (record_digest ~ '^[0-9a-f]{64}$'),
  record jsonb not null check (
    record ->> 'format' = '1' and record ->> 'digest' = record_digest
    and record #>> '{genesis,meta,gameId}' = game_id::text
  ),
  captured_at timestamptz not null default now(),
  primary key (source_kind, source_id)
);
comment on table public.recent_game_payloads is
  'Dormant shared Compact store for a future trusted normal terminal writer. No legacy-to-Compact conversion and no active normal caller.';
alter table public.recent_game_payloads enable row level security;
revoke all on public.recent_game_payloads from public, anon, authenticated, service_role;
grant select, insert on public.recent_game_payloads to service_role;

create function public.freeze_recent_game_payload()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'completed payload is immutable' using errcode = '42501';
end $$;
revoke all on function public.freeze_recent_game_payload()
  from public, anon, authenticated, service_role;
create trigger freeze_recent_game_payload before update or delete
  on public.recent_game_payloads for each row execute function public.freeze_recent_game_payload();

create table public.recent_game_items (
  source_kind text not null check (source_kind in ('normal', 'stage')),
  source_id uuid not null,
  participant_id uuid not null,
  completed_at timestamptz not null,
  primary key (source_kind, source_id, participant_id),
  foreign key (source_kind, source_id, participant_id)
    references public.game_history (source_kind, source_id, participant_id)
    on delete cascade
);
create index recent_game_items_page_idx on public.recent_game_items
  (participant_id, completed_at desc, source_kind desc, source_id desc);
comment on table public.recent_game_items is
  'Newest 20 eligible completed replays per participant; no Saved quota, ownership folder, or result fields.';
alter table public.recent_game_items enable row level security;
revoke all on public.recent_game_items from public, anon, authenticated, service_role;
grant select on public.recent_game_items to service_role;

-- The completion transaction calls this after History and the immutable
-- payload exist. All participant locks are acquired in UUID order so two
-- shared games cannot deadlock by seating the same players in reverse order.
create function public.recent_retain_completed_source(
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
  if p_source_kind = 'stage' then
    if not exists (select 1 from public.stage_completed_attempts s
      where s.attempt_id = p_source_id and s.record ->> 'format' = '1'
        and s.record ->> 'digest' = s.record_digest
        and s.record #>> '{genesis,meta,gameId}' = s.room_id::text
        and s.record #>> '{provenance,mode}' = 'stage') then
      raise exception 'Stage Compact capture required' using errcode = '22023';
    end if;
  elsif not exists (select 1 from public.recent_game_payloads p
    where p.source_kind = 'normal' and p.source_id = p_source_id) then
    raise exception 'trusted normal Compact capture required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.game_history h
    where h.source_kind = p_source_kind and h.source_id = p_source_id) then
    raise exception 'completed participant History required' using errcode = '22023';
  end if;
  for seat in
    select h.participant_id, h.completed_at from public.game_history h
    where h.source_kind = p_source_kind and h.source_id = p_source_id
    order by h.participant_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('eq-recent:' || seat.participant_id::text, 0));
  end loop;
  for seat in
    select h.participant_id, h.completed_at from public.game_history h
    where h.source_kind = p_source_kind and h.source_id = p_source_id
    order by h.participant_id
  loop
    insert into public.recent_game_items
      (source_kind, source_id, participant_id, completed_at)
    values (p_source_kind, p_source_id, seat.participant_id, seat.completed_at)
    on conflict do nothing;
    -- A late retry of an already-evicted source is inserted, then pruned by
    -- the same authoritative ordering; it cannot become newest again.
    delete from public.recent_game_items i using (
      select source_kind, source_id, row_number() over (
        order by completed_at desc, source_kind desc, source_id desc
      ) as ordinal
      from public.recent_game_items
      where participant_id = seat.participant_id
    ) ranked
    where i.participant_id = seat.participant_id
      and i.source_kind = ranked.source_kind and i.source_id = ranked.source_id
      and ranked.ordinal > 20;
  end loop;
end $$;
revoke all on function public.recent_retain_completed_source(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.recent_retain_completed_source(text, uuid)
  to service_role;

-- One database snapshot checks ownership and obtains the raw record for the
-- trusted Edge adapter. A concurrent eviction either happens before this
-- statement or after it; there is no relation-check/payload-fetch gap.
create function public.read_recent_game_payload(p_game_id uuid, p_user_id uuid)
returns table (game_id uuid, completed_at timestamptz, record jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'trusted Recent replay reader required' using errcode = '42501';
  end if;
  return query
    select p.game_id, i.completed_at, p.record
    from public.recent_game_items i
    join public.recent_game_payloads p on p.source_kind = i.source_kind
      and p.source_id = i.source_id
    where i.participant_id = p_user_id and i.source_kind = 'normal'
      and p.game_id = p_game_id;
end $$;
revoke all on function public.read_recent_game_payload(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_recent_game_payload(uuid, uuid)
  to service_role;

-- Capture is best-effort: an unexpected Recent storage failure rolls back
-- only this subtransaction, never the Stage result or permanent History.
create function public.recent_capture_stage_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform public.recent_retain_completed_source('stage', new.source_id);
  exception when others then
    raise warning 'Recent retention failed for Stage attempt %: %', new.source_id, sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.recent_capture_stage_history()
  from public, anon, authenticated, service_role;
create trigger capture_stage_recent after insert on public.game_history
  for each row when (new.source_kind = 'stage')
  execute function public.recent_capture_stage_history();

-- Recreate the metadata-only History reader with a live Recent indicator.
-- Neither the list nor the browser receives a Compact/legacy payload.
drop function public.list_my_game_history(integer, timestamptz, text, uuid);
create function public.list_my_game_history(
  p_limit integer default 20, p_before_at timestamptz default null,
  p_before_kind text default null, p_before_id uuid default null
) returns table (
  source_kind text, source_id uuid, game_id uuid, participant_side text,
  game_name text, mode_key text, game_mode text, opponent_label text, bot_key text,
  score_for integer, score_against integer, outcome text, completed_at timestamptz,
  rules_version text, result_authority text, replay_availability text,
  is_recent boolean
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare viewer uuid := auth.uid(); viewer_region uuid;
  viewer_approved boolean; viewer_admin boolean;
begin
  if auth.role() is distinct from 'authenticated' or viewer is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 or
     ((p_before_at is null) <> (p_before_kind is null)) or
     ((p_before_at is null) <> (p_before_id is null)) or
     (p_before_kind is not null and p_before_kind not in ('normal', 'ranked', 'stage')) then
    raise exception 'invalid History page cursor' using errcode = '22023';
  end if;
  select region_id, status = 'approved', is_admin
    into viewer_region, viewer_approved, viewer_admin
    from public.profiles where id = viewer;
  return query
  select h.source_kind, h.source_id, h.game_id, h.participant_side,
    h.game_name, h.mode_key, h.game_mode, h.opponent_label, h.bot_key,
    h.score_for, h.score_against, h.outcome, h.completed_at,
    h.rules_version, h.result_authority,
    case
      when p.snapshot is not null then
        case when p.snapshot ? 'format' then 'compact_available'
          when p.snapshot ->> 'v' in ('1', '2')
            or jsonb_typeof(p.snapshot -> 'history') is distinct from 'array'
          then 'legacy_partial' else 'legacy_available' end
      when r.snapshot is not null then
        case when r.snapshot ? 'format' then 'compact_available'
          when r.snapshot ->> 'v' in ('1', '2')
            or jsonb_typeof(r.snapshot -> 'history') is distinct from 'array'
          then 'legacy_partial' else 'legacy_available' end
      when v.snapshot is not null then
        case when v.snapshot ? 'format' then 'compact_available'
          when v.snapshot ->> 'v' in ('1', '2')
            or jsonb_typeof(v.snapshot -> 'history') is distinct from 'array'
          then 'legacy_partial' else 'legacy_available' end
      when n.record_digest is not null then 'compact_available'
      when s.record is not null then 'compact_available'
      when h.source_kind = 'ranked' or h.result_authority = 'advisory' then 'unsupported_legacy'
      else 'unavailable' end,
    (i.participant_id is not null and
      (s.record is not null or n.record_digest is not null))
  from (
    select * from public.game_history h0
    where h0.participant_id = viewer
      and (p_before_at is null or
        (h0.completed_at, h0.source_kind, h0.source_id) <
        (p_before_at, p_before_kind, p_before_id))
    order by h0.completed_at desc, h0.source_kind desc, h0.source_id desc
    limit p_limit
  ) h
  left join public.public_game_snapshots p on p.game_id = h.game_id
    and h.source_kind = 'normal' and (viewer_approved or viewer_admin)
  left join public.region_game_snapshots r on r.game_id = h.game_id
    and h.source_kind = 'normal' and (viewer_approved or viewer_admin)
    and (r.region_id = viewer_region or viewer_admin)
  left join lateral (
    select v0.snapshot from public.private_library_items v0
    where v0.game_id = h.game_id and v0.owner_id = viewer
      and v0.item_type = 'game' and v0.trashed_at is null
    order by v0.created_at, v0.id limit 1
  ) v on h.source_kind = 'normal'
  left join public.stage_completed_attempts s on s.attempt_id = h.source_id
    and h.source_kind = 'stage' and s.player_id = viewer
  left join public.recent_game_items i on i.source_kind = h.source_kind
    and i.source_id = h.source_id and i.participant_id = viewer
  left join public.recent_game_payloads n on n.source_kind = i.source_kind
    and n.source_id = i.source_id and n.game_id = h.game_id
  order by h.completed_at desc, h.source_kind desc, h.source_id desc;
end $$;
revoke all on function public.list_my_game_history(integer, timestamptz, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_my_game_history(integer, timestamptz, text, uuid)
  to authenticated;

commit;
