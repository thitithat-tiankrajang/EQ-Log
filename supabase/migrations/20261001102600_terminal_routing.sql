-- Terminal routing is metadata, not permission to read a frozen internal
-- room column or to finish a game. The existing Edge adapters still authorize
-- and validate the terminal write independently.
begin;

create function public.get_game_terminal_route(target_game_id uuid)
returns text language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare viewer uuid := auth.uid(); live record;
begin
  if auth.role() is distinct from 'authenticated' or viewer is null
    or not (public.is_approved() or public.is_admin()) then
    return null;
  end if;

  -- Ranked is a separate server-authoritative game, never a normal terminal.
  if exists (select 1 from public.ranked_matches where id = target_game_id) then
    return null;
  end if;

  select room_purpose, owner_id, player_a_user_id, player_b_user_id
    into live from public.room_live where room_id = target_game_id;
  if found then
    if live.room_purpose = 'stage' then
      if live.owner_id = viewer and exists (
        select 1 from public.survival_attempts a
        where a.room_id = target_game_id and a.player_id = viewer
      ) then return 'stage'; end if;
    elsif live.room_purpose = 'normal'
      and viewer in (live.owner_id, live.player_a_user_id, live.player_b_user_id) then
      return 'normal';
    end if;
    return null;
  end if;

  -- Successful capture removes the live row. Route a lost-response retry
  -- from the immutable, caller-owned receipt, never from the client name.
  if exists (select 1 from public.stage_completed_attempts s
    where s.room_id = target_game_id and s.player_id = viewer) then
    return 'stage';
  end if;
  if exists (select 1 from public.game_history h
    where h.source_kind = 'normal' and h.source_id = target_game_id
      and viewer in (h.participant_id, h.source_owner_id)) then
    return 'normal';
  end if;
  return null;
end $$;

revoke all on function public.get_game_terminal_route(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_game_terminal_route(uuid) to authenticated;
comment on function public.get_game_terminal_route(uuid) is
  'Caller-authorized terminal route only; no payload, secrets, or write authority. Null also covers unavailable and Ranked games.';

commit;
