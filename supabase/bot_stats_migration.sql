-- Bot statistics "folders" (portfolios).
--
-- An admin creates folders and keeps exactly one open at a time. While a folder
-- is open, every finished Play-vs-BOT game (from any approved player) appends an
-- immutable summary row into it, so the admin can decide *when* to route bot
-- play into *which* folder. Aggregates (avg score, win rate, score density) are
-- computed client-side from the raw rows.
--
-- Run this in the Supabase SQL editor after schema.sql.

-- 1) TABLES -------------------------------------------------------------------

create table if not exists public.bot_stat_folders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid references public.profiles(id) on delete set null,
  is_open     boolean not null default false,
  created_at  timestamptz not null default now(),
  opened_at   timestamptz,
  closed_at   timestamptz
);

-- At most one folder may be open at any moment (partial unique index).
create unique index if not exists bot_stat_folders_single_open_idx
  on public.bot_stat_folders (is_open) where is_open;

create table if not exists public.bot_stat_games (
  id               uuid primary key default gen_random_uuid(),
  folder_id        uuid not null references public.bot_stat_folders(id) on delete cascade,
  game_id          text not null,
  room_id          uuid,
  player_name      text not null default 'Player',
  player_member_id text,
  bot_side         text not null check (bot_side in ('A', 'B')),
  bot_difficulty   text,
  bot_score        int  not null default 0,
  opp_score        int  not null default 0,
  outcome          text not null check (outcome in ('bot_win', 'bot_loss', 'draw')),
  turns            int  not null default 0,
  recorded_by      uuid references public.profiles(id) on delete set null,
  finished_at      timestamptz,
  created_at       timestamptz not null default now(),
  -- One row per game per folder: replays / reloads of the same finished game
  -- upsert instead of double-counting.
  unique (folder_id, game_id)
);

create index if not exists bot_stat_games_folder_idx
  on public.bot_stat_games (folder_id, created_at desc);

-- 2) RLS ----------------------------------------------------------------------

alter table public.bot_stat_folders enable row level security;
alter table public.bot_stat_games   enable row level security;

-- Folders: any approved user may READ (a player needs to know a folder exists to
-- record into it); only admins may write. Management still goes through the
-- SECURITY DEFINER helpers below, but these policies keep direct reads working.
drop policy if exists bot_folders_read on public.bot_stat_folders;
create policy bot_folders_read on public.bot_stat_folders
  for select using (public.is_approved());

drop policy if exists bot_folders_admin_write on public.bot_stat_folders;
create policy bot_folders_admin_write on public.bot_stat_folders
  for all using (public.is_admin()) with check (public.is_admin());

-- Games: any approved user may READ and INSERT (they record their own finished
-- games); only admins may modify or delete.
drop policy if exists bot_games_read on public.bot_stat_games;
create policy bot_games_read on public.bot_stat_games
  for select using (public.is_approved());

drop policy if exists bot_games_insert on public.bot_stat_games;
create policy bot_games_insert on public.bot_stat_games
  for insert with check (public.is_approved());

drop policy if exists bot_games_admin_modify on public.bot_stat_games;
create policy bot_games_admin_modify on public.bot_stat_games
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists bot_games_admin_delete on public.bot_stat_games;
create policy bot_games_admin_delete on public.bot_stat_games
  for delete using (public.is_admin());

-- 3) HELPERS ------------------------------------------------------------------

-- The currently open folder's id (or null). Readable by any approved user so the
-- client knows where finished games should go.
create or replace function public.bot_folder_open_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.bot_stat_folders where is_open limit 1
$$;

-- Create a folder (admin). When p_open, it becomes the single open folder.
create or replace function public.create_bot_folder(p_name text, p_open boolean default true)
returns public.bot_stat_folders
language plpgsql security definer set search_path = public as $$
declare
  row public.bot_stat_folders;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_open then
    update public.bot_stat_folders
       set is_open = false, closed_at = now()
     where is_open;
  end if;
  insert into public.bot_stat_folders (name, created_by, is_open, opened_at)
  values (coalesce(nullif(trim(p_name), ''), 'Untitled folder'), auth.uid(),
          p_open, case when p_open then now() else null end)
  returning * into row;
  return row;
end;
$$;

-- Open a folder (admin): closes whatever is open, then opens this one.
create or replace function public.open_bot_folder(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  update public.bot_stat_folders
     set is_open = false, closed_at = now()
   where is_open and id <> p_id;
  update public.bot_stat_folders
     set is_open = true, opened_at = now(), closed_at = null
   where id = p_id;
end;
$$;

-- Close a folder (admin). No-op if it is not the open one.
create or replace function public.close_bot_folder(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  update public.bot_stat_folders
     set is_open = false, closed_at = now()
   where id = p_id and is_open;
end;
$$;

-- Record a finished bot game into the currently open folder. Called by any
-- approved player. The *server* resolves the open folder, so a client can never
-- write into a closed or arbitrary folder. Idempotent per (folder, game_id).
-- Returns the folder id it recorded into, or null when no folder is open.
create or replace function public.record_bot_game(
  p_game_id          text,
  p_room_id          uuid,
  p_player_name      text,
  p_player_member_id text,
  p_bot_side         text,
  p_bot_difficulty   text,
  p_bot_score        int,
  p_opp_score        int,
  p_outcome          text,
  p_turns            int,
  p_finished_at      timestamptz
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  target uuid;
begin
  if not public.is_approved() then
    raise exception 'not approved';
  end if;
  select id into target from public.bot_stat_folders where is_open limit 1;
  if target is null then
    return null;
  end if;
  insert into public.bot_stat_games (
    folder_id, game_id, room_id, player_name, player_member_id,
    bot_side, bot_difficulty, bot_score, opp_score, outcome, turns,
    recorded_by, finished_at
  ) values (
    target, p_game_id, p_room_id,
    coalesce(nullif(trim(p_player_name), ''), 'Player'), p_player_member_id,
    p_bot_side, p_bot_difficulty, coalesce(p_bot_score, 0), coalesce(p_opp_score, 0),
    p_outcome, coalesce(p_turns, 0), auth.uid(), p_finished_at
  )
  on conflict (folder_id, game_id) do update
    set bot_score   = excluded.bot_score,
        opp_score   = excluded.opp_score,
        outcome     = excluded.outcome,
        turns       = excluded.turns,
        finished_at = excluded.finished_at;
  return target;
end;
$$;

grant execute on function public.bot_folder_open_id()            to authenticated;
grant execute on function public.create_bot_folder(text, boolean) to authenticated;
grant execute on function public.open_bot_folder(uuid)           to authenticated;
grant execute on function public.close_bot_folder(uuid)          to authenticated;
grant execute on function public.record_bot_game(
  text, uuid, text, text, text, text, int, int, text, int, timestamptz
) to authenticated;
