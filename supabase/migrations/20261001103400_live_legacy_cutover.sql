-- Preserve pre-security games without pretending their client-reported history
-- is server-authoritative. No payload from this quarantine is browser-readable.
begin;

create table private.live_legacy_quarantine (
  room_id uuid primary key,
  quarantined_at timestamptz not null default now(),
  room_row jsonb not null,
  timeline_row jsonb,
  event_rows jsonb not null,
  source_digest text not null
);
alter table private.live_legacy_quarantine enable row level security;
revoke all on table private.live_legacy_quarantine from public,anon,authenticated;
grant select,insert on table private.live_legacy_quarantine to service_role;

insert into private.live_legacy_quarantine(room_id,room_row,timeline_row,event_rows,source_digest)
select l.room_id,to_jsonb(l),t.doc,e.doc,
  encode(extensions.digest(convert_to(jsonb_build_object('room',to_jsonb(l),'timeline',t.doc,'events',e.doc)::text,'UTF8'),'sha256'),'hex')
from public.room_live l
left join lateral (select to_jsonb(g) doc from public.game_timelines g where g.game_id=l.room_id) t on true
cross join lateral (select coalesce(jsonb_agg(to_jsonb(g) order by g.revision),'[]'::jsonb) doc
  from public.live_game_events g where g.game_id=l.room_id) e
where l.authority_protocol='legacy-client';

-- Do not allow an authenticated old Ready/join call to mutate a frozen row.
-- Preserve existing seats for view identity. Once play starts, vacancies never
-- become a route into a former player's rack.
alter function public.join_live_game(text,uuid) rename to join_live_game_before_security_gate;
revoke all on function public.join_live_game_before_security_gate(text,uuid) from public,anon,authenticated;
create function public.join_live_game(target_room_code text default null,target_game_id uuid default null)
returns table(room_id uuid,claimed_side text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare live public.room_live%rowtype;
begin
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'approved membership required' using errcode='42501';
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
  return query select * from public.join_live_game_before_security_gate(target_room_code,target_game_id);
end $$;
revoke all on function public.join_live_game(text,uuid) from public,anon;
grant execute on function public.join_live_game(text,uuid) to authenticated,service_role;

alter function public.set_room_ready(uuid,text,boolean) rename to set_room_ready_before_security_gate;
revoke all on function public.set_room_ready_before_security_gate(uuid,text,boolean) from public,anon,authenticated;
create function public.set_room_ready(target_room_id uuid,target_side text,target_ready boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare live public.room_live%rowtype;
begin
  select * into live from public.room_live where room_id=target_room_id for update;
  if found and live.authority_protocol<>'server-v1' then
    raise exception 'security_restart_required: refresh EQ Lab and start a new game' using errcode='42501';
  end if;
  perform public.set_room_ready_before_security_gate(target_room_id,target_side,target_ready);
end $$;
revoke all on function public.set_room_ready(uuid,text,boolean) from public,anon;
grant execute on function public.set_room_ready(uuid,text,boolean) to authenticated,service_role;

-- Active authoritative games must finish through atomic capture, never through
-- the old lobby Delete RPC. A legacy owner may abandon the visible frozen room;
-- the private cutover copy survives that deletion, with no fake result/Replay.
alter function public.cancel_live_game(uuid) rename to cancel_live_game_before_security_gate;
revoke all on function public.cancel_live_game_before_security_gate(uuid) from public,anon,authenticated;
create function public.cancel_live_game(target_game_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare live public.room_live%rowtype;
begin
  select * into live from public.room_live where room_id=target_game_id for update;
  if found and live.authority_protocol='server-v1' and live.status<>'waiting' then
    raise exception 'trusted_finish_required: finish this game before removing it' using errcode='42501';
  end if;
  if found and live.authority_protocol='legacy-client'
    and not exists(select 1 from private.live_legacy_quarantine q where q.room_id=live.room_id) then
    raise exception 'legacy_preservation_required' using errcode='42501';
  end if;
  perform public.cancel_live_game_before_security_gate(target_game_id);
end $$;
revoke all on function public.cancel_live_game(uuid) from public,anon;
grant execute on function public.cancel_live_game(uuid) to authenticated,service_role;

-- Frozen legacy sessions do not consume playable-board quota after cutover.
-- This leaves funding and capacity rules for every playable room unchanged.
create or replace function public.active_board_count(
  target_user uuid,t timestamptz,exclude_room uuid default null,exclude_match uuid default null
) returns integer language sql stable security definer set search_path=public,pg_temp as $$
  select ((select count(*) from public.room_live l
    where target_user in (l.player_a_user_id,l.player_b_user_id)
      and l.authority_protocol='server-v1'
      and public.room_counts_as_board(l.status,l.expires_at,t)
      and l.room_id is distinct from exclude_room)
    + (select count(*) from public.ranked_matches m
    where target_user in (m.player_a_id,m.player_b_id)
      and public.ranked_counts_as_board(m.status,m.created_at,t)
      and m.id is distinct from exclude_match))::integer
$$;

create or replace function public.cleanup_expired_live_games()
returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare removed bigint;
begin
  with removed_rows as (delete from public.room_live
    where authority_protocol='server-v1' and expires_at is not null and expires_at<=now()
    returning 1) select count(*) into removed from removed_rows;
  return removed;
end $$;
notify pgrst,'reload schema';
commit;
