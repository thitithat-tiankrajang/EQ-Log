-- Private, transactionally captured Ranked positions for future completed-game
-- records. Existing matches are deliberately not backfilled: their earlier
-- revisions no longer exist and must never be fabricated.
begin;

create table if not exists public.ranked_private_revisions (
  match_id uuid not null references public.ranked_matches(id) on delete cascade,
  revision bigint not null check (revision >= 0),
  state jsonb not null,
  captured_at timestamptz not null default now(),
  primary key (match_id, revision)
);
alter table public.ranked_private_revisions enable row level security;
revoke all on public.ranked_private_revisions from public, anon, authenticated;
grant select, insert on public.ranked_private_revisions to service_role;

create or replace function public.capture_ranked_private_revision()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.revision <= old.revision then
    raise exception 'ranked revision did not advance' using errcode = '22023';
  end if;
  if new.status in ('playing', 'finished') then
    insert into public.ranked_private_revisions (match_id, revision, state)
      values (new.id, new.revision, new.state);
  end if;
  return new;
end; $$;
revoke all on function public.capture_ranked_private_revision() from public, anon, authenticated;

drop trigger if exists capture_ranked_private_revision on public.ranked_matches;
create trigger capture_ranked_private_revision
  after update of state on public.ranked_matches
  for each row execute function public.capture_ranked_private_revision();

commit;
