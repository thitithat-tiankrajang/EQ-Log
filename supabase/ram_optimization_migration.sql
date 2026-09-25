-- Reduce variable database and Realtime memory on small Supabase compute.
-- Safe to run repeatedly after realtime_performance_migration.sql.

set statement_timeout = '120s';
set lock_timeout = '15s';

-- Members are private to their creator and the client refreshes them on load.
-- The legacy room_sessions journal is no longer used. Keeping either table in
-- the publication makes Realtime decode and authorize changes unnecessarily.
do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'members'
  ) then
    execute 'alter publication supabase_realtime drop table public.members';
  end if;

  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_sessions'
  ) then
    execute 'alter publication supabase_realtime drop table public.room_sessions';
  end if;
end $$;

-- These small tables are updated repeatedly. Lower thresholds prevent dead
-- rows from accumulating for too long on databases with very few live rows.
alter table public.rooms set (
  fillfactor = 90,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 10,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 10
);

alter table public.room_live set (
  fillfactor = 70,
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_threshold = 10,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_analyze_threshold = 10
);

analyze public.rooms;
analyze public.room_live;

notify pgrst, 'reload schema';
