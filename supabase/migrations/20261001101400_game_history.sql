-- Permanent, metadata-only participation index. No replay data lives here.
-- All active inserts happen inside an existing terminal transaction.
begin;

create table public.game_history (
  source_kind text not null check (source_kind in ('normal', 'ranked', 'stage')),
  source_id uuid not null,
  participant_id uuid not null references auth.users(id) on delete cascade,
  source_owner_id uuid,
  game_id uuid not null,
  participant_side text not null check (participant_side in ('A', 'B')),
  game_name text not null,
  mode_key text not null,
  game_mode text not null check (game_mode in ('versus', 'solo', 'stage', 'ranked')),
  opponent_label text,
  bot_key text,
  score_for integer,
  score_against integer,
  outcome text check (outcome in ('win', 'loss', 'draw')),
  completed_at timestamptz not null,
  rules_version text,
  result_authority text not null check (result_authority in (
    'client_reported', 'server_reduced', 'captured_client_state', 'advisory'
  )),
  primary key (source_kind, source_id, participant_id),
  constraint history_score_pair check (
    (score_for is null and score_against is null) or score_for is not null
  )
);
comment on table public.game_history is
  'Permanent per-seated-participant metadata index. Never contains a board, rack, draw, move, or replay payload. Results copy existing terminal authorities.';
create index game_history_page_idx on public.game_history
  (participant_id, completed_at desc, source_kind desc, source_id desc);
alter table public.game_history enable row level security;
revoke all on public.game_history from public, anon, authenticated, service_role;
grant select, insert on public.game_history to service_role;

create function public.history_normal_outcome(
  p_mode text, p_side text, p_a integer, p_b integer, p_surrendered text
) returns text language sql immutable set search_path = pg_catalog as $$
  select case
    when p_mode = 'solo' then null
    when p_surrendered = p_side then 'loss'
    when p_surrendered is not null then 'win'
    when p_a = p_b then 'draw'
    when (p_side = 'A' and p_a > p_b) or (p_side = 'B' and p_b > p_a) then 'win'
    else 'loss' end
$$;
revoke all on function public.history_normal_outcome(text, text, integer, integer, text)
  from public, anon, authenticated, service_role;

create function public.history_insert_normal(
  p_live public.room_live, p_score_a integer, p_score_b integer,
  p_surrendered text, p_completed_at timestamptz
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_live.room_purpose <> 'normal' then return; end if;
  if p_live.player_a_user_id is not null then
    insert into public.game_history (
      source_kind, source_id, participant_id, source_owner_id, game_id, participant_side,
      game_name, mode_key, game_mode, opponent_label, bot_key,
      score_for, score_against, outcome, completed_at, result_authority
    ) values (
      'normal', p_live.room_id, p_live.player_a_user_id, p_live.owner_id, p_live.room_id, 'A',
      p_live.name, p_live.mode_key, p_live.game_mode,
      case when p_live.game_mode = 'solo' then null else p_live.player_b end,
      p_live.bot_key, p_score_a,
      case when p_live.game_mode = 'solo' then null else p_score_b end,
      public.history_normal_outcome(p_live.game_mode, 'A', p_score_a, p_score_b, p_surrendered),
      p_completed_at, 'client_reported'
    ) on conflict do nothing;
  end if;
  if p_live.game_mode = 'versus' and p_live.player_b_user_id is not null then
    insert into public.game_history (
      source_kind, source_id, participant_id, source_owner_id, game_id, participant_side,
      game_name, mode_key, game_mode, opponent_label, bot_key,
      score_for, score_against, outcome, completed_at, result_authority
    ) values (
      'normal', p_live.room_id, p_live.player_b_user_id, p_live.owner_id, p_live.room_id, 'B',
      p_live.name, p_live.mode_key, p_live.game_mode, p_live.player_a,
      p_live.bot_key, p_score_b, p_score_a,
      public.history_normal_outcome(p_live.game_mode, 'B', p_score_a, p_score_b, p_surrendered),
      p_completed_at, 'client_reported'
    ) on conflict do nothing;
  end if;
end $$;
revoke all on function public.history_insert_normal(public.room_live, integer, integer, text, timestamptz)
  from public, anon, authenticated, service_role;

-- The previous finalizer still writes legacy archives and unchanged stats.
-- This wrapper captures its frozen seats before it deletes room_live. A failed
-- finalization rolls back History; replay quota/retention is never consulted.
alter function public.finalize_live_game(uuid, jsonb, text, text, text)
  rename to finalize_live_game_before_history;
revoke all on function public.finalize_live_game_before_history(uuid, jsonb, text, text, text)
  from public, anon, authenticated, service_role;
create function public.finalize_live_game(
  target_game_id uuid, target_state jsonb, target_completion_kind text,
  target_completion_reason text, target_surrendered_side text default null
) returns table (archive_scope text, archive_game_id uuid, private_item_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  live public.room_live%rowtype;
  result_row record;
  fallback_private_quota boolean := false;
begin
  select * into live from public.room_live where room_id = target_game_id for update;
  if not found then
    -- A retained History row is the durable duplicate marker even if an
    -- archive has subsequently been pruned or a private copy deleted.
    if exists (select 1 from public.game_history h
       where h.source_kind = 'normal' and h.source_id = target_game_id
         and (h.participant_id = auth.uid() or h.source_owner_id = auth.uid())) then
      return query select 'none'::text, target_game_id, null::uuid;
      return;
    end if;
    return query select * from public.finalize_live_game_before_history(
      target_game_id, target_state, target_completion_kind,
      target_completion_reason, target_surrendered_side);
    return;
  end if;
  -- A previously reserved Private slot can disappear if the legacy limit is
  -- lowered or another item fills it. Save replay if possible, but never make
  -- completed-game History or the result depend on that storage capacity.
  begin
    for result_row in select * from public.finalize_live_game_before_history(
      target_game_id, target_state, target_completion_kind,
      target_completion_reason, target_surrendered_side) loop
      perform public.history_insert_normal(
        live, coalesce((target_state #>> '{scores,A}')::integer, live.score_a),
        coalesce((target_state #>> '{scores,B}')::integer, live.score_b),
        target_surrendered_side, now());
      return query select result_row.archive_scope::text,
        result_row.archive_game_id::uuid, result_row.private_item_id::uuid;
    end loop;
  exception when sqlstate 'P0001' then
    if live.archive_policy <> 'private' or sqlerrm <> 'private library quota reached' then
      raise;
    end if;
    fallback_private_quota := true;
  end;
  if fallback_private_quota then
    -- The prior call passed all of the old finalizer's access, terminal and
    -- reason checks before its archive INSERT failed. Its subtransaction was
    -- rolled back; repeat only the old result/stat operations and room delete.
    live.turn_number := coalesce((target_state ->> 'turnNumber')::int, live.turn_number);
    live.score_a := coalesce((target_state #>> '{scores,A}')::int, live.score_a);
    live.score_b := coalesce((target_state #>> '{scores,B}')::int, live.score_b);
    perform public.record_player_result(
      live.player_a_user_id, live.mode_key, live.game_mode, 'A',
      live.score_a, live.score_b, now(), target_surrendered_side);
    if live.game_mode = 'versus' then
      perform public.record_player_result(
        live.player_b_user_id, live.mode_key, live.game_mode, 'B',
        live.score_a, live.score_b, now(), target_surrendered_side);
    end if;
    if live.bot_key is not null then
      perform public.record_bot_stat_from_room(
        live, target_completion_kind, target_completion_reason);
    end if;
    perform public.history_insert_normal(
      live, live.score_a, live.score_b,
      target_surrendered_side, now());
    delete from public.room_live where room_id = target_game_id;
    return query select 'none'::text, target_game_id, null::uuid;
  end if;
end $$;
revoke all on function public.finalize_live_game(uuid, jsonb, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_live_game(uuid, jsonb, text, text, text)
  to authenticated, service_role;

create function public.history_capture_ranked_result()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.ranked_matches%rowtype;
begin
  select * into m from public.ranked_matches where id = new.match_id;
  insert into public.game_history (
    source_kind, source_id, participant_id, game_id, participant_side,
    game_name, mode_key, game_mode, opponent_label, score_for, score_against,
    outcome, completed_at, result_authority
  ) values
    ('ranked', new.match_id, new.player_a_id, new.match_id, 'A', 'Ranked match',
     'ranked', 'ranked', m.state #>> '{players,B}', new.score_a, new.score_b,
     case when new.winner_id is null then 'draw' when new.winner_id = new.player_a_id then 'win' else 'loss' end,
     new.created_at, 'server_reduced'),
    ('ranked', new.match_id, new.player_b_id, new.match_id, 'B', 'Ranked match',
     'ranked', 'ranked', m.state #>> '{players,A}', new.score_b, new.score_a,
     case when new.winner_id is null then 'draw' when new.winner_id = new.player_b_id then 'win' else 'loss' end,
     new.created_at, 'server_reduced')
  on conflict do nothing;
  return new;
end $$;
revoke all on function public.history_capture_ranked_result()
  from public, anon, authenticated, service_role;
create trigger capture_ranked_history after insert on public.ranked_results
  for each row execute function public.history_capture_ranked_result();

create function public.history_capture_stage_result()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare level_no integer;
begin
  select l.level_no into level_no from public.survival_levels l where l.id = new.level_id;
  insert into public.game_history (
    source_kind, source_id, participant_id, game_id, participant_side,
    game_name, mode_key, game_mode, opponent_label, bot_key,
    score_for, score_against, outcome, completed_at, rules_version, result_authority
  ) values (
    'stage', new.attempt_id, new.player_id, new.room_id, 'A',
    'Stage level ' || level_no::text, 'stage', 'stage', 'Authur', 'authur_strong',
    new.score_a, new.score_b,
    case when new.outcome = 'tie' then 'draw' else new.outcome end,
    new.completed_at, new.rules_version, 'captured_client_state'
  ) on conflict do nothing;
  return new;
end $$;
revoke all on function public.history_capture_stage_result()
  from public, anon, authenticated, service_role;
create trigger capture_stage_history after insert on public.stage_completed_attempts
  for each row execute function public.history_capture_stage_result();

-- The RPC returns only allowlisted metadata. The EXISTS probes are indexed by
-- game ID and owner/region; they never send snapshot/record bytes to a client.
create function public.list_my_game_history(
  p_limit integer default 20, p_before_at timestamptz default null,
  p_before_kind text default null, p_before_id uuid default null
) returns table (
  source_kind text, source_id uuid, game_id uuid, participant_side text,
  game_name text, mode_key text, game_mode text, opponent_label text, bot_key text,
  score_for integer, score_against integer, outcome text, completed_at timestamptz,
  rules_version text, result_authority text, replay_availability text
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
      when s.record is not null then 'compact_available'
      when h.source_kind = 'ranked' or h.result_authority = 'advisory' then 'unsupported_legacy'
      else 'unavailable' end
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
    select i.snapshot from public.private_library_items i
    where i.game_id = h.game_id and i.owner_id = viewer
      and i.item_type = 'game' and i.trashed_at is null
    order by i.created_at, i.id limit 1
  ) v on h.source_kind = 'normal'
  left join public.stage_completed_attempts s on s.attempt_id = h.source_id
    and h.source_kind = 'stage' and s.player_id = viewer
  order by h.completed_at desc, h.source_kind desc, h.source_id desc
  ;
end $$;
revoke all on function public.list_my_game_history(integer, timestamptz, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_my_game_history(integer, timestamptz, text, uuid)
  to authenticated;

-- Explicit service-only, keyset-batched legacy metadata backfill. No payload
-- conversion, no score inference from JSON, and no Private owner inference.
create function public.backfill_game_history_page(
  p_source text, p_after_id uuid default null, p_limit integer default 500
) returns table (scanned integer, inserted integer, last_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n integer := 0; added integer := 0; affected integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service-only History backfill' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('public', 'region', 'ranked', 'stage')
     or p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'invalid History backfill page' using errcode = '22023';
  end if;
  if p_source in ('public', 'region') then
    for r in
      select a.* from (
        select game_id, source_owner_id, name, player_a, player_b, game_mode, mode_key,
          player_a_user_id, player_b_user_id, score_a, score_b, surrendered_side,
          finished_at from public.public_game_snapshots where p_source = 'public'
        union all
        select game_id, source_owner_id, name, player_a, player_b, game_mode, mode_key,
          player_a_user_id, player_b_user_id, score_a, score_b, surrendered_side,
          finished_at from public.region_game_snapshots where p_source = 'region'
      ) a where p_after_id is null or a.game_id > p_after_id
      order by a.game_id limit p_limit
    loop
      n := n + 1; last_id := r.game_id;
      if r.player_a_user_id is not null then
        insert into public.game_history (
          source_kind, source_id, participant_id, source_owner_id, game_id, participant_side,
          game_name, mode_key, game_mode, opponent_label, score_for, score_against,
          outcome, completed_at, result_authority
        ) values (
          'normal', r.game_id, r.player_a_user_id, r.source_owner_id, r.game_id, 'A', r.name,
          r.mode_key, r.game_mode, case when r.game_mode = 'solo' then null else r.player_b end,
          r.score_a, case when r.game_mode = 'solo' then null else r.score_b end,
          public.history_normal_outcome(r.game_mode, 'A', r.score_a, r.score_b, r.surrendered_side),
          r.finished_at, 'client_reported'
        ) on conflict do nothing;
        get diagnostics affected = row_count;
        added := added + affected;
      end if;
      if r.game_mode = 'versus' and r.player_b_user_id is not null then
        insert into public.game_history (
          source_kind, source_id, participant_id, source_owner_id, game_id, participant_side,
          game_name, mode_key, game_mode, opponent_label, score_for, score_against,
          outcome, completed_at, result_authority
        ) values (
          'normal', r.game_id, r.player_b_user_id, r.source_owner_id, r.game_id, 'B', r.name,
          r.mode_key, r.game_mode, r.player_a, r.score_b, r.score_a,
          public.history_normal_outcome(r.game_mode, 'B', r.score_a, r.score_b, r.surrendered_side),
          r.finished_at, 'client_reported'
        ) on conflict do nothing;
        get diagnostics affected = row_count;
        added := added + affected;
      end if;
    end loop;
  elsif p_source = 'ranked' then
    for r in select x.* from public.ranked_results x
      where p_after_id is null or x.match_id > p_after_id
      order by x.match_id limit p_limit loop
      n := n + 1; last_id := r.match_id;
      added := added + public.history_capture_ranked_result_backfill(r.match_id);
    end loop;
  else
    for r in select a.id from public.survival_attempts a
      where a.finished_at is not null and (p_after_id is null or a.id > p_after_id)
      order by a.id limit p_limit loop
      n := n + 1; last_id := r.id;
      added := added + public.history_capture_stage_result_backfill(r.id);
    end loop;
  end if;
  scanned := n; inserted := added;
  return next;
end $$;

create function public.history_capture_ranked_result_backfill(p_match uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.ranked_results%rowtype; m public.ranked_matches%rowtype; added integer;
begin
  select * into r from public.ranked_results where match_id = p_match;
  select * into m from public.ranked_matches where id = p_match;
  if r.match_id is null then return 0; end if;
  insert into public.game_history (
    source_kind, source_id, participant_id, game_id, participant_side, game_name,
    mode_key, game_mode, opponent_label, score_for, score_against,
    outcome, completed_at, result_authority
  ) values
    ('ranked', r.match_id, r.player_a_id, r.match_id, 'A', 'Ranked match',
     'ranked', 'ranked', m.state #>> '{players,B}', r.score_a, r.score_b,
     case when r.winner_id is null then 'draw' when r.winner_id = r.player_a_id then 'win' else 'loss' end,
     r.created_at, 'server_reduced'),
    ('ranked', r.match_id, r.player_b_id, r.match_id, 'B', 'Ranked match',
     'ranked', 'ranked', m.state #>> '{players,A}', r.score_b, r.score_a,
     case when r.winner_id is null then 'draw' when r.winner_id = r.player_b_id then 'win' else 'loss' end,
     r.created_at, 'server_reduced') on conflict do nothing;
  get diagnostics added = row_count;
  return added;
end $$;

create function public.history_capture_stage_result_backfill(p_attempt uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.survival_attempts%rowtype; c public.stage_completed_attempts%rowtype;
  level_no integer; added integer;
begin
  select * into a from public.survival_attempts where id = p_attempt and finished_at is not null;
  if a.id is null then return 0; end if;
  select * into c from public.stage_completed_attempts where attempt_id = a.id;
  select l.level_no into level_no from public.survival_levels l where l.id = a.level_id;
  insert into public.game_history (
    source_kind, source_id, participant_id, game_id, participant_side, game_name,
    mode_key, game_mode, opponent_label, bot_key, score_for, score_against,
    outcome, completed_at, rules_version, result_authority
  ) values (
    'stage', a.id, a.player_id, a.room_id, 'A', 'Stage level ' || level_no::text,
    'stage', 'stage', 'Authur', 'authur_strong', a.player_score, a.authur_score,
    case when a.result = 'tie' then 'draw' else a.result end,
    coalesce(c.completed_at, a.finished_at), c.rules_version,
    case when c.attempt_id is null then 'advisory' else 'captured_client_state' end
  ) on conflict do nothing;
  get diagnostics added = row_count;
  return added;
end $$;
revoke all on function public.backfill_game_history_page(text, uuid, integer),
  public.history_capture_ranked_result_backfill(uuid),
  public.history_capture_stage_result_backfill(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.backfill_game_history_page(text, uuid, integer)
  to service_role;

commit;
