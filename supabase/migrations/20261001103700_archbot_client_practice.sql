begin;
-- Product decision: ArchBot is client practice. This grants a chosen-move
-- commit to the stored practice owner, never arbitrary canonical browser writes.
create function public.trusted_commit_practice_bot(
 p_actor_id uuid,p_room_id uuid,p_revision bigint,p_command_id text,p_action jsonb,p_canonical jsonb,p_state jsonb
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare live public.room_live%rowtype; result record;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'trusted server required' using errcode='42501'; end if;
 select * into live from public.room_live where room_id=p_room_id for update;
 if not found or live.owner_id<>p_actor_id or live.authority_protocol<>'server-v1' or live.room_purpose<>'normal'
   or live.mode_key<>'stage5b_standard' or live.bot_key<>'stage5b' or live.state->>'botEngine'<>'stage5b'
   or live.bot_difficulty<>'stage5b64' then raise exception 'ArchBot practice required' using errcode='42501'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
 select * into result from public.commit_live_game_command(p_room_id,p_revision,p_command_id,live.bot_side,
   jsonb_build_object('kind',p_action->>'kind'),p_canonical,null,p_state,'{}');
 return result.outcome;
end $$;
revoke all on function public.trusted_commit_practice_bot(uuid,uuid,bigint,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.trusted_commit_practice_bot(uuid,uuid,bigint,text,jsonb,jsonb,jsonb) to service_role;

-- Keep Authur's existing durable queue. ArchBot never enters this runtime.
create or replace function public.queue_authoritative_bot_turn() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.authority_protocol='server-v1' and new.status='playing'
   and new.state->>'status'='playing' and new.state->>'roomStage'='playing'
   and coalesce((new.state#>>'{timers,paused}')::boolean,true)=false
   and new.bot_side is not null and new.state->>'activeSide'=new.bot_side
   and new.state->>'botEngine'='authur' then
   insert into public.live_bot_jobs(room_id,revision,actor_id,bot_side,request)
     values(new.room_id,new.revision,new.owner_id,new.bot_side,'{}') on conflict(room_id,revision) do nothing;
 end if;
 return new;
end $$;
revoke all on function public.queue_authoritative_bot_turn() from public,anon,authenticated;
create or replace function public.enqueue_live_bot(p_room_id uuid,p_revision bigint,p_actor_id uuid,p_request jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare live public.room_live%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'trusted server required' using errcode='42501'; end if;
 select * into live from public.room_live where room_id=p_room_id for update;
 if not found or live.authority_protocol<>'server-v1' or live.revision<>p_revision
   or live.status<>'playing' or live.state->>'status'<>'playing'
   or coalesce((live.state#>>'{timers,paused}')::boolean,true)
   or live.bot_side is null or live.state->>'activeSide'<>live.bot_side
   or live.owner_id<>p_actor_id or live.state->>'botEngine'<>'authur' then raise exception 'bot turn unavailable' using errcode='40001'; end if;
 if p_request->>'side'<>live.bot_side or (p_request->>'revision')::bigint<>live.revision then raise exception 'bot request mismatch'; end if;
 insert into public.live_bot_jobs(room_id,revision,actor_id,bot_side,request)
   values(p_room_id,p_revision,p_actor_id,live.bot_side,p_request) on conflict(room_id,revision) do update set request=excluded.request where live_bot_jobs.request='{}';
end $$;
update public.live_bot_jobs j set status='cancelled' from public.room_live l
 where l.room_id=j.room_id and l.room_purpose='normal' and l.mode_key='stage5b_standard' and j.status in ('queued','running','failed');
notify pgrst,'reload schema';
commit;
