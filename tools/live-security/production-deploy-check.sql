\set ON_ERROR_STOP on
begin read only;
-- DEPLOY-TIME REQUIRED. Stop rollout on ANY unsafe=true or missing object.
with sensitive(table_name,column_name) as (values
 ('room_live','state'),('room_live','canonical'),('room_live','session'),
 ('game_timelines','doc'),('live_game_events','command'),
 ('public_game_snapshots','snapshot'),('region_game_snapshots','snapshot'),('private_library_items','snapshot'),
 ('survival_levels','seed'),('survival_levels','start_canonical'),('survival_levels','winning_replays'))
select r.role,s.table_name,s.column_name,
 has_column_privilege(r.role,'public.'||s.table_name,s.column_name,'select') as unsafe
 from sensitive s cross join (values('anon'),('authenticated')) r(role);
select r.role,p.proname,has_function_privilege(r.role,p.oid,'execute') as unsafe
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 cross join (values('anon'),('authenticated')) r(role)
 where n.nspname='public' and p.proname in
 ('create_live_game','create_bot_game','create_stage_attempt','set_room_ready',
 'commit_live_game_command','commit_live_game_timeline','get_live_game_engine_context','get_live_game_snapshot',
 'list_live_game_events','sync_live_game_state','update_live_game_state','update_live_game_session','update_live_game_timeline',
 'finalize_live_game','admin_seal_stage_start','claim_local_turn','trusted_admin_stage','read_completed_replay_sources',
 'trusted_create_live_game','trusted_create_stage','trusted_commit_live_game',
 'trusted_commit_live_capability','trusted_commit_practice_bot','capture_live_game_terminal',
 'claim_live_bot_job','enqueue_live_bot','join_live_game_before_security_gate');
-- Expected zero rows: canonical relations cannot be published to clients.
select schemaname,tablename from pg_publication_tables where pubname='supabase_realtime'
 and tablename in ('room_live','game_timelines','live_game_events','survival_levels',
 'ranked_private_revisions','ranked_matches','public_game_snapshots','region_game_snapshots','private_library_items');
-- Expected preserved=true for every legacy room, with zero omitted.
select count(*) as legacy_live,
 count(*) filter(where q.room_id is not null and q.room_row->'state'=l.state
 and q.room_row->'canonical' is not distinct from l.canonical) as preserved
 from public.room_live l left join private.live_legacy_quarantine q on q.room_id=l.room_id
 where l.authority_protocol='legacy-client';
-- These counts must match the signed PRE plan. Protocol is a stored fact.
select authority_protocol,mode_key,room_purpose,status,count(*) from public.room_live group by 1,2,3,4;
-- Expected ten rows, each present=true and service_allowed=true.
with required(proname) as (values
 ('trusted_create_live_game'),('trusted_create_stage'),('trusted_admin_stage'),('trusted_commit_live_game'),
 ('trusted_commit_live_capability'),('trusted_commit_practice_bot'),('claim_live_bot_job'),
 ('enqueue_live_bot'),('claim_local_turn'),('read_completed_replay_sources'))
select r.proname,p.oid is not null as present,
 coalesce(has_function_privilege('service_role',p.oid,'execute'),false) as service_allowed
 from required r left join pg_proc p on p.proname=r.proname
 and p.pronamespace='public'::regnamespace order by r.proname;
-- Expected zero active ArchBot jobs. Its browser execution has no server queue.
select count(*) as unexpected_archbot_jobs from public.live_bot_jobs j join public.room_live l on l.room_id=j.room_id
 where l.mode_key='stage5b_standard' and j.status in ('queued','running','failed');
-- Fail the command itself on a violated boundary, instead of relying on visual
-- inspection of the rows above. This supersedes pre-security raw-client ACLs.
do $gate$
declare role_name text; item record;
begin
 foreach role_name in array array['anon','authenticated'] loop
  for item in select * from (values
   ('room_live','state'),('room_live','canonical'),('room_live','session'),
   ('game_timelines','doc'),('live_game_events','command'),
   ('public_game_snapshots','snapshot'),('region_game_snapshots','snapshot'),('private_library_items','snapshot'),
   ('survival_levels','seed'),('survival_levels','start_canonical'),('survival_levels','winning_replays')) s(tbl,col)
  loop
   if has_column_privilege(role_name,'public.'||item.tbl,item.col,'select') then
    raise exception 'unsafe private column grant: %.%.%',role_name,item.tbl,item.col;
   end if;
  end loop;
  for item in select p.oid,p.proname from pg_proc p where p.pronamespace='public'::regnamespace
   and p.proname in ('create_live_game','create_bot_game','create_stage_attempt','set_room_ready',
    'commit_live_game_command','commit_live_game_timeline','get_live_game_engine_context','get_live_game_snapshot',
    'list_live_game_events','sync_live_game_state','update_live_game_state','update_live_game_session','update_live_game_timeline',
    'finalize_live_game','admin_seal_stage_start','trusted_create_live_game','trusted_create_stage','trusted_admin_stage',
    'trusted_commit_live_game','trusted_commit_live_capability','trusted_commit_practice_bot','capture_live_game_terminal',
    'claim_live_bot_job','enqueue_live_bot','claim_local_turn','read_completed_replay_sources','join_live_game_before_security_gate')
  loop
   if has_function_privilege(role_name,item.oid,'execute') then
    raise exception 'unsafe private function grant: %.%',role_name,item.proname;
   end if;
  end loop;
 end loop;
 for item in select name from unnest(array['trusted_create_live_game','trusted_create_stage','trusted_admin_stage',
  'trusted_commit_live_game','trusted_commit_live_capability','trusted_commit_practice_bot','claim_live_bot_job',
  'enqueue_live_bot','claim_local_turn','read_completed_replay_sources']) r(name)
 loop
  if not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=item.name
   and has_function_privilege('service_role',p.oid,'execute')) then
   raise exception 'required service function missing or denied: %',item.name;
  end if;
 end loop;
 if exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
  and tablename in ('room_live','game_timelines','live_game_events','survival_levels','ranked_private_revisions',
   'ranked_matches','public_game_snapshots','region_game_snapshots','private_library_items')) then
  raise exception 'private relation remains in Realtime publication';
 end if;
 if exists(select 1 from public.room_live l left join private.live_legacy_quarantine q on q.room_id=l.room_id
  where l.authority_protocol='legacy-client' and (q.room_id is null or q.room_row->'state' is distinct from l.state
   or q.room_row->'canonical' is distinct from l.canonical)) then
  raise exception 'legacy private preservation mismatch';
 end if;
 if exists(select 1 from public.live_bot_jobs j join public.room_live l on l.room_id=j.room_id
  where l.mode_key='stage5b_standard' and j.status in ('queued','running','failed')) then
  raise exception 'unexpected active ArchBot worker job';
 end if;
end $gate$;
rollback;
