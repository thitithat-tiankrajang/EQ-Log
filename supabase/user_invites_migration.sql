-- UUID-based registered-player rooms and a privacy-safe username directory.
-- Run once in Supabase SQL Editor. Safe to run more than once.

set statement_timeout = '120s';
set lock_timeout = '15s';

alter table public.rooms
  add column if not exists invite_user_a_id uuid references public.profiles(id) on delete set null,
  add column if not exists invite_user_b_id uuid references public.profiles(id) on delete set null;

-- Convert existing email assignments without exposing those addresses to the
-- frontend. New rooms write only these UUID columns.
drop trigger if exists protect_invited_room_update on public.rooms;
create index if not exists profiles_email_lower_idx on public.profiles (lower(btrim(email)));

update public.rooms r
set invite_user_a_id = p.id
from public.profiles p
where r.invite_user_a_id is null
  and r.invite_email_a is not null
  and lower(btrim(p.email)) = lower(btrim(r.invite_email_a));

update public.rooms r
set invite_user_b_id = p.id
from public.profiles p
where r.invite_user_b_id is null
  and r.invite_email_b is not null
  and lower(btrim(p.email)) = lower(btrim(r.invite_email_b));

-- Avoid rewriting every large game-state JSON blob in one migration. The app
-- hydrates these UUIDs and removes legacy addresses from state/history when an
-- old room is next opened and saved.

-- Once an address has been resolved to a UUID it no longer needs to remain on
-- the room row. Unresolved legacy values stay server-side for one more rerun.
update public.rooms
set invite_email_a = case when invite_user_a_id is not null then null else invite_email_a end,
    invite_email_b = case when invite_user_b_id is not null then null else invite_email_b end
where (invite_user_a_id is not null and invite_email_a is not null)
   or (invite_user_b_id is not null and invite_email_b is not null);

create index if not exists rooms_invite_user_a_idx on public.rooms (invite_user_a_id);
create index if not exists rooms_invite_user_b_idx on public.rooms (invite_user_b_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rooms_invite_users_different'
  ) then
    alter table public.rooms add constraint rooms_invite_users_different check (
      invite_user_a_id is null
      or invite_user_b_id is null
      or invite_user_a_id <> invite_user_b_id
    );
  end if;
end $$;

-- The room picker gets only stable account ids and public usernames.
create or replace function public.list_registered_players()
returns table (id uuid, username text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name
  from public.profiles p
  where auth.uid() is not null
    and p.display_name is not null
    and btrim(p.display_name) <> ''
    and p.status <> 'blocked'
  order by lower(p.display_name), p.id
$$;

revoke all on function public.list_registered_players() from public;
grant execute on function public.list_registered_players() to authenticated;

-- Full profile rows are private: users can read their own row and admins can
-- read the approval list through narrowly-scoped security-definer RPCs.
create or replace function public.get_my_profile()
returns table (
  id uuid,
  email text,
  display_name text,
  status text,
  is_admin boolean,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.display_name, p.status, p.is_admin, p.created_at
  from public.profiles p
  where p.id = auth.uid()
$$;

revoke all on function public.get_my_profile() from public;
grant execute on function public.get_my_profile() to authenticated;

create or replace function public.list_profiles_admin()
returns table (
  id uuid,
  email text,
  display_name text,
  status text,
  is_admin boolean,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.display_name, p.status, p.is_admin, p.created_at
  from public.profiles p
  where public.is_admin()
  order by p.created_at, p.id
$$;

revoke all on function public.list_profiles_admin() from public;
grant execute on function public.list_profiles_admin() to authenticated;

-- RLS controls rows; column grants prevent ordinary clients from selecting
-- email/status/admin fields even though public display names remain readable.
revoke select on table public.profiles from anon, authenticated;
grant select (id, display_name) on table public.profiles to anon, authenticated;

-- Room state is public for spectators, but legacy invite-address columns are
-- not. New identity columns contain opaque account ids only.
revoke select on table public.rooms from anon, authenticated;
grant select (
  id, owner_id, name, player_a, player_b, status, turn_number, score_a, score_b,
  lifecycle_status, member_a_id, member_b_id, starting_side,
  invite_user_a_id, invite_user_b_id, state, created_at, updated_at
) on table public.rooms to anon, authenticated;

create or replace function public.is_room_player(
  user_a uuid,
  user_b uuid,
  email_a text,
  email_b text
)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    case
      when user_a is not null or user_b is not null
        then auth.uid() in (user_a, user_b)
      else public.is_room_invitee(email_a, email_b)
    end,
    false
  )
$$;

create or replace function public.is_room_player_for_active_side(
  room_state jsonb,
  user_a uuid,
  user_b uuid,
  email_a text,
  email_b text
)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    case room_state ->> 'activeSide'
      when 'A' then case
        when user_a is not null then user_a = auth.uid()
        else lower(btrim(email_a)) = public.my_email_lower()
      end
      when 'B' then case
        when user_b is not null then user_b = auth.uid()
        else lower(btrim(email_b)) = public.my_email_lower()
      end
      else false
    end,
    false
  )
$$;

create or replace function public.set_room_ready(
  target_room_id uuid,
  target_side text,
  target_ready boolean
)
returns void language plpgsql security definer set search_path = public as $$
declare
  target_room public.rooms%rowtype;
  target_user_id uuid;
  target_email text;
  ready_state jsonb;
begin
  if target_side not in ('A', 'B') then
    raise exception 'invalid player side' using errcode = '22023';
  end if;

  select * into target_room
  from public.rooms
  where id = target_room_id
  for update;

  if not found or target_room.state ->> 'roomStage' <> 'waiting' then
    raise exception 'waiting room not found' using errcode = 'P0002';
  end if;

  target_user_id := case target_side
    when 'A' then target_room.invite_user_a_id
    else target_room.invite_user_b_id
  end;
  target_email := case target_side
    when 'A' then coalesce(target_room.invite_email_a, target_room.state #>> '{playerEmails,A}')
    else coalesce(target_room.invite_email_b, target_room.state #>> '{playerEmails,B}')
  end;

  if target_user_id is not null then
    if target_user_id is distinct from auth.uid() then
      raise exception 'not assigned to this player side' using errcode = '42501';
    end if;
  elsif target_email is null
    or lower(btrim(target_email)) is distinct from public.my_email_lower()
  then
    raise exception 'not assigned to this player side' using errcode = '42501';
  end if;

  ready_state := coalesce(target_room.state -> 'lobbyReadyBySide', '{}'::jsonb);
  ready_state := jsonb_set(ready_state, array[target_side], to_jsonb(target_ready), true);
  update public.rooms
  set state = jsonb_set(state, '{lobbyReadyBySide}', ready_state, true),
      updated_at = now()
  where id = target_room_id;
end $$;

revoke all on function public.set_room_ready(uuid, text, boolean) from public;
grant execute on function public.set_room_ready(uuid, text, boolean) to authenticated;

create or replace function public.protect_invited_room_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.owner_id = auth.uid() or public.is_admin() then
    return new;
  end if;

  if old.state ->> 'roomStage' = 'waiting' then
    if not public.is_room_player(
      old.invite_user_a_id, old.invite_user_b_id,
      old.invite_email_a, old.invite_email_b
    ) then
      raise exception 'not assigned to this waiting room' using errcode = '42501';
    end if;
    if new.owner_id is distinct from old.owner_id
      or new.name is distinct from old.name
      or new.player_a is distinct from old.player_a
      or new.player_b is distinct from old.player_b
      or new.invite_user_a_id is distinct from old.invite_user_a_id
      or new.invite_user_b_id is distinct from old.invite_user_b_id
      or new.invite_email_a is distinct from old.invite_email_a
      or new.invite_email_b is distinct from old.invite_email_b
      or (new.state - 'lobbyReadyBySide') is distinct from (old.state - 'lobbyReadyBySide')
    then
      raise exception 'players can only update their waiting-room ready state'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status <> 'playing'
    or coalesce(old.state ->> 'status', '') <> 'playing'
    or (
      coalesce(old.state ->> 'emailPlayMode', 'hosted') = 'hosted'
      and old.state ->> 'tileDrawMode' = 'manual'
      and old.state ->> 'phase' = 'refill'
    )
    or not public.is_room_player_for_active_side(
      old.state,
      old.invite_user_a_id, old.invite_user_b_id,
      old.invite_email_a, old.invite_email_b
    )
  then
    raise exception 'not assigned to the active side' using errcode = '42501';
  end if;

  if new.owner_id is distinct from old.owner_id
    or new.name is distinct from old.name
    or new.player_a is distinct from old.player_a
    or new.player_b is distinct from old.player_b
    or new.invite_user_a_id is distinct from old.invite_user_a_id
    or new.invite_user_b_id is distinct from old.invite_user_b_id
    or new.invite_email_a is distinct from old.invite_email_a
    or new.invite_email_b is distinct from old.invite_email_b
    or new.state -> 'gameId' is distinct from old.state -> 'gameId'
    or new.state -> 'name' is distinct from old.state -> 'name'
    or new.state -> 'players' is distinct from old.state -> 'players'
    or new.state -> 'playerMembers' is distinct from old.state -> 'playerMembers'
    or new.state -> 'playerUserIds' is distinct from old.state -> 'playerUserIds'
    or new.state -> 'playerEmails' is distinct from old.state -> 'playerEmails'
    or new.state -> 'emailPlayMode' is distinct from old.state -> 'emailPlayMode'
    or new.state -> 'emailPlayersCanSeeOpponentRack'
      is distinct from old.state -> 'emailPlayersCanSeeOpponentRack'
    or new.state -> 'gameMode' is distinct from old.state -> 'gameMode'
    or new.state -> 'tileDrawMode' is distinct from old.state -> 'tileDrawMode'
    or new.state -> 'startingSide' is distinct from old.state -> 'startingSide'
  then
    raise exception 'players cannot change room ownership or configuration'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists protect_invited_room_update on public.rooms;
create trigger protect_invited_room_update
  before update on public.rooms
  for each row execute function public.protect_invited_room_update();

drop policy if exists rooms_insert on public.rooms;
create policy rooms_insert on public.rooms for insert
  with check (
    owner_id = auth.uid()
    and (public.is_approved() or public.is_admin())
    and (
      public.is_admin()
      or (
        invite_user_a_id is null and invite_user_b_id is null
        and invite_email_a is null and invite_email_b is null
      )
      or (
        state ->> 'gameMode' = 'solo'
        and coalesce(state ->> 'emailPlayMode', 'hosted') = 'hosted'
        and (invite_user_a_id is not null or invite_email_a is not null)
        and invite_user_b_id is null and invite_email_b is null
        and not public.is_room_player(
          invite_user_a_id, invite_user_b_id, invite_email_a, invite_email_b
        )
      )
      or (
        coalesce(state ->> 'gameMode', 'versus') = 'versus'
        and (invite_user_a_id is not null or invite_email_a is not null)
        and (invite_user_b_id is not null or invite_email_b is not null)
        and (
          (invite_user_a_id is not null and invite_user_b_id is not null
            and invite_user_a_id <> invite_user_b_id)
          or (invite_user_a_id is null and invite_user_b_id is null
            and lower(btrim(invite_email_a)) <> lower(btrim(invite_email_b)))
        )
        and (
          (
            state ->> 'emailPlayMode' = 'direct'
            and state ->> 'tileDrawMode' = 'play'
            and public.is_room_player(
              invite_user_a_id, invite_user_b_id, invite_email_a, invite_email_b
            )
          )
          or (
            coalesce(state ->> 'emailPlayMode', 'hosted') = 'hosted'
            and not public.is_room_player(
              invite_user_a_id, invite_user_b_id, invite_email_a, invite_email_b
            )
          )
        )
      )
    )
  );

drop policy if exists rooms_update on public.rooms;
create policy rooms_update on public.rooms for update
  using (
    owner_id = auth.uid()
    or public.is_admin()
    or (
      state ->> 'roomStage' = 'waiting'
      and public.is_room_player(
        invite_user_a_id, invite_user_b_id, invite_email_a, invite_email_b
      )
    )
    or public.is_room_player_for_active_side(
      state,
      invite_user_a_id, invite_user_b_id,
      invite_email_a, invite_email_b
    )
  )
  with check (
    owner_id = auth.uid()
    or public.is_admin()
    or public.is_room_player(
      invite_user_a_id, invite_user_b_id, invite_email_a, invite_email_b
    )
  );

drop policy if exists room_live_insert on public.room_live;
create policy room_live_insert on public.room_live for insert
  with check (exists (
    select 1 from public.rooms r
    where r.id = room_id
      and (
        r.owner_id = auth.uid()
        or public.is_admin()
        or public.is_room_player(
          r.invite_user_a_id, r.invite_user_b_id,
          r.invite_email_a, r.invite_email_b
        )
      )
  ));

drop policy if exists room_live_update on public.room_live;
create policy room_live_update on public.room_live for update
  using (exists (
    select 1 from public.rooms r
    where r.id = room_id
      and (
        r.owner_id = auth.uid()
        or public.is_admin()
        or public.is_room_player(
          r.invite_user_a_id, r.invite_user_b_id,
          r.invite_email_a, r.invite_email_b
        )
      )
  ))
  with check (exists (
    select 1 from public.rooms r
    where r.id = room_id
      and (
        r.owner_id = auth.uid()
        or public.is_admin()
        or public.is_room_player(
          r.invite_user_a_id, r.invite_user_b_id,
          r.invite_email_a, r.invite_email_b
        )
      )
  ));

notify pgrst, 'reload schema';
