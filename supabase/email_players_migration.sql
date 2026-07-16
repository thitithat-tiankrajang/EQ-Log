-- Hosted two-side, hosted solo, and direct two-email rooms.
-- Direct creators are one player; hosted creators are separate from every
-- invited player. Local rooms store no player emails. Safe to run more than once.

set statement_timeout = '120s';
set lock_timeout = '15s';

alter table public.rooms
  add column if not exists invite_email_a text,
  add column if not exists invite_email_b text;

create table if not exists public.room_live (
  room_id     uuid primary key references public.rooms(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  session     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.room_live enable row level security;

create or replace function public.my_email_lower()
returns text language sql stable security definer set search_path = public as $$
  select lower(email) from public.profiles where id = auth.uid()
$$;

create or replace function public.is_room_invitee(email_a text, email_b text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.my_email_lower() is not null
      and (
        lower(btrim(email_a)) = public.my_email_lower()
        or lower(btrim(email_b)) = public.my_email_lower()
      ),
    false
  )
$$;

create or replace function public.is_room_invitee_for_active_side(
  room_state jsonb,
  email_a text,
  email_b text
)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    case room_state ->> 'activeSide'
      when 'A' then lower(btrim(email_a)) = public.my_email_lower()
      when 'B' then lower(btrim(email_b)) = public.my_email_lower()
      else false
    end,
    false
  )
$$;

-- Atomic waiting-room readiness update. The row lock prevents Side A and
-- Side B from overwriting each other when they press Ready at the same time.
create or replace function public.set_room_ready(
  target_room_id uuid,
  target_side text,
  target_ready boolean
)
returns void language plpgsql security definer set search_path = public as $$
declare
  target_room public.rooms%rowtype;
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

  target_email := case target_side
    when 'A' then target_room.invite_email_a
    else target_room.invite_email_b
  end;
  if target_email is null
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

-- A non-owner player may commit only the side currently stored in the durable
-- game state and cannot rewrite room identity or player assignments.
create or replace function public.protect_invited_room_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.owner_id = auth.uid() or public.is_admin() then
    return new;
  end if;

  if old.state ->> 'roomStage' = 'waiting' then
    if not public.is_room_invitee(old.invite_email_a, old.invite_email_b) then
      raise exception 'not assigned to this waiting room' using errcode = '42501';
    end if;
    if new.owner_id is distinct from old.owner_id
      or new.name is distinct from old.name
      or new.player_a is distinct from old.player_a
      or new.player_b is distinct from old.player_b
      or new.invite_email_a is distinct from old.invite_email_a
      or new.invite_email_b is distinct from old.invite_email_b
      or (new.state - 'lobbyReadyBySide')
        is distinct from (old.state - 'lobbyReadyBySide')
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
    or not public.is_room_invitee_for_active_side(
      old.state,
      old.invite_email_a,
      old.invite_email_b
    ) then
    raise exception 'not assigned to the active side' using errcode = '42501';
  end if;

  if new.owner_id is distinct from old.owner_id
    or new.name is distinct from old.name
    or new.player_a is distinct from old.player_a
    or new.player_b is distinct from old.player_b
    or new.invite_email_a is distinct from old.invite_email_a
    or new.invite_email_b is distinct from old.invite_email_b
    or new.state -> 'gameId' is distinct from old.state -> 'gameId'
    or new.state -> 'name' is distinct from old.state -> 'name'
    or new.state -> 'players' is distinct from old.state -> 'players'
    or new.state -> 'playerMembers' is distinct from old.state -> 'playerMembers'
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
        invite_email_a is null
        and invite_email_b is null
      )
      or (
        state ->> 'gameMode' = 'solo'
        and coalesce(state ->> 'emailPlayMode', 'hosted') = 'hosted'
        and invite_email_a is not null
        and invite_email_b is null
        and not public.is_room_invitee(invite_email_a, invite_email_b)
      )
      or (
        coalesce(state ->> 'gameMode', 'versus') = 'versus'
        and
        invite_email_a is not null
        and invite_email_b is not null
        and lower(btrim(invite_email_a)) <> lower(btrim(invite_email_b))
        and (
          (
            state ->> 'emailPlayMode' = 'direct'
            and state ->> 'tileDrawMode' = 'play'
            and public.is_room_invitee(invite_email_a, invite_email_b)
          )
          or (
            coalesce(state ->> 'emailPlayMode', 'hosted') = 'hosted'
            and not public.is_room_invitee(invite_email_a, invite_email_b)
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
      and public.is_room_invitee(invite_email_a, invite_email_b)
    )
    or public.is_room_invitee_for_active_side(state, invite_email_a, invite_email_b)
  )
  with check (
    owner_id = auth.uid()
    or public.is_admin()
    or public.is_room_invitee(invite_email_a, invite_email_b)
  );

drop policy if exists room_live_insert on public.room_live;
create policy room_live_insert on public.room_live for insert
  with check (exists (
    select 1 from public.rooms r
    where r.id = room_id
      and (
        r.owner_id = auth.uid()
        or public.is_admin()
        or public.is_room_invitee(r.invite_email_a, r.invite_email_b)
      )
  ));

drop policy if exists room_live_read on public.room_live;
create policy room_live_read on public.room_live for select using (true);

drop policy if exists room_live_update on public.room_live;
create policy room_live_update on public.room_live for update
  using (exists (
    select 1 from public.rooms r
    where r.id = room_id
      and (
        r.owner_id = auth.uid()
        or public.is_admin()
        or public.is_room_invitee(r.invite_email_a, r.invite_email_b)
      )
  ))
  with check (exists (
    select 1 from public.rooms r
    where r.id = room_id
      and (
        r.owner_id = auth.uid()
        or public.is_admin()
        or public.is_room_invitee(r.invite_email_a, r.invite_email_b)
      )
  ));

do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.room_live;
exception
  when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
