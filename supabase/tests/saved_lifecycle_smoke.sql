-- Isolated local Supabase lifecycle/permission gate. All fixtures roll back.
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

insert into auth.users (id,email,aud,role) values
  ('84000000-0000-4000-8000-000000000001','lifecycle-a@example.test','authenticated','authenticated'),
  ('84000000-0000-4000-8000-000000000002','lifecycle-b@example.test','authenticated','authenticated');
update public.profiles set status='approved' where id::text like '84000000-0000-4000-8000-00000000000%';
with games as (
  select n, ('84000000-0000-4000-9000-' || lpad(n::text,12,'0'))::uuid id
  from generate_series(1,102) n
)
insert into public.game_history (source_kind,source_id,participant_id,game_id,
  participant_side,game_name,mode_key,game_mode,completed_at,result_authority)
select 'normal',id,'84000000-0000-4000-8000-000000000001',id,'A',
  'Lifecycle '||n,'friend','versus',now(),'client_reported' from games;
insert into public.game_history (source_kind,source_id,participant_id,game_id,
  participant_side,game_name,mode_key,game_mode,completed_at,result_authority)
values ('normal','84000000-0000-4000-9000-000000000001',
  '84000000-0000-4000-8000-000000000002',
  '84000000-0000-4000-9000-000000000001','B','Shared','friend','versus',now(),
  'client_reported');
with games as (
  select ('84000000-0000-4000-9000-' || lpad(n::text,12,'0'))::uuid id
  from generate_series(1,102) n
)
insert into public.recent_game_payloads (source_id,game_id,record_digest,record)
select id,id,repeat('c',64),jsonb_build_object('format',1,'digest',repeat('c',64),
  'genesis',jsonb_build_object('meta',jsonb_build_object('gameId',id::text)))
from games;
insert into public.saved_game_items (source_kind,source_id,participant_id,saved_at)
select 'normal',('84000000-0000-4000-9000-' || lpad(n::text,12,'0'))::uuid,
  '84000000-0000-4000-8000-000000000001',
  '2026-01-01 00:00+00'::timestamptz + n * interval '1 minute'
from generate_series(1,102) n;
insert into public.saved_game_items (source_kind,source_id,participant_id)
values ('normal','84000000-0000-4000-9000-000000000001',
  '84000000-0000-4000-8000-000000000002');

select pg_temp.as_user('84000000-0000-4000-8000-000000000001');
select pg_temp.expect((select saved_state='overflow'
  from public.list_my_game_history(50) where source_id=
    '84000000-0000-4000-9000-000000000101'),
  'History reconciles authoritative capacity before reporting state');
select pg_temp.expect((select active_count=100 and capacity=100
  from public.saved_game_usage()), 'Free downgrade reconciles to 100');
select pg_temp.as_owner();
select pg_temp.expect((select state='overflow' from public.saved_game_items
  where source_id='84000000-0000-4000-9000-000000000101'
    and participant_id='84000000-0000-4000-8000-000000000001'),
  'oldest 100 remain active; newest is Overflow');
select pg_temp.as_user('84000000-0000-4000-8000-000000000001');
select pg_temp.expect((select state='trashed' and active_count=99
  from public.change_my_saved_game('normal','84000000-0000-4000-9000-000000000001','trash')),
  'Trash releases one active slot');
select pg_temp.expect((select state='active' and active_count=100
  from public.change_my_saved_game('normal','84000000-0000-4000-9000-000000000101','activate')),
  'Overflow activation consumes freed slot');
select pg_temp.expect((select state='trashed' and active_count=100
  from public.change_my_saved_game('normal','84000000-0000-4000-9000-000000000102','trash')),
  'Overflow can move to Trash without consuming capacity');
select pg_temp.expect((select state='deleted'
  from public.change_my_saved_game('normal','84000000-0000-4000-9000-000000000102','delete')),
  'Overflow follows Trash before permanent delete');
do $$ begin
  begin
    perform * from public.change_my_saved_game('normal',
      '84000000-0000-4000-9000-000000000001',null);
    raise exception 'expected null action refusal';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform * from public.change_my_saved_game('normal',
      '84000000-0000-4000-9000-000000000001','restore');
    raise exception 'expected restore capacity refusal';
  exception when raise_exception then
    if sqlerrm not like 'Saved capacity reached%' then raise; end if;
  end;
  begin
    perform * from public.change_my_saved_game('normal',
      '84000000-0000-4000-9000-000000000101','delete');
    raise exception 'expected active delete refusal';
  exception when invalid_parameter_value then null;
  end;
end $$;
select pg_temp.expect((select state='trashed' and active_count=100
  from public.change_my_saved_game('normal','84000000-0000-4000-9000-000000000001','trash')),
  'Trash retry is idempotent');
select pg_temp.expect((select state='deleted'
  from public.change_my_saved_game('normal','84000000-0000-4000-9000-000000000001','delete')),
  'permanent delete from Trash');
select pg_temp.expect((select state='deleted'
  from public.change_my_saved_game('normal','84000000-0000-4000-9000-000000000001','delete')),
  'permanent delete retry');
select pg_temp.as_service();
select pg_temp.expect(public.cleanup_unreferenced_recent_payload(
  '84000000-0000-4000-9000-000000000102'),
  'last Trash deletion permits orphan payload cleanup');
select pg_temp.expect(not public.cleanup_unreferenced_recent_payload(
  '84000000-0000-4000-9000-000000000001'),
  'other participant Saved ownership preserves shared payload');
select pg_temp.as_owner();
select pg_temp.expect((select count(*)=1 from public.game_history
  where source_id='84000000-0000-4000-9000-000000000001'
    and participant_id='84000000-0000-4000-8000-000000000001'),
  'History survives permanent delete');
select pg_temp.expect(not has_table_privilege('authenticated','public.saved_game_items','UPDATE')
  and not has_table_privilege('authenticated','public.saved_game_items','DELETE')
  and not has_function_privilege('authenticated','public.reconcile_saved_capacity(uuid)','EXECUTE')
  and not has_function_privilege('authenticated',
    'public.capture_normal_terminal(uuid,uuid,bigint,bigint,jsonb,jsonb,text,text,text)',
    'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.migrate_validated_private_item(uuid,text)','EXECUTE')
  and not has_function_privilege('authenticated',
    'public.list_private_migration_candidates(uuid,timestamptz,uuid,integer)','EXECUTE')
  and not has_table_privilege('authenticated','public.saved_legacy_migration_ledger','SELECT'),
  'browser cannot bypass lifecycle');
select pg_temp.as_user('84000000-0000-4000-8000-000000000002');
do $$ begin
  begin
    perform * from public.change_my_saved_game('normal',
      '84000000-0000-4000-9000-000000000002','trash');
    raise exception 'expected cross-user refusal';
  exception when no_data_found then null;
  end;
end $$;
select pg_temp.as_owner();
update public.profiles set is_admin=true
  where id='84000000-0000-4000-8000-000000000002';
select public.economy_post('84000000-0000-4000-8000-000000000001',
  'probot_credit',20,'admin_grant','admin_request','lifecycle',
  'lifecycle:bot:' || gen_random_uuid(),
  '84000000-0000-4000-8000-000000000002','local test');
do $$ declare created record; replay record; old_created record; old_replay record;
  request_id uuid := gen_random_uuid(); old_request uuid := gen_random_uuid();
begin
  perform pg_temp.as_user('84000000-0000-4000-8000-000000000001');
  select * into created from public.create_bot_game(request_id,'authur_strong','B',
    '{"name":"Cutover bot","gameMode":"versus","players":{"A":"Owner","B":"Bot"},"startingSide":"A","turnNumber":1,"scores":{"A":0,"B":0}}'::jsonb,
    'private','private',null,'invite_only',null,'credit');
  select * into replay from public.create_bot_game(request_id,'authur_strong','B',
    '{"name":"Cutover bot","gameMode":"versus","players":{"A":"Owner","B":"Bot"},"startingSide":"A","turnNumber":1,"scores":{"A":0,"B":0}}'::jsonb,
    'private','private',null,'invite_only',null,'credit');
  if not replay.replayed or replay.room_id <> created.room_id then
    raise exception 'private bot creation retry changed room';
  end if;
  perform pg_temp.as_owner();
  if not exists (select 1 from public.room_live r where r.room_id = created.room_id
    and r.access_scope = 'private' and r.archive_policy = 'none'
    and not r.legacy_private_autosave) then
    raise exception 'new private bot room retained old autosave policy';
  end if;
  -- The original function is owner-only after cutover. Recreate a request
  -- begun before cutover and prove the public wrapper replays its old policy.
  select * into old_created from public.create_bot_game_before_saved_cutover(
    old_request,'authur_strong','B',
    '{"name":"Old bot","gameMode":"versus","players":{"A":"Owner","B":"Bot"},"startingSide":"A","turnNumber":1,"scores":{"A":0,"B":0}}'::jsonb,
    'private','private',null,'invite_only',null,'credit');
  perform pg_temp.as_user('84000000-0000-4000-8000-000000000001');
  select * into old_replay from public.create_bot_game(old_request,'authur_strong','B',
    '{"name":"Old bot","gameMode":"versus","players":{"A":"Owner","B":"Bot"},"startingSide":"A","turnNumber":1,"scores":{"A":0,"B":0}}'::jsonb,
    'private','private',null,'invite_only',null,'credit');
  if not old_replay.replayed or old_replay.room_id <> old_created.room_id then
    raise exception 'pre-cutover bot request retry changed room';
  end if;
  perform pg_temp.as_owner();
  if not exists (select 1 from public.room_live r where r.room_id = old_created.room_id
    and r.archive_policy = 'private') then
    raise exception 'pre-cutover bot request retry changed archive policy';
  end if;
end $$;
rollback;
