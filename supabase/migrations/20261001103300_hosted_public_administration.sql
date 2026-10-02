begin;
-- Only the frozen tournament owner may issue typed public administration.
create or replace function public.trusted_commit_live_game(
 p_actor_id uuid,p_room_id uuid,p_revision bigint,p_command_id text,p_side text,
 p_action jsonb,p_canonical jsonb,p_state jsonb
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare result record;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'trusted server required' using errcode='42501'; end if;
 if not exists(select 1 from public.room_live l where l.room_id=p_room_id and l.authority_protocol='server-v1'
   and ((p_side='host' and p_actor_id=l.owner_id and (l.state->>'emailPlayMode'='hosted' or l.game_mode='solo')
       and l.bot_side is null and l.room_purpose='normal')
     or p_actor_id=case p_side when 'A' then l.player_a_user_id when 'B' then l.player_b_user_id end
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
