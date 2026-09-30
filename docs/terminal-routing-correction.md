# Terminal-routing correction

Base: released candidate `85082b3e5c8c50a331929f26dc6fed7b4ee1ee05`.
Branch: `codex/terminal-routing-correction`, isolated worktree. Production is
unchanged during this correction/review track and remains at 35 migrations.

## Root cause and experiment ledger

Storage added a direct `room_live.room_purpose` read before either terminal Edge
call. The production-equivalent schema grants authenticated clients SELECT on
the approved opened-game columns, including `room_id` and `state`, but excludes
`room_purpose`. PostgreSQL reports the denied column selection as table error
42501. The previous normal finalizer used an authorized RPC without this read.
The earlier unit terminal tests granted the read through a mock; direct-Edge
integration tests bypassed the frontend routing step. Neither caught the gap.

1. A fresh disposable local 35-migration environment reproduced the exact
   production error through `commitRoomState`, with a real non-admin Auth user
   and actual PostgREST. The initial red run took 2.56 seconds including setup.
2. A repeated red run sent the identical authenticated user, state and revision
   directly to `normal-terminal`. The existing Edge capture succeeded while
   the frontend routing read still failed with 42501. This disproved an Edge
   authentication, invalid payload or stale revision explanation for the bug.
3. Adding only the proposed correction locally removed the routing failure.
   Raw purpose selection remains denied; real terminal capture is persisted.
4. Real frontend calls test normal/Stage completion, stale revisions,
   lost-response retries after live deletion, a fresh authenticated client,
   duplicate completion, History/Recent/Saved/Trash/restore/replay and denial
   for spectators, pending users, anonymous clients and Ranked callers.
5. The actual frontend/browser/engine Authur gate now finishes through the UI
   after four full-strength bot responses and verifies Compact and History
   persistence with exactly one funding consumption.

## Correction design

One additive migration, `20261001102600_terminal_routing.sql`, introduces
`get_game_terminal_route(uuid)`. It is a stable SECURITY DEFINER RPC with an
explicit search path and EXECUTE only for authenticated clients. It requires
an approved account (or the existing administrator policy) and returns only:

- `normal` for a live normal game's owner or frozen seated participant;
- `stage` for the live Stage's owner bound to its actual survival attempt;
- the same route from caller-owned immutable Stage capture or normal History
  metadata after successful completion has removed the live row;
- null for unavailable games, spectators, pending users and Ranked identities.

The RPC neither writes nor returns a board, rack, draw order, digest, ownership
identifier, join secret or internal configuration. Live routing selects only
four metadata columns. A client-controlled Stage-like name cannot choose a
route. The existing Edge adapters independently recheck identity, ownership,
purpose, revision, payload and terminal state; routing grants no write authority.
Their locking and idempotent receipts remain unchanged. A concurrent completion
between routing and capture is handled by those existing receipts.

`commitRoomState` calls that RPC, accepts only normal/stage, and invokes the
existing endpoint. An unavailable route stops with a generic error; RPC errors
retain their database details. There is no speculative fallback to another
endpoint and no name-based Stage retry heuristic.

## Entry-path and Storage-read audit

Normal manual/natural completion, Authur and other normal bots, lifecycle and
remote-state reconciliation converge on `commitRoomState`. Stage creation
freezes purpose and the attempt on the server; its completion uses that same
frontend seam. Retries after live-row deletion use durable server identity.
Ranked creates separate `ranked_matches` and commits actions exclusively through
the existing ranked Edge function; it never needs the room purpose read. The
new RPC returns no route for a Ranked identity even if the caller owns it.
Timeline switching/pruning uses the existing revision-aware timeline RPCs and
introduces no purpose or hidden-column read. Normal terminal capture still
reads parked timelines behind the existing server boundary.

The complete Storage diff's new direct frontend reads are the denied purpose
selection and AppShell's `room_id` existence probe. The latter has an existing
authenticated column grant and RLS; tests also prove an approved spectator can
read a public room ID but cannot resolve its terminal route. History/Recent and
Saved list/capacity/lifecycle use existing authorized RPCs. Save and completed
replay use existing Edge projections. Archive and private-library listing
select approved metadata columns, excluding raw snapshots; existing grant/RLS
and safe-replay tests remain the gate. No other Storage-introduced forbidden
client read was found.

## Security and scope

All 35 existing migration files, all Edge sources/bundles/configuration, engine
code, bot strength, allowance/Credit rules and cleanup behavior are unchanged.
No table/column grant or RLS policy is altered. The sole new privilege is
EXECUTE on the caller-authorized, two-value route RPC. Anonymous and service
roles have no EXECUTE; service-only capture functions and raw payload tables
retain their existing boundaries. No production query/mutation, push, deploy,
backfill, legacy conversion, expired-room cleanup or Live Sync work is part of
this correction phase. Local fixture grants and cleanup are confined to a new
loopback Supabase environment and do not change product permissions.

## Proposed rollout, only after explicit approval

1. Obtain and verify a fresh recovery point for the current 35-migration state
   and current data. The approved old snapshot contains the pre-release 19
   migrations and predates the committed smoke-game writes. It must be refreshed.
2. Read-only preflight: exact 35-version ledger and expected ACLs, frontend/main
   ancestry, unchanged existing Edge deployment identities. Confirm the normal
   dry run lists only this additive correction migration.
3. Apply the one new migration, reaching exactly 36. Independently verify its
   definition/ownership/caller grants and unchanged raw column/RLS boundaries.
   Existing frontend/Edge behavior is unchanged by installing this read-only RPC.
4. Release the corrected frontend with a history-preserving main update and
   verify the actual Vercel revision and PWA refresh. No Edge or engine deployment
   is required; do not rerun or alter the existing 35 migrations.
5. Resume the blocked owned-account production terminal/Storage smoke, inspect
   persisted data and complete the remaining accepted validation and monitoring.
   Do not treat local success as production release completion.

If a correction release fails, stop and follow the accepted forward-recovery
procedure. A frontend-only rollback does not revert the installed Storage
cutover. No broad raw SELECT grant or snapshot restore is an automatic fallback.

Exact validation receipts and independent review results are recorded outside
Git under `/Users/thitithat_tiankrajang/.codex/release-evidence/terminal-routing-correction`.
