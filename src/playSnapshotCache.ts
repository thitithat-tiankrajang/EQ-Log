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
//   • It is mirrored to this tab's sessionStorage. Mobile browsers routinely
//     discard a backgrounded page and rebuild it when the player returns; an
//     in-memory-only cache turns that into a full-screen reload. sessionStorage
//     survives that rebuild but remains scoped to this tab and is cleared when
//     the tab is closed.
//
// A room whose snapshot no longer applies (deleted, left) is forgotten so a
// later visit does not flash a game that is gone.

import type { GameState } from "./game";
import { deserializeGame, serializeGame } from "./codec";
import { revisionOf } from "./gameSync";

const snapshots = new Map<string, GameState>();
const STORAGE_PREFIX = "eq-lab:play-snapshot:v1:";

function storageKey(roomId: string): string {
  return `${STORAGE_PREFIX}${roomId}`;
}

function restore(roomId: string): GameState | undefined {
  try {
    const raw = window.sessionStorage.getItem(storageKey(roomId));
    if (!raw) return undefined;
    const game = deserializeGame(raw);
    if (!game) {
      window.sessionStorage.removeItem(storageKey(roomId));
      return undefined;
    }
    snapshots.set(roomId, game);
    return game;
  } catch {
    // Storage can be unavailable (private browsing/quota) or contain a damaged
    // snapshot. The authoritative room load remains the safe fallback.
    try {
      window.sessionStorage.removeItem(storageKey(roomId));
    } catch {
      // Storage itself is unavailable.
    }
    return undefined;
  }
}

/**
 * Remember the latest authoritative snapshot for a room. A stale write — an
 * older revision of the same game arriving late — is ignored, so the cache can
 * only ever move forward. A different game in the same room replaces wholesale.
 */
export function remember(roomId: string, game: GameState): void {
  const existing = snapshots.get(roomId) ?? restore(roomId);
  if (existing && existing.gameId === game.gameId && revisionOf(existing) > revisionOf(game)) {
    return;
  }
  snapshots.set(roomId, game);
  try {
    window.sessionStorage.setItem(storageKey(roomId), serializeGame(game));
  } catch {
    // Rendering can still use the in-memory seed; persistence is best effort.
  }
}

/** The last known snapshot for a room, if any. The caller renders it at once and
 *  revalidates; it must not treat it as authoritative for any mutation. */
export function get(roomId: string): GameState | undefined {
  return snapshots.get(roomId) ?? restore(roomId);
}

/** Drop a room's snapshot — it was deleted or left, and must not seed a return. */
export function forget(roomId: string): void {
  snapshots.delete(roomId);
  try {
    window.sessionStorage.removeItem(storageKey(roomId));
  } catch {
    // Storage itself is unavailable.
  }
}
