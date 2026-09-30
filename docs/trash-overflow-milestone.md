# Milestone 10 — Trash, Overflow, and legacy migration

This milestone extends Saved ownership without changing Compact v1 or the live
move protocol. The pre-implementation source trace is in
`docs/trash-overflow-source-audit.md`. All changes are local and uncommitted.

## Lifecycle and authority

| State | Counts toward capacity | Replay retained | Allowed user actions |
| --- | --- | --- | --- |
| Active | Yes | Yes | Trash |
| Trash | No | Yes | Restore if capacity permits; permanent delete |
| Overflow | No | Yes | Activate if capacity permits; Trash |

An absent item can be explicitly Saved only if the user has a completed
History seat, an eligible replay source, and an available active slot. A new
Save at capacity fails; it never creates Overflow. Trash and Overflow do not
promote automatically. Restore and Activate acquire the same account lock as
Save and plan reconciliation. Permanent delete is idempotent and only removes
ownership from Trash. History and independent Recent retention survive.

The deterministic downgrade policy keeps the oldest Active ownership, ordered
by `saved_at, source_kind, source_id`; newest excess becomes Overflow. It
preserves the games retained longest and uses source identity only to break an
exact timestamp tie. Explicit plan revocation reconciles in its transaction;
Saved and History reads/writes reconcile elapsed plan expiry before reporting
state. A later upgrade does not automatically activate Overflow.

## Completion cutover

New private rooms, including bot rooms, retain private access but use
`archive_policy = none`; they do not reserve old Private Library quota or
automatically consume Saved capacity. Normal terminal capture produces a
client-reported Compact v1 payload for Recent, then History, result, and stats
through the established finalizer. This is a terminal storage boundary, not
server verification of intermediate moves or scores.

The migration marks existing live private rooms as the legacy autosave cohort.
They remain live and resumable; no completed record is fabricated for them.
When one finishes, the old private archive still records its result. The
terminal transaction also gives its seated owner Active Saved ownership if a
slot exists, or Overflow if full. The old Private Library quota cannot block
this completion. For incomplete old history, the exact v3 snapshot and any
parked branch document are frozen as **legacy**, with no false Compact or
Recent label. A nonseated Hosted owner retains the old private archive but is
not given a participant Saved relation.

Normal terminal capture is revision and timeline-version checked, locks the
live row, and is idempotent after room deletion. Concurrent/retried capture
cannot insert a second result, duplicate Recent reference, or duplicate
legacy ownership. A failure to retain optional Recent never rolls back an
established result. The client-trusted gameplay authority remains explicitly
`client_reported` in History and `client-reported` in Compact provenance.

## Migration

`migrate-saved-legacy` is service-key only and defaults to dry run. It pages
old Private Library game rows in `(created_at, id)` order with a maximum of 50
per request. Its cursor carries the dry-run active count and plan capacity so
a multi-page estimate does not restart capacity allocation on each page. A
capacity change invalidates the dry-run cursor. Actual writes take an account
lock and calculate the current authoritative plan capacity again.

Only an original private source with matching external archive identity, a
seated owner History row, a decoder-valid finished v3 snapshot, matching
recorded scores, and a safe replay projection is eligible. The internal v3
game ID may differ from the external room/archive ID. Eligible existing Trash
stays Trash. Eligible excess becomes Overflow. A duplicate source produces one
Saved relation. The ledger makes reruns idempotent and prevents an old row from
resurrecting ownership after permanent deletion. No old row is rewritten or
deleted, and migration never invents a Compact payload or History fact.

Old v1/v2, incomplete, ambiguous, copied, nonparticipant-owned, and
in-progress sources remain on their existing readable/resumable path. Old
folders and their cascade behavior remain compatibility-only; Saved does not
use them. Old Trash is never purged by this migration.

The isolated dry run covered one eligible Overflow source, one eligible old
Trash source, one incomplete/ambiguous source, one duplicate source, and one
already processed source. A bounded two-row cursor produced the same aggregate
classification. The in-progress room report counted a live legacy room without
creating a completed item.

## Replay references and access

Recent, Active, Trash, and Overflow all retain a shared Compact payload.
Frozen legacy v3 payloads use the same reference rule. Trusted cleanup takes
the source lock and refuses deletion while any relevant relation remains.
The safe replay endpoint returns projected positions, never the raw record,
tile IDs, bag order, or private draw facts. The browser has no direct write or
raw-read privilege on Saved rows, migration ledger, or payloads. Transition
RPCs derive ownership and capacity on the server. Migration and terminal
capture RPCs are service-only.

## Preliminary metadata measurement

Fresh temporary physical clones of the Saved relation, including indexes,
produced these local PostgreSQL measurements. State transitions update only
relation metadata and do not duplicate replay payload bytes.

| Scenario | Rows | Mean tuple | Heap | Indexes | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Free, 100 Active | 100 | 97 B | 16,384 B | 65,536 B | 114,688 B |
| Plus/Pro, 1,000 Active | 1,000 | 97 B | 114,688 B | 466,944 B | 614,400 B |
| Downgrade, 100 Active + 900 Overflow | 1,000 | 104 B | 221,184 B | 647,168 B | 901,120 B |
| 80 Active + 20 Trash | 100 | 97 B | 16,384 B | 81,920 B | 131,072 B |

The update scenarios include dead tuples and index entries until vacuum;
their physical sizes are not steady-state capacity forecasts. Milestone 12
will handle performance and cost gates.

## Scope limits

Old Private Library folders, copies, and old Trash remain accessible by their
legacy UI. The new Saved view has no folders. An incomplete old replay stays
legacy and may not be fully branchable even though its exact snapshot and
parked timeline are retained. A nonseated Hosted owner's old private archive
does not become Saved. New normal games with incomplete history can still
finish through the established finalizer, but cannot truthfully claim Compact
Recent replay. Competitive verification of ordinary client-submitted moves is
a separate trust-boundary project.
