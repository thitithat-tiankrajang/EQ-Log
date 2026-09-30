# Milestone 11 — Sync / Performance Gate

All measurements were made against the disposable loopback Supabase stack on
2026-09-30. This is an architecture comparison, not a production latency SLA.
No production service, live protocol, product capacity, or deployed data was
changed.

## What is compared

| Operation | Old production-compatible boundary | New boundary |
| --- | --- | --- |
| Normal finish | Authenticated `finalize_live_game` RPC on a pre-cutover private room, retaining a v3 Private Library snapshot. The current local wrapper also writes History. | Authenticated `normal-terminal` Edge request, server-built Compact v1, `capture_normal_terminal` transaction, History and Recent. |
| Completed list | `private_library_items` metadata selection, which already excludes `snapshot`. | `list_my_game_history` metadata RPC, with Recent/Saved availability; `list_my_saved_games` for explicit ownership. |
| Replay open | `archive-replay` reading a private v3 snapshot and returning the safe projection. | The same trusted endpoint reading a Recent Compact record and returning the same safe projection. |
| Explicit Save | `save_archive_to_private` copies a public v3 snapshot to another Private Library row. | `save-completed-game` adds Saved ownership of an already retained Compact source. |
| Live resume | Existing room creation, full-state conditional commit, canonical-head and room reads. | Same live command and read protocol. Private archive policy changed at creation; live state semantics did not. |

The old finish measurement is a compatible current local code path, not a
separate production deployment of the base commit. Its History wrapper means
old and new DB work is not a pure before/after CPU comparison. New terminal
construction is server-controlled; intermediate normal move state and scores
remain client-reported. Stage has no old equivalent durable Compact capture.

At the API boundary, old finish is one authenticated finalizer RPC. New
eligible normal finish performs an auth lookup, one room SELECT, one timeline
SELECT and one atomic capture RPC; the capture internally calls the established
finalizer, then inserts one shared Compact payload and up to two History/Recent
seat relations. SQL statements inside PL/pgSQL are not counted as separate
client requests. Old Private Library list is one GET; History and Saved are
one RPC per page, with no application N+1. Recent retention is one service RPC
per completed source inside its transaction. New Save is one Edge request,
one auth lookup and one authenticated Save RPC. Both old and new replay opens
use the same safe Edge reader: one auth lookup, one profile query and six
candidate-source queries/RPCs before projection. The live create, commit and
head reads each remain one RPC.

## Environment and method

- Apple Silicon host, Node 26.6.0, Supabase CLI 2.117.0, local PostgreSQL
  17.6, PostgREST 16.2, Edge Runtime image v1.74.3.
- Isolated loopback API and database; accumulated local test database had about
  18,000 History and Saved rows before this run. Dedicated benchmark users held
  1,000 Saved rows and 100 old Private Library metadata rows. No production
  account or database was contacted.
- Legal games come from frozen, seeded action traces revalidated by the game
  rules. The four replay pairs were short (3 actions), 40 actions, 60 actions,
  and natural rack-out (39 actions). The existing codec benchmark adds Authur,
  manual edit, one/several/heavy branch cases. Metadata-scale rows have valid
  ownership keys but intentionally do not pretend to be 1,000 replayable
  games.
- Request/response bytes below are UTF-8 JSON bodies. GET query URLs, headers,
  TLS and protocol framing are excluded. `pg_column_size` is a PostgreSQL
  datum/tuple measure; separate fresh-table samples include heap and indexes.
- HTTP timings include local Edge/PostgREST, auth, database, serialization and
  loopback transport. Read routes had one warm-up and seven or eleven samples;
  finish had seven short and three each 40/60-action samples. p90 of three
  runs is their maximum. Caches were warm; cold starts are excluded. Runs
  varied with local host load, so figures should be read to tens of
  milliseconds rather than as production predictions.

## Network bytes and local latency

| Operation | Old request / response | New request / response | Local p50 old / new | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Finish, 3 actions | 19,386 / 143 B | 19,264 / 123 B | 40 / 121 ms | Full final v3 state remains in request. |
| Finish, 40 actions | 229,760 / 143 B | 229,638 / 123 B | 650 / 1,008 ms | New Edge validates and builds Compact before capture. |
| Finish, 60 actions | 374,499 / 143 B | 374,377 / 123 B | 1,137 / 1,743 ms | Same growing live-state transfer remains. |
| Completed list, 20 | 0 / 11,169 B | 14 / 10,599 B | 4 / 11 ms | Old Private Library list was already metadata-only; about 5% smaller response is not a material transfer gain. |
| Completed list, 100 | 0 / 55,890 B, one GET | 340 / 53,525 B, three bounded pages | 4 ms old; 39 ms total new | Different scopes: old retained private items versus all completed History. |
| Save existing 40-action source | 105 / 38 B | 73 / 120 B | 32 / 79 ms for one creation | New Edge/auth adds latency; DB copy is eliminated. Seven idempotent new retries: p50 61, p90 94 ms. |
| Replay open, 40 actions | 49 / 221,004 B | 49 / 221,000 B | 337 / 101 ms | Safe projected positions dominate response; network size is unchanged. |
| Replay open, 60 actions | 49 / 415,482 B | 49 / 415,479 B | 665 / 105 ms | Compact decoding was faster in this local run; safe response still expands. |
| Live reload after 3 actions | Same unchanged RPCs; separate base stack not timed | Canonical 3,169 B + room 15,400 B; 9 ms combined | — | Four legal commits and a fresh-client reload/update passed. |

Finish p90 old/new was 54/319 ms (short), 699/1,156 ms (40), and
1,216/2,187 ms (60). Replay-open p90 was 595/116 ms (40) and 800/132 ms
(60) in the final uncontended run. The safe replay responses are larger than
the Compact storage payload by design. They do not expose bag order, physical
tile IDs, private draw facts or raw digests.

To isolate processing from database and HTTP work, the same safe projection
was timed in-process for seven warm runs. For 40 actions, old v3 projection
was p50/p90 248/326 ms versus Compact 29/32 ms. For 60 actions it was
374/470 ms versus 35/39 ms. This is a Node-side server-processing proxy,
not an Edge Runtime timing; the full authenticated HTTP measurements above
remain the user-visible result.

The local 40-action Compact build took 143–191 ms in the measured Node runs;
the 60-action build took 348–394 ms. The Edge path additionally authenticates,
reads the room and timeline, validates the finished record and calls one
atomic capture RPC. The old client sends one finalizer RPC. These extra
operations explain much of the finish-path latency increase. We made no
speculative optimization or claim that finish network bytes shrank.

Stage terminal capture was measured separately through two concurrent real
requests: 6,712 B per request, 145 B per response, 211 ms combined wall time.
There is no old durable Stage replay operation with equivalent semantics.
Legacy full-account compatibility finish remained operational: a 3.2 KB
request returned in 67–236 ms across Free/Plus/Pro local cases; an incomplete
old History case retained exact legacy v3 instead of claiming Compact.

## Durable database accounting

| Same legal game | Old v3 raw JSON | Compact raw JSON | Raw reduction | Old v3 JSONB datum | New Compact JSONB datum + History + Recent tuples |
| --- | ---: | ---: | ---: | ---: | ---: |
| Short, 3 actions | 19,050 B | 7,193 B | 62% | 9,142 B | 4,509 + 184 + 69 B |
| Normal, 40 actions | 228,943 B | 40,727 B | 82% | 120,065 B | 17,661 + 192 + 69 B |
| Long, 60 actions | 373,422 B | 54,898 B | 85% | 233,258 B | 20,793 + 192 + 69 B |
| Natural rack-out, 39 actions | 253,418 B | 49,729 B | 80% | not isolated | not isolated |

The v3 datum is the old private archive snapshot, and the Compact datum is
one immutable `recent_game_payloads.record`. A two-seat normal game has one
payload and two History/Recent rows. An explicit Saved relation added a 105 B
tuple without changing the Compact payload's 17,638 B datum or its row count.
The old public-to-private Save copied another 118,098 B compressed v3 datum.
These are datum/tuple sizes, not exact per-game physical table totals.

Fresh physical clones with production indexes measured 1,000 History rows at
425,984 B total (160 B mean tuple), 2,000 Recent rows at 589,824 B total
(72 B mean tuple), and 1,000 Active Saved rows at 614,400 B total (97 B mean
tuple). They demonstrate metadata and index overhead without double-counting
the shared payload. A 100 Active + 900 Overflow sample was 901,120 B including
dead tuples after updates; it is not a steady-state storage forecast.

The full codec corpus confirmed 40 legal placements at 218,772 → 39,991 B
(81.7% reduction) and a finished 60-action trace at 368,382 → 54,818 B
(85.1%). Authur 20-action was 59,604 → 11,199 B; a manual correction
3,008 → 1,425 B. One branch was 56,854 B current state plus a 2,110 B
legacy timeline versus 13,116 B new; several branches were 56,854 + 12,290
versus 23,296 B. Heavy branches were 111,754 + 358,647 versus 379,353 B:
the branch document dominates, but the fair total still declines. The
60-action legal Compact result exceeds the provisional 50 KB target because
replay facts and physical identity were preserved.

## Metadata scale, retention, and query plans

- History 20: 10,599 B response, p50/p90 10.7/11.7 ms after the fix. A
  100-item History page sequence required three RPCs and 53,525 B. An old
  Private Library 20-row list was 11,169 B and 4.1/5.5 ms; its old interface
  already selected metadata only.
- Saved 20: 9,679 B, p50/p90 4.1/4.4 ms. Saved 50: 24,199 B,
  4.2/4.5 ms. Traversing 1,000 Active items took 21 bounded RPCs, 483,855 B
  responses, and 176 ms total local wall time. No Saved list response included
  a replay payload.
- Recent is exposed through the History metadata view. Its 20-item page was
  10,453 B, p50/p90 10.4/11.0 ms. At the 21st retained source, one old
  relation was evicted and the account stayed at 20. At steady state, the
  service-only retention RPC took p50/p90 3.3/4.0 ms; completion/retry tests
  separately cover concurrent retention. Its payload is shared between seats
  and with Saved.
- `EXPLAIN ANALYZE` at the 1,000-item scale used
  `game_history_page_idx` for the History page (20 rows, 0.28 ms),
  `saved_game_items_active_idx` plus indexed History/payload joins for Saved
  (20 rows, 1.20 ms), and the Active partial index for the 1,000-row capacity
  count (0.59 ms). Replay lookup used the unique payload game-ID index; Recent
  relation lookup scanned its small 359-row local table in 0.24 ms. The
  `(participant_id, completed_at, source_kind, source_id)` Recent index exists
  for larger tables. No application-layer N+1 requests were found.

### Measured capacity-reconciliation blocker and fix

Before this milestone, History and Saved reads called
`reconcile_saved_capacity`. PostgreSQL inlined its ranked UPDATE and chose a
plan that evaluated the 1,000-row window 1,001 times: about 33,000 shared
buffer hits and 334 ms for that SQL step. Authenticated History/Saved list
p50 was about 239/242 ms. A read-only materialized-excess experiment took
2.6 ms for the UPDATE. The new migration counts Active items first and
returns without an UPDATE when within capacity; when over capacity it
materializes both ranked and excess sets before updating. The same
authenticated benchmark then measured History/Saved p50 10.7/6.2 ms on its
first rerun, and 10.7/4.1 ms on the final uncontended rerun. A direct
within-capacity function call was about 10.5 ms including plan lookup;
reducing 1,000 Active to Free capacity moved exactly 900 items to Overflow,
leaving 100 Active, in 188 ms including a new `psql` process.

## Correctness, limitations, and gate

The safe replay projection produced the same final visible board for each
paired old/new game. The Save payload row count and digest-sized datum were
unchanged after insertion and seven retries. Stage concurrency and sealed
start tests, normal and legacy full-capacity finish tests, Saved lifecycle and
History/Recent/Save/archive security tests passed on the isolated stack. A
live room accepted four legal commits with a fresh-client reload between the
third and fourth; its full-state request grew from 8,611 to 23,534 B, as
expected from the unchanged live protocol. No live transport or move semantics
were modified.

The main remaining performance caveat is finish latency: Compact construction
and the stronger terminal capture add local work while the client still sends
the full growing state. Replay-open bytes do not shrink. Legacy History
availability still inspects v3 `snapshot` JSONB inside the database to classify
partial versus complete records. It returns metadata only to the client and a
20-row full-legacy page measured about 10 ms locally, but the internal legacy
datum inspection should be watched at production scale. The newer Compact
History path consults record digest and relation metadata, not replay JSON.
No production p95, cold-start, cross-region, or mobile-network claim follows
from these loopback measurements.

The measured blocker was the capacity reconciliation plan and is fixed within
this worktree. The written A–G criteria pass with the distinctions above:
durable eligible payloads are materially smaller; History is tiny versus
loading full snapshots but only marginally smaller than the old metadata-only
Private Library list; Save shares a retained payload; metadata operations are
bounded and indexed; completion remains independent of full Saved capacity;
live resume/update works; and the safe replay route remains operational.
Milestone 12 may proceed for storage-cost analysis after Product Owner review.
Competitive verification of client-submitted normal or Stage gameplay belongs
to its separate authority track.

## Validation and scope

PASS: the three opt-in sync performance tests; the existing Compact corpus
benchmark and safe-projection benchmark; Stage terminal and full-capacity
normal/legacy local tests; five local History/Recent/Saved/archive tests
(History rerun standalone after a parallel-run timeout); SQL History, Recent,
Saved, Saved lifecycle, archive privilege and live sync smokes; focused codec,
boundary, legal-corpus, History API, safe replay and remote sync unit tests;
format, lint, typecheck and `git diff --check`. The legal-corpus tests also
passed standalone after four 5-second timeouts when run concurrently with
format, lint and typecheck. No correctness failure remained.

NOT RUN in Milestone 11: full Vitest suite and production build, because no
production TypeScript was changed and the milestone asks for focused checks.
The previously completed Milestone 10 full suite was green. This worktree
remains intentionally uncommitted. Milestone 11 added only measurement tests,
this report, a History physical-size script, and the narrow Saved capacity
reconciliation migration. It did not start Milestone 12 or change product
capacity.
