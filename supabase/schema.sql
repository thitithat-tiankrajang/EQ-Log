-- ============================================================================
-- A-math Lab Board — Supabase schema (profiles + rooms) with Row-Level Security
-- Run this whole file in Supabase → SQL Editor (after creating the project).
-- ============================================================================

-- 1) PROFILES ----------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text unique,
  status       text not null default 'pending'
                 check (status in ('pending', 'approved', 'blocked')),
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Auto-create a profile row whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) MEMBERS (private directory owned by the signed-in creator) -------------
create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  institution text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists members_owner_idx on public.members (owner_id, name);

-- 3) ROOMS (one row per saved game; `state` = compact GameState blob) ---------
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references public.profiles(id) on delete set null,
  name        text not null,
  player_a    text not null default 'A',
  player_b    text not null default 'B',
  status      text not null default 'playing'
                check (status in ('playing', 'draft', 'finished')),
  turn_number int  not null default 1,
  score_a     int  not null default 0,
  score_b     int  not null default 0,
  lifecycle_status text,
  game_mode text check (game_mode is null or game_mode in ('versus', 'solo')),
  member_a_id text,
  member_b_id text,
  starting_side text check (starting_side in ('A', 'B')),
  invite_user_a_id uuid references public.profiles(id) on delete set null,
  invite_user_b_id uuid references public.profiles(id) on delete set null,
  invite_email_a text,
  invite_email_b text,
  constraint rooms_invite_emails_different check (
    invite_email_a is null
    or invite_email_b is null
    or lower(invite_email_a) <> lower(invite_email_b)
  ),
  constraint rooms_invite_users_different check (
    invite_user_a_id is null
    or invite_user_b_id is null
    or invite_user_a_id <> invite_user_b_id
  ),
  state       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists rooms_updated_idx on public.rooms (updated_at desc);
create index if not exists rooms_owner_idx on public.rooms (owner_id);
create index if not exists rooms_invite_user_a_idx on public.rooms (invite_user_a_id);
create index if not exists rooms_invite_user_b_idx on public.rooms (invite_user_b_id);
create index if not exists rooms_invite_email_a_idx on public.rooms (lower(invite_email_a));
create index if not exists rooms_invite_email_b_idx on public.rooms (lower(invite_email_b));

-- Small, high-frequency live state is isolated from the large durable game
-- snapshot so tile placement updates never rewrite or broadcast rooms.state.
create table if not exists public.room_live (
  room_id     uuid primary key references public.rooms(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  session     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- 4) HELPERS -----------------------------------------------------------------
create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and status = 'approved')
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and is_admin)
$$;

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
end; $$;

drop trigger if exists protect_invited_room_update on public.rooms;
create trigger protect_invited_room_update
  before update on public.rooms
  for each row execute function public.protect_invited_room_update();

-- 5) ROW-LEVEL SECURITY ------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.members  enable row level security;
alter table public.rooms    enable row level security;
alter table public.room_live enable row level security;

-- profiles: anyone may read display names; you edit your own; admins edit anyone.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or public.is_admin());

-- members: each account has a private directory. Even admins only use members
-- they created themselves when creating a room.
drop policy if exists members_select_own on public.members;
create policy members_select_own on public.members for select
  using (owner_id = auth.uid());

drop policy if exists members_insert_own on public.members;
create policy members_insert_own on public.members for insert
  with check (
    owner_id = auth.uid()
    and (public.is_approved() or public.is_admin())
  );

drop policy if exists members_update_own on public.members;
create policy members_update_own on public.members for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists members_delete_own on public.members;
create policy members_delete_own on public.members for delete
  using (owner_id = auth.uid());

-- rooms:
--   • Every room is readable by everyone from the moment it is created.
--   • Only an APPROVED user can create a room (as its owner).
--   • Owners and admins can update/delete (play, end, resume, rename…).
drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select using (true);

drop policy if exists rooms_insert on public.rooms;
create policy rooms_insert on public.rooms for insert
  with check (owner_id = auth.uid() and (public.is_approved() or public.is_admin()));

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

drop policy if exists rooms_delete on public.rooms;
create policy rooms_delete on public.rooms for delete
  using (owner_id = auth.uid() or public.is_admin());

drop policy if exists room_live_read on public.room_live;
create policy room_live_read on public.room_live for select using (true);

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

-- Enable Supabase Realtime for the live room row.
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

notify pgrst, 'reload schema';

-- UUID player assignments, readiness RPCs, privacy-safe profile grants, and
-- their RLS policies live in the idempotent follow-up migration. Run it after
-- this base schema and whenever upgrading an existing project:
--   supabase/user_invites_migration.sql
--
-- Production archive/live architecture (run last; replaces rooms):
--   supabase/region_visibility_migration.sql
--   supabase/game_archives_migration.sql

-- ============================================================================
-- After running this, make yourself admin + approved (replace the email):
--   update public.profiles set is_admin = true, status = 'approved'
--   where email = 'you@gmail.com';
-- Approve another player:
--   update public.profiles set status = 'approved' where email = 'them@gmail.com';
-- ============================================================================
