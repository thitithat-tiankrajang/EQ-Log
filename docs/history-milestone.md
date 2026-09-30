# Milestone 7: permanent lightweight History

## Boundary

History answers which completed games a signed-in person played. It is a
metadata index, not a replay store, score reducer, rating system, bot economy,
or Saved/Drive item. Compact v1 remains the chosen full-game payload contract
for supported new captures after its separate trusted-write cutover. Normal
completion continues to write legacy archive payloads in this milestone.

The [source audit](history-source-audit.md) records the existing terminal,
archive, result, statistics and listing paths before the schema change.

## Schema and ownership

`game_history` has one row per seated participant and game, keyed by
`(source_kind, source_id, participant_id)`. Two players get two small metadata
rows and share the same external replay reference. This avoids a join in the
primary Me query; no payload is duplicated. A non-playing Host and spectators
receive no row. Bot games belong to the human seat; Stage belongs to its
attempt owner; Ranked belongs to its two result participants.

Stored facts are source/game reference, participant and side, safe game and
opponent labels, mode/bot key, final score summary and outcome if known,
completion time, optional rules pin, and result authority. `source_owner_id`
is private retry metadata for normal games with no retained archive; the list
RPC never returns it. There are no boards, racks, moves, physical tile IDs,
ordered draws, Compact deltas, seals or raw snapshots.

History rows have no expiry, capacity check, user-facing delete, or dependency
on Recent/Saved retention. Account deletion can still cascade-delete that
account's personal History under the existing account lifecycle.

## Creation and authority

- Normal, Solo, bot and Hosted: a narrow wrapper around the existing
  `finalize_live_game` writes History in the same transaction after the old
  terminal path succeeds. It uses frozen `room_live` seats/owner/mode/bot and
  copies the same final score and outcome semantics as `record_player_result`.
  It does not make client-submitted gameplay server-authoritative. The old
  finalizer remains the archive/stat path and still writes legacy snapshots.
- A Private archive quota failure no longer blocks completion: after the old
  finalizer validates the terminal request but its archive insert fails, the
  wrapper records the same stats/bot stat and History, removes the live room,
  and returns `none` for replay. Other errors still propagate. This changes no
  plan capacity. A retained History row authorizes an idempotent retry by the
  participant or original room owner even after the replay is gone.
- Ranked: the service-only `ranked_results` insert triggers both History rows
  in the result/rating transaction. Its existing reducer remains the rating
  authority. Old Ranked matches without a post-game replay remain marked as
  unsupported legacy replay.
- Stage: the service-only completed-attempt insert triggers one History row in
  the capture transaction. It retains `captured_client_state` provenance; the
  intermediate gameplay is still client trusted. Older advisory results are
  explicitly `advisory`, with no invented Compact replay.

The table gives browser roles no direct read or mutation grants. The
security-definer list RPC binds `auth.uid()` and returns allowlisted metadata
only. The service-only legacy backfill has a bounded page size and UUID keyset
cursor; it uses `ON CONFLICT DO NOTHING` and returns scanned/inserted/last ID.
It is not run automatically in a schema migration. An operator must page each
source (`public`, `region`, `ranked`, `stage`) after the deployment is reviewed.
For Public/Region it reads frozen archive seat columns, not untrusted payload
claims. Private-only legacy rows lack trusted seat columns and cannot be safely
backfilled. Pruned archives and aggregate stats cannot be turned back into
individual History entries.

## Read API and UI

`list_my_game_history(limit, before_at, before_kind, before_id)` returns newest
first, ordered by `(completed_at, source_kind, source_id)` descending. The
composite participant/page index supplies a stable keyset page. A bounded
20-item client page asks for 21 rows and returns an opaque tuple cursor. The
query first limits History, then uses indexed joins to current archive/Stage
rows to classify replay availability. It does not send a replay payload or
perform one replay fetch per item. Direct browser access to raw archive rows
remains denied.

Availability is `compact_available`, `legacy_available`, `legacy_partial`,
`unsupported_legacy`, or `unavailable`. The latter changes automatically if
an archive is pruned or a Private copy is trashed/deleted. A v1/v2 or missing
history array is labeled limited rather than full replay. The list can prove a
payload is stored, not validate every Compact digest; the existing safe replay
endpoint validates on open and fails truthfully if corrupt. Future Recent/Saved
tables should be added to the availability query without changing History
rows. Me → History displays mode, opponent/bot, outcome, score, time and replay
state, with a link only when a safe replay/view path exists. It labels captured
Stage results as client-reported.

## Measured size and query shape

The isolated SQL fixture produced 41 History rows and a 20-item API page of
**8,928 JSON bytes** (about **446 bytes/item**). Its average database tuple
was **160 bytes**; a separate 10,000-row, typical-name fixture averaged
**200 bytes/tuple** and occupied **2,048,000 heap bytes + 1,449,984 index
bytes = 3,530,752 bytes total**. The page keyset used `game_history_page_idx`
with 20 heap fetches and two shared buffer hits in the small fixture. These
are local measurements, not production latency forecasts.

| Games per participant | Approximate serialized metadata | Approximate heap + indexes |
| --------------------: | ------------------------------: | -------------------------: |
|                   100 |                         44.6 KB |                      35 KB |
|                 1,000 |                          446 KB |                     353 KB |
|                10,000 |                         4.46 MB |                    3.53 MB |

The API is paginated, so it never returns all 10,000 in one request. Database
figures are linear estimates from the 10,000-row local fixture; small tables
have fixed page overhead and real names/nullable fields vary.

## Activation and limits

Apply the migration and compatible Me reader together, then run the service
backfill in bounded pages per source. Do not turn the function into an
unbounded migration transaction. Existing and future full replay stores remain
separate. A historical private-only archive, a pruned archive, or old Ranked
latest-state row with no result cannot be inferred into a truthful History
entry. Historic rules pins are nullable where the old source did not record
one; future trusted Compact writers must supply the pin to History.

The isolated smoke covers ownership, duplicate and concurrent terminal calls,
quota-independent completion, Ranked/Stage capture, advisory legacy backfill,
partial legacy labeling, replay deletion, pagination, permissions and row/page
sizes. The current normal gameplay authority remains client reported; this
milestone does not address competitive move validation.
