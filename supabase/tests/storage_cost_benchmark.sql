-- Milestone 12 physical accounting. Run only on the disposable local database
-- after the Milestone 11 legal corpus has populated its four normal records.
-- All measured relations are temporary and disappear when psql exits. The
-- payload clone repeats intact legal JSONB values under synthetic row keys;
-- it is a storage sample, never a replay or decoder fixture.
\set ON_ERROR_STOP on

create temp table storage_archetypes as
select distinct on (jsonb_array_length(record -> 'events'))
  jsonb_array_length(record -> 'events') as event_count, record, record_digest
from public.recent_game_payloads
where jsonb_array_length(record -> 'events') in (4, 39, 41, 61)
  and record #>> '{provenance,mode}' = 'standard'
order by jsonb_array_length(record -> 'events'), pg_column_size(record) desc;
do $$ begin
  if (select count(*) from storage_archetypes) <> 4 then
    raise exception 'Milestone 11 legal corpus is required';
  end if;
end $$;

create temp table storage_payload (like public.recent_game_payloads including defaults including indexes);
insert into storage_payload (source_kind, source_id, game_id, record_digest, record)
select 'normal', synthetic.id, synthetic.id, a.record_digest, a.record
from generate_series(1, 1000) n
cross join lateral (
  select ('86000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid id
) synthetic
join storage_archetypes a on a.event_count = case
  when n <= 600 then 41 when n <= 900 then 61 else 39 end;
vacuum (analyze) storage_payload;

create temp table storage_history (like public.game_history including all);
insert into storage_history (
  source_kind, source_id, participant_id, game_id, participant_side,
  game_name, mode_key, game_mode, score_for, completed_at, result_authority
)
select 'normal', id, '86000000-0000-4000-8000-000000000001'::uuid,
  id, 'A', 'Completed game ' || n, 'friend', 'versus', n,
  '2026-01-01'::timestamptz + n * interval '1 minute', 'client_reported'
from (
  select n, ('86000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid id
  from generate_series(1, 10000) n
) games;
vacuum (analyze) storage_history;

create temp table storage_recent (like public.recent_game_items including all);
insert into storage_recent (source_kind, source_id, participant_id, completed_at)
select 'normal', ('87000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid,
  ('87000000-0000-4000-8000-' || lpad(((n - 1) / 20 + 1)::text, 12, '0'))::uuid,
  '2026-01-01'::timestamptz + n * interval '1 minute'
from generate_series(1, 2000) n;
vacuum (analyze) storage_recent;

create temp table storage_saved (like public.saved_game_items including all);
insert into storage_saved (source_kind, source_id, participant_id, saved_at)
select 'normal', ('88000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid,
  '88000000-0000-4000-8000-000000000001'::uuid,
  '2026-01-01'::timestamptz + n * interval '1 minute'
from generate_series(1, 1000) n;
vacuum (analyze) storage_saved;

create temp table storage_overflow (like public.saved_game_items including all);
insert into storage_overflow (source_kind, source_id, participant_id, saved_at, state)
select 'normal', ('8e000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid,
  '8e000000-0000-4000-8000-000000000001'::uuid,
  '2026-01-01'::timestamptz + n * interval '1 minute',
  case when n <= 100 then 'active' else 'overflow' end
from generate_series(1, 1000) n;
vacuum (analyze) storage_overflow;

create temp table storage_trash (like public.saved_game_items including all);
insert into storage_trash (source_kind, source_id, participant_id, saved_at, state)
select 'normal', ('8f000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid,
  '8f000000-0000-4000-8000-000000000001'::uuid,
  '2026-01-01'::timestamptz + n * interval '1 minute',
  case when n <= 100 then 'active' else 'trashed' end
from generate_series(1, 120) n;
vacuum (analyze) storage_trash;

create temp table storage_ledger (like public.saved_legacy_migration_ledger including all);
insert into storage_ledger (legacy_item_id, owner_id, source_id, outcome)
select ('89000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid,
  '89000000-0000-4000-8000-000000000001'::uuid,
  ('89000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid, 'active'
from generate_series(1, 1000) n;
vacuum (analyze) storage_ledger;

create temp table storage_cleanup_queue
  (like public.completed_payload_cleanup_queue including all);
insert into storage_cleanup_queue (source_id, queued_at)
select ('8c000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid,
  '2026-01-01'::timestamptz + n * interval '1 minute'
from generate_series(1, 1000) n;
vacuum (analyze) storage_cleanup_queue;

create temp table storage_legacy (like public.saved_legacy_payloads including defaults including indexes);
insert into storage_legacy (source_kind, source_id, game_id, snapshot)
select 'normal', id, id, archived.snapshot
from generate_series(1, 100) n
cross join lateral (
  select ('8a000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid id
) ids
cross join (
  select snapshot from public.private_library_items
  where pg_column_size(snapshot) between 119000 and 121000 limit 1
) archived;
do $$ begin
  if (select count(*) from storage_legacy) <> 100 then
    raise exception 'Milestone 11 legacy 40-action snapshot is required';
  end if;
end $$;
vacuum (analyze) storage_legacy;

create temp table storage_legacy_60
  (like public.saved_legacy_payloads including defaults including indexes);
insert into storage_legacy_60 (source_kind, source_id, game_id, snapshot)
select 'normal', id, id, archived.snapshot
from generate_series(1, 100) n
cross join lateral (
  select ('8d000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid id
) ids
cross join (
  select snapshot from public.private_library_items
  where pg_column_size(snapshot) between 230000 and 235000 limit 1
) archived;
do $$ begin
  if (select count(*) from storage_legacy_60) <> 100 then
    raise exception 'Milestone 11 legacy 60-action snapshot is required';
  end if;
end $$;
vacuum (analyze) storage_legacy_60;

create temp table storage_legacy_rackout
  (like public.saved_legacy_payloads including defaults including indexes);
insert into storage_legacy_rackout (source_kind, source_id, game_id, snapshot)
select 'normal', id, id, archived.snapshot
from generate_series(1, 100) n
cross join lateral (
  select ('8b100000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid id
) ids
cross join (
  select snapshot from public.private_library_items
  where pg_column_size(snapshot) between 158000 and 163000 limit 1
) archived;
do $$ begin
  if (select count(*) from storage_legacy_rackout) <> 100 then
    raise exception 'Milestone 11 legacy rack-out snapshot is required';
  end if;
end $$;
vacuum (analyze) storage_legacy_rackout;

\echo BASELINE
select c.relname, c.reltuples::integer as estimated_rows,
  pg_relation_size(c.oid) as heap_bytes,
  pg_indexes_size(c.oid) as main_index_bytes,
  case when c.reltoastrelid = 0 then 0 else pg_relation_size(c.reltoastrelid) end as toast_heap_bytes,
  case when c.reltoastrelid = 0 then 0 else pg_indexes_size(c.reltoastrelid) end as toast_index_bytes,
  pg_total_relation_size(c.oid) as total_bytes
from pg_class c where c.oid in (
  'storage_payload'::regclass, 'storage_history'::regclass,
  'storage_recent'::regclass, 'storage_saved'::regclass,
  'storage_overflow'::regclass, 'storage_trash'::regclass,
  'storage_ledger'::regclass, 'storage_cleanup_queue'::regclass,
  'storage_legacy'::regclass, 'storage_legacy_60'::regclass,
  'storage_legacy_rackout'::regclass
) order by c.relname;

\echo INDEXES
select t.relname as table_name, i.relname as index_name,
  pg_relation_size(i.oid) as bytes
from pg_class t join pg_index x on x.indrelid = t.oid
join pg_class i on i.oid = x.indexrelid
where t.oid in (
  'storage_payload'::regclass, 'storage_history'::regclass,
  'storage_recent'::regclass, 'storage_saved'::regclass,
  'storage_overflow'::regclass, 'storage_trash'::regclass,
  'storage_ledger'::regclass, 'storage_cleanup_queue'::regclass,
  'storage_legacy'::regclass, 'storage_legacy_60'::regclass,
  'storage_legacy_rackout'::regclass
) order by t.relname, i.relname;

\echo DATUMS
select 'compact-short' as kind, pg_column_size(record) as datum_bytes
from storage_archetypes where event_count = 4
union all select 'compact-40', pg_column_size(record) from storage_archetypes where event_count = 41
union all select 'compact-60', pg_column_size(record) from storage_archetypes where event_count = 61
union all select 'compact-rackout', pg_column_size(record) from storage_archetypes where event_count = 39
union all select 'legacy-v3-40', pg_column_size(snapshot) from storage_legacy limit 5;

-- Recent: 100 users at a stable 20 each, then 20 completion/eviction rounds
-- (2,000 replacements). Repeat to observe whether allocated pages plateau.
do $$ declare cycle integer; begin
  for cycle in 1..20 loop
    delete from storage_recent r using (
      select source_id from (
        select source_id, row_number() over (
          partition by participant_id order by completed_at, source_id
        ) as rank from storage_recent
      ) ranked where rank = 1
    ) oldest where r.source_id = oldest.source_id;
    insert into storage_recent (source_kind, source_id, participant_id, completed_at)
    select 'normal', ('87000000-0000-4000-9000-' || lpad((2000 + cycle * 100 + u)::text, 12, '0'))::uuid,
      ('87000000-0000-4000-8000-' || lpad(u::text, 12, '0'))::uuid,
      '2026-02-01'::timestamptz + cycle * interval '1 day'
    from generate_series(1, 100) u;
  end loop;
end $$;
\echo RECENT_AFTER_2000_REPLACEMENTS_BEFORE_VACUUM
select count(*) as rows, pg_relation_size('storage_recent') as heap_bytes,
  pg_indexes_size('storage_recent') as index_bytes,
  pg_total_relation_size('storage_recent') as total_bytes from storage_recent;
vacuum (analyze) storage_recent;
\echo RECENT_AFTER_REGULAR_VACUUM
select count(*) as rows, pg_relation_size('storage_recent') as heap_bytes,
  pg_indexes_size('storage_recent') as index_bytes,
  pg_total_relation_size('storage_recent') as total_bytes from storage_recent;

do $$ declare cycle integer; begin
  for cycle in 21..40 loop
    delete from storage_recent r using (
      select source_id from (
        select source_id, row_number() over (
          partition by participant_id order by completed_at, source_id
        ) as rank from storage_recent
      ) ranked where rank = 1
    ) oldest where r.source_id = oldest.source_id;
    insert into storage_recent (source_kind, source_id, participant_id, completed_at)
    select 'normal', ('87000000-0000-4000-9000-' || lpad((2000 + cycle * 100 + u)::text, 12, '0'))::uuid,
      ('87000000-0000-4000-8000-' || lpad(u::text, 12, '0'))::uuid,
      '2026-02-01'::timestamptz + cycle * interval '1 day'
    from generate_series(1, 100) u;
  end loop;
end $$;
vacuum (analyze) storage_recent;
\echo RECENT_AFTER_4000_REPLACEMENTS_AND_VACUUM
select count(*) as rows, pg_relation_size('storage_recent') as heap_bytes,
  pg_indexes_size('storage_recent') as index_bytes,
  pg_total_relation_size('storage_recent') as total_bytes from storage_recent;

-- Saved transitions touch metadata only; no replay table is updated.
update storage_saved set state = 'trashed' where saved_at <= '2026-01-01 00:20+00';
update storage_saved set state = 'active' where state = 'trashed';
update storage_saved set state = 'overflow' where saved_at > '2026-01-01 01:40+00';
update storage_saved set state = 'active' where state = 'overflow';
update storage_saved set state = 'trashed' where saved_at <= '2026-01-01 00:50+00';
delete from storage_saved where state = 'trashed';
\echo SAVED_AFTER_TRANSITIONS_BEFORE_VACUUM
select count(*) as rows, pg_relation_size('storage_saved') as heap_bytes,
  pg_indexes_size('storage_saved') as index_bytes,
  pg_total_relation_size('storage_saved') as total_bytes from storage_saved;
vacuum (analyze) storage_saved;
\echo SAVED_AFTER_REGULAR_VACUUM
select count(*) as rows, pg_relation_size('storage_saved') as heap_bytes,
  pg_indexes_size('storage_saved') as index_bytes,
  pg_total_relation_size('storage_saved') as total_bytes from storage_saved;

-- Rebuilds bound the space occupied by a churned table; ordinary VACUUM
-- typically makes pages reusable without shrinking every index file.
vacuum (full, analyze) storage_recent;
vacuum (full, analyze) storage_saved;
\echo COMPACTED_AFTER_VACUUM_FULL
select c.relname, pg_relation_size(c.oid) as heap_bytes,
  pg_indexes_size(c.oid) as index_bytes, pg_total_relation_size(c.oid) as total_bytes
from pg_class c where c.oid in ('storage_recent'::regclass, 'storage_saved'::regclass)
order by c.relname;
