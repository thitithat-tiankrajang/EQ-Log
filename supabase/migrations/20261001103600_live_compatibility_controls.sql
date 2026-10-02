begin;
-- Public Ready used to mutate state outside the revision/command boundary.
-- Old callers must upgrade; the Edge now owns Ready/Unready and launch.
revoke all on function public.set_room_ready(uuid,text,boolean) from public,anon,authenticated;

create function public.trusted_commit_live_capability(
 p_actor_id uuid,p_room_id uuid,p_revision bigint,p_command_id text,p_action jsonb,
 p_canonical jsonb,p_state jsonb,p_timeline jsonb,p_timeline_version bigint
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare live public.room_live%rowtype; kind text:=p_action->>'kind'; seat text;
 current_version bigint; result record; a uuid; b uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'trusted server required' using errcode='42501'; end if;
 select * into live from public.room_live where room_id=p_room_id for update;
 if not found or live.authority_protocol<>'server-v1' then raise exception 'secure room required' using errcode='42501'; end if;
 seat:=case when live.player_a_user_id=p_actor_id then 'A' when live.player_b_user_id=p_actor_id then 'B' end;
 if live.mode_key='local_versus' and live.owner_id=p_actor_id and live.status='waiting' then seat:='A'; end if;
 if not (
   (kind in ('configure','launch','start') and live.owner_id=p_actor_id and live.status='waiting')
   or (kind='ready' and seat is not null and live.status='waiting')
   or (kind='rename' and live.owner_id=p_actor_id and live.status<>'waiting')
   or (kind='save-exit' and live.owner_id=p_actor_id and (live.mode_key='local_versus' or live.game_mode='solo') and live.state->>'emailPlayMode' is null)
   or (kind in ('request-pause','respond-pause','acknowledge-pause','resume-direct') and seat is not null
       and live.state->>'emailPlayMode'='direct' and live.bot_side is null)
   -- History edits (and moves that follow a parked twin) replay the stored ordered
   -- bag: only where that cannot reveal another party's tiles or future draws.
   or (kind in ('undo','redo','annotate','continue','prune','place','exchange','pass','record') and live.owner_id=p_actor_id
       and live.status<>'waiting'
       and case when live.bot_side is not null then
             (live.room_purpose='normal' and live.mode_key='stage5b_standard' and live.state->>'botEngine'='stage5b')
             or (jsonb_array_length(coalesce(live.state->'tilebag','[]'::jsonb))=0
                 and not exists(select 1 from jsonb_array_elements(coalesce(live.state->'history','[]'::jsonb)) h
                   where jsonb_array_length(coalesce(h->'tilebag','[]'::jsonb))>0))
           else live.state->>'emailPlayMode' is null
             or (live.state->>'emailPlayMode'='hosted' and live.state->>'tileDrawMode'='manual') end)
 ) then raise exception 'capability required' using errcode='42501'; end if;
 if exists(select 1 from public.live_game_events where game_id=p_room_id and command_id=p_command_id and actor_id=p_actor_id) then return 'duplicate'; end if;
 if live.revision<>p_revision then return 'conflict'; end if;
 select version into current_version from public.game_timelines where game_id=p_room_id for update;
 current_version:=coalesce(current_version,0);
 if current_version is distinct from p_timeline_version then return 'timeline_conflict'; end if;
 if kind='configure' then
   a:=nullif(p_state#>>'{playerUserIds,A}','')::uuid; b:=nullif(p_state#>>'{playerUserIds,B}','')::uuid;
   if a=b or (live.game_mode='solo' and b is not null)
      or (live.state->>'emailPlayMode'='direct' and p_actor_id is distinct from a and p_actor_id is distinct from b)
      or (live.state->>'emailPlayMode'='hosted' and live.state->>'tileDrawMode'<>'manual' and p_actor_id in (a,b))
      or (live.bot_side is not null and (a is distinct from live.player_a_user_id or b is distinct from live.player_b_user_id))
      or (live.mode_key='local_versus' and (a is distinct from live.owner_id or b is not null))
   then raise exception 'invalid seats' using errcode='42501'; end if;
   if exists(select 1 from unnest(array[a,b]) u(id) where id is not null and not exists(
       select 1 from public.profiles p where p.id=u.id and p.status='approved'
         and (live.access_scope<>'region' or p.region_id=live.region_id)))
   then raise exception 'approved region seat required' using errcode='42501'; end if;
   perform public.lock_board_users(array[p_actor_id,a,b]);
 end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
 -- Stage history editing may return to a position reached after the sealed
 -- opening. The Stage check still enforces that opening, score floor and set.
 if kind in ('undo','redo','continue') then perform set_config('eq.trusted_history_restore',p_room_id::text,true); end if;
 if p_timeline is not null then
   select * into result from public.commit_live_game_timeline(p_room_id,p_revision,p_command_id,'host',
     jsonb_build_object('kind',kind),p_canonical,null,p_state,'{}',p_timeline,p_timeline_version);
 else
   select * into result from public.commit_live_game_command(p_room_id,p_revision,p_command_id,
     coalesce(seat,'host'),jsonb_build_object('kind',kind),p_canonical,null,p_state,'{}');
 end if;
 if result.outcome='committed' then
   update public.room_live set name=p_state->>'name',player_a=p_state#>>'{players,A}',player_b=p_state#>>'{players,B}',
     starting_side=p_state->>'startingSide',
     player_a_user_id=case when kind='configure' then a else player_a_user_id end,
     player_b_user_id=case when kind='configure' then b else player_b_user_id end
   where room_id=p_room_id;
 end if;
 perform set_config('eq.trusted_history_restore','',true);
 return result.outcome;
end $$;
revoke all on function public.trusted_commit_live_capability(uuid,uuid,bigint,text,jsonb,jsonb,jsonb,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.trusted_commit_live_capability(uuid,uuid,bigint,text,jsonb,jsonb,jsonb,jsonb,bigint) to service_role;

create or replace function public.check_stage_commit(live public.room_live,target_canonical jsonb)
returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
declare expected jsonb; new_inventory jsonb:=target_canonical->'inventory'; old_inventory jsonb;
 before_tile jsonb; after_tile jsonb;
begin
 select l.start_canonical into expected from public.survival_attempts a join public.survival_levels l on l.id=a.level_id where a.room_id=live.room_id;
 if expected is null then raise exception 'stage_start_unknown'; end if;
 if jsonb_typeof(new_inventory) is distinct from 'array' or jsonb_array_length(new_inventory)<>100 then raise exception 'stage_invalid_position'; end if;
 if live.canonical is null then
   if new_inventory is distinct from expected->'inventory' or target_canonical->'scores' is distinct from expected->'scores'
     or target_canonical->'activeSide' is distinct from expected->'activeSide' or target_canonical->'turnNumber' is distinct from expected->'turnNumber'
     or target_canonical->'startingSide' is distinct from expected->'startingSide' then raise exception 'stage_start_mismatch'; end if;
   return;
 end if;
 if jsonb_typeof(target_canonical->'scores') is distinct from 'object'
   or jsonb_typeof(target_canonical#>'{scores,A}') is distinct from 'number'
   or jsonb_typeof(target_canonical#>'{scores,B}') is distinct from 'number'
   or (target_canonical#>>'{scores,A}')::numeric < (expected#>>'{scores,A}')::numeric
   or (target_canonical#>>'{scores,B}')::numeric < (expected#>>'{scores,B}')::numeric then raise exception 'stage_score_baseline'; end if;
 old_inventory:=case when current_setting('eq.trusted_history_restore',true)=live.room_id::text then expected->'inventory' else live.canonical->'inventory' end;
 for i in 0..99 loop
   before_tile:=old_inventory->i;
   if before_tile->>'at'='board' then
     after_tile:=new_inventory->i;
     if after_tile->>'at' is distinct from 'board' or after_tile->'row' is distinct from before_tile->'row'
        or after_tile->'col' is distinct from before_tile->'col' then raise exception 'stage_board_rewrite'; end if;
   end if;
 end loop;
end $$;
revoke all on function public.check_stage_commit(public.room_live,jsonb) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
