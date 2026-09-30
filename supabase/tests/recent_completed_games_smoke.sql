-- Isolated local Supabase only. Every fixture rolls back.
begin;

create function pg_temp.expect(ok boolean, message text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception '%', message; end if; end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin execute 'reset role'; end $$;
grant execute on function pg_temp.expect(boolean, text), pg_temp.as_service(),
  pg_temp.as_user(uuid), pg_temp.as_owner() to authenticated, service_role;

insert into auth.users (id, email, aud, role) values
  ('82000000-0000-4000-8000-000000000001', 'recent-a@example.test', 'authenticated', 'authenticated'),
  ('82000000-0000-4000-8000-000000000002', 'recent-b@example.test', 'authenticated', 'authenticated'),
  ('82000000-0000-4000-8000-000000000003', 'recent-host@example.test', 'authenticated', 'authenticated');
update public.profiles set status = 'approved'
  where id::text like '82000000-0000-4000-8000-00000000000%';

-- Game 1 is shared; A will evict it while B still retains it.
with games as (
  select n, ('82000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid as id
  from generate_series(1,25) n
)
insert into public.game_history (
  source_kind, source_id, participant_id, game_id, participant_side,
  game_name, mode_key, game_mode, completed_at, result_authority
)
select 'normal', id, '82000000-0000-4000-8000-000000000001', id, 'A',
  'Recent ' || n, 'versus', 'versus',
  '2026-09-30 00:00+00'::timestamptz + n * interval '1 minute', 'client_reported'
from games;
insert into public.game_history (
  source_kind, source_id, participant_id, game_id, participant_side,
  game_name, mode_key, game_mode, completed_at, result_authority
) values (
  'normal', '82000000-0000-4000-9000-000000000001',
  '82000000-0000-4000-8000-000000000002',
  '82000000-0000-4000-9000-000000000001', 'B', 'Shared', 'versus', 'versus',
  '2026-09-30 00:01+00', 'client_reported'
);
with games as (
  select n, ('82000000-0000-4001-9000-' || lpad(n::text, 12, '0'))::uuid as id
  from generate_series(1,19) n
)
insert into public.game_history (
  source_kind, source_id, participant_id, game_id, participant_side,
  game_name, mode_key, game_mode, completed_at, result_authority
)
select 'normal', id, '82000000-0000-4000-8000-000000000002', id, 'A',
  'B Recent ' || n, 'solo_practice', 'solo',
  '2026-09-30 01:00+00'::timestamptz + n * interval '1 minute', 'client_reported'
from games;
with games as (
  select ('82000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid as id
  from generate_series(1,25) n
  union all
  select ('82000000-0000-4001-9000-' || lpad(n::text, 12, '0'))::uuid
  from generate_series(1,19) n
)
insert into public.recent_game_payloads (source_id, game_id, record_digest, record)
select id, id, repeat('a',64),
  jsonb_build_object('format', 1, 'digest', repeat('a',64),
    'genesis', jsonb_build_object('meta', jsonb_build_object('gameId', id::text)))
from games;

select pg_temp.as_service();
select public.recent_retain_completed_source('normal',
  ('82000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid)
  from generate_series(1,19) n;
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = 19 from public.recent_game_items
  where participant_id = '82000000-0000-4000-8000-000000000001'), '19-game count');
select pg_temp.as_service();
select public.recent_retain_completed_source('normal', '82000000-0000-4000-9000-000000000020');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = 20 from public.recent_game_items
  where participant_id = '82000000-0000-4000-8000-000000000001'), '20-game count');
select pg_temp.as_service();
select public.recent_retain_completed_source('normal', '82000000-0000-4000-9000-000000000021');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = 20 from public.recent_game_items
  where participant_id = '82000000-0000-4000-8000-000000000001'), '21-game bound');
select pg_temp.expect(not exists (select 1 from public.recent_game_items
  where participant_id = '82000000-0000-4000-8000-000000000001'
    and source_id = '82000000-0000-4000-9000-000000000001'), 'oldest not evicted');
select pg_temp.as_service();
select public.recent_retain_completed_source('normal',
  ('82000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid)
  from generate_series(22,25) n;
select public.recent_retain_completed_source('normal',
  ('82000000-0000-4001-9000-' || lpad(n::text, 12, '0'))::uuid)
  from generate_series(1,19) n;
select public.recent_retain_completed_source('normal', '82000000-0000-4000-9000-000000000001');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = 20 from public.recent_game_items
  where participant_id = '82000000-0000-4000-8000-000000000001'), '>20-game bound');
select pg_temp.expect((select count(*) = 20 from public.recent_game_items
  where participant_id = '82000000-0000-4000-8000-000000000002'), 'B count');
select pg_temp.expect((select min(completed_at) = '2026-09-30 00:06+00'
  from public.recent_game_items
  where participant_id = '82000000-0000-4000-8000-000000000001'),
  'A did not retain exactly games 6-25');
select pg_temp.expect(exists (select 1 from public.recent_game_items
  where participant_id = '82000000-0000-4000-8000-000000000002'
    and source_id = '82000000-0000-4000-9000-000000000001'),
  'A eviction broke B retention');
select pg_temp.expect((select count(*) = 45 from public.game_history
  where participant_id in ('82000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000002')),
  'Recent eviction changed permanent History');
select pg_temp.expect((select count(*) = 44 from public.recent_game_payloads
  where game_id::text like '82000000-%'),
  'Recent eviction mutated a shared immutable payload');
do $$ begin
  begin
    update public.recent_game_payloads set record_digest = repeat('d',64)
      where game_id = '82000000-0000-4000-9000-000000000001';
    raise exception 'completed payload was mutable';
  exception when insufficient_privilege then null; end;
end $$;

-- Equal server completion times have a stable source-ID tie-breaker.
with games as (
  select n, ('82000000-0000-4003-9000-' || lpad(n::text, 12, '0'))::uuid as id
  from generate_series(1,21) n
)
insert into public.game_history (
  source_kind, source_id, participant_id, game_id, participant_side,
  game_name, mode_key, game_mode, completed_at, result_authority
)
select 'normal', id, '82000000-0000-4000-8000-000000000003', id, 'A',
  'Tie ' || n, 'solo_practice', 'solo', '2026-10-02 00:00+00', 'client_reported'
from games;
with games as (
  select ('82000000-0000-4003-9000-' || lpad(n::text, 12, '0'))::uuid as id
  from generate_series(1,21) n
)
insert into public.recent_game_payloads (source_id, game_id, record_digest, record)
select id, id, repeat('c',64),
  jsonb_build_object('format',1,'digest',repeat('c',64),
    'genesis',jsonb_build_object('meta',jsonb_build_object('gameId',id::text)))
from games;
select pg_temp.as_service();
select public.recent_retain_completed_source('normal',
  ('82000000-0000-4003-9000-' || lpad(n::text, 12, '0'))::uuid)
  from generate_series(21,1,-1) n;
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = 20 from public.recent_game_items
  where participant_id = '82000000-0000-4000-8000-000000000003')
  and not exists (select 1 from public.recent_game_items
    where participant_id = '82000000-0000-4000-8000-000000000003'
      and source_id = '82000000-0000-4003-9000-000000000001'),
  'stable same-timestamp tie-break failed');

select pg_temp.as_service();
select pg_temp.expect((select count(*) = 1 from public.read_recent_game_payload(
  '82000000-0000-4000-9000-000000000001',
  '82000000-0000-4000-8000-000000000002')), 'B retained replay read failed');
select pg_temp.expect((select count(*) = 0 from public.read_recent_game_payload(
  '82000000-0000-4000-9000-000000000001',
  '82000000-0000-4000-8000-000000000001')), 'evicted A read still works');
select pg_temp.expect((select count(*) = 0 from public.read_recent_game_payload(
  '82000000-0000-4000-9000-000000000001',
  '82000000-0000-4000-8000-000000000003')), 'Host gained replay');
select pg_temp.as_owner();

-- Stage is the only active Compact source. Its completed-attempt trigger
-- creates Recent automatically; an unexpected Recent failure is isolated.
insert into public.survival_levels (
  id, season_key, level_no, seed, reference_key, sample_policy, sample_count, win_count
) values ('82000000-0000-4002-9000-000000000001', 'recent-smoke', 1, 23,
  'endgame-v1', 'history', 3, 0);
insert into public.survival_attempts (
  id, level_id, room_id, player_id, finished_at, player_score, authur_score, result
) values (
  '82000000-0000-4002-9000-000000000002',
  '82000000-0000-4002-9000-000000000001',
  '82000000-0000-4002-9000-000000000003',
  '82000000-0000-4000-8000-000000000001', now(), 8, 3, 'win'
);
select pg_temp.as_service();
insert into public.stage_completed_attempts (
  attempt_id, room_id, player_id, level_id, source_revision,
  completion_kind, completion_reason, outcome, score_a, score_b,
  rules_version, record_digest, record, completed_at
) values (
  '82000000-0000-4002-9000-000000000002',
  '82000000-0000-4002-9000-000000000003',
  '82000000-0000-4000-8000-000000000001',
  '82000000-0000-4002-9000-000000000001', 1,
  'terminated', 'manual', 'win', 8, 3, 'eq-lab-840ef0e',
  repeat('a',64), jsonb_build_object('format',1,'digest',repeat('a',64),
    'genesis',jsonb_build_object('meta',jsonb_build_object(
      'gameId','82000000-0000-4002-9000-000000000003')),
    'provenance',jsonb_build_object('mode','stage')), '2026-10-01 00:00+00'
);
select pg_temp.as_owner();
select pg_temp.expect(exists (select 1 from public.recent_game_items
  where source_kind = 'stage' and source_id = '82000000-0000-4002-9000-000000000002'),
  'Stage completion did not retain Recent');

create function pg_temp.fail_recent() returns trigger language plpgsql as $$
begin raise exception 'simulated Recent storage failure'; end $$;
create trigger fail_recent before insert on public.recent_game_items
  for each row execute function pg_temp.fail_recent();
insert into public.survival_attempts (
  id, level_id, room_id, player_id, finished_at, player_score, authur_score, result
) values (
  '82000000-0000-4002-9000-000000000004',
  '82000000-0000-4002-9000-000000000001',
  '82000000-0000-4002-9000-000000000005',
  '82000000-0000-4000-8000-000000000001', now(), 8, 3, 'win'
);
select pg_temp.as_service();
insert into public.stage_completed_attempts (
  attempt_id, room_id, player_id, level_id, source_revision,
  completion_kind, completion_reason, outcome, score_a, score_b,
  rules_version, record_digest, record, completed_at
) values (
  '82000000-0000-4002-9000-000000000004',
  '82000000-0000-4002-9000-000000000005',
  '82000000-0000-4000-8000-000000000001',
  '82000000-0000-4002-9000-000000000001', 1,
  'terminated', 'manual', 'win', 8, 3, 'eq-lab-840ef0e',
  repeat('b',64), jsonb_build_object('format',1,'digest',repeat('b',64),
    'genesis',jsonb_build_object('meta',jsonb_build_object(
      'gameId','82000000-0000-4002-9000-000000000005')),
    'provenance',jsonb_build_object('mode','stage')), '2026-10-01 00:01+00'
);
select pg_temp.as_owner();
drop trigger fail_recent on public.recent_game_items;
select pg_temp.expect(exists (select 1 from public.stage_completed_attempts
  where attempt_id = '82000000-0000-4002-9000-000000000004')
  and exists (select 1 from public.game_history
  where source_kind = 'stage' and source_id = '82000000-0000-4002-9000-000000000004')
  and not exists (select 1 from public.recent_game_items
  where source_kind = 'stage' and source_id = '82000000-0000-4002-9000-000000000004'),
  'Recent failure blocked Stage result or History');

select pg_temp.as_user('82000000-0000-4000-8000-000000000001');
select pg_temp.expect(exists (select 1 from public.list_my_game_history(50)
  where source_id = '82000000-0000-4002-9000-000000000002'
    and is_recent and replay_availability = 'compact_available'),
  'History did not show Stage Recent');
select pg_temp.expect(exists (select 1 from public.list_my_game_history(50)
  where source_id = '82000000-0000-4002-9000-000000000004'
    and not is_recent and replay_availability = 'compact_available'),
  'History misclassified failed Recent while Stage source remained');
select pg_temp.as_owner();

-- Browser roles cannot attach themselves, choose a timestamp, replace raw
-- Compact, invoke retention or obtain the raw payload RPC.
select pg_temp.as_user('82000000-0000-4000-8000-000000000003');
do $$ begin
  begin
    insert into public.recent_game_items values (
      'normal', '82000000-0000-4000-9000-000000000025',
      '82000000-0000-4000-8000-000000000003', now());
    raise exception 'browser forged Recent';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.recent_game_payloads (source_id, game_id, record_digest, record)
    values ('82000000-0000-4000-9000-000000000099',
      '82000000-0000-4000-9000-000000000099', repeat('a',64), '{}'::jsonb);
    raise exception 'browser wrote a payload';
  exception when insufficient_privilege then null; end;
  begin
    perform public.recent_retain_completed_source('normal',
      '82000000-0000-4000-9000-000000000025');
    raise exception 'browser invoked retention';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.read_recent_game_payload(
      '82000000-0000-4000-9000-000000000025',
      '82000000-0000-4000-8000-000000000001');
    raise exception 'browser read raw payload';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.as_owner();

rollback;
