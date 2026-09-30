-- Disposable local database only. Physical sample includes the real History
-- indexes and keeps replay JSON entirely outside this table.
begin;
create temp table history_size_sample
  (like public.game_history including all) on commit drop;
insert into history_size_sample (
  source_kind, source_id, participant_id, game_id, participant_side,
  game_name, mode_key, game_mode, score_for, completed_at, result_authority
)
select 'normal', id,
  '84000000-0000-4000-8000-000000000001'::uuid, id, 'A',
  'Completed game ' || n, 'solo_practice', 'solo', n,
  '2026-01-01'::timestamptz + n * interval '1 minute', 'client_reported'
from (
  select n, ('84000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid id
  from generate_series(1,1000) n
) sample;
select count(*) as rows, round(avg(pg_column_size(h))) as mean_tuple_bytes,
  pg_relation_size('history_size_sample') as heap_bytes,
  pg_indexes_size('history_size_sample') as index_bytes,
  pg_total_relation_size('history_size_sample') as total_bytes
from history_size_sample h;
rollback;
