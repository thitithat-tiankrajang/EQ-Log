# Milestone 8: replay source and retention audit

This audit was made before adding Recent. History remains the permanent,
metadata-only participation index. Recent is a separate, evictable relation to
an existing immutable completed payload.

| Completion path | Current full replay source | Ownership and lifetime | Recent eligibility at this milestone |
| --- | --- | --- | --- |
| Normal, Solo, bot, Hosted | Legacy `public_game_snapshots` or `region_game_snapshots`, or a `private_library_items.snapshot`; `archive_policy = none` saves none | Public/Region rows are pruned; Private rows belong to the room owner, count against the existing library limit, and can be trashed/deleted. The owner may be a non-playing Host. | Existing legacy archive remains readable through the safe endpoint, but it is not a durable Recent source. A normal Compact writer is not active. |
| Stage | `stage_completed_attempts.record`, Compact v1 | Immutable, owner-only, bound to a server-created attempt and sealed opening. The intermediate moves and scoring remain client-committed. | Eligible now: a Recent relation points to this already stored payload, without a second copy. |
| Ranked | `ranked_matches.state` and `ranked_private_revisions` | Service-side result/rating reduction, but the revisions have no approved post-game replay destination or safe projection. | Ineligible until a complete approved terminal record and read path exist. |

The normal finalizer writes legacy snapshots from the submitted finished state.
Its Private insert can hit `private library quota reached`; the History wrapper
then commits result/stat/History without replay. Public and Region pruning can
remove a replay at any later time. Merely pointing Recent at one of those rows
would break the 20-game retention promise; copying it would create a new
client-trusted full payload outside the approved Compact capture gate. Neither
is activated here. The safe `archive-replay` reader currently checks Public,
Region, the signed-in owner's untrashed Private item, then the signed-in Stage
owner's completed record. It projects a decoded record and never sends raw
draw order, physical tile IDs, seals or hidden bot internals.

The new relation will use the authoritative History completion timestamp and
source identity for deterministic order. Stage will populate it in the same
terminal transaction as its record and History. A dormant shared Compact
payload table and service-only retention function provide the normal writer's
future contract, with no caller in the normal finalizer. There is no browser
timestamp, ownership insert, or raw-payload read path.
