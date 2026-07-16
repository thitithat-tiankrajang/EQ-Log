-- Solo room summary support. Gameplay rules remain in the durable state JSON;
-- this column keeps lobby cards lightweight and avoids reading every snapshot.

set statement_timeout = '120s';
set lock_timeout = '15s';

alter table public.rooms
  add column if not exists game_mode text;

update public.rooms
set game_mode = case
  when state ->> 'gameMode' = 'solo' then 'solo'
  else 'versus'
end
where game_mode is null;

alter table public.rooms
  alter column game_mode set default 'versus';

do $$
begin
  alter table public.rooms
    add constraint rooms_game_mode_check
    check (game_mode in ('versus', 'solo'));
exception
  when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
