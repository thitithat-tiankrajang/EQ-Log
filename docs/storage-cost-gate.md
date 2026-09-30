# Milestone 12 — Storage Cost Gate

All measurements used the disposable local PostgreSQL 17.6/Supabase stack on
2026-09-30. No production database was contacted. The physical benchmark is
`supabase/tests/storage_cost_benchmark.sql`; it creates temporary tables with
the current columns and indexes, runs `VACUUM (ANALYZE)`, reports heap, main
indexes, TOAST heap/index, and total relation allocation, then disappears at
session end. Compact JSONB values are repeated from the **legal** Milestone 11
3-action, 40-action, 60-action, and rack-out records under synthetic row keys
for physical measurement only. This does not claim 1,000 distinct legal games.
The 100-row legacy samples repeat actual v3 40/60-action snapshots. The
History/Recent/Saved/ledger rows are metadata-scale fixtures, not replay
fixtures. No provider price, compression beyond PostgreSQL JSONB/TOAST, WAL,
replica, backup, or network egress cost is included.

## Accounting boundary and corpus

| Component | Retention and counting rule |
| --- | --- |
| Compact replay payload | One immutable normal source in `recent_game_payloads`, shared by seats, Recent and Saved. Count distinct retained source IDs. Stage has a separate permanent `stage_completed_attempts.record`. |
| History | One permanent `game_history` row per seated participant, including games without replay. |
| Recent | At most 20 `recent_game_items` rows per participant; its source payload is retained while any Recent/Saved reference remains. |
| Saved | One lifecycle row per participant/source in Active, Trash or Overflow. All three states retain replay; only Active counts against plan capacity. |
| Indexes, TOAST, pages | Included in the physical totals below. These are relation allocations, not raw JSON length. |
| Migration/idempotency | One `saved_legacy_migration_ledger` row per processed old item. A transient cleanup-queue row per evicted or last-deleted normal source. |
| Legacy coexistence | Old Private Library/public/region snapshots remain. Eligible legacy Saved freezes a separate v3 copy; old in-progress rooms remain live v3 until finish. New public/region normal finishes still write a v3 archive **in addition to** Compact Recent. |

The measured raw Compact corpus (UTF-8 `JSON.stringify` bytes) is below. The
short/40/60/rack-out rows reuse finished legal Milestone 11 records. The
opt-in `tests/storage-cost-corpus.test.ts` completed the bot, manual-edit and
branch variants, built Compact, and decoded each record. They are deliberate
size examples, not a random sample of user games.

| Record | Raw Compact bytes |
| --- | ---: |
| Finished manual correction | 1,485 |
| Short, 3 actions | 7,193 |
| Finished Authur bot, 20 actions | 23,121 |
| Finished one branch, 40 actions | 43,407 |
| Finished four branches, 40 actions | 55,255 |
| Normal, 40 actions | 40,727 |
| Natural rack-out, 39 actions | 49,729 |
| Long, 60 actions | 54,898 |
| Finished heavy, 30 × 12 branch suffixes | 443,076 |

For these **nine deliberately varied finished examples**, min/median/mean/max
are 1,485 / 43,407 / 79,877 / 443,076 B. Nearest-rank p90 equals the
maximum because n=9; it is not a meaningful population percentile. The heavy
branch case dominates the mean. For capacity scenarios, a declared
**60% normal 40 /
30% long 60 / 10% rack-out** mix yields 45,879 B mean raw JSON, 18,668 B
mean PostgreSQL JSONB datum, and 20,275 B mean physical payload allocation.
This mix is an assumption, not measured user behavior. Bot, branch, short and
Stage records remain visible exceptions rather than being hidden in a falsely
precise average. The paired legacy raw mix is 274,734 B; Compact is 83.3%
smaller by `(old-new)/old`.

## PostgreSQL physical measurements

Fresh temporary clones were analyzed and vacuumed before this baseline.
`total` includes heap, main indexes, TOAST, and relation forks/page overhead.

| Sample | Rows | Heap B | Main indexes B | TOAST heap B | TOAST index B | Total B | Total/row B |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Compact mix | 1,000 | 172,032 | 139,264 | 19,660,800 | 237,568 | 20,275,200 | 20,275 |
| History | 10,000 | 1,581,056 | 1,826,816 | 0 | 8,192 empty TOAST index | 3,448,832 | 345 |
| Recent, 100 users × 20 | 2,000 | 155,648 | 294,912 | 0 | 8,192 empty TOAST index | 491,520 | 246 |
| Saved, 1,000 Active | 1,000 | 114,688 | 466,944 | 0 | 8,192 empty TOAST index | 622,592 | 623 |
| Saved, 100 Active + 900 Overflow, inserted in final state | 1,000 | 122,880 | 409,600 | 0 | 8,192 empty TOAST index | 573,440 | 573 |
| Saved, 100 Active + 20 Trash, inserted in final state | 120 | 16,384 | 81,920 | 0 | 8,192 empty TOAST index | 139,264 | 1,161* |
| Legacy migration ledger | 1,000 | 98,304 | 65,536 | 0 | 8,192 empty TOAST index | 204,800 | 205 |
| Cleanup queue | 1,000 | 57,344 | 106,496 | 0 | 0 | 196,608 | 197 |
| Frozen v3 40-action | 100 | 16,384 | 16,384 | 12,288,000 | 155,648 | 12,541,952 | 125,420 |
| Frozen v3 60-action | 100 | 16,384 | 16,384 | 23,863,296 | 294,912 | 24,256,512 | 242,565 |
| Frozen v3 rack-out | 100 | 16,384 | 16,384 | 16,490,496 | 204,800 | 16,793,600 | 167,936 |

`*` The 120-row clone pays whole 8 KiB index pages; it is not a marginal
per-row price in the shared platform tables. The model uses measured large
sample marginal averages: **P=20,275 B per distinct Compact payload,
H=345 B per History seat, R=246 B per Recent relation, S=623 B per Saved
relation**. The difference between the 18,668 B mean payload datum and its
20,275 B physical allocation is about 1,607 B (8.6%) for TOAST/index/page
overhead. Actual small tables allocate in 8 KiB pages; future fill factors,
JSON content, and churn change the average. The 8,192 B empty TOAST indexes
are per table, not charged once per user.

The Compact sample's TOAST heap is 97% of the total; its two main indexes
total 139 KB per 1,000 payloads. History's two indexes exceed its small heap
but total only 345 B/seat. Saved's four indexes total 467 KB per 1,000 Active
rows, 75% of that relation's allocation, yet only about 2.3% of the paired
20.3 MB replay payload allocation. The partial Active index falls from
90 KB to 16 KB when just 100 of 1,000 rows remain Active. None of these
indexes is a measured storage blocker; no index was removed.

The eight local Stage attempt rows had a mean 2,623 B record datum and a
147,456 B small-table total (including indexes and page minimums). This is
not a representative Stage population estimate. Stage's sealed record is
already permanent; a Saved relation does not create a second Stage record.

**Current public/region archive overlay:** `capture_normal_terminal` calls
the established `finalize_live_game`, which still inserts a full v3 snapshot
for rooms with `archive_policy = public` or `region`, then stores Compact for
Recent. This is a real dual payload while the archive row survives, not
sharing between archive and Compact. The three measured frozen-v3 physical
samples imply ~164,815 B/source under the declared 60/30/10 mix, plus the
archive table's own row/index overhead (not isolated here). The configured
fallback pruning limits are 100,000 public rows globally and 1,000 rows per
region when no `system_settings` override exists; the local settings table
has no override. Thus at full fallback capacity the public legacy-v3
snapshot overlay alone is ~16.48 GB, with another ~0.165 GB per full region.
These archive bytes are platform-wide and are added separately below; they
are not attributed to both players. New private rooms use `archive_policy =
none` and do not create this extra v3 archive. No public/region cutover or
storage redesign was attempted in this measurement milestone.

## Automatic History + Recent

Assume one-seat, distinct normal games, the declared payload mix, and a
healthy cleanup worker. The same payload is counted once even if Recent and
Saved both reference it. Automatic cost is `H × history_count + R × 20 +
P × 20`; evicted unsaved payloads are removed after the cleanup grace period.

| Completed games/user | Permanent History B | Recent metadata B | Latest 20 payloads B | Approx. automatic total B |
| ---: | ---: | ---: | ---: | ---: |
| 20 | 6,898 | 4,915 | 405,504 | 417,317 |
| 100 | 34,488 | 4,915 | 405,504 | 444,908 |
| 1,000 | 344,883 | 4,915 | 405,504 | 755,302 |
| 10,000 | 3,448,832 | 4,915 | 405,504 | 3,859,251 |

Permanent History alone is approximately 34 KB / 345 KB / 3.45 MB / 34.5 MB
at 100 / 1,000 / 10,000 / 100,000 seated games. Two-human games create two
History and Recent relations globally but still only one source payload.
Without payload cleanup, Recent's 20-row **logical** bound would not bound
physical bytes; that measured gap is addressed below.

## Saved and lifecycle scenarios

These are approximate marginal physical allocations in shared tables, in
decimal MB. All modeled Saved games have distinct source IDs, the 20 Recent
sources overlap with Saved where Saved count is at least 20, and History has
at least one row per Saved source. The 20-Saved scenario assumes all 20 are
Recent. Shared two-human games can lower actual platform payload cost.

| Plan/scenario | History | Retained distinct payloads | Payload MB | History MB | Recent MB | Saved MB | Total MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Free, no Saved | 100 | 20 | 0.406 | 0.034 | 0.005 | 0 | 0.445 |
| Free, 20 Saved | 100 | 20 | 0.406 | 0.034 | 0.005 | 0.012 | 0.457 |
| Free, 100 Saved | 100 | 100 | 2.028 | 0.034 | 0.005 | 0.062 | 2.129 |
| Plus/Pro, 100 Saved | 1,000 | 100 | 2.028 | 0.345 | 0.005 | 0.062 | 2.440 |
| Plus/Pro, 500 Saved | 1,000 | 500 | 10.138 | 0.345 | 0.005 | 0.311 | 10.799 |
| Plus/Pro, 1,000 Saved | 1,000 | 1,000 | 20.275 | 0.345 | 0.005 | 0.623 | 21.248 |
| Long-term heavy, 1,000 Saved | 10,000 | 1,000 | 20.275 | 3.449 | 0.005 | 0.623 | 24.352 |

**Product capacity is not a physical storage ceiling.** Trash and Overflow
do not consume Active slots but retain payloads until explicit permanent
deletion. With the same distinct-source assumption:

| Lifecycle scenario | Minimum History | Retained payloads | Approx. total MB |
| --- | ---: | ---: | ---: |
| 100 Active + 20 Trash | 120 | 120 | 2.554 |
| 100 Active + 900 Overflow after downgrade | 1,000 | 1,000 | 21.248 |
| 100 Active + 900 Overflow + 50 Trash | 1,050 | 1,050 | 22.310 |
| 1,000 Active + 50 Trash | 1,050 | 1,050 | 22.310 |

The fresh 100 Active + 900 Overflow relation was 573 KB versus 623 KB for
1,000 Active rows, because the partial Active index shrinks; the replay
payloads remain 20.3 MB. A downgraded heavy user can retain at least roughly
21 MB in this mix despite a Free 100 Active limit. Trash/Overflow can grow
further through historical retention; no destructive cleanup policy is
assumed or proposed here.

## Shared payloads and marginal new-game cost

| Event, one-seat unless stated | Payload B | History B | Recent B | Saved B | Approx. total B |
| --- | ---: | ---: | ---: | ---: | ---: |
| New normal game, Recent only | 20,275 | 345 | 246 | 0 | 20,866 |
| Same game, also Saved by one | 20,275 | 345 | 246 | 623 | 21,489 |
| Two-human game, Recent and Saved by both | 20,275 | 690 | 492 | 1,246 | 22,703 |
| Eventually evicted from Recent, not Saved | 0 after cleanup | 345 | 0 | 0 | 345 |
| Evicted from Recent, Saved by one | 20,275 | 345 | 0 | 623 | 21,243 |

A second seat adds its History/Recent/Saved relations but **zero Compact payload
bytes**. For the representative mix that avoids another ~20.3 KB physical
Compact payload per shared game; if the old system had two distinct private
v3 copies, each 40-action copy could be about 125.4 KB physical in the
measured frozen-table sample. A Recent-to-Saved transition adds ~623 B of
ownership instead of another ~20.3 KB payload. Twenty fully overlapping
Recent/Saved games avoid ~405.5 KB/user versus duplicate Compact copies.
These are comparisons of actual distinct-source counts, not cross-user hash
deduplication; unrelated games are never merged by digest. A new public/region
game currently adds the separate ~165 KB v3 archive overlay while retained;
the marginal table above describes the shared Compact/History/Recent/Saved
layer only.

## Legacy coexistence and migration peak

Migration preserves the old Private Library row and its original v3 snapshot.
For an eligible complete source it writes one **additional frozen v3**
`saved_legacy_payloads` copy, one Saved relation, and one ledger row. It does
not convert v3 into Compact, and two Saved participants can share the one
frozen source. The migration ledger makes retries idempotent. Old v1/v2,
partial v3, copied/ambiguous archives, and live private rooms stay on their
existing path. In-progress `room_live.state` and timelines are separate live
storage and are excluded from per-completed-game totals until they finish.

| Eligible legacy source | Existing old copy* | Added frozen copy | Added Saved + ledger | Temporary coexistence total* |
| --- | ---: | ---: | ---: | ---: |
| 40 actions | ~125,420 B | 125,420 B | ~828 B | ~251,668 B |
| 60 actions | ~242,565 B | 242,565 B | ~828 B | ~485,958 B |

`*` Existing old Private Library physical row layout differs from the frozen
clone; the first and total columns approximate its snapshot using the frozen
copy measurement, not a measured old table total. History may already exist;
add ~345 B if it must be newly indexed. At 100,000 eligible migrated
40-action sources, additional frozen+Saved+ledger storage is about **12.62 GB**
while old copies remain; this can temporarily nearly double their replay
storage. Public/region archives and old private copies may already contain
other duplicates outside this calculation. No old record is deleted or
destructively rewritten to improve the number. Migration batches, backup
headroom, and rollout pace should be planned against the actual eligible
legacy inventory before production execution.

## Platform scenarios and price input

The following are explicitly **hypothetical user mixes**, using distinct
payloads per user as a conservative platform assumption. Two-human source
sharing lowers the payload count when users retain the same game. These are
database relation allocations before WAL, backup, replicas, free-space
reserve, and provider billing rules.

| Profile | History | Saved | Approx. MB/user |
| --- | ---: | ---: | ---: |
| Light | 20 | 2, both Recent | 0.419 |
| Active | 1,000 | 100, including Recent 20 | 2.440 |
| Heavy | 10,000 | 1,000, including Recent 20 | 24.352 |

| Scenario | 1,000 users | 10,000 users | 100,000 users |
| --- | ---: | ---: | ---: |
| 80% Light / 19% Active / 1% Heavy | 1.04 GB | 10.42 GB | 104.19 GB |
| 50% Light / 40% Active / 10% Heavy | 3.62 GB | 36.20 GB | 362.03 GB |
| All Free users with 100 Active Saved, 100 History | 2.13 GB | 21.29 GB | 212.92 GB |
| All Plus/Pro users with 1,000 Active Saved, 1,000 History | 21.25 GB | 212.48 GB | 2.125 TB |

The last two are **plan-capacity saturation** examples, not a physical worst
case: Trash, Overflow, extra History, legacy coexistence and unusual heavy
branches can exceed them. No authoritative provider price was supplied.
`monthly_storage_cost = stored_GB × provider_cost_per_GB_month`; add provider
charges for backups, replicas, I/O and egress if applicable.

Add the public/region archive overlay to any platform row as
`0.000164815 GB × [min(public archive count, 100000) + Σ min(region archive
count, 1000)]`, plus archive row/index overhead. For example, a full public
archive adds ~16.48 GB to the table's scenario; 100 full regions would add
another ~16.48 GB. Public and region are distinct archive scopes, not two
copies of the same normal finish under the ordinary finalizer. These are
source counts, never user ownership counts.

## Churn, cleanup, and the measured blocker

The old `recent_retain_completed_source` removed the 21st **relation** but
never invoked the existing reference-aware payload cleanup function. The
disposable stack already contained 948 unreferenced Compact payload rows
(404,245 B of JSONB datums; mostly tiny test records). Those rows may include
direct test inserts, so the count is not attributed wholly to Recent churn;
the SQL path itself proves that eviction could accumulate orphans. At the
representative physical mix, 1,000 completed games with only the latest 20
retained would allocate ~20.28 MB instead of ~0.41 MB payload until cleanup.
That was a concrete storage-cost blocker, not an index micro-optimization.

Migration `20261001102500_completed_payload_cleanup.sql` queues normal source
IDs when a Recent or Saved relation is deleted, backfills existing orphans,
and schedules a database-owner `pg_cron` worker every five minutes. It waits
ten minutes, processes at most 10,000 queued IDs/run, takes the existing
per-source lock, checks **both** Recent and all Saved lifecycle states, then
deletes only unreferenced Compact/frozen-legacy payloads. It removes a queue
entry even if another owner still retains the payload; that owner's eventual
delete requeues it. No browser or service-role EXECUTE/table privilege was
granted. Cleanup runs after the terminal transaction, avoiding account/source
lock inversion and user-facing finish latency. The local job is active under
`postgres`; a rollback-based SQL regression proved 21st eviction, two-seat
retention, Saved retention, last-reference deletion, frozen legacy cleanup,
queue drain and privileges. Production operation must monitor job failures
and queue age; if pg_cron is disabled, automatic physical cost is unbounded.
In a rollback-only local `EXPLAIN ANALYZE`, the worker processed 974 queued
mostly tiny test orphans in 78 ms; this is not a 10,000-real-game throughput
guarantee. A 1,000-row queued-ID physical clone occupied 197 KB.

Physical metadata churn was also measured on temporary relations. The 2,000-
row Recent baseline was 491,520 B. After 2,000 replacements it occupied
909,312 B; regular `VACUUM` left that allocation unchanged but made dead
space reusable. Another 2,000 replacements plus vacuum occupied 892,928 B,
which did not show continuing linear growth in this small experiment.
`VACUUM FULL` returned it to 458,752 B. Saved began at 622,592 B for 1,000
Active rows. Active→Trash→Restore, 900 Active→Overflow→Active, and 50 Trash→
permanent delete left 950 rows occupying 1,024,000 B; regular vacuum retained
the file allocation, while `VACUUM FULL` compacted it to 442,368 B. These
updates touched only metadata, never replay JSONB. Routine autovacuum should
reclaim reusable dead space; it does not promise to shrink the physical file.
The 4,000-replacement and one Saved lifecycle experiments are not lifetime
bloat forecasts, so track relation growth and dead tuples in production.

## Gate and limits

The main physical uncertainty is behavior distribution: the nine-record
corpus is deliberately broad, not a random sample; heavy branches and very
long games can be much larger. The models assume a declared typical mix,
one distinct source per user except explicit overlap, healthy cleanup, and
large-table marginal allocations. The public/region v3 overlay must be added
by archive source count. The old legacy inventory and true user
mix are unknown. Supabase physical billing may include backup/replica/WAL
amplification not represented here. The cleanup worker's 10,000-per-five-
minute rate is configured, not an observed production throughput guarantee.
No current currency price or economic pass/fail threshold was invented.

Validation: the physical benchmark, finished corpus benchmark and cleanup
smoke script passed; existing
Recent, Saved, and Saved lifecycle SQL smokes passed; five focused local
Recent/Saved/lifecycle/full-capacity-finish/Stage integration files passed;
format check, lint, TypeScript typecheck, and `git diff --check` passed. An initial
integration command used only the Milestone 11 opt-in variable and skipped
the five local tests; it was rerun with their correct opt-in variables and
all five passed. The full application suite and build were not rerun because
no application TypeScript changed. The migration was applied only to the
disposable local database. No production migration, product capacity change,
commit, push, merge or deployment occurred.

After the measured orphan-retention fix, no table, index, TOAST or churn result
requires an architecture change for this gate. Milestone 13 can proceed after
Product Owner review, with cleanup scheduling/monitoring and actual legacy
inventory as explicit rollout checks. Product Saved capacities remain Free
100 Active and Plus/Pro 1,000 Active; no destructive cleanup policy was added.
