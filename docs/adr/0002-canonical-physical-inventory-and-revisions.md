# 2. Canonical physical inventory and revision-ordered synchronization

Date: 2026-08-11

Status: Accepted

## Context

The application represents one real A-Math set: exactly 100 physical tiles that
move between the bag, two racks, the board, and a holding area for tiles just
exchanged out. That set is closed. Tiles do not appear, vanish, duplicate, or
change into other tiles.

The synchronization layer could not guarantee any of that.

**Identity was destroyed on every read.** The storage codec recorded a tile as
its face ("this is a 5") and minted a fresh random id on decode, on the stated
reasoning that ids were labels nothing referenced. They were referenced — by the
board, by drafts in flight, and by every other client reading the same row. Two
readers of one saved game therefore disagreed about which tile was which, and a
client's own write echoed back as an unrecognizable stranger.

**Ordering was inferred from content.** Which of two states was newer was
decided by comparing log lengths, then turn numbers, then a rank over statuses,
then a rank over phases, and finally by wall-clock timestamps written by
whichever device made the change. That relation was not total, not consistent
between clients, and not monotonic: an action that shortened the log, or a
lifecycle change that lowered the phase rank, read as *older* and was discarded.
A committed turn could be dropped as stale.

**Writes were unconditional.** `sync_live_game_state` accepted any state from
any writer at any time. Two players acting on the same position both succeeded
and the later arrival won, whatever it contained.

**Nothing checked the physical set.** The only guard looked for repeated tile
ids. It caught a duplicated tile but not a lost one, an invented one, or one
whose face no longer matched its identity — and on failure it silently skipped
the write rather than reporting the corruption.

**Spectators cost authoritative work.** Every observer subscribed to row changes
carrying the full record, which embeds a board and two rack copies per turn
played, so both per-observer cost and payload size grew with the game.

## Decision

### The inventory is one value, and the invariants are structural

`src/domain/inventory.ts` holds the whereabouts of all 100 tiles as a
fixed-length table indexed by tile ordinal:

    inventory[ordinal] = the single authoritative location of that tile

This makes the hard requirements structural rather than checked: exactly 100
slots, index *is* identity, one slot holds one location. A move overwrites a
slot; it cannot add or remove one. What remains genuinely checkable — two tiles
on one square, ordering keys not dense, a played face on a tile that has none —
is checked by `assertInventory` on every committed transition.

The physical invariant in this domain's vocabulary is:

    bag ⊎ rackA ⊎ rackB ⊎ pendingReturnA ⊎ pendingReturnB ⊎ board
      = exactly the 100 manifest tiles, each in exactly one place

`pendingReturn` is a real location, not bookkeeping: an exchanged-out tile has
left the rack and has not yet re-entered the bag. Omitting it is what let tiles
appear to vanish mid-exchange.

### Identity is an ordinal, and the tile's type is derived from it

`src/domain/tiles.ts` fixes the manifest of 100 tiles. A tile's intrinsic token
is `tokenOfOrdinal(ordinal)` over a frozen table, never a field stored beside
it — so a tile cannot silently change what it is, because there is nothing to
write. Only how a tile is *used* (a blank's played face) is mutable, and that
lives on the placement.

The codec (v3) stores the ordinal, so encode/decode preserves identity. Games
saved in v1/v2 never recorded per-copy identity; it is recovered once, on the
way in, by a fixed traversal (`src/domain/identity.ts`). Because the set is
closed the multiset of faces determines the multiset of tiles exactly, so this
is a canonical relabelling rather than a guess, and every client recovers the
same one.

### One number decides ordering

`room_live.revision` is the authoritative position: monotonic, +1 per committed
change, assigned by the server. `gameSync.ts` compares nothing else. The content
key (`stateKey.ts`) is kept only for the question it can answer — "is this
byte-for-byte the position I already hold?" — which is how a client recognizes
its own commit echoing back without mistaking it for someone else's move.

### Writes are conditional, idempotent and atomic

`commit_live_game_command` locks the game row, refuses a command composed
against a superseded revision (`conflict`), returns the earlier effect for a
command id it has already seen (`duplicate`), and otherwise appends one
immutable row to `live_game_events` and moves the head — in one transaction, so
a client can never read a revision whose event was not recorded.

`src/domain/canonical.ts` implements the same contract as a pure reducer, with
deterministic replay from genesis plus the ordered log, used by the tests and
available for in-process authorities.

### Spectators are cheap readers

Observers follow a broadcast topic instead of row changes. The server publishes
once per move; the payload is the canonical placement table — around a hundred
short entries, the same size on move 200 as on move 1. Topic access is
authorized once, when the observer joins, rather than per subscriber per change.
Each message is self-sufficient at its revision, so a missed one costs nothing.

### Impossible states are reported, never repaired

Decoding a payload that is not the 100-tile set throws with the specific
problems listed. Publishing derives the canonical table first, so a bad position
fails before it reaches the database. Nothing invents, deletes or substitutes a
tile to make the numbers work.

## Consequences

- `supabase/canonical_revision_migration.sql` must be applied. It retires
  `sync_live_game_state`; a client that has not been reloaded gets an explicit
  error rather than an unconditional write.
- Deployments that applied an earlier copy of that migration must also apply
  `supabase/room_live_revision_acl_repair.sql`; it restores authenticated reads
  of the non-sensitive revision counter without exposing canonical payloads or
  other internal Live Game columns.
- Deployments whose End Game action fails with `committed game events are
  immutable` must apply `supabase/live_game_event_cascade_repair.sql`. Direct
  event mutation remains forbidden by table ACL/RLS, while the update trigger
  prevents trusted SQL from rewriting an event. Event deletion is left to the
  `room_live` foreign-key cascade so every lifecycle cleanup path can complete.
- A game that really has lost or duplicated a tile now refuses to open, with
  diagnostics, instead of rendering a board that is quietly wrong.
- Canonical state is authoritative for the physical set and turn control. The
  rendered record still carries the non-physical parts (names, timers, match
  control, turn logs) and is stored alongside it.
- The client computes the canonical state it publishes; the database orders and
  arbitrates but does not re-derive it. Divergence is detectable — the event log
  is authoritative for ordering and every state carries a digest — but not yet
  prevented at the server. Re-deriving state server-side is the next hardening
  step.
