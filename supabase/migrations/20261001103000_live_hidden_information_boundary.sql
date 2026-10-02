-- Coordinated cutover: raw live state is a service-only contract. The new Edge
-- reader derives recipient views. Old clients fail closed, never get a fallback.
begin;

alter table public.room_live add column authority_protocol text not null default 'legacy-client' check (authority_protocol in ('legacy-client','server-v1'));

do $acl$
declare tbl text; columns text; fn regprocedure;
begin
  foreach tbl in array array['room_live','game_timelines','live_game_events','survival_levels'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', tbl);
    select string_agg(quote_ident(attname), ',') into columns from pg_attribute
      where attrelid = ('public.' || tbl)::regclass and attnum > 0 and not attisdropped;
    execute format('revoke all (%s) on table public.%I from public, anon, authenticated', columns, tbl);
    execute format('grant all on table public.%I to service_role', tbl);
  end loop;
  -- Function overloads are revoked together. SECURITY DEFINER functions otherwise
  -- bypass column ACLs, including the engine context and old terminal writers.
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(array[
      'get_live_game_snapshot','get_live_game_engine_context','list_live_game_events',
      'commit_live_game_command','commit_live_game_timeline','update_live_game_timeline',
      'update_live_game_session','update_live_game_state','sync_live_game_state',
      'create_live_game','create_bot_game','create_stage_attempt','finalize_live_game',
      'admin_seal_stage_start'
    ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $acl$;

grant select (room_id,owner_id,name,player_a,player_b,status,access_scope,archive_policy,
  join_policy,region_id,game_mode,mode_key,member_a_id,member_b_id,player_a_user_id,
  player_b_user_id,starting_side,creator_side,turn_number,score_a,score_b,created_at,
  updated_at,revision) on public.room_live to authenticated;
alter table public.survival_levels add column winning_replay_count integer generated always as (jsonb_array_length(winning_replays)) stored;
grant select (id,season_key,level_no,status,start_sealed_at,reference_key,sample_policy,sample_count,win_count,immediate_winning_moves,shortest_winning_replay_turns,bot_latency_ms,winning_replay_count,admin_note)
  on public.survival_levels to authenticated;

-- Raw legacy archives may share an inner game ID with a still-live room.
-- They must pass the same lifecycle guard as Compact/Saved/Recent readers.
do $archives$
declare tbl text; all_columns text; safe_columns text;
begin
  foreach tbl in array array['public_game_snapshots','region_game_snapshots','private_library_items'] loop
    select string_agg(quote_ident(attname),','), string_agg(quote_ident(attname),',') filter(where attname <> 'snapshot')
      into all_columns,safe_columns from pg_attribute where attrelid=('public.'||tbl)::regclass and attnum>0 and not attisdropped;
    execute format('revoke select on table public.%I from public,anon,authenticated',tbl);
    execute format('revoke select (%s) on table public.%I from public,anon,authenticated',all_columns,tbl);
    execute format('grant select (%s) on table public.%I to authenticated',safe_columns,tbl);
  end loop;
end $archives$;

-- A schema/row change must never carry a private column, regardless of a
-- subscriber's column-selection implementation or replica identity.
do $publication$
declare tbl text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime' and puballtables) then
    raise exception 'Live secrecy requires an explicit-table Realtime publication';
  end if;
  foreach tbl in array array['room_live','game_timelines','live_game_events','survival_levels','ranked_private_revisions','ranked_matches','public_game_snapshots','region_game_snapshots','private_library_items'] loop
    if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tbl) then
      execute format('alter publication supabase_realtime drop table public.%I',tbl);
    end if;
  end loop;
end $publication$;

create or replace function public.broadcast_live_game_commit(
  target_game_id uuid, target_revision bigint, target_command_id text, target_issued_by text
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if to_regproc('realtime.send') is not null then
    perform realtime.send(jsonb_build_object('gameId',target_game_id,'revision',target_revision),
      'commit','game:' || target_game_id::text,true);
  end if;
end $$;
revoke all on function public.broadcast_live_game_commit(uuid,bigint,text,text) from public,anon,authenticated;

-- Server wrappers use the established row-lock/idempotency/charging code. Actor
-- identity is bound by the Edge authenticator; clients cannot call these wrappers.
create or replace function public.trusted_commit_live_game(
  p_actor_id uuid,p_room_id uuid,p_revision bigint,p_command_id text,p_side text,
  p_action jsonb,p_canonical jsonb,p_state jsonb
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare result record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'trusted server required' using errcode='42501';
  end if;
  if not exists(select 1 from public.room_live l where l.room_id=p_room_id
    and l.authority_protocol='server-v1' and p_actor_id = case p_side when 'A' then l.player_a_user_id when 'B' then l.player_b_user_id end)
  then raise exception 'seat required' using errcode='42501'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
  select * into result from public.commit_live_game_command(p_room_id,p_revision,p_command_id,p_side,
    jsonb_build_object('kind',p_action->>'kind'),p_canonical,null,p_state,'{}'::jsonb);
  return result.outcome;
end $$;
revoke all on function public.trusted_commit_live_game(uuid,uuid,bigint,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.trusted_commit_live_game(uuid,uuid,bigint,text,text,jsonb,jsonb,jsonb) to service_role;

-- A persisted server-reduced completion is accepted by the same atomic Normal
-- capture path. Its ACL is already service-only; callers cannot assert authority.
do $capture$
declare fn regprocedure; body text;
begin
  select p.oid::regprocedure,pg_get_functiondef(p.oid) into fn,body
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='capture_normal_terminal';
  if body is null or position('is distinct from ''client-reported''' in body)=0 then
    raise exception 'Unexpected Normal capture definition; audit before cutover';
  end if;
  body := replace(body,'is distinct from ''client-reported''',
    'is distinct from ''server-reduced''' );
  -- Unlike the old advisory terminal path, authoritative completion must roll
  -- back the whole transaction if its full Compact payload cannot persist.
  body := replace(body, '  return next;',
    '  if compact and (not recent_retained or not exists(select 1 from public.recent_game_payloads where source_kind=''normal'' and source_id=p_room_id)) then raise exception ''completed history persistence required''; end if;
  update public.game_history set result_authority=''server_reduced'' where source_kind=''normal'' and source_id=p_room_id;
  return next;');
  execute body;
end $capture$;

-- Distinguish new authoritative Stage results without relabeling legacy rows.
alter table public.survival_attempts drop constraint survival_attempts_result_authority_check;
alter table public.survival_attempts add constraint survival_attempts_result_authority_check check (result_authority in ('advisory','captured_client_state','server_reduced'));
alter table public.stage_completed_attempts drop constraint stage_completed_attempts_state_authority_check;
alter table public.stage_completed_attempts add constraint stage_completed_attempts_state_authority_check check (state_authority in ('client_committed','server_reduced'));
alter table public.stage_completed_attempts alter column state_authority set default 'server_reduced';
do $stage_capture$
declare body text;
begin
 select pg_get_functiondef(p.oid) into body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='capture_stage_terminal';
 if position('''client-reported''' in body)=0 then raise exception 'Unexpected Stage capture definition'; end if;
 body := replace(body,'''client-reported''','''server-reduced''');
 body := replace(body,'''captured_client_state''','''server_reduced''');
 execute body;
end $stage_capture$;

-- Stage labels must not ship the generation seed through metadata.
update public.room_live set name='Stage attempt' where room_purpose='stage';

create table public.trusted_live_creation_requests (
 actor_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null, room_id uuid references public.room_live(room_id) on delete set null,
 public_spec jsonb not null, primary key(actor_id,request_id)
);
alter table public.trusted_live_creation_requests enable row level security;
revoke all on table public.trusted_live_creation_requests from public,anon,authenticated;
grant all on table public.trusted_live_creation_requests to service_role;

create or replace function public.trusted_create_live_game(
 p_actor_id uuid,p_state jsonb,p_policy jsonb,p_request_id uuid,p_bot_key text,p_bot_side text,p_funding text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare created record; prior public.trusted_live_creation_requests%rowtype; spec jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'trusted server required' using errcode='42501'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
 if p_request_id is null then raise exception 'creation request required'; end if;
 perform public.lock_board_users(array[p_actor_id,nullif(p_state#>>'{playerUserIds,A}','')::uuid,nullif(p_state#>>'{playerUserIds,B}','')::uuid]);
 spec := jsonb_build_object('policy',p_policy,'name',p_state->'name','players',p_state->'players','users',p_state->'playerUserIds',
   'emails',p_state->'playerEmails','startingSide',p_state->'startingSide','gameMode',p_state->'gameMode','initialTimes',p_state#>'{timers,initialSecondsBySide}','untimed',p_state#>'{timers,sideUntimed}');
 select * into prior from public.trusted_live_creation_requests where actor_id=p_actor_id and request_id=p_request_id;
 if found then
   if p_bot_key is not null or prior.public_spec is distinct from spec then raise exception 'idempotency_conflict'; end if;
   if prior.room_id is null then raise exception 'this creation request already completed'; end if;
   return jsonb_build_object('room_id',prior.room_id,'room_code',public.derive_live_room_code(prior.room_id));
 end if;
 if p_bot_key is not null then
   select * into created from public.create_bot_game(p_request_id,p_bot_key,p_bot_side,p_state,
     p_policy->>'accessScope',p_policy->>'archivePolicy',nullif(p_policy->>'regionId','')::uuid,
     p_policy->>'joinPolicy',nullif(p_policy->>'privateParentId','')::uuid,p_funding);
 else
   if exists(select 1 from public.room_creation_requests where user_id=p_actor_id and request_id=p_request_id) then raise exception 'idempotency_conflict'; end if;
   select * into created from public.create_live_game(p_state,p_policy->>'accessScope',p_policy->>'archivePolicy',
     nullif(p_policy->>'regionId','')::uuid,p_policy->>'joinPolicy',nullif(p_policy->>'privateParentId','')::uuid);
   insert into public.trusted_live_creation_requests(actor_id,request_id,room_id,public_spec)
     values(p_actor_id,p_request_id,created.room_id,spec);
 end if;
 update public.room_live set authority_protocol='server-v1' where room_id=created.room_id;
 return to_jsonb(created);
end $$;
revoke all on function public.trusted_create_live_game(uuid,jsonb,jsonb,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.trusted_create_live_game(uuid,jsonb,jsonb,uuid,text,text,text) to service_role;

create or replace function public.trusted_create_stage(
 p_actor_id uuid,p_level_id uuid,p_request_id uuid,p_state jsonb,p_canonical jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare created record; committed record;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'trusted server required' using errcode='42501'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
 if exists(select 1 from public.trusted_live_creation_requests where actor_id=p_actor_id and request_id=p_request_id) then raise exception 'idempotency_conflict'; end if;
 select * into created from public.create_stage_attempt(p_request_id,p_level_id,p_state);
 if not created.replayed then
   update public.room_live set name='Stage attempt',state=jsonb_set(state,'{name}','"Stage attempt"'::jsonb) where room_id=created.room_id;
   select * into committed from public.commit_live_game_command(created.room_id,0,gen_random_uuid()::text,'A',
     '{"kind":"initialize"}'::jsonb,p_canonical,null,p_state || '{"name":"Stage attempt","revision":1}'::jsonb,'{}'::jsonb);
   if committed.outcome is distinct from 'committed' then raise exception 'Stage initialization refused'; end if;
 end if;
 update public.room_live set authority_protocol='server-v1' where room_id=created.room_id;
 return to_jsonb(created);
end $$;
revoke all on function public.trusted_create_stage(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.trusted_create_stage(uuid,uuid,uuid,jsonb,jsonb) to service_role;

create or replace function public.trusted_admin_stage(p_actor_id uuid,p_level_id uuid,p_start jsonb,p_note text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'trusted server required' using errcode='42501'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
 if not public.is_admin() then raise exception 'administrator required' using errcode='42501'; end if;
 perform public.admin_seal_stage_start(p_level_id,p_start);
 if p_note is not null then
   update public.survival_levels set status='approved',admin_note=p_note,approved_by=p_actor_id,approved_at=now(),updated_at=now() where id=p_level_id;
 end if;
end $$;
revoke all on function public.trusted_admin_stage(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.trusted_admin_stage(uuid,uuid,jsonb,text) to service_role;

-- One database snapshot decides both lifecycle and which persisted source can
-- be read. A live tip and a completed replay can never race across HTTP reads.
-- Legacy archives may contain an object, plain JSON string or c1: string.
-- Resolve the inner ID inside the same database snapshot as the live guard.
create or replace function public.completed_snapshot_game_id(p_snapshot jsonb)
returns text language plpgsql immutable set search_path=public,pg_temp as $$
declare parsed jsonb := p_snapshot; raw text;
begin
 if jsonb_typeof(parsed)='string' then
   raw := parsed #>> '{}';
   if left(raw,3)='c1:' then raw := substr(raw,4); end if;
   parsed := raw::jsonb;
 end if;
 return coalesce(parsed->>'gameId',parsed#>>'{genesis,meta,gameId}');
exception when invalid_text_representation then return null;
end $$;
revoke all on function public.completed_snapshot_game_id(jsonb) from public,anon,authenticated;
grant execute on function public.completed_snapshot_game_id(jsonb) to service_role;

create or replace function public.read_completed_replay_sources(p_game_id uuid,p_user_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(candidate order by priority),'[]'::jsonb)
  from (
    select 2 as priority,jsonb_build_object('scope','public','gameId',game_id,'ownerId',coalesce(source_owner_id::text,''),'name',name,'finishedAt',finished_at,'snapshot',snapshot) candidate
      from public.public_game_snapshots where game_id=p_game_id
    union all
    select 2,jsonb_build_object('scope','region','gameId',game_id,'regionId',region_id,'ownerId',coalesce(source_owner_id::text,''),'name',name,'finishedAt',finished_at,'snapshot',snapshot)
      from public.region_game_snapshots where game_id=p_game_id
    union all
    select 1,jsonb_build_object('scope','private','gameId',game_id,'ownerId',owner_id,'name',name,'finishedAt',updated_at,'snapshot',snapshot)
      from public.private_library_items where game_id=p_game_id and owner_id=p_user_id and item_type='game' and trashed_at is null
    union all
    select 1,jsonb_build_object('scope','recent','gameId',game_id,'ownerId',p_user_id,'name','Recent game','finishedAt',completed_at,'snapshot',record)
      from public.read_recent_game_payload(p_game_id,p_user_id)
    union all
    select 0,jsonb_build_object('scope',case when source_kind='stage' then 'stage' else 'saved' end,'gameId',game_id,'ownerId',p_user_id,'name','Saved game','finishedAt',completed_at,'snapshot',record)
      from public.read_saved_game_payload(p_game_id,p_user_id)
    union all
    select 1,jsonb_build_object('scope','stage','gameId',room_id,'ownerId',player_id,'name','Stage attempt','finishedAt',completed_at,'snapshot',record)
      from public.stage_completed_attempts where room_id=p_game_id and player_id=p_user_id
    union all
    select 1,jsonb_build_object('scope','ranked','gameId',m.id,'ownerId',m.player_a_id,
      'participantIds',jsonb_build_array(m.player_a_id,m.player_b_id),'name','Ranked match',
      'finishedAt',r.created_at,'rankedState',m.state,
      'rankedRevisions',(select jsonb_agg(v.state order by v.revision) from public.ranked_private_revisions v where v.match_id=m.id))
      from public.ranked_matches m join public.ranked_results r on r.match_id=m.id
      where m.id=p_game_id and m.status='finished' and p_user_id in (m.player_a_id,m.player_b_id)
  ) sources
  where not exists(select 1 from public.room_live l where l.room_id=p_game_id
    or l.state->>'gameId'=p_game_id::text
    or l.state->>'gameId'=public.completed_snapshot_game_id(candidate->'snapshot'))
    and not exists(select 1 from public.ranked_matches m where m.id=p_game_id and m.status<>'finished')
$$;
revoke all on function public.read_completed_replay_sources(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_completed_replay_sources(uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
