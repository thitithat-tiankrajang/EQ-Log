-- Complete room-creation schema for local, hosted, direct, and solo rooms.
-- Run in Supabase SQL Editor. Safe to run more than once.
--
-- This installer intentionally does not backfill old email rooms. A large
-- backfill in the same transaction can hit statement_timeout and roll back the
-- new columns as well, leaving PostgREST with PGRST204. Existing email rooms
-- continue to work through the legacy columns; new rooms use account UUIDs.

set statement_timeout = '120s';
set lock_timeout = '15s';

alter table public.rooms
  add column if not exists lifecycle_status text,
  add column if not exists game_mode text,
  add column if not exists member_a_id text,
  add column if not exists member_b_id text,
  add column if not exists starting_side text,
  add column if not exists invite_email_a text,
  add column if not exists invite_email_b text,
  add column if not exists invite_user_a_id uuid references public.profiles(id) on delete set null,
  add column if not exists invite_user_b_id uuid references public.profiles(id) on delete set null;

alter table public.rooms alter column game_mode set default 'versus';

-- NOT VALID avoids a full historical-table scan during installation while the
-- constraint still applies immediately to every new or changed row.
alter table public.rooms drop constraint if exists rooms_status_check;
alter table public.rooms add constraint rooms_status_check
  check (status in ('playing', 'draft', 'finished')) not valid;

create table if not exists public.room_live (
  room_id     uuid primary key references public.rooms(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  session     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_live enable row level security;

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved'
  )
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin
  )
$$;

create or replace function public.my_email_lower()
returns text language sql stable security definer set search_path = public as $$
  select lower(btrim(email)) from public.profiles where id = auth.uid()
$$;

create or replace function public.is_room_invitee(email_a text, email_b text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.my_email_lower() is not null
      and public.my_email_lower() in (lower(btrim(email_a)), lower(btrim(email_b))),
    false
  )
$$;

create index if not exists rooms_invite_user_a_idx on public.rooms (invite_user_a_id);
create index if not exists rooms_invite_user_b_idx on public.rooms (invite_user_b_id);
create index if not exists rooms_invite_email_a_idx on public.rooms (lower(btrim(invite_email_a)));
create index if not exists rooms_invite_email_b_idx on public.rooms (lower(btrim(invite_email_b)));

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
end; $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rooms_game_mode_check'
  ) then
    alter table public.rooms add constraint rooms_game_mode_check
      check (game_mode is null or game_mode in ('versus', 'solo')) not valid;
  end if;
end; $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rooms_starting_side_check'
  ) then
    alter table public.rooms add constraint rooms_starting_side_check
      check (starting_side is null or starting_side in ('A', 'B')) not valid;
  end if;
end; $$;

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
-- ...but signed-in users still need to write their OWN profile row (the
-- "choose a name" step upserts id/email/display_name). Row-Level Security
-- (profiles_insert / profiles_update: id = auth.uid()) keeps that to their own
-- row; without these table grants the upsert fails with "permission denied for
-- table profiles". The upsert requests no representation back, so no extra
-- SELECT grant on email is needed.
grant insert, update on table public.profiles to authenticated;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);

-- Room state is public for spectators, but legacy invite-address columns are
-- not. New identity columns contain opaque account ids only.
revoke select on table public.rooms from anon, authenticated;
grant select (
  id, owner_id, name, player_a, player_b, status, turn_number, score_a, score_b,
  lifecycle_status, game_mode, member_a_id, member_b_id, starting_side,
  invite_user_a_id, invite_user_b_id, state, created_at, updated_at
) on table public.rooms to anon, authenticated;
grant insert, update, delete on table public.rooms to authenticated;
grant select on table public.room_live to anon, authenticated;
grant insert, update on table public.room_live to authenticated;

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
end; $$;

revoke all on function public.set_room_ready(uuid, text, boolean) from public;
grant execute on function public.set_room_ready(uuid, text, boolean) to authenticated;

create or replace function public.protect_invited_room_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- A direct room has no host. Its creator remains owner_id for persistence,
  -- but must obey the same active-side restrictions as the other player.
  if public.is_admin()
    or (
      old.owner_id = auth.uid()
      and coalesce(old.state ->> 'emailPlayMode', 'hosted') <> 'direct'
    )
  then
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
end; $$;

drop trigger if exists protect_invited_room_update on public.rooms;
create trigger protect_invited_room_update
  before update on public.rooms
  for each row execute function public.protect_invited_room_update();

drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select using (true);

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

drop policy if exists rooms_delete on public.rooms;
create policy rooms_delete on public.rooms for delete
  using (owner_id = auth.uid() or public.is_admin());

drop policy if exists room_live_read on public.room_live;
create policy room_live_read on public.room_live for select using (true);

-- room_live's write rules must read the parent room's owner + invite columns to
-- decide who may save the live snapshot. That lookup crosses from room_live into
-- public.rooms, so it runs as a normal query in the CALLER's context — and
-- ordinary clients no longer hold SELECT on rooms.invite_email_* (the privacy
-- grant above revokes it). Reading those columns there raises "permission denied
-- for column invite_email_a", which PostgREST surfaces as 403 on the room_live
-- upsert. Wrap the whole decision in a SECURITY DEFINER helper so the policy
-- never touches those columns as the client. (rooms' own policies are fine: they
-- reference invite_email_* as columns of the same table, which RLS allows.)
create or replace function public.can_write_room_live(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room_id
      and (
        (
          r.owner_id = auth.uid()
          and coalesce(r.state ->> 'emailPlayMode', 'hosted') <> 'direct'
        )
        or public.is_admin()
        or public.is_room_player(
          r.invite_user_a_id, r.invite_user_b_id,
          r.invite_email_a, r.invite_email_b
        )
      )
  );
$$;

revoke all on function public.can_write_room_live(uuid) from public;
grant execute on function public.can_write_room_live(uuid) to authenticated;

drop policy if exists room_live_insert on public.room_live;
create policy room_live_insert on public.room_live for insert
  with check (public.can_write_room_live(room_id));

drop policy if exists room_live_update on public.room_live;
create policy room_live_update on public.room_live for update
  using (public.can_write_room_live(room_id))
  with check (public.can_write_room_live(room_id));

do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception
  when duplicate_object then null;
end; $$;

do $$
begin
  alter publication supabase_realtime add table public.room_live;
exception
  when duplicate_object then null;
end; $$;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rooms'
      and column_name in (
        'game_mode', 'invite_user_a_id', 'invite_user_b_id',
        'invite_email_a', 'invite_email_b'
      )
    group by table_schema, table_name
    having count(*) = 5
  ) then
    raise exception 'room creation schema verification failed';
  end if;

  if to_regprocedure('public.list_registered_players()') is null
    or to_regprocedure('public.set_room_ready(uuid,text,boolean)') is null
  then
    raise exception 'room creation RPC verification failed';
  end if;
end; $$;

notify pgrst, 'reload schema';
