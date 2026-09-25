-- Fast owner/spectator sync for existing projects.
-- Separates tiny live drafts from large durable room snapshots and adds
-- lightweight lobby summary columns. Safe to run more than once.

set statement_timeout = '120s';
set lock_timeout = '15s';

alter table public.rooms
  add column if not exists lifecycle_status text,
  add column if not exists member_a_id text,
  add column if not exists member_b_id text,
  add column if not exists starting_side text;

update public.rooms
set
  lifecycle_status = coalesce(state ->> 'status', status),
  member_a_id = state -> 'playerMembers' ->> 'A',
  member_b_id = state -> 'playerMembers' ->> 'B',
  starting_side = coalesce(state ->> 'startingSide', state ->> 'activeSide')
where
  lifecycle_status is null
  or starting_side is null;

create table if not exists public.room_live (
  room_id     uuid primary key references public.rooms(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  session     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.room_live enable row level security;

drop policy if exists room_live_read on public.room_live;
create policy room_live_read on public.room_live for select using (true);

drop policy if exists room_live_insert on public.room_live;
create policy room_live_insert on public.room_live for insert
  with check (exists (
    select 1 from public.rooms r
    where r.id = room_id
      and (r.owner_id = auth.uid() or public.is_admin())
  ));

drop policy if exists room_live_update on public.room_live;
create policy room_live_update on public.room_live for update
  using (exists (
    select 1 from public.rooms r
    where r.id = room_id
      and (r.owner_id = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.rooms r
    where r.id = room_id
      and (r.owner_id = auth.uid() or public.is_admin())
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

analyze public.rooms;
analyze public.room_live;
notify pgrst, 'reload schema';
