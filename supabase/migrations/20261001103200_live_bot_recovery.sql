begin;
-- The durable outbox is part of the authoritative room transaction. Only
-- revision/owner/side are queued here; the worker requests its own observation
-- from the private Edge boundary after acquiring a lease.
alter table public.live_bot_jobs add column attempts integer not null default 0;
alter table public.live_bot_jobs add column next_attempt_at timestamptz not null default now();
create function public.queue_authoritative_bot_turn() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.authority_protocol='server-v1' and new.status='playing'
   and new.state->>'status'='playing' and new.state->>'roomStage'='playing'
   and coalesce((new.state#>>'{timers,paused}')::boolean,true)=false
   and new.bot_side is not null and new.state->>'activeSide'=new.bot_side
   and new.state->>'botEngine'='authur' then
   insert into public.live_bot_jobs(room_id,revision,actor_id,bot_side,request)
     values(new.room_id,new.revision,new.owner_id,new.bot_side,'{}'::jsonb)
     on conflict(room_id,revision) do nothing;
 end if;
 return new;
end $$;
revoke all on function public.queue_authoritative_bot_turn() from public,anon,authenticated;
create trigger queue_authoritative_bot_turn after insert or update on public.room_live
 for each row execute function public.queue_authoritative_bot_turn();
-- Reconcile games already at a bot turn when the migration is installed.
insert into public.live_bot_jobs(room_id,revision,actor_id,bot_side,request)
 select room_id,revision,owner_id,bot_side,'{}'::jsonb from public.room_live
 where authority_protocol='server-v1' and status='playing' and state->>'status'='playing'
   and state->>'roomStage'='playing' and coalesce((state#>>'{timers,paused}')::boolean,true)=false
   and bot_side is not null and state->>'activeSide'=bot_side and state->>'botEngine'='authur'
 on conflict(room_id,revision) do nothing;

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
   or live.owner_id<>p_actor_id or live.state->>'botEngine'<>'authur'
 then raise exception 'bot turn unavailable' using errcode='40001'; end if;
 if p_request->>'side'<>live.bot_side or (p_request->>'revision')::bigint<>live.revision then
   raise exception 'bot request mismatch'; end if;
 insert into public.live_bot_jobs(room_id,revision,actor_id,bot_side,request)
   values(p_room_id,p_revision,p_actor_id,live.bot_side,p_request)
   on conflict(room_id,revision) do update set request=excluded.request
     where live_bot_jobs.request='{}'::jsonb;
end $$;

create or replace function public.claim_live_bot_job() returns setof public.live_bot_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.live_bot_jobs%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'trusted server required' using errcode='42501'; end if;
 -- A commit whose HTTP receipt was lost has already consumed its command ID.
 update public.live_bot_jobs j set status='done' where status in ('queued','running','failed')
   and exists(select 1 from public.live_game_events e where e.game_id=j.room_id and e.command_id=j.id::text and e.actor_id=j.actor_id);
 update public.live_bot_jobs j set status='cancelled' where status in ('queued','running','failed') and not exists
   (select 1 from public.room_live l where l.room_id=j.room_id and l.revision=j.revision
      and l.authority_protocol='server-v1' and l.status='playing' and l.state->>'status'='playing'
      and coalesce((l.state#>>'{timers,paused}')::boolean,true)=false
      and l.state->>'activeSide'=j.bot_side);
 select * into job from public.live_bot_jobs
   where status='queued' or (status='failed' and next_attempt_at<=now())
      or (status='running' and lease_expires_at<now())
   order by created_at for update skip locked limit 1;
 if not found then return; end if;
 update public.live_bot_jobs set status='running',lease_token=gen_random_uuid(),
   lease_expires_at=now()+interval '10 minutes',attempts=attempts+1,
   next_attempt_at=now()+make_interval(secs=>least(60,power(2,least(attempts+1,6)))::integer)
   where id=job.id returning * into job;
 return next job;
end $$;
notify pgrst,'reload schema';
commit;
