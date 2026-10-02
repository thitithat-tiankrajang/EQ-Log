begin;
-- Joining a waiting seat changes trusted capabilities. Make it visible to CAS,
-- invalidate Ready/countdown, and retain the existing scope/code/region checks.
create or replace function public.join_live_game(target_room_code text default null,target_game_id uuid default null)
returns table(room_id uuid,claimed_side text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare live public.room_live%rowtype; joined record;
begin
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'approved membership required' using errcode='42501';
  end if;
  if (target_room_code is null) = (target_game_id is null) then
    raise exception 'provide exactly one room code or game id' using errcode='22023';
  end if;
  select * into live from public.room_live l where
    (target_game_id is not null and l.room_id=target_game_id and l.join_policy='open') or
    (target_room_code is not null and l.room_code_hash=encode(extensions.digest(
      upper(regexp_replace(btrim(target_room_code),'[^A-Za-z0-9]','','g')),'sha256'),'hex'))
    for update;
  if found then
    if live.authority_protocol<>'server-v1' then
      raise exception 'security_restart_required: refresh EQ Lab and start a new game' using errcode='42501';
    end if;
    if live.status<>'waiting' and (live.player_a_user_id is null or live.player_b_user_id is null)
      and auth.uid() is distinct from live.player_a_user_id
      and auth.uid() is distinct from live.player_b_user_id then
      raise exception 'live_seats_fixed: seats can only be claimed before play starts' using errcode='42501';
    end if;
  end if;
  select * into joined from public.join_live_game_before_security_gate(target_room_code,target_game_id);
  if joined.claimed_side is not null and auth.uid() is distinct from live.player_a_user_id
    and auth.uid() is distinct from live.player_b_user_id then
    update public.room_live l set revision=l.revision+1,
      state=jsonb_set(jsonb_set(l.state-'lobbyLaunchAt','{revision}',to_jsonb(l.revision+1)),
        '{lobbyReadyBySide}','{}'::jsonb)
    where l.room_id=joined.room_id;
  end if;
  return query select joined.room_id,joined.claimed_side;
end $$;
revoke all on function public.join_live_game(text,uuid) from public,anon;
grant execute on function public.join_live_game(text,uuid) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
