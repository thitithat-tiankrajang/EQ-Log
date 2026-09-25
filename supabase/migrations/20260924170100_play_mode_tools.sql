-- Run after authur_bot_migration.sql and multiverse_timeline_migration.sql.
-- A mode identifies gameplay rules elsewhere; this catalog owns which Play tools
-- its viewers can open. Existing rooms keep their current tool set.
begin;

create table if not exists public.game_modes (
  id uuid primary key default gen_random_uuid(),
  mode_key text not null unique check (mode_key ~ '^[a-z][a-z0-9_]*$'),
  label text not null check (btrim(label) <> '')
);

create table if not exists public.game_tools (
  id uuid primary key default gen_random_uuid(),
  tool_key text not null unique check (tool_key ~ '^[a-z][a-z0-9_]*$'),
  label text not null check (btrim(label) <> '')
);

create table if not exists public.game_mode_tools (
  mode_id uuid not null references public.game_modes(id) on delete cascade,
  tool_id uuid not null references public.game_tools(id) on delete cascade,
  primary key (mode_id, tool_id)
);

insert into public.game_modes (mode_key, label) values
  ('local_versus', 'Pass & Play'),
  ('hosted_versus', 'Hosted Match'),
  ('online_versus', 'Online Match'),
  ('solo_practice', 'Solo Practice'),
  ('aether_easy', 'Aether Easy'),
  ('aether_medium', 'Aether Medium'),
  ('aether_hard', 'Aether Hard'),
  ('aether_max', 'Aether Max'),
  ('aether_super', 'Aether Super'),
  ('authur_strong', 'Authur')
on conflict (mode_key) do nothing;

-- Old archived/custom keys remain readable after the catalog is installed.
insert into public.game_modes (mode_key, label)
select distinct mode_key, mode_key from public.room_live
where mode_key ~ '^[a-z][a-z0-9_]*$'
on conflict (mode_key) do nothing;

insert into public.game_tools (tool_key, label) values
  ('turn_log', 'Turn history'),
  ('replay', 'Replay'),
  ('analysis', 'Move help'),
  ('multiverse', 'Alternate lines'),
  ('bot_insight', 'Bot explanation')
on conflict (tool_key) do nothing;

insert into public.game_mode_tools (mode_id, tool_id)
select m.id, t.id from public.game_modes m cross join public.game_tools t
where m.mode_key in (
    'local_versus', 'hosted_versus', 'online_versus', 'solo_practice',
    'aether_easy', 'aether_medium', 'aether_hard', 'aether_max',
    'aether_super', 'authur_strong'
  )
  and (t.tool_key <> 'multiverse' or m.mode_key not in ('online_versus', 'solo_practice'))
  and (t.tool_key <> 'bot_insight' or m.mode_key like 'aether_%' or m.mode_key = 'authur_strong')
on conflict do nothing;

alter table public.game_modes enable row level security;
alter table public.game_tools enable row level security;
alter table public.game_mode_tools enable row level security;
revoke all on public.game_modes, public.game_tools, public.game_mode_tools from anon, authenticated;

-- The browser only needs a small, read-only list for the current mode.
create or replace function public.get_game_mode_tools(target_mode_key text)
returns table (tool_key text)
language sql stable security definer set search_path = public as $$
  select t.tool_key
  from public.game_modes m
  join public.game_mode_tools mt on mt.mode_id = m.id
  join public.game_tools t on t.id = mt.tool_id
  where m.mode_key = target_mode_key
  order by t.tool_key
$$;
revoke all on function public.get_game_mode_tools(text) from public, anon, authenticated;
grant execute on function public.get_game_mode_tools(text) to authenticated;

-- The timeline RPCs both write this table. Checking at the write makes a hidden
-- button a real rule: a caller cannot restore/prune an alternate line by RPC.
create or replace function public.guard_game_timeline_tool()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.room_live l
    join public.game_modes m on m.mode_key = l.mode_key
    join public.game_mode_tools mt on mt.mode_id = m.id
    join public.game_tools t on t.id = mt.tool_id and t.tool_key = 'multiverse'
    where l.room_id = new.game_id
  ) then
    raise exception 'alternate lines are unavailable in this mode' using errcode = '42501';
  end if;
  return new;
end; $$;

drop trigger if exists game_timeline_tool_guard on public.game_timelines;
create trigger game_timeline_tool_guard
  before insert or update on public.game_timelines
  for each row execute function public.guard_game_timeline_tool();
revoke all on function public.guard_game_timeline_tool() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
