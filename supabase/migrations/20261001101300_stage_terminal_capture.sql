-- Stage-only terminal capture. The Edge adapter validates and builds Compact v1;
-- this transaction binds it to the frozen attempt, records an outcome and removes
-- the live room together. Earlier advisory attempts remain advisory.
begin;

-- The attempt's genesis is the level seal as it existed at creation. Older
-- code allowed an administrator to reseal a level afterwards, which could
-- strand a valid attempt at its next commit or terminal capture.
create function public.freeze_used_stage_start()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.survival_attempts where level_id = old.id) then
    raise exception 'stage_start_in_use: a level with attempts cannot be resealed'
      using errcode = '22023';
  end if;
  return new;
end; $$;
revoke all on function public.freeze_used_stage_start()
  from public, anon, authenticated, service_role;
create trigger freeze_used_stage_start before update of start_canonical
  on public.survival_levels for each row execute function public.freeze_used_stage_start();

-- Hold the level row from the initial seal read through attempt insertion.
-- Without this lock, an admin reseal could commit between the old function's
-- level read and its attempt insert, leaving that attempt with a stale start.
alter function public.create_stage_attempt(uuid, uuid, jsonb)
  rename to create_stage_attempt_before_start_freeze;
revoke all on function public.create_stage_attempt_before_start_freeze(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
create function public.create_stage_attempt(
  target_request_id uuid, target_level_id uuid, target_state jsonb
) returns table (room_id uuid, room_code text, attempt_id uuid, replayed boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.survival_levels where id = target_level_id for share;
  return query select * from public.create_stage_attempt_before_start_freeze(
    target_request_id, target_level_id, target_state);
end; $$;
revoke all on function public.create_stage_attempt(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_stage_attempt(uuid, uuid, jsonb)
  to authenticated;

alter table public.survival_attempts
  add column if not exists result_authority text not null default 'advisory';
alter table public.survival_attempts drop constraint if exists survival_attempts_result_authority_check;
alter table public.survival_attempts add constraint survival_attempts_result_authority_check
  check (result_authority in ('advisory', 'captured_client_state'));
comment on column public.survival_attempts.result_authority is
  'advisory = historic browser report; captured_client_state = server-bound terminal capture, with prior live moves still client-computed.';

-- Owners may read their listing, but no browser may set a result after this
-- migration. Historic values are neither rewritten nor silently upgraded.
revoke update (finished_at, player_score, authur_score, result)
  on public.survival_attempts from authenticated;
drop policy if exists survival_attempt_update on public.survival_attempts;

create table public.stage_completed_attempts (
  attempt_id uuid primary key references public.survival_attempts(id) on delete restrict,
  room_id uuid not null unique,
  player_id uuid not null references auth.users(id),
  level_id uuid not null references public.survival_levels(id),
  source_revision bigint not null check (source_revision > 0),
  completed_at timestamptz not null default now(),
  completion_kind text not null check (completion_kind in ('natural', 'terminated')),
  completion_reason text not null,
  surrendered_side text check (surrendered_side in ('A', 'B')),
  outcome text not null check (outcome in ('win', 'loss', 'tie')),
  score_a integer not null check (score_a >= 0),
  score_b integer not null check (score_b >= 0),
  rules_version text not null,
  record_digest text not null check (record_digest ~ '^[0-9a-f]{64}$'),
  record jsonb not null,
  state_authority text not null default 'client_committed'
    check (state_authority = 'client_committed')
);
comment on table public.stage_completed_attempts is
  'Immutable Stage Compact records. Raw record is service-only; Stage move legality and scoring remain client-committed.';
alter table public.stage_completed_attempts enable row level security;
revoke all on table public.stage_completed_attempts from public, anon, authenticated, service_role;
grant select, insert on table public.stage_completed_attempts to service_role;
-- The trusted Edge adapter needs these source facts. The previous hardening
-- revoked service_role's table grants even though it bypasses RLS.
grant select on table public.survival_attempts, public.survival_levels,
  public.game_timelines to service_role;

-- The old finalizer remains exactly as it was for normal, Ranked and Hosted
-- games. It is private under a new name. The public name now routes Stage to
-- the dedicated capture endpoint, so no Stage completion can delete the room
-- without a durable Compact record.
alter function public.finalize_live_game(uuid, jsonb, text, text, text)
  rename to finalize_live_game_before_stage_capture;
revoke all on function public.finalize_live_game_before_stage_capture(uuid, jsonb, text, text, text)
  from public, anon, authenticated, service_role;
create function public.finalize_live_game(
  target_game_id uuid, target_state jsonb, target_completion_kind text,
  target_completion_reason text, target_surrendered_side text default null
) returns table (archive_scope text, archive_game_id uuid, private_item_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.room_live where room_id = target_game_id and room_purpose = 'stage')
     or exists (select 1 from public.stage_completed_attempts where room_id = target_game_id) then
    raise exception 'stage_terminal_endpoint_required: use the trusted Stage terminal endpoint'
      using errcode = '42501';
  end if;
  return query select * from public.finalize_live_game_before_stage_capture(
    target_game_id, target_state, target_completion_kind,
    target_completion_reason, target_surrendered_side
  );
end; $$;
revoke all on function public.finalize_live_game(uuid, jsonb, text, text, text)
  from public, anon;
grant execute on function public.finalize_live_game(uuid, jsonb, text, text, text)
  to authenticated, service_role;

create function public.capture_stage_terminal(
  target_game_id uuid,
  target_player_id uuid,
  target_expected_revision bigint,
  target_timeline_version bigint,
  target_state jsonb,
  target_record jsonb,
  target_completion_kind text,
  target_completion_reason text,
  target_surrendered_side text default null
) returns table (attempt_id uuid, outcome text, record_digest text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  live public.room_live%rowtype;
  attempt public.survival_attempts%rowtype;
  existing public.stage_completed_attempts%rowtype;
  opening jsonb;
  score_a integer;
  score_b integer;
  sum_a numeric;
  sum_b numeric;
  final_outcome text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'trusted Stage capture required' using errcode = '42501';
  end if;
  -- A repeat uses the stable server-created room/attempt identity. Reject a
  -- changed payload rather than mutating an immutable result.
  select * into existing from public.stage_completed_attempts c
   where c.room_id = target_game_id for update;
  if found then
    if existing.player_id is distinct from target_player_id
       or existing.record_digest is distinct from target_record ->> 'digest' then
      raise exception 'stage_terminal_conflict: completion already differs'
        using errcode = '22023';
    end if;
    return query select existing.attempt_id, existing.outcome, existing.record_digest;
    return;
  end if;

  select * into live from public.room_live where room_id = target_game_id for update;
  if not found then
    -- A concurrent capture may have deleted the room while this statement
    -- waited on its lock. This new statement sees the committed result.
    select * into existing from public.stage_completed_attempts c
     where c.room_id = target_game_id for update;
    if found then
      if existing.player_id is distinct from target_player_id
         or existing.record_digest is distinct from target_record ->> 'digest' then
        raise exception 'stage_terminal_conflict: completion already differs'
          using errcode = '22023';
      end if;
      return query select existing.attempt_id, existing.outcome, existing.record_digest;
      return;
    end if;
    raise exception 'stage room not found' using errcode = 'P0002';
  end if;
  select * into attempt from public.survival_attempts a
   where a.room_id = target_game_id for update;
  if not found or live.room_purpose <> 'stage' or live.archive_policy <> 'none'
     or live.owner_id is distinct from target_player_id
     or attempt.player_id is distinct from target_player_id
     or live.bot_key <> 'authur_strong' or live.bot_side <> 'B' then
    raise exception 'valid server-created Stage attempt required' using errcode = '42501';
  end if;
  if attempt.finished_at is not null or live.revision < 1 or live.canonical is null
     or live.state is null then
    raise exception 'sealed, unfinished Stage attempt required' using errcode = '22023';
  end if;
  if live.revision is distinct from target_expected_revision
     or (select t.version from public.game_timelines t where t.game_id = target_game_id)
       is distinct from target_timeline_version then
    raise exception 'stage_revision_conflict: live state changed' using errcode = '40001';
  end if;
  select l.start_canonical into opening from public.survival_levels l where l.id = attempt.level_id;
  if opening is null then
    raise exception 'sealed Stage start missing' using errcode = '22023';
  end if;
  if target_state ->> 'status' <> 'finished'
     or target_state ->> 'gameId' is distinct from live.state ->> 'gameId'
     or target_record ->> 'format' <> '1'
     or target_record #>> '{provenance,mode}' <> 'stage'
     or target_record #>> '{provenance,completionAuthority}' <> 'client-reported'
     or target_record #>> '{provenance,stage,levelId}' is distinct from attempt.level_id::text
     or target_record #>> '{provenance,bot,catalogId}' is distinct from live.bot_key
     or target_record #>> '{provenance,bot,catalogVersion}' is distinct from live.bot_config_version::text
     or target_record #>> '{genesis,meta,gameId}' is distinct from live.state ->> 'gameId'
     or target_record ->> 'digest' !~ '^[0-9a-f]{64}$'
     or target_record ->> 'rules' is null then
    raise exception 'invalid Stage terminal record identity' using errcode = '22023';
  end if;
  if target_completion_kind not in ('natural', 'terminated')
     or (target_completion_kind = 'natural' and target_completion_reason not in
       ('rack_out', 'no_score_streak', 'perfect_game'))
     or (target_completion_kind = 'terminated' and target_completion_reason not in
       ('surrender', 'manual', 'admin', 'timeout', 'disconnect', 'legacy_finished', 'other'))
     or (target_completion_reason = 'surrender') <> (target_surrendered_side is not null)
     or target_surrendered_side = 'B'
     or (target_completion_kind = 'natural' and
       public.snapshot_completion_reason(target_state) is distinct from target_completion_reason)
     or (target_completion_reason = 'surrender' and
       target_state #>> '{matchControl,surrenderedSide}' is distinct from target_surrendered_side) then
    raise exception 'invalid Stage terminal reason' using errcode = '22023';
  end if;
  if jsonb_typeof(target_state -> 'logs') is distinct from 'array'
     or jsonb_typeof(target_state #> '{scores,A}') is distinct from 'number'
     or jsonb_typeof(target_state #> '{scores,B}') is distinct from 'number' then
    raise exception 'Stage scores and logs required' using errcode = '22023';
  end if;
  score_a := (target_state #>> '{scores,A}')::integer;
  score_b := (target_state #>> '{scores,B}')::integer;
  select coalesce(sum((log ->> 'finalScore')::numeric) filter (where log ->> 'side' = 'A'), 0),
         coalesce(sum((log ->> 'finalScore')::numeric) filter (where log ->> 'side' = 'B'), 0)
    into sum_a, sum_b from jsonb_array_elements(target_state -> 'logs') as log;
  if score_a is distinct from (opening #>> '{scores,A}')::numeric + sum_a
     or score_b is distinct from (opening #>> '{scores,B}')::numeric + sum_b
     or score_a < 0 or score_b < 0 then
    raise exception 'Stage terminal score lost seeded baseline or log effects'
      using errcode = '22023';
  end if;
  final_outcome := case
    when target_completion_kind <> 'natural' then 'loss'
    when score_a > score_b then 'win'
    when score_a < score_b then 'loss'
    else 'tie' end;

  insert into public.stage_completed_attempts (
    attempt_id, room_id, player_id, level_id, source_revision,
    completion_kind, completion_reason, surrendered_side, outcome,
    score_a, score_b, rules_version, record_digest, record
  ) values (
    attempt.id, live.room_id, attempt.player_id, attempt.level_id, live.revision,
    target_completion_kind, target_completion_reason, target_surrendered_side,
    final_outcome, score_a, score_b, target_record ->> 'rules',
    target_record ->> 'digest', target_record
  );
  update public.survival_attempts
     set finished_at = now(), player_score = score_a, authur_score = score_b,
         result = final_outcome, result_authority = 'captured_client_state'
   where id = attempt.id;
  -- Stage's client-committed moves are not a verified competitive result.
  -- Do not feed the ordinary player-result/stat path until a Stage reducer
  -- can independently verify every human and bot action.
  delete from public.room_live where room_id = target_game_id;
  return query select attempt.id, final_outcome, target_record ->> 'digest';
end; $$;
revoke all on function public.capture_stage_terminal(uuid, uuid, bigint, bigint, jsonb, jsonb, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.capture_stage_terminal(uuid, uuid, bigint, bigint, jsonb, jsonb, text, text, text)
  to service_role;
commit;
