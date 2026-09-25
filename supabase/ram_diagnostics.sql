-- Read-only production diagnostics for Supabase SQL Editor.
-- Run each numbered section separately so every result remains visible.

-- 1) Memory-related settings. Do not change these globally without measuring.
select name, setting, unit, source
from pg_settings
where name in (
  'shared_buffers',
  'work_mem',
  'maintenance_work_mem',
  'max_connections',
  'autovacuum_max_workers',
  'wal_buffers'
)
order by name;

-- 2) Connections by client and state. Many idle connections point to pooling
-- or client lifecycle problems; long idle transactions retain dead rows/WAL.
select
  coalesce(application_name, '(unspecified)') as application,
  coalesce(usename, '(unknown)') as database_user,
  coalesce(state, '(none)') as state,
  count(*) as connections
from pg_stat_activity
where datname = current_database()
group by application_name, usename, state
order by connections desc, application;

-- 3) Active queries and transactions older than five seconds.
select
  pid,
  usename,
  application_name,
  state,
  now() - query_start as query_age,
  now() - xact_start as transaction_age,
  wait_event_type,
  wait_event,
  left(query, 240) as query
from pg_stat_activity
where datname = current_database()
  and pid <> pg_backend_pid()
  and (
    (query_start is not null and now() - query_start > interval '5 seconds')
    or (xact_start is not null and now() - xact_start > interval '5 seconds')
  )
order by coalesce(xact_start, query_start);

-- 4) Largest and most churned tables. A high n_dead_tup on rooms/room_live
-- means autovacuum has not caught up with frequent updates.
select
  s.relname as table_name,
  pg_size_pretty(pg_total_relation_size(s.relid)) as total_size,
  s.n_live_tup,
  s.n_dead_tup,
  s.n_tup_ins,
  s.n_tup_upd,
  s.n_tup_del,
  s.last_autovacuum,
  s.autovacuum_count
from pg_stat_user_tables s
order by pg_total_relation_size(s.relid) desc;

-- 5) Replication slots retaining WAL. Inactive slots with growing retained_wal
-- consume disk and can accompany Realtime/replication trouble.
select
  slot_name,
  slot_type,
  active,
  pg_size_pretty(
    greatest(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn), 0)::bigint
  ) as retained_wal
from pg_replication_slots
order by pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) desc nulls last;

-- 6) Queries consuming the most total execution time. Supabase normally has
-- pg_stat_statements enabled in the extensions schema.
select
  calls,
  round(total_exec_time::numeric, 1) as total_ms,
  round(mean_exec_time::numeric, 1) as mean_ms,
  rows,
  left(query, 240) as query
from extensions.pg_stat_statements
order by total_exec_time desc
limit 25;

-- 7) Confirm only hot room tables are in the Realtime publication.
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by schemaname, tablename;
