-- Drafted Survival positions are visible only to administrators. Approved
-- positions may be read by members; game attempts remain ordinary bot rooms
-- until the server owns the full ranked command reducer.
create table if not exists public.survival_levels (
  id uuid primary key default gen_random_uuid(),
  season_key text not null,
  level_no int not null check (level_no between 1 and 100),
  seed int not null check (seed >= 0),
  reference_key text not null default 'endgame-v1',
  sample_policy text not null,
  sample_count int not null check (sample_count > 0),
  win_count int not null check (win_count between 0 and sample_count),
  immediate_winning_moves int not null default -1 check (immediate_winning_moves >= -1),
  shortest_winning_replay_turns int not null default 0 check (shortest_winning_replay_turns >= 0),
  bot_latency_ms jsonb not null default '{}'::jsonb,
  winning_replays jsonb not null default '[]'::jsonb
    check (jsonb_typeof(winning_replays) = 'array'),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  admin_note text not null default '',
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_key, level_no),
  constraint survival_approval_requires_evidence check (
    status = 'draft' or
    (jsonb_array_length(winning_replays) >= 3 and
     immediate_winning_moves = 0 and
     shortest_winning_replay_turns >= 5 and
     length(btrim(admin_note)) > 0 and
     approved_by is not null and approved_at is not null)
  )
);

alter table public.survival_levels enable row level security;

create policy survival_read on public.survival_levels for select to authenticated
  using (status = 'approved' or public.is_admin());
create policy survival_admin_insert on public.survival_levels for insert to authenticated
  with check (public.is_admin());
create policy survival_admin_update on public.survival_levels for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update on public.survival_levels to authenticated;

-- Practice telemetry is user reported. It helps recalibrate stage selection,
-- but cannot be used for official ranking until the server owns game results.
create table if not exists public.survival_attempts (
  id uuid primary key default gen_random_uuid(),
  level_id uuid not null references public.survival_levels(id),
  room_id uuid not null unique,
  player_id uuid not null references auth.users(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  player_score int check (player_score >= 0),
  authur_score int check (authur_score >= 0),
  result text check (result in ('win', 'loss', 'tie')),
  constraint survival_attempt_result_complete check (
    (finished_at is null and player_score is null and authur_score is null and result is null)
    or (finished_at is not null and player_score is not null and authur_score is not null and result is not null)
  )
);
alter table public.survival_attempts enable row level security;
create policy survival_attempt_read on public.survival_attempts for select to authenticated
  using (player_id = auth.uid() or public.is_admin());
create policy survival_attempt_insert on public.survival_attempts for insert to authenticated
  with check (player_id = auth.uid() and exists (
    select 1 from public.survival_levels l
      join public.room_live r on r.room_id = survival_attempts.room_id
    where l.id = level_id and r.owner_id = auth.uid()
      and r.mode_key = 'authur_strong'
      and r.name = ('Survival test · seed ' || l.seed::text)
      and (l.status = 'approved' or public.is_admin())
  ));
create policy survival_attempt_update on public.survival_attempts for update to authenticated
  using (player_id = auth.uid() and finished_at is null)
  with check (player_id = auth.uid());
grant select, insert on public.survival_attempts to authenticated;
grant update (finished_at, player_score, authur_score, result)
  on public.survival_attempts to authenticated;

-- Historical Aether rooms remain readable and can finish. No new room may
-- select the retired opponent, including clients that have not refreshed yet.
create or replace function public.reject_new_aether_room()
returns trigger language plpgsql set search_path = public as $$
begin
  if left(new.mode_key, 7) = 'aether_' then
    if tg_op = 'INSERT' then
      raise exception 'Aether is retired; create an Authur room.' using errcode = '22023';
    end if;
    if old.mode_key is distinct from new.mode_key then
      raise exception 'Aether is retired; create an Authur room.' using errcode = '22023';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists reject_new_aether_room on public.room_live;
create trigger reject_new_aether_room before insert or update of mode_key on public.room_live
  for each row execute function public.reject_new_aether_room();
