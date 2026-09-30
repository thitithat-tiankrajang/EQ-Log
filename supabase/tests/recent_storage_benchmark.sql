-- Isolated local database only. A fresh physical clone avoids page reuse from
-- earlier rolled-back tests. It has the same columns, PK and page index.
begin;
create temp table recent_size_sample
  (like public.recent_game_items including all) on commit drop;
insert into recent_size_sample (
  source_kind, source_id, participant_id, completed_at
)
select 'normal',
  ('83000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid,
  '83000000-0000-4000-8000-000000000001'::uuid,
  '2026-01-01'::timestamptz + n * interval '1 minute'
from generate_series(1,2000) n;
select count(*) as rows,
  round(avg(pg_column_size(i))) as mean_tuple_bytes,
  pg_relation_size('recent_size_sample') as heap_bytes,
  pg_indexes_size('recent_size_sample') as index_bytes,
  pg_total_relation_size('recent_size_sample') as total_bytes
from recent_size_sample i;
rollback;
