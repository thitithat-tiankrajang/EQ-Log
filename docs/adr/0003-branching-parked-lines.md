# 3. Branching keeps the played line straight and parks the rest beside the game

Date: 2026-09-23

Status: Accepted. Supersedes the unimplemented design in `EDIT_BOARD_BRANCHING_DESIGN.md`
(one database row per turn) and the `parentId`-on-every-log prototype.

## Context

Players want to go back to an earlier turn, play something else, and keep what was played:
a transcriber trying the move that should have been made, a player asking what would have
happened against the bot. That makes a game's history a tree.

Two things about the existing system constrained how.

**Everything reads `game.logs` as one line.** Scoring, the end-of-game rules, the bot, the
archive (`snapshot_completion_reason`), stats and the turn log all assume it. Turning it into
a tree means auditing every reader, on the client and in SQL, and every one missed is a
silent scoring or archiving bug.

**The live state is already heavy and written on every move.** A 20-turn game's
`room_live.state` measured 154 KB, walked by `sanitize_game_snapshot` twice per commit and
pushed to every player by Realtime. Anything stored inside it is paid for on every move.

## Decision

1. **`game.logs` is always the line being played.** Nothing that reads it changes.
2. **Every other line is parked** in one document per game (`src/gameplay/multiverse.ts`):
   the turns after a fork point, the exact position each was committed with, and the position
   the line was left at. Positions are copied from `game.history` — the snapshot the game
   already pushes on every commit — never re-simulated from moves. "Before turn N" is turn N
   reverted from its own before-fields, and proven against the 100-tile set before use.
3. **Parked lines live beside the game**: `game_timelines` (one row per live game) remotely,
   one local-storage key per room locally. The live state carries only
   `timelineRef = { version, lines }`, which is part of the state key so another device
   notices a change and fetches the document.
4. **A branch is one transaction**: `commit_live_game_timeline` runs the ordinary conditional
   commit and rewrites the document, conditional on both the game revision and the document
   version. Pruning (`update_live_game_timeline`) may only remove whole lines.
5. **Finishing folds the lines into the archive** (`snapshot.timeline`) by trigger, then drops
   them with the live row, so archived games stay self-contained.
6. **The UI never draws the tree in the turn log.** The log shows one line with fork badges;
   the Turn Log Map shows the whole tree.

## Consequences

- A game that never branches pays nothing: no row, no fetch, no bytes in its state.
- A branched game's moves cost what they cost before; its lines cost about 1.3 KB per parked
  turn, written only when a line is parked, restored or pruned.
- Continuing is exact or refused. A turn with no recorded position can be viewed but not
  continued from; the UI says so.
- Undo history is reset by a branch or a switch: it belongs to the line that was left.
- Branching needs `supabase/multiverse_timeline_migration.sql`. Without it, games that never
  branch are unaffected, and a branch attempt fails with a message naming the file.
