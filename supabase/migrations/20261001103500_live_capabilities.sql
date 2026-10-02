begin;
-- A local turn claim is a view capability, not a gameplay snapshot. No browser
-- SELECT/EXECUTE grant or Realtime payload is added for these private columns.
alter table public.room_live add column local_claim_token uuid;
alter table public.room_live add column local_claim_side text check(local_claim_side in ('A','B'));
alter table public.room_live add column local_claim_revision bigint;
create function public.claim_local_turn(p_actor_id uuid,p_room_id uuid,p_revision bigint,p_side text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare live public.room_live%rowtype; token uuid := gen_random_uuid();
begin
 if auth.role() is distinct from 'service_role' then raise exception 'trusted server required' using errcode='42501'; end if;
 select * into live from public.room_live where room_id=p_room_id for update;
 if not found or live.owner_id<>p_actor_id or live.mode_key<>'local_versus'
   or live.authority_protocol<>'server-v1' or live.revision<>p_revision
   or live.status<>'playing' or live.state->>'activeSide'<>p_side
 then raise exception 'local handoff unavailable' using errcode='42501'; end if;
 update public.room_live set local_claim_token=token,local_claim_side=p_side,local_claim_revision=p_revision where room_id=p_room_id;
 return token;
end $$;
revoke all on function public.claim_local_turn(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.claim_local_turn(uuid,uuid,bigint,text) to service_role;
create function public.clear_local_turn_claim() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.revision is distinct from old.revision then
   new.local_claim_token=null; new.local_claim_side=null; new.local_claim_revision=null;
 end if;
 return new;
end $$;
revoke all on function public.clear_local_turn_claim() from public,anon,authenticated;
create trigger clear_local_turn_claim before update on public.room_live
 for each row execute function public.clear_local_turn_claim();

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
   'emails',p_state->'playerEmails','emailPlayMode',p_state->'emailPlayMode','tileDrawMode',p_state->'tileDrawMode','startingSide',p_state->'startingSide','gameMode',p_state->'gameMode','initialTimes',p_state#>'{timers,initialSecondsBySide}','untimed',p_state#>'{timers,sideUntimed}');
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


create or replace function public.trusted_commit_live_game(
 p_actor_id uuid,p_room_id uuid,p_revision bigint,p_command_id text,p_side text,
 p_action jsonb,p_canonical jsonb,p_state jsonb
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare result record;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'trusted server required' using errcode='42501'; end if;
 if not exists(select 1 from public.room_live l where l.room_id=p_room_id and l.authority_protocol='server-v1'
   and ((p_side='host' and p_actor_id=l.owner_id and (l.state->>'emailPlayMode'='hosted' or l.game_mode='solo' or l.mode_key='local_versus')
       and l.bot_side is null and l.room_purpose='normal')
     or (l.mode_key<>'local_versus' and p_actor_id=case p_side when 'A' then l.player_a_user_id when 'B' then l.player_b_user_id end)
     or (l.mode_key='local_versus' and p_actor_id=l.owner_id and p_side=l.local_claim_side and l.local_claim_revision=p_revision)
     or (p_actor_id=l.owner_id and p_side=l.bot_side and exists(select 1 from public.live_bot_jobs j
       where j.room_id=l.room_id and j.revision=p_revision and j.id::text=p_command_id and j.status='running'
         and j.actor_id=p_actor_id and j.bot_side=p_side and j.lease_expires_at>now()))))
 then raise exception 'seat required' using errcode='42501'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
 select * into result from public.commit_live_game_command(p_room_id,p_revision,p_command_id,p_side,
   jsonb_build_object('kind',p_action->>'kind'),p_canonical,null,p_state,'{}'::jsonb);
 return result.outcome;
end $$;

notify pgrst,'reload schema';
commit;
