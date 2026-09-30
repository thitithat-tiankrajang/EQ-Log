-- Isolated local database only. A fresh physical clone avoids page reuse.
begin;
create temp table saved_size_sample
  (like public.saved_game_items including all) on commit drop;
insert into saved_size_sample (source_kind, source_id, participant_id, saved_at)
select 'normal',
  ('84000000-0000-4000-9000-' || lpad(n::text,12,'0'))::uuid,
  '84000000-0000-4000-8000-000000000001'::uuid,
  '2026-01-01'::timestamptz + n * interval '1 minute'
from generate_series(1,1000) n;
select count(*) as rows,
  round(avg(pg_column_size(i))) as mean_tuple_bytes,
  pg_relation_size('saved_size_sample') as heap_bytes,
  pg_indexes_size('saved_size_sample') as index_bytes,
  pg_total_relation_size('saved_size_sample') as total_bytes
from saved_size_sample i;
rollback;
