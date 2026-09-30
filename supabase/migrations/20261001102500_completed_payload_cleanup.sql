-- Recent is a 20-relation window, so payloads whose last Recent/Saved owner
-- disappears must not accumulate forever. Queue source IDs in the deleting
-- transaction, then clean them after commit without holding participant locks.
begin;

create table public.completed_payload_cleanup_queue (
  source_id uuid primary key,
  queued_at timestamptz not null default now()
);
create index completed_payload_cleanup_queued_idx
  on public.completed_payload_cleanup_queue (queued_at, source_id);
alter table public.completed_payload_cleanup_queue enable row level security;
revoke all on public.completed_payload_cleanup_queue
  from public, anon, authenticated, service_role;

create function public.enqueue_completed_payload_cleanup()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.source_kind = 'normal' then
    insert into public.completed_payload_cleanup_queue (source_id)
      values (old.source_id) on conflict (source_id) do update
        set queued_at = now();
  end if;
  return old;
end $$;
revoke all on function public.enqueue_completed_payload_cleanup()
  from public, anon, authenticated, service_role;
create trigger queue_recent_payload_cleanup after delete on public.recent_game_items
  for each row execute function public.enqueue_completed_payload_cleanup();
create trigger queue_saved_payload_cleanup after delete on public.saved_game_items
  for each row execute function public.enqueue_completed_payload_cleanup();

-- Existing orphans are included once. The worker also handles frozen legacy
-- sources after the last Saved relation is permanently deleted.
insert into public.completed_payload_cleanup_queue (source_id)
select p.source_id from public.recent_game_payloads p
where not exists (select 1 from public.recent_game_items r
    where r.source_kind = p.source_kind and r.source_id = p.source_id)
  and not exists (select 1 from public.saved_game_items s
    where s.source_kind = p.source_kind and s.source_id = p.source_id)
union
select l.source_id from public.saved_legacy_payloads l
where not exists (select 1 from public.recent_game_items r
    where r.source_kind = l.source_kind and r.source_id = l.source_id)
  and not exists (select 1 from public.saved_game_items s
    where s.source_kind = l.source_kind and s.source_id = l.source_id)
on conflict do nothing;

-- Cron runs as the database owner. No browser, authenticated RPC, or service
-- role receives EXECUTE. Per-source locks match Save/Recent source locking;
-- the queued operation runs outside the completion/account transaction.
create function public.process_completed_payload_cleanup(
  p_limit integer default 10000, p_min_age interval default interval '10 minutes'
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare candidate record; processed integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 10000
    or p_min_age is null or p_min_age < interval '0 seconds' then
    raise exception 'invalid completed payload cleanup batch' using errcode = '22023';
  end if;
  for candidate in
    select q.source_id from public.completed_payload_cleanup_queue q
    where q.queued_at <= now() - p_min_age
    order by q.queued_at, q.source_id limit p_limit for update skip locked
  loop
    perform pg_advisory_xact_lock(hashtextextended('eq-payload:' || candidate.source_id::text, 0));
    perform set_config('app.allow_recent_payload_cleanup', '1', true);
    perform set_config('app.allow_saved_legacy_cleanup', '1', true);
    delete from public.recent_game_payloads p
      where p.source_kind = 'normal' and p.source_id = candidate.source_id
        and not exists (select 1 from public.recent_game_items r
          where r.source_kind = p.source_kind and r.source_id = p.source_id)
        and not exists (select 1 from public.saved_game_items s
          where s.source_kind = p.source_kind and s.source_id = p.source_id);
    delete from public.saved_legacy_payloads l
      where l.source_kind = 'normal' and l.source_id = candidate.source_id
        and not exists (select 1 from public.recent_game_items r
          where r.source_kind = l.source_kind and r.source_id = l.source_id)
        and not exists (select 1 from public.saved_game_items s
          where s.source_kind = l.source_kind and s.source_id = l.source_id);
    delete from public.completed_payload_cleanup_queue q
      where q.source_id = candidate.source_id;
    processed := processed + 1;
  end loop;
  return processed;
end $$;
revoke all on function public.process_completed_payload_cleanup(integer, interval)
  from public, anon, authenticated, service_role;

-- Supabase Postgres provides pg_cron. A ten-minute grace interval avoids
-- competing with a terminal retry or an in-flight Save; five-minute batches
-- bound routine orphans without coupling cleanup latency to game completion.
create extension if not exists pg_cron with schema extensions;
select cron.schedule(
  'eq-completed-payload-cleanup', '*/5 * * * *',
  $$select public.process_completed_payload_cleanup(10000, interval '10 minutes')$$
);

commit;
