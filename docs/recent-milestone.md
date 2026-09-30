# Milestone 8: Recent completed replay retention

## Boundary and activation

Recent is a per-seated-user, evictable reference to a complete replay. It is
separate from permanent metadata-only `game_history`, from Public/Region
archives, and from the existing Private library. It does not create a Saved
item or use any Saved/Drive capacity, folder, Trash or Overflow rule.

[The source audit](recent-source-audit.md) explains why Stage is the only
currently active Compact writer. The Stage completion transaction already
stores one immutable owner-only Compact record in
`stage_completed_attempts`; its History insertion now triggers Recent
retention. Normal, Solo, bot and Hosted finalizers are unchanged and do not
write Recent yet. The future trusted normal terminal writer may write one
shared Compact v1 row to `recent_game_payloads` and call the service-only
`recent_retain_completed_source('normal', game_id)` after History exists. That
writer must validate Compact and catch an unexpected retention error so game
completion remains authoritative. This contract is dormant in this milestone.

| Mode/source | Classification | Current behavior |
| --- | --- | --- |
| Stage new captured attempt | A: Compact now | One owner Recent relation, no payload copy; result remains `captured_client_state` and gameplay client-committed. |
| Normal friend/multiplayer, Solo, Authur bot, Hosted | B: Compact after trusted writer; C: existing legacy archive | Legacy replay remains safely readable if its Public/Region/Private row exists. Those prunable/deletable rows are not falsely advertised as 20-game Recent retention. Seated users, rather than a non-playing Host, will own future Recent relations. |
| Ranked | D: ineligible | Result/rating authority and private revisions remain unchanged; there is no approved full post-game replay destination. |
| Older Stage advisory | D: ineligible | No missing Compact history is fabricated. |

No legacy backfill is activated. A future normal Compact backfill would need
complete historic facts and trusted participant membership; old private-only
copies may lack the latter. Existing legacy archives continue through the safe
reader, and History continues to report their actual availability.

## Ordering, concurrency and ownership

`recent_game_items` has one row per `(source_kind, source_id,
participant_id)`, with a foreign key to the corresponding permanent History
row. It copies History's server completion timestamp only to support its page
index. The newest 20 sort by `(completed_at, source_kind, source_id)`
descending. A late duplicate cannot change the timestamp or revive an evicted
old game. `recent_retain_completed_source` takes transaction advisory locks for
all seated participants in UUID order, inserts missing relations, then deletes
all rows ranked after 20 for each participant. Different games finishing for
the same user serialize and converge; reverse player seating cannot invert the
lock order. The relation does not store a payload, result or listing duplicate.

The normal payload table is shared across both seats. Stage points directly to
its existing immutable completed-attempt record. Evicting one player's relation
does not delete another player's relation, shared payload, History, result,
stats, Stage attempt or economy. No payload cleanup runs in this milestone:
Stage's record has independent durable authority, and no normal payload writer
is active. Before enabling normal writes, a retention-aware cleanup policy
must account for both Recent and future Saved references. The temporary
retention **access** policy is already enforced by the relation; payload bytes
must not be left unbounded after normal activation.

The Stage trigger catches unexpected Recent storage errors in a subtransaction,
preserving its result and History. A missing relation can be reconciled by the
trusted service call; the ordinary Stage terminal retry is idempotent and does
not reorder the completion. Ranked, normal stats and bot economy have no new
write path here.

## Read and privacy contract

The History RPC pages metadata once, then joins Recent and current archive
sources in SQL. `is_recent` is computed at read time; replay availability is
also recomputed, so eviction cannot stale a History row. `archive-replay`
obtains a normal Recent payload through the service-only
`read_recent_game_payload(game_id, authenticated_user_id)` RPC, which checks
the relation and returns the record in one database statement. The Edge
function passes it through the existing private safe projection. Stage remains
available to its owner through the existing Stage source even after its Recent
indicator ages out. The browser has no table or raw RPC access and cannot
choose an owner or timestamp. The public projection can show approved final
rack faces, clocks and safe bot provenance; it excludes ordered bag/draws,
physical IDs, seal digest, hidden bot internals and secrets.

## Local measurements

The representative legal corpus remains the Compact benchmark source. Sizes
below are raw serialized bytes, not PostgreSQL JSONB disk usage or compressed
transport. The 40-action finished measurement includes a terminal event, so
it has 41 recorded turns; the 60-action finished measurement has 61.

| Finished fixture | Legacy `encodeGame` | Compact v1 | Reduction | 20 Compact payloads | Safe replay response |
| --- | ---: | ---: | ---: | ---: | ---: |
| 40 actions | 225,503 B | 40,647 B | 82.0% | 812,940 B | 220,986 B |
| 60 actions | 368,382 B | 54,818 B | 85.1% | 1,096,360 B | 415,465 B |

A 2,000-row fresh physical clone of the Recent relation measured 72 B average
tuple, 155,648 B heap, 401,408 B indexes, and 589,824 B total including
fixed/auxiliary pages. The local 23-row History page was one RPC and 10,747
JSON bytes. A trivial complete game's safe replay response was 499 B versus
1,569 B raw Compact, whereas long safe projections expand because they carry
visible positions. One 40-action payload is 40,647 B for two participants
with shared storage, versus 81,294 B if duplicated; each participant has a
small independent relation row. Stage adds no new payload copy at all.

These are local fixture measurements. They do not forecast production
compression, database TOAST, or final Sync Performance cost.

## Tests and remaining boundary

`recent_completed_games_smoke.sql` rolls back its fixtures and checks 19,
20, 21, >20, equal-timestamp ties, late retries, cross-user retention, Stage
capture, a simulated Recent storage failure, History independence, raw read
permissions and owner-only access. The opt-in local integration test exercises
parallel callbacks at capacity, duplicate calls, a replay read racing eviction,
safe projection, cross-user ownership and History availability. The existing
Stage endpoint test additionally checks automatic Recent capture. The
`recent_storage_benchmark.sql` fixture also rolls back.

The normal Compact trusted writer/cutover, its completion failure isolation,
and a payload cleanup policy are prerequisites to activating normal Recent.
Client-committed Stage intermediate moves remain a separate Competitive
Security boundary. Nothing here claims a Stage win is fully server-verified.
