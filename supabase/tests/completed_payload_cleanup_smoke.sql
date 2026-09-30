-- Disposable local Supabase only. Every fixture and cleanup is rolled back.
begin;
create function pg_temp.expect(ok boolean, message text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception '%', message; end if; end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin execute 'reset role'; end $$;
grant execute on function pg_temp.expect(boolean,text), pg_temp.as_service(),
  pg_temp.as_owner() to service_role;

insert into auth.users (id,email,aud,role) values
  ('8b000000-0000-4000-8000-000000000001','cleanup-a@example.test','authenticated','authenticated'),
  ('8b000000-0000-4000-8000-000000000002','cleanup-b@example.test','authenticated','authenticated');
update public.profiles set status='approved' where id::text like '8b000000-%';

with games as (
  select n, ('8b000000-0000-4000-9000-' || lpad(n::text,12,'0'))::uuid id
  from generate_series(1,22) n
)
insert into public.game_history (source_kind,source_id,participant_id,game_id,
  participant_side,game_name,mode_key,game_mode,completed_at,result_authority)
select 'normal',id,'8b000000-0000-4000-8000-000000000001',id,'A',
  'Cleanup '||n,'friend','versus',
  '2026-01-01'::timestamptz + n * interval '1 minute','client_reported' from games;
insert into public.game_history (source_kind,source_id,participant_id,game_id,
  participant_side,game_name,mode_key,game_mode,completed_at,result_authority)
values ('normal','8b000000-0000-4000-9000-000000000001',
  '8b000000-0000-4000-8000-000000000002',
  '8b000000-0000-4000-9000-000000000001','B','Shared','friend','versus',
  '2026-01-01 00:01+00','client_reported');
with games as (
  select n, ('8b000000-0000-4001-9000-' || lpad(n::text,12,'0'))::uuid id
  from generate_series(1,20) n
)
insert into public.game_history (source_kind,source_id,participant_id,game_id,
  participant_side,game_name,mode_key,game_mode,completed_at,result_authority)
select 'normal',id,'8b000000-0000-4000-8000-000000000002',id,'A',
  'B Cleanup '||n,'solo_practice','solo',
  '2026-02-01'::timestamptz + n * interval '1 minute','client_reported' from games;

with games as (
  select ('8b000000-0000-4000-9000-' || lpad(n::text,12,'0'))::uuid id
    from generate_series(1,22) n
  union all
  select ('8b000000-0000-4001-9000-' || lpad(n::text,12,'0'))::uuid
    from generate_series(1,20) n
)
insert into public.recent_game_payloads (source_id,game_id,record_digest,record)
select id,id,repeat('b',64),jsonb_build_object('format',1,'digest',repeat('b',64),
  'genesis',jsonb_build_object('meta',jsonb_build_object('gameId',id::text)))
from games;
insert into public.saved_game_items (source_kind,source_id,participant_id)
values ('normal','8b000000-0000-4000-9000-000000000002',
  '8b000000-0000-4000-8000-000000000001');

select pg_temp.as_service();
select public.recent_retain_completed_source('normal',
  ('8b000000-0000-4000-9000-' || lpad(n::text,12,'0'))::uuid)
  from generate_series(1,22) n;
select pg_temp.as_owner();
select pg_temp.expect((select count(*)=20 from public.recent_game_items
  where participant_id='8b000000-0000-4000-8000-000000000001'),
  'Recent exceeds 20');
select pg_temp.expect((select count(*)=2 from public.completed_payload_cleanup_queue
  where source_id in ('8b000000-0000-4000-9000-000000000001',
    '8b000000-0000-4000-9000-000000000002')),
  'evicted sources were not queued');
select public.process_completed_payload_cleanup(10000, interval '0 seconds');
select pg_temp.expect(exists (select 1 from public.recent_game_payloads
  where source_id='8b000000-0000-4000-9000-000000000001'),
  'B Recent did not protect shared payload');
select pg_temp.expect(exists (select 1 from public.recent_game_payloads
  where source_id='8b000000-0000-4000-9000-000000000002'),
  'Saved did not protect payload');

select pg_temp.as_service();
select public.recent_retain_completed_source('normal',
  ('8b000000-0000-4001-9000-' || lpad(n::text,12,'0'))::uuid)
  from generate_series(1,20) n;
select pg_temp.as_owner();
select pg_temp.expect(exists (select 1 from public.completed_payload_cleanup_queue
  where source_id='8b000000-0000-4000-9000-000000000001'),
  'last Recent owner did not requeue source');
select public.process_completed_payload_cleanup(10000, interval '0 seconds');
select pg_temp.expect(not exists (select 1 from public.recent_game_payloads
  where source_id='8b000000-0000-4000-9000-000000000001'),
  'orphan Compact payload remains');
select pg_temp.expect(exists (select 1 from public.recent_game_payloads
  where source_id='8b000000-0000-4000-9000-000000000002'),
  'Saved payload was removed');

-- Trash and Overflow retain the same shared payload even without Recent.
insert into public.game_history (source_kind,source_id,participant_id,game_id,
  participant_side,game_name,mode_key,game_mode,completed_at,result_authority)
select 'normal', id, '8b000000-0000-4000-8000-000000000001', id,
  'A', 'Saved-only ' || state, 'friend', 'versus', now(), 'client_reported'
from (values
  ('8b000000-0000-4002-9000-000000000002'::uuid, 'trashed'),
  ('8b000000-0000-4002-9000-000000000003'::uuid, 'overflow')
) cases(id,state);
insert into public.recent_game_payloads (source_id,game_id,record_digest,record)
select id,id,repeat('d',64),jsonb_build_object('format',1,'digest',repeat('d',64),
  'genesis',jsonb_build_object('meta',jsonb_build_object('gameId',id::text)))
from (values
  ('8b000000-0000-4002-9000-000000000002'::uuid),
  ('8b000000-0000-4002-9000-000000000003'::uuid)
) cases(id);
insert into public.saved_game_items (source_kind,source_id,participant_id,state)
values
  ('normal','8b000000-0000-4002-9000-000000000002',
    '8b000000-0000-4000-8000-000000000001','trashed'),
  ('normal','8b000000-0000-4002-9000-000000000003',
    '8b000000-0000-4000-8000-000000000001','overflow');
insert into public.completed_payload_cleanup_queue (source_id,queued_at)
values
  ('8b000000-0000-4002-9000-000000000002',now()-interval '20 minutes'),
  ('8b000000-0000-4002-9000-000000000003',now()-interval '20 minutes');
select public.process_completed_payload_cleanup(10000, interval '10 minutes');
select pg_temp.expect((select count(*)=2 from public.recent_game_payloads
  where source_id in ('8b000000-0000-4002-9000-000000000002',
    '8b000000-0000-4002-9000-000000000003')),
  'Trash or Overflow ownership did not retain replay');

delete from public.saved_game_items where source_id='8b000000-0000-4000-9000-000000000002';
select public.process_completed_payload_cleanup(10000, interval '0 seconds');
select pg_temp.expect(not exists (select 1 from public.recent_game_payloads
  where source_id='8b000000-0000-4000-9000-000000000002'),
  'last Saved removal did not release Compact payload');

insert into public.game_history (source_kind,source_id,participant_id,game_id,
  participant_side,game_name,mode_key,game_mode,completed_at,result_authority)
values ('normal','8b000000-0000-4002-9000-000000000001',
  '8b000000-0000-4000-8000-000000000001',
  '8b000000-0000-4002-9000-000000000001','A','Legacy','friend','versus',
  now(),'client_reported');
insert into public.saved_legacy_payloads (source_id,game_id,snapshot)
values ('8b000000-0000-4002-9000-000000000001',
  '8b000000-0000-4002-9000-000000000001',
  jsonb_build_object('v',3,'gameId','8b000000-0000-4002-9000-000000000001',
    'status','finished','history',jsonb_build_array(),'logs',jsonb_build_array()));
insert into public.saved_game_items (source_kind,source_id,participant_id)
values ('normal','8b000000-0000-4002-9000-000000000001',
  '8b000000-0000-4000-8000-000000000001');
delete from public.saved_game_items where source_id='8b000000-0000-4002-9000-000000000001';
select public.process_completed_payload_cleanup(10000, interval '0 seconds');
select pg_temp.expect(not exists (select 1 from public.saved_legacy_payloads
  where source_id='8b000000-0000-4002-9000-000000000001'),
  'orphan frozen legacy payload remains');
select pg_temp.expect((select count(*)=0 from public.completed_payload_cleanup_queue
  where source_id::text like '8b000000-%'), 'cleanup queue was not drained');

select pg_temp.as_service();
select pg_temp.expect(not has_function_privilege('service_role',
  'public.process_completed_payload_cleanup(integer,interval)','EXECUTE')
  and not has_table_privilege('service_role',
  'public.completed_payload_cleanup_queue','SELECT'),
  'service role can bypass cleanup ownership');
select pg_temp.as_owner();
select pg_temp.expect(not has_function_privilege('authenticated',
  'public.process_completed_payload_cleanup(integer,interval)','EXECUTE')
  and not has_table_privilege('authenticated',
  'public.completed_payload_cleanup_queue','SELECT'),
  'browser can access cleanup internals');
select pg_temp.expect(exists(select 1 from cron.job
  where jobname='eq-completed-payload-cleanup' and active),
  'scheduled cleanup missing');
rollback;
