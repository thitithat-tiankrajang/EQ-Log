// ── Which of two states is newer ─────────────────────────────────────────────
//
// One number decides it: the revision the server assigned.
//
// This replaces a heuristic that inferred ordering from the shape of the game —
// comparing log lengths, then turn numbers, then a rank over statuses, then a
// rank over phases, and finally falling back to wall-clock timestamps written
// by whichever device happened to make the change. That ordering was not total
// (two genuinely different states could compare equal), not consistent across
// clients (device clocks disagree), and not monotonic (an action that shortens
// the log, or a lifecycle change that lowers the phase rank, read as "older"
// and was discarded). A committed turn could be dropped as stale.
//
// Revisions have none of those properties to get wrong. They come from one
// place, they only ever increase, and comparing them is exact.

import type { GameSnapshot, GameState } from "./game";

/** Games saved before revisions existed read as 0: old, never ahead. */
export function revisionOf(game: Pick<GameSnapshot, "revision">): number {
  const revision = game.revision;
  return Number.isFinite(revision) && (revision as number) >= 0 ? (revision as number) : 0;
}

export function withRevision<T extends GameSnapshot>(game: T, revision: number): T {
  return { ...game, revision };
}

/**
 * True when `remote` is a position this client has not reached.
 *
 * A different game is always "ahead": it is not a comparison at all, it is a
 * different subject, and the caller must adopt it wholesale.
 */
export function isRemoteGameAhead(local: GameState, remote: GameState): boolean {
  if (remote.gameId !== local.gameId) return true;
  return revisionOf(remote) > revisionOf(local);
}

/**
 * True when `remote` carries nothing this client has not already applied.
 *
 * Delayed delivery, duplicate delivery and a slow read racing a fast one all
 * land here, and all are discarded — an older revision can never overwrite a
 * newer one.
 */
export function isRemoteGameStale(local: GameState, remote: GameState): boolean {
  if (remote.gameId !== local.gameId) return false;
  return revisionOf(remote) < revisionOf(local);
}

/**
 * True when the two are the same position. By construction they then hold the
 * same committed state, so a disagreement here is a real divergence and worth
 * reporting rather than resolving locally.
 */
export function isSameRevision(local: GameState, remote: GameState): boolean {
  return remote.gameId === local.gameId && revisionOf(remote) === revisionOf(local);
}
