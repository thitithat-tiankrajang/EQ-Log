begin;

-- Requests contain only the bot's observation, not the human rack or true queue.
-- Both the job and lease capability stay behind service-role access.
create table public.live_bot_jobs (
 id uuid primary key default gen_random_uuid(), room_id uuid not null,
 revision bigint not null, actor_id uuid not null, bot_side text not null check(bot_side in ('A','B')),
 request jsonb not null, status text not null default 'queued' check(status in ('queued','running','done','failed','cancelled')),
 lease_token uuid, lease_expires_at timestamptz, created_at timestamptz not null default now(),
 unique(room_id,revision)
);
alter table public.live_bot_jobs enable row level security;
revoke all on table public.live_bot_jobs from public,anon,authenticated;
grant all on table public.live_bot_jobs to service_role;

create function public.enqueue_live_bot(p_room_id uuid,p_revision bigint,p_actor_id uuid,p_request jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare live public.room_live%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'trusted server required' using errcode='42501'; end if;
 select * into live from public.room_live where room_id=p_room_id for update;
 if not found or live.authority_protocol<>'server-v1' or live.revision<>p_revision
   or live.status<>'playing' or live.bot_side is null or live.state->>'activeSide'<>live.bot_side
   or live.owner_id<>p_actor_id or live.state->>'botEngine'<>'authur'
 then raise exception 'bot turn unavailable' using errcode='40001'; end if;
 if p_request->>'side'<>live.bot_side or (p_request->>'revision')::bigint<>live.revision then
   raise exception 'bot request mismatch'; end if;
 insert into public.live_bot_jobs(room_id,revision,actor_id,bot_side,request)
   values(p_room_id,p_revision,p_actor_id,live.bot_side,p_request)
   on conflict(room_id,revision) do update set status='queued'
     where live_bot_jobs.status='failed';
end $$;
revoke all on function public.enqueue_live_bot(uuid,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_live_bot(uuid,bigint,uuid,jsonb) to service_role;

create function public.claim_live_bot_job() returns setof public.live_bot_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.live_bot_jobs%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'trusted server required' using errcode='42501'; end if;
 update public.live_bot_jobs j set status='cancelled' where status in ('queued','running') and not exists
   (select 1 from public.room_live l where l.room_id=j.room_id and l.revision=j.revision and l.status='playing');
 select * into job from public.live_bot_jobs where status='queued' or (status='running' and lease_expires_at<now())
   order by created_at for update skip locked limit 1;
 if not found then return; end if;
 update public.live_bot_jobs set status='running',lease_token=gen_random_uuid(),lease_expires_at=now()+interval '10 minutes'
   where id=job.id returning * into job;
 return next job;
end $$;
revoke all on function public.claim_live_bot_job() from public,anon,authenticated;
grant execute on function public.claim_live_bot_job() to service_role;

-- A trusted worker may commit the bot side for its frozen human owner. The
-- browser still cannot call this wrapper, nor select its own acting side.
create or replace function public.trusted_commit_live_game(
 p_actor_id uuid,p_room_id uuid,p_revision bigint,p_command_id text,p_side text,
 p_action jsonb,p_canonical jsonb,p_state jsonb
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare result record;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'trusted server required' using errcode='42501'; end if;
 if not exists(select 1 from public.room_live l where l.room_id=p_room_id and l.authority_protocol='server-v1'
   and (p_actor_id=case p_side when 'A' then l.player_a_user_id when 'B' then l.player_b_user_id end
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
