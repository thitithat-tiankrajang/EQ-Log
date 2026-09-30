-- Run against an isolated local Supabase database. All fixtures roll back.
begin;
create function pg_temp.expect(ok boolean, message text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception '%', message; end if; end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin execute 'reset role'; end $$;
grant execute on function pg_temp.expect(boolean,text), pg_temp.as_user(uuid),
  pg_temp.as_service(), pg_temp.as_owner() to authenticated, service_role;

select pg_temp.expect(public.plan_capability_int('free','private_drive_limit') = 100,
  'Free capacity');
select pg_temp.expect(public.plan_capability_int('plus','private_drive_limit') = 1000,
  'Plus capacity');
select pg_temp.expect(public.plan_capability_int('pro','private_drive_limit') = 1000,
  'Pro capacity');

insert into auth.users (id, email, aud, role) values
  ('83000000-0000-4000-8000-000000000001','saved-a@example.test','authenticated','authenticated'),
  ('83000000-0000-4000-8000-000000000002','saved-b@example.test','authenticated','authenticated'),
  ('83000000-0000-4000-8000-000000000003','saved-host@example.test','authenticated','authenticated');
update public.profiles set status='approved'
  where id::text like '83000000-0000-4000-8000-00000000000%';

-- 1002 frozen sources for A; B shares the first source, Host is not seated.
with games as (
  select n, ('83000000-0000-4000-9000-' || lpad(n::text,12,'0'))::uuid id
  from generate_series(1,1002) n
)
insert into public.game_history (source_kind,source_id,participant_id,source_owner_id,
  game_id,participant_side,game_name,mode_key,game_mode,completed_at,result_authority)
select 'normal',id,'83000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000003',id,'A','Saved '||n,'versus','versus',
  '2026-09-30 00:00+00'::timestamptz + n * interval '1 minute','client_reported'
from games;
insert into public.game_history (source_kind,source_id,participant_id,game_id,
  participant_side,game_name,mode_key,game_mode,completed_at,result_authority) values
('normal','83000000-0000-4000-9000-000000000001',
 '83000000-0000-4000-8000-000000000002',
 '83000000-0000-4000-9000-000000000001','B','Shared','versus','versus',now(),'client_reported');
with games as (
  select ('83000000-0000-4000-9000-' || lpad(n::text,12,'0'))::uuid id
  from generate_series(1,1002) n
)
insert into public.recent_game_payloads (source_id,game_id,record_digest,record)
select id,id,repeat('a',64),jsonb_build_object('format',1,'digest',repeat('a',64),
  'genesis',jsonb_build_object('meta',jsonb_build_object('gameId',id::text)))
from games;

select pg_temp.as_service();
select public.recent_retain_completed_source('normal',
  ('83000000-0000-4000-9000-' || lpad(n::text,12,'0'))::uuid)
from (values (1),(100),(101),(1000),(1001)) selected(n);
select pg_temp.as_owner();

select pg_temp.as_user('83000000-0000-4000-8000-000000000001');
select pg_temp.expect((select capacity=100 and active_count=0 and plan_name='Free'
  from public.saved_game_usage()), 'Free usage is authoritative');
select pg_temp.expect((select not already_saved and active_count=1
  from public.save_completed_game('normal','83000000-0000-4000-9000-000000000001')),
  'first explicit Save');
select pg_temp.expect((select already_saved and active_count=1
  from public.save_completed_game('normal','83000000-0000-4000-9000-000000000001')),
  'duplicate idempotent Save');
select pg_temp.expect((select count(*)=1 from public.list_my_saved_games()),
  'metadata-only Saved list');
select pg_temp.as_owner();
delete from public.recent_game_items where source_kind='normal'
  and source_id='83000000-0000-4000-9000-000000000001'
  and participant_id='83000000-0000-4000-8000-000000000001';
select pg_temp.as_user('83000000-0000-4000-8000-000000000001');
select pg_temp.expect((select is_saved and not is_recent
  from public.list_my_game_history(20,'2026-09-30 00:02+00','normal',
    '83000000-0000-4000-9000-000000000002')
  where source_id='83000000-0000-4000-9000-000000000001'),
  'History Saved marker independent of Recent');
select pg_temp.as_owner();

-- Direct rows seed the exact capacity boundary without 999 network calls.
insert into public.saved_game_items (source_kind,source_id,participant_id)
select 'normal',('83000000-0000-4000-9000-' || lpad(n::text,12,'0'))::uuid,
  '83000000-0000-4000-8000-000000000001'
from generate_series(2,99) n;
select pg_temp.as_user('83000000-0000-4000-8000-000000000001');
select pg_temp.expect((select active_count=100 from public.save_completed_game(
  'normal','83000000-0000-4000-9000-000000000100')), '99 to 100');
do $$ begin
  begin perform * from public.save_completed_game('normal','83000000-0000-4000-9000-000000000101');
    raise exception 'expected Free capacity refusal';
  exception when raise_exception then
    if sqlerrm not like 'Saved capacity reached%' then raise; end if;
  end;
end $$;
select pg_temp.expect((select already_saved and active_count=100 from public.save_completed_game(
  'normal','83000000-0000-4000-9000-000000000001')), 'duplicate works at capacity');
select pg_temp.as_owner();

-- Granting Plus from the authoritative timeline changes only the limit.
insert into public.plan_segments (user_id,plan_key,starts_at,ends_at,chain_anchor,chain_months)
values ('83000000-0000-4000-8000-000000000001','plus',now()-interval '1 day',
  now()+interval '1 year',now()-interval '1 day',12);
insert into public.saved_game_items (source_kind,source_id,participant_id)
select 'normal',('83000000-0000-4000-9000-' || lpad(n::text,12,'0'))::uuid,
  '83000000-0000-4000-8000-000000000001'
from generate_series(101,999) n;
select pg_temp.as_user('83000000-0000-4000-8000-000000000001');
select pg_temp.expect((select capacity=1000 and active_count=999
  from public.saved_game_usage()), 'Plus upgrade preserves Saved');
select pg_temp.expect((select active_count=1000 from public.save_completed_game(
  'normal','83000000-0000-4000-9000-000000001000')), '999 to 1000 Plus');
do $$ begin
  begin perform * from public.save_completed_game('normal','83000000-0000-4000-9000-000000001001');
    raise exception 'expected Plus capacity refusal';
  exception when raise_exception then
    if sqlerrm not like 'Saved capacity reached%' then raise; end if;
  end;
end $$;
select pg_temp.as_owner();
update public.plan_segments set plan_key='pro'
  where user_id='83000000-0000-4000-8000-000000000001';
select pg_temp.as_user('83000000-0000-4000-8000-000000000001');
select pg_temp.expect((select capacity=1000 and active_count=1000
  from public.saved_game_usage()), 'Pro 1000');
do $$ begin
  begin perform * from public.save_completed_game('normal','83000000-0000-4000-9000-000000001001');
    raise exception 'expected Pro capacity refusal';
  exception when raise_exception then
    if sqlerrm not like 'Saved capacity reached%' then raise; end if;
  end;
end $$;
select pg_temp.as_owner();
delete from public.plan_segments
  where user_id='83000000-0000-4000-8000-000000000001';
select pg_temp.as_user('83000000-0000-4000-8000-000000000001');
select pg_temp.expect((select capacity=100 and active_count=100
  from public.saved_game_usage()), 'downgrade retains 100 active items');
select pg_temp.as_owner();
select pg_temp.expect((select count(*)=900 from public.saved_game_items
  where participant_id='83000000-0000-4000-8000-000000000001'
    and state='overflow'), 'downgrade preserves 900 replays in Overflow');
select pg_temp.as_user('83000000-0000-4000-8000-000000000001');
select pg_temp.expect((select count(*)=20 from public.list_my_saved_games()),
  'over-capacity Saved items remain listable');
select pg_temp.as_owner();

-- A full Saved account still accepts a completed Stage result; its History
-- and Recent triggers do not invoke Saved capacity at all.
insert into public.survival_levels (
  id, season_key, level_no, seed, reference_key, sample_policy, sample_count, win_count
) values ('83000000-0000-4002-9000-000000000001', 'saved-smoke', 1, 23,
  'endgame-v1', 'history', 3, 0);
insert into public.survival_attempts (
  id, level_id, room_id, player_id, finished_at, player_score, authur_score, result
) values (
  '83000000-0000-4002-9000-000000000002',
  '83000000-0000-4002-9000-000000000001',
  '83000000-0000-4002-9000-000000000003',
  '83000000-0000-4000-8000-000000000001', now(), 8, 3, 'win'
);
select pg_temp.as_service();
insert into public.stage_completed_attempts (
  attempt_id, room_id, player_id, level_id, source_revision,
  completion_kind, completion_reason, outcome, score_a, score_b,
  rules_version, record_digest, record, completed_at
) values (
  '83000000-0000-4002-9000-000000000002',
  '83000000-0000-4002-9000-000000000003',
  '83000000-0000-4000-8000-000000000001',
  '83000000-0000-4002-9000-000000000001', 1,
  'terminated', 'manual', 'win', 8, 3, 'eq-lab-840ef0e',
  repeat('a',64), jsonb_build_object('format',1,'digest',repeat('a',64),
    'genesis',jsonb_build_object('meta',jsonb_build_object(
      'gameId','83000000-0000-4002-9000-000000000004')),
    'provenance',jsonb_build_object('mode','stage')), now()
);
select pg_temp.as_owner();
select pg_temp.expect(exists (select 1 from public.stage_completed_attempts
  where attempt_id='83000000-0000-4002-9000-000000000002')
  and exists (select 1 from public.game_history
  where source_kind='stage' and source_id='83000000-0000-4002-9000-000000000002')
  and exists (select 1 from public.recent_game_items
  where source_kind='stage' and source_id='83000000-0000-4002-9000-000000000002')
  and not exists (select 1 from public.saved_game_items
  where source_kind='stage' and source_id='83000000-0000-4002-9000-000000000002')
  and (select count(*)=1000 from public.saved_game_items
  where participant_id='83000000-0000-4000-8000-000000000001'),
  'full Saved capacity blocked Stage completion/History/Recent');

delete from public.recent_game_items where source_kind='normal'
  and source_id='83000000-0000-4000-9000-000000000001'
  and participant_id='83000000-0000-4000-8000-000000000002';
select pg_temp.as_user('83000000-0000-4000-8000-000000000002');
do $$ begin
  begin perform * from public.save_completed_game('normal','83000000-0000-4000-9000-000000000001');
    raise exception 'expected expired Recent refusal';
  exception when invalid_parameter_value then
    if sqlerrm <> 'replay unavailable for Saved' then raise; end if;
  end;
end $$;
select pg_temp.as_owner();
insert into public.recent_game_items (source_kind,source_id,participant_id,completed_at)
values ('normal','83000000-0000-4000-9000-000000000001',
  '83000000-0000-4000-8000-000000000002',now());
select pg_temp.as_user('83000000-0000-4000-8000-000000000002');
select pg_temp.expect((select active_count=1 from public.save_completed_game(
  'normal','83000000-0000-4000-9000-000000000001')), 'other seated participant can Save');
do $$ begin
  begin perform * from public.save_completed_game('normal','83000000-0000-4000-9000-000000000002');
    raise exception 'expected nonparticipant refusal';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.expect((select count(*)=1 from public.list_my_saved_games()),
  'Saved list owner isolation');
select pg_temp.as_user('83000000-0000-4000-8000-000000000003');
do $$ begin
  begin perform * from public.save_completed_game('normal','83000000-0000-4000-9000-000000000001');
    raise exception 'expected Host refusal';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.as_owner();

select pg_temp.expect(not has_table_privilege('authenticated','public.saved_game_items','INSERT'),
  'browser has no direct Saved INSERT');
select pg_temp.expect(not has_table_privilege('authenticated','public.saved_game_items','SELECT'),
  'browser has no raw Saved table read');
select pg_temp.expect(not has_table_privilege('authenticated','public.saved_legacy_payloads','SELECT'),
  'browser has no raw legacy payload read');
select pg_temp.expect(not has_function_privilege('authenticated',
  'public.cleanup_unreferenced_recent_payload(uuid)','EXECUTE'),
  'browser has no cleanup RPC');
select pg_temp.expect(not has_function_privilege('authenticated',
  'public.cleanup_unreferenced_saved_legacy_payload(uuid)','EXECUTE'),
  'browser has no legacy cleanup RPC');
select pg_temp.expect(not has_function_privilege('authenticated',
  'public.read_saved_game_payload(uuid,uuid)','EXECUTE'),
  'browser has no raw reader RPC');
select pg_temp.expect(not has_function_privilege('authenticated',
  'public.saved_legacy_source_for_user(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated',
  'public.save_validated_legacy_game(uuid,uuid,text)','EXECUTE')
  and not has_function_privilege('authenticated',
  'public.save_completed_game_before_source_eligibility(text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated',
  'public.save_completed_game_before_legacy_validation(text,uuid)','EXECUTE'),
  'browser cannot bypass validated and eligible Save');

select pg_temp.as_service();
select pg_temp.expect((select count(*)=1 from public.read_saved_game_payload(
  '83000000-0000-4000-9000-000000000001','83000000-0000-4000-8000-000000000001')),
  'Saved payload reader follows ownership');
select pg_temp.expect((select count(*)=0 from public.read_saved_game_payload(
  '83000000-0000-4000-9000-000000000002','83000000-0000-4000-8000-000000000002')),
  'Saved payload reader denies other game');
select pg_temp.expect(not public.cleanup_unreferenced_recent_payload(
  '83000000-0000-4000-9000-000000000001'), 'Saved prevents payload cleanup');
select pg_temp.as_owner();
select pg_temp.expect(exists (select 1 from public.recent_game_payloads
  where source_id='83000000-0000-4000-9000-000000000001'),
  'shared payload retained after cleanup attempt');

do $$ begin
  begin
    insert into public.saved_legacy_payloads (source_id,game_id,snapshot)
    values ('83000000-0000-4000-9000-000000000001',
      '83000000-0000-4000-9000-000000000001',
      '{"v":3,"gameId":"83000000-0000-4000-9000-000000000001","status":"finished","history":[],"logs":[]}');
    raise exception 'expected mixed-format rejection';
  exception when check_violation then null; end;
end $$;
insert into public.saved_legacy_payloads (source_id,game_id,snapshot)
values ('83000000-0000-4004-9000-000000000001',
  '83000000-0000-4004-9000-000000000001',
  '{"v":3,"gameId":"83000000-0000-4004-9000-000000000001","status":"finished","history":[],"logs":[]}');
do $$ begin
  begin
    insert into public.recent_game_payloads (source_id,game_id,record_digest,record)
    values ('83000000-0000-4004-9000-000000000001',
      '83000000-0000-4004-9000-000000000001', repeat('b',64),
      '{"format":1,"digest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","genesis":{"meta":{"gameId":"83000000-0000-4004-9000-000000000001"}}}');
    raise exception 'expected reverse mixed-format rejection';
  exception when check_violation then null; end;
end $$;
select pg_temp.as_service();
select pg_temp.expect(public.cleanup_unreferenced_saved_legacy_payload(
  '83000000-0000-4004-9000-000000000001'),
  'unreferenced frozen legacy payload can be cleaned');
select pg_temp.as_owner();
select pg_temp.expect(not exists (select 1 from public.saved_legacy_payloads
  where source_id='83000000-0000-4004-9000-000000000001'),
  'legacy cleanup removes only the orphan');

rollback;
