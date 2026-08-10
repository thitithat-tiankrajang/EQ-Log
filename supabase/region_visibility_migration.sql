-- Public + Region room visibility.
-- Run this AFTER user_invites_migration.sql. Safe to run more than once.

set statement_timeout = '120s';
set lock_timeout = '15s';

-- 1) Region membership -------------------------------------------------------
create table if not exists public.regions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (btrim(name) <> ''),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists regions_name_unique_idx
  on public.regions (lower(btrim(name)));

alter table public.profiles
  add column if not exists region_id uuid references public.regions(id) on delete set null;

create index if not exists profiles_region_idx on public.profiles (region_id);

-- 2) Immutable room scope ----------------------------------------------------
alter table public.rooms
  add column if not exists visibility text not null default 'public',
  add column if not exists region_id uuid references public.regions(id) on delete restrict;

update public.rooms
set visibility = 'public', region_id = null
where visibility is null
   or visibility not in ('public', 'region')
   or (visibility = 'public' and region_id is not null)
   or (visibility = 'region' and region_id is null);

alter table public.rooms drop constraint if exists rooms_visibility_scope_check;
alter table public.rooms add constraint rooms_visibility_scope_check check (
  (visibility = 'public' and region_id is null)
  or (visibility = 'region' and region_id is not null)
) not valid;

alter table public.rooms validate constraint rooms_visibility_scope_check;

create index if not exists rooms_visibility_updated_idx
  on public.rooms (visibility, updated_at desc);
create index if not exists rooms_region_updated_idx
  on public.rooms (region_id, updated_at desc)
  where visibility = 'region';

-- 3) Narrow helper interfaces ------------------------------------------------
create or replace function public.my_region_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.region_id from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.can_read_room(
  room_visibility text,
  room_region_id uuid
)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    room_visibility = 'public'
    or (
      room_visibility = 'region'
      and auth.uid() is not null
      and exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.region_id = room_region_id
          and (p.status = 'approved' or p.is_admin)
      )
    ),
    false
  )
$$;

revoke all on function public.my_region_id() from public;
grant execute on function public.my_region_id() to authenticated;
revoke all on function public.can_read_room(text, uuid) from public;
grant execute on function public.can_read_room(text, uuid) to anon, authenticated;

-- Profile RPCs expose region context without exposing private profile columns.
drop function if exists public.get_my_profile();
create function public.get_my_profile()
returns table (
  id uuid,
  email text,
  display_name text,
  status text,
  is_admin boolean,
  region_id uuid,
  region_name text,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.display_name, p.status, p.is_admin,
         p.region_id, r.name, p.created_at
  from public.profiles p
  left join public.regions r on r.id = p.region_id
  where p.id = auth.uid()
$$;

revoke all on function public.get_my_profile() from public;
grant execute on function public.get_my_profile() to authenticated;

drop function if exists public.list_profiles_admin();
create function public.list_profiles_admin()
returns table (
  id uuid,
  email text,
  display_name text,
  status text,
  is_admin boolean,
  region_id uuid,
  region_name text,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.display_name, p.status, p.is_admin,
         p.region_id, r.name, p.created_at
  from public.profiles p
  left join public.regions r on r.id = p.region_id
  where public.is_admin()
  order by p.created_at, p.id
$$;

revoke all on function public.list_profiles_admin() from public;
grant execute on function public.list_profiles_admin() to authenticated;

create or replace function public.list_regions_admin()
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select r.id, r.name
  from public.regions r
  where public.is_admin()
  order by lower(r.name), r.id
$$;

revoke all on function public.list_regions_admin() from public;
grant execute on function public.list_regions_admin() to authenticated;

create or replace function public.update_profile_admin(
  target_profile_id uuid,
  next_status text,
  next_is_admin boolean,
  next_region_id uuid
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if next_status not in ('pending', 'approved', 'blocked') then
    raise exception 'invalid profile status' using errcode = '22023';
  end if;
  if next_region_id is not null
    and not exists (select 1 from public.regions where id = next_region_id)
  then
    raise exception 'region not found' using errcode = 'P0002';
  end if;

  update public.profiles
  set status = next_status,
      is_admin = next_is_admin,
      region_id = next_region_id
  where id = target_profile_id;
end; $$;

revoke all on function public.update_profile_admin(uuid, text, boolean, uuid) from public;
grant execute on function public.update_profile_admin(uuid, text, boolean, uuid) to authenticated;

-- Region room creators can only select registered players from their own region.
drop function if exists public.list_registered_players();
drop function if exists public.list_registered_players(text);
create function public.list_registered_players(target_visibility text default 'public')
returns table (id uuid, username text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name
  from public.profiles p
  where auth.uid() is not null
    and target_visibility in ('public', 'region')
    and p.display_name is not null
    and btrim(p.display_name) <> ''
    and (p.status = 'approved' or p.is_admin)
    and (
      target_visibility = 'public'
      or (public.my_region_id() is not null and p.region_id = public.my_region_id())
    )
  order by lower(p.display_name), p.id
$$;

revoke all on function public.list_registered_players(text) from public;
grant execute on function public.list_registered_players(text) to authenticated;

-- Ordinary users may update only their display name. Admin-only fields are
-- changed through update_profile_admin(), so users cannot self-assign regions
-- or promote/approve themselves through the REST endpoint.
revoke insert, update on table public.profiles from authenticated;
grant insert (id, email, display_name) on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;

-- 4) Region table RLS --------------------------------------------------------
alter table public.regions enable row level security;

drop policy if exists regions_read on public.regions;
create policy regions_read on public.regions for select using (
  public.is_admin() or id = public.my_region_id()
);

drop policy if exists regions_insert_admin on public.regions;
create policy regions_insert_admin on public.regions for insert
  with check (public.is_admin());

drop policy if exists regions_update_admin on public.regions;
create policy regions_update_admin on public.regions for update
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists regions_delete_admin on public.regions;
create policy regions_delete_admin on public.regions for delete
  using (public.is_admin());

revoke all on table public.regions from anon, authenticated;
grant select, insert, update, delete on table public.regions to authenticated;

-- Keep a room's privacy scope stable for its lifetime. Duplicating a room is the
-- explicit path for creating the same game in another scope.
create or replace function public.protect_room_scope_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.visibility is distinct from old.visibility
    or new.region_id is distinct from old.region_id
  then
    raise exception 'room visibility cannot be changed after creation'
      using errcode = '42501';
  end if;
  return new;
end; $$;

drop trigger if exists protect_room_scope_update on public.rooms;
create trigger protect_room_scope_update
  before update on public.rooms
  for each row execute function public.protect_room_scope_update();

-- 5) Room RLS ---------------------------------------------------------------
revoke select on table public.rooms from anon, authenticated;
grant select (
  id, owner_id, name, player_a, player_b, status, turn_number, score_a, score_b,
  lifecycle_status, game_mode, member_a_id, member_b_id, starting_side,
  invite_user_a_id, invite_user_b_id, state, created_at, updated_at,
  visibility, region_id
) on table public.rooms to anon, authenticated;
grant insert, update, delete on table public.rooms to authenticated;

drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select using (
  public.can_read_room(visibility, region_id)
);

drop policy if exists rooms_insert on public.rooms;
create policy rooms_insert on public.rooms for insert
  with check (
    owner_id = auth.uid()
    and (public.is_approved() or public.is_admin())
    and public.can_read_room(visibility, region_id)
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
    public.can_read_room(visibility, region_id)
    and (
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
  )
  with check (
    public.can_read_room(visibility, region_id)
    and (
      owner_id = auth.uid()
      or public.is_admin()
      or public.is_room_player(
        invite_user_a_id, invite_user_b_id, invite_email_a, invite_email_b
      )
    )
  );

drop policy if exists rooms_delete on public.rooms;
create policy rooms_delete on public.rooms for delete using (
  public.can_read_room(visibility, region_id)
  and (owner_id = auth.uid() or public.is_admin())
);

-- 6) Realtime rows inherit the parent room's visibility ---------------------
create or replace function public.can_read_room_live(p_room_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room_id
      and public.can_read_room(r.visibility, r.region_id)
  )
$$;

revoke all on function public.can_read_room_live(uuid) from public;
grant execute on function public.can_read_room_live(uuid) to anon, authenticated;

drop policy if exists room_live_read on public.room_live;
create policy room_live_read on public.room_live for select
  using (public.can_read_room_live(room_id));

create or replace function public.can_write_room_live(p_room_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room_id
      and public.can_read_room(r.visibility, r.region_id)
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
  )
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

-- set_room_ready is SECURITY DEFINER, so it must repeat the visibility check.
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

  if not found
    or not public.can_read_room(target_room.visibility, target_room.region_id)
    or target_room.state ->> 'roomStage' <> 'waiting'
  then
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

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rooms'
      and column_name in ('visibility', 'region_id')
    group by table_schema, table_name
    having count(*) = 2
  ) then
    raise exception 'room scope schema verification failed';
  end if;
end; $$;

notify pgrst, 'reload schema';
