# Phase B — trusted tentative live sync (protocol)

Date 2026-10-03 · base `12b12ce` · local only (not pushed, not deployed).

## Scope

During an Online Match, the opponent sees the active player's **current tentative board tiles** before Commit. Nothing else is synchronized: not rack selection, cursor, picker, Notes, sheets, rack order, or the rack itself. No tentative history is stored, replayed or reconstructed.

## Pre-change architecture (audit)

| Question                      | Answer from the code                                                                                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport                     | `live-game` Edge function (JWT-verified POST) for every command and read; Supabase Realtime for notification only                                                                                                                                                     |
| Realtime channels             | one private channel per game, `game:<id>`; the server sends an empty `commit` ping (`{gameId, revision}`) via `realtime.send` from SQL; clients then re-read their recipient projection. Readers: `can_read_live_game` — includes approved spectators of public games |
| Authoritative position        | `room_live.revision`, server-owned, incremented by every committed command (move, Pass, Exchange, control, host/physical action); completion deletes the row                                                                                                          |
| Seat authentication           | the caller's JWT (`auth.getUser`), matched against `room_live.player_a_user_id / player_b_user_id`; never request-supplied                                                                                                                                            |
| Whose turn                    | `activeSide` (and `phase`) in the authoritative decoded state                                                                                                                                                                                                         |
| Public information for a tile | square + the tile's kind (token) + an alternative's chosen face — exactly what a physical board shows                                                                                                                                                                 |
| Ephemeral carrier             | Realtime **broadcast** (no table writes) — the HTTP broadcast API from the Edge function with the service role; receive authorization by `realtime.messages` select policies                                                                                          |
| Reconnect today               | the client re-subscribes and re-reads the projection; there is no event history                                                                                                                                                                                       |
| Draft model                   | `useTurnDraft.placements`: `{tile, row, col, assignedToken?}` per tentative tile; local only                                                                                                                                                                          |
| Clients broadcasting          | impossible: no insert policy on `realtime.messages`                                                                                                                                                                                                                   |

## Threat model

The sender browser is untrusted (any request content, any timing, replays). The opponent and spectators may try to read what they must not. Assets: the sender's unplaced rack tiles, the bag order, RNG, canonical history. Rule: **server validates; browser proposes**; the relay forwards only a message it builds itself.

## Transport

```
active browser ──POST live-game {operation:"tentative", …}──▶ trusted relay (Edge)
   validate against room_live (auth, seat, turn, revision, rack, squares, faces)
   ──HTTP Realtime broadcast (service role, private)──▶ topic tentative:<game>:<opponent user id>
opponent browser (subscribed to its own tentative topic) ──▶ overlay
```

- **Recipient topic** `tentative:<gameId>:<recipientUserId>`; joinable only by that user while seated in that Online Match (`live_tentative_receive` policy + `can_receive_live_tentative`, migration `20261003120000_live_tentative_relay.sql`). Spectators and the sender cannot join it; nobody can send on it.
- **No durable writes per event**: the broadcast API does not write `realtime.messages` (measured: 0 rows for tentative topics).

## Schema

Proposal (browser → relay), strict keys, ≤ 2048 bytes, ≤ 8 tiles:

```
{ operation: "tentative", id: <game uuid>, revision: <int>, seq: <int>,
  tiles: [ { tileId: <own rack tile id>, row: 0–14, col: 0–14, face?: <chosen face> } ] }
```

Message (relay → opponent), built by the relay:

```
{ gameId, revision, seq, side: "A"|"B", tiles: [ { row, col, kind, face? } ] }
```

**Snapshot, not operations.** Each message is the sender's whole current public set; CLEAR is the empty set. A dropped, duplicated or reordered message is corrected by the next one — eventual convergence without a refresh, and without needing history. PLACE/MOVE/REMOVE/CLEAR are just different snapshots.

## Epoch identity

Epoch = `room_live.revision` (server-owned). The relay accepts a proposal only when `proposal.revision === room_live.revision` **and** the sender's seat is `activeSide` **and** `phase === "choose_action"`. Any commit (Commit, Pass, Exchange, Surrender, Finish, timeout, host/physical action, control) advances the revision; completion deletes the row (relay → 404). The receiver draws a message only when `message.revision === the revision of the board it shows`, so the commit's projection and the overlay's disappearance happen in the **same render**.

## Ordering

`seq` = sender-chosen, strictly increasing (microsecond timestamp, monotonic even if the clock stalls or steps back). The relay bounds it (≥ now − 10 min, ≤ now + 60 s). The receiver keeps one message: a newer epoch replaces an older one; within an epoch only a higher `seq` replaces; older epochs, older/duplicate `seq` are ignored. A message for an epoch the board has not reached yet is held and appears when the board catches up; it is never drawn on another epoch.

## Validation (relay)

Authenticated user · seated participant · seat == active side · game playing, not paused, not finished · mode capability (below) · revision matches · seq bounded · every `tileId` is in the sender's CURRENT rack · no duplicate tile · no two tiles on one square · square on the board and free · `face` only on an alternative tile and only a legal option · strict keys (any extra/private field → 400) · size/tile-count limits · per-sender rate limit (token bucket: 20 burst, 10/s; 429). The reply carries no game data.

## Public tile representation

The opponent learns only what a physical board shows: square, tile kind (e.g. `7`, `+`, `+/-`, `?`), and — for an alternative tile — the chosen face once chosen. An unassigned alternative shows as its kind (the physical tile face: both signs, or a blank). Tile ids (manifest ordinals) are sent to the relay to prove ownership and are never forwarded.

## Lifecycle, reconnect, cleanup

- **Sender**: optimistic — the draft renders immediately; publishing is asynchronous, one request in flight, later changes collapse into the latest set (coalescing). A new epoch needs no CLEAR (the receiver discards old epochs); a reloaded sender sends one CLEAR to replace any overlay it left behind. Rejections (stale revision, finished game) are ignored: the authoritative projection wins. 429 → the latest set is resent after 300 ms.
- **Receiver reconnect**: starts empty; no history; the next update shows the current set.
- **Cleanup**: there is no server state to clean. The receiver's single held message is invisible as soon as its epoch is not the board's.

## Mode capability (server-derived)

`tentativeSync` in the recipient projection, true only for a **seated** viewer when `tentativeSyncAllowed`: `mode_key = online_versus`, `purpose = normal`, `server-v1`, `emailPlayMode = direct`, not solo, no bot, two distinct seats.

| Mode                                   | V1  | Why                                                        |
| -------------------------------------- | --- | ---------------------------------------------------------- |
| Online Match                           | ON  | two authenticated seats on their own devices               |
| Ranked                                 | OFF | separate authority (`ranked` function); rated play — later |
| Pass & Play (both variants)            | OFF | one device                                                 |
| Hosted / Physical Hosted / Hosted Solo | OFF | host-recorded play; not V1                                 |
| Solo, Authur, ArchBot, Stage           | OFF | no human opponent                                          |
| Spectators (any mode)                  | OFF | never a recipient                                          |

## Failure handling

Relay errors never block the local draft. Dropped/duplicated/reordered messages are corrected by later snapshots. A lagging receiver never draws a message on the wrong epoch. Completion → 404, nothing broadcast.

## Security invariants

1. The relay builds every forwarded message; no request field is forwarded.
2. Only the current active seat's own rack tiles, at free squares, in the current epoch.
3. Exactly one recipient per message (the seated opponent); spectators cannot join.
4. No rack, bag, RNG, canonical history, tile ids or account data in messages.
5. No durable storage of tentative state; no replay; Replay/History unaffected.
6. Authoritative committed projection always wins (epoch filter at render).
