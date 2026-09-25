-- Private member directories for existing Supabase projects.
-- Run once in Supabase SQL Editor.

create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  institution text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists members_owner_idx
  on public.members (owner_id, name);

alter table public.members enable row level security;

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

-- Table privileges. RLS above still confines every row to its owner; these
-- grants are what lets the `authenticated` role touch the table at all. Without
-- them the directory fails with "permission denied for table members" on
-- projects that don't hand ALL privileges to authenticated by default (the same
-- reason rooms/profiles needed explicit grants). No anon access — the directory
-- is private.
grant select, insert, update, delete on table public.members to authenticated;

notify pgrst, 'reload schema';
