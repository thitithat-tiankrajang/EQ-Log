-- Local-only lifecycle metadata measurement. Four fresh physical clones avoid
-- page-reuse distortion. No replay payload is copied by any state transition.
begin;
create temp table saved_free_100 (like public.saved_game_items including all) on commit drop;
create temp table saved_plus_1000 (like public.saved_game_items including all) on commit drop;
create temp table saved_downgrade (like public.saved_game_items including all) on commit drop;
create temp table saved_trash_20 (like public.saved_game_items including all) on commit drop;

insert into saved_free_100 (source_kind,source_id,participant_id,saved_at)
select 'normal',('85000000-0000-4000-9000-' || lpad(n::text,12,'0'))::uuid,
  '85000000-0000-4000-8000-000000000001'::uuid,
  '2026-01-01'::timestamptz + n * interval '1 minute'
from generate_series(1,100) n;
insert into saved_plus_1000 select * from saved_free_100;
insert into saved_plus_1000 (source_kind,source_id,participant_id,saved_at)
select 'normal',('85000000-0000-4000-9000-' || lpad(n::text,12,'0'))::uuid,
  '85000000-0000-4000-8000-000000000001'::uuid,
  '2026-01-01'::timestamptz + n * interval '1 minute'
from generate_series(101,1000) n;
insert into saved_downgrade select * from saved_plus_1000;
update saved_downgrade set state='overflow',state_changed_at=now()
  where saved_at > '2026-01-01 01:40+00'::timestamptz;
insert into saved_trash_20 select * from saved_free_100;
update saved_trash_20 set state='trashed',state_changed_at=now()
  where saved_at <= '2026-01-01 00:20+00'::timestamptz;

select scenario, row_count, active_count, overflow_count, trash_count,
  mean_tuple_bytes, heap_bytes, index_bytes, total_bytes from (
  select 'Free: 100 Active' scenario, count(*) row_count,
    count(*) filter(where state='active') active_count,
    count(*) filter(where state='overflow') overflow_count,
    count(*) filter(where state='trashed') trash_count,
    round(avg(pg_column_size(i))) mean_tuple_bytes,
    pg_relation_size('saved_free_100') heap_bytes,
    pg_indexes_size('saved_free_100') index_bytes,
    pg_total_relation_size('saved_free_100') total_bytes from saved_free_100 i
  union all
  select 'Plus/Pro: 1000 Active',count(*),count(*) filter(where state='active'),
    count(*) filter(where state='overflow'),count(*) filter(where state='trashed'),
    round(avg(pg_column_size(i))),pg_relation_size('saved_plus_1000'),
    pg_indexes_size('saved_plus_1000'),pg_total_relation_size('saved_plus_1000')
    from saved_plus_1000 i
  union all
  select 'Downgrade: 100 Active + 900 Overflow',count(*),
    count(*) filter(where state='active'),count(*) filter(where state='overflow'),
    count(*) filter(where state='trashed'),round(avg(pg_column_size(i))),
    pg_relation_size('saved_downgrade'),pg_indexes_size('saved_downgrade'),
    pg_total_relation_size('saved_downgrade') from saved_downgrade i
  union all
  select 'Trash: 80 Active + 20 Trash',count(*),
    count(*) filter(where state='active'),count(*) filter(where state='overflow'),
    count(*) filter(where state='trashed'),round(avg(pg_column_size(i))),
    pg_relation_size('saved_trash_20'),pg_indexes_size('saved_trash_20'),
    pg_total_relation_size('saved_trash_20') from saved_trash_20 i
) measurements order by row_count,scenario;
rollback;
