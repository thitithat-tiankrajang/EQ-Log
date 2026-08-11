// ── Play snapshot cache ──────────────────────────────────────────────────────
//
// The gameplay component is mounted only for the Play route, so leaving Play and
// coming back destroys and rebuilds it from nothing. In remote mode that meant
// the board seeded to `null` on every return: a full-screen loader, then the
// board, every time — the "load → disappear → load" the player sees as a flash.
//
// This holds the last VALID game snapshot per room, in memory, so a remount can
// render it immediately and revalidate in the background. It is a RENDER SEED and
// nothing more:
//
//   • It is written only from AUTHORITATIVE state the client already adopted —
//     never from an optimistic, not-yet-confirmed local move — so a seed can
//     never be a position the server did not agree to.
//   • A newer revision never loses to an older one here, mirroring the same
//     revision ordering the sync layer enforces everywhere else.
//   • It never authorises a move. The server remains the only authority for any
//     mutation; this only decides what pixels to draw first.
//   • It lives in memory for the session only. Nothing is persisted, so no token
//     and no hidden state is ever written to disk — and a hard refresh simply
//     falls back to a normal load from the server.
//
// A room whose snapshot no longer applies (deleted, left) is forgotten so a
// later visit does not flash a game that is gone.

import type { GameState } from "./game";
import { revisionOf } from "./gameSync";

const snapshots = new Map<string, GameState>();

/**
 * Remember the latest authoritative snapshot for a room. A stale write — an
 * older revision of the same game arriving late — is ignored, so the cache can
 * only ever move forward. A different game in the same room replaces wholesale.
 */
export function remember(roomId: string, game: GameState): void {
  const existing = snapshots.get(roomId);
  if (existing && existing.gameId === game.gameId && revisionOf(existing) > revisionOf(game)) {
    return;
  }
  snapshots.set(roomId, game);
}

/** The last known snapshot for a room, if any. The caller renders it at once and
 *  revalidates; it must not treat it as authoritative for any mutation. */
export function get(roomId: string): GameState | undefined {
  return snapshots.get(roomId);
}

/** Drop a room's snapshot — it was deleted or left, and must not seed a return. */
export function forget(roomId: string): void {
  snapshots.delete(roomId);
}
