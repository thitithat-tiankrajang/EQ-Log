-- ============================================================================
-- Invite-by-email migration
-- Adds invite_email_a / invite_email_b columns to public.rooms, and updates
-- the RLS policies so a signed-in user whose email matches one of those
-- columns can play their side (update rooms + room_live).
--
-- Run this file in Supabase → SQL Editor after the base schema.sql.
-- ============================================================================

-- 1) NEW COLUMNS -------------------------------------------------------------
alter table public.rooms
  add column if not exists invite_email_a text,
  add column if not exists invite_email_b text;

update public.rooms
set
  invite_email_a = nullif(lower(btrim(invite_email_a)), ''),
  invite_email_b = nullif(lower(btrim(invite_email_b)), '')
where invite_email_a is not null or invite_email_b is not null;

do $$
begin
  alter table public.rooms
    add constraint rooms_invite_emails_different
    check (
      invite_email_a is null
      or invite_email_b is null
      or lower(invite_email_a) <> lower(invite_email_b)
    );
exception
  when duplicate_object then null;
end $$;

create index if not exists rooms_invite_email_a_idx
  on public.rooms (lower(invite_email_a));
create index if not exists rooms_invite_email_b_idx
  on public.rooms (lower(invite_email_b));

-- 2) HELPER ------------------------------------------------------------------
-- Returns the signed-in user's lowercased email (or null when signed out).
-- Uses profiles so it follows the same source-of-truth as the rest of the app.
create or replace function public.my_email_lower()
returns text language sql stable security definer set search_path = public as $$
  select lower(email) from public.profiles where id = auth.uid()
$$;

create or replace function public.is_room_invitee(
  email_a text,
  email_b text
)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.my_email_lower() is not null
      and (
        lower(email_a) = public.my_email_lower()
        or lower(email_b) = public.my_email_lower()
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
      when 'A' then lower(email_a) = public.my_email_lower()
      when 'B' then lower(email_b) = public.my_email_lower()
      else false
    end,
    false
  )
$$;

-- Invitees may write gameplay state, but cannot take ownership or rewrite the
-- room identity/invite configuration. Owners and admins remain unrestricted.
create or replace function public.protect_invited_room_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.owner_id = auth.uid() or public.is_admin() then
    return new;
  end if;

  if old.status <> 'playing'
    or coalesce(old.state ->> 'status', '') <> 'playing'
    or not public.is_room_invitee_for_active_side(
    old.state,
    old.invite_email_a,
    old.invite_email_b
  ) then
    raise exception 'not invited for the active side' using errcode = '42501';
  end if;

  if new.owner_id is distinct from old.owner_id
    or new.name is distinct from old.name
    or new.player_a is distinct from old.player_a
    or new.player_b is distinct from old.player_b
    or new.member_a_id is distinct from old.member_a_id
    or new.member_b_id is distinct from old.member_b_id
    or new.starting_side is distinct from old.starting_side
    or new.invite_email_a is distinct from old.invite_email_a
    or new.invite_email_b is distinct from old.invite_email_b
    or new.state -> 'gameId' is distinct from old.state -> 'gameId'
    or new.state -> 'name' is distinct from old.state -> 'name'
    or new.state -> 'players' is distinct from old.state -> 'players'
    or new.state -> 'playerMembers' is distinct from old.state -> 'playerMembers'
    or new.state -> 'playerEmails' is distinct from old.state -> 'playerEmails'
    or new.state -> 'startingSide' is distinct from old.state -> 'startingSide'
  then
    raise exception 'invitees cannot change room ownership or configuration'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists protect_invited_room_update on public.rooms;
create trigger protect_invited_room_update
  before update on public.rooms
  for each row execute function public.protect_invited_room_update();

-- 3) RLS POLICIES ------------------------------------------------------------
-- USING checks the old active side. WITH CHECK allows the same commit to hand
-- the turn to the other side; the trigger above keeps protected fields fixed.
drop policy if exists rooms_update on public.rooms;
create policy rooms_update on public.rooms for update
  using (
    owner_id = auth.uid()
    or public.is_admin()
    or public.is_room_invitee_for_active_side(state, invite_email_a, invite_email_b)
  )
  with check (
    owner_id = auth.uid()
    or public.is_admin()
    or public.is_room_invitee(invite_email_a, invite_email_b)
  );

-- Room live (tile placement preview): same access rule as rooms_update.
drop policy if exists room_live_insert on public.room_live;
create policy room_live_insert on public.room_live for insert
  with check (exists (
    select 1 from public.rooms r
    where r.id = room_id
      and (
        r.owner_id = auth.uid()
        or public.is_admin()
        or (r.invite_email_a is not null and lower(r.invite_email_a) = public.my_email_lower())
        or (r.invite_email_b is not null and lower(r.invite_email_b) = public.my_email_lower())
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
        or (r.invite_email_a is not null and lower(r.invite_email_a) = public.my_email_lower())
        or (r.invite_email_b is not null and lower(r.invite_email_b) = public.my_email_lower())
      )
  ))
  with check (exists (
    select 1 from public.rooms r
    where r.id = room_id
      and (
        r.owner_id = auth.uid()
        or public.is_admin()
        or (r.invite_email_a is not null and lower(r.invite_email_a) = public.my_email_lower())
        or (r.invite_email_b is not null and lower(r.invite_email_b) = public.my_email_lower())
      )
  ));

notify pgrst, 'reload schema';
