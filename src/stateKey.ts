// Content identity for a GameState.
//
// This answers exactly one question: are two states byte-for-byte the same
// position? It is NOT an ordering mechanism — which of two states is newer is
// decided by the server-assigned revision (`gameSync.ts`) and never inferred
// from content.
//
// Two uses remain, and both are equality tests:
//   • recognizing this client's own commit when it echoes back through the
//     realtime channel, so the echo does not read as someone else's move and
//     wipe a draft in progress;
//   • deciding whether local state has actually changed enough to be worth
//     writing at all.
//
// canonicalStringify sorts keys recursively because Postgres jsonb re-orders
// object keys, so a verbatim-stored object comes back sorted. Tile ids are
// compared like any other field: they are stable manifest ids now, so two
// clients holding the same position produce the same key, and a position where
// a DIFFERENT physical tile sits in the same slot correctly compares unequal.

import {
  aggregatePendingExchangeReturns,
  getGameMode,
  getPendingExchangeReturnBySide,
  getTileDrawMode,
  type GameState,
} from "./game";

export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item === undefined ? null : item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    if (record[key] === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalStringify(record[key])}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * Content key for a position. Deliberately excludes `revision` — the key must
 * identify the position itself, so that a confirmed commit (same content, new
 * revision) is recognized as the position this client already has.
 */
export function makeRemoteStateKey(game: GameState): string {
  return canonicalStringify({
    activeSide: game.activeSide,
    board: game.board,
    gameId: game.gameId,
    gameMode: getGameMode(game),
    historyIndex: game.historyIndex,
    logs: game.logs,
    name: game.name,
    phase: game.phase,
    playerUserIds: game.playerUserIds,
    playerEmails: game.playerEmails,
    emailPlayMode: game.emailPlayMode,
    emailPlayersCanSeeOpponentRack: game.emailPlayersCanSeeOpponentRack,
    matchControl: game.matchControl,
    roomStage: game.roomStage,
    lobbyReadyBySide: game.lobbyReadyBySide,
    players: game.players,
    pendingExchangeReturn: aggregatePendingExchangeReturns(getPendingExchangeReturnBySide(game)),
    pendingExchangeReturnBySide: getPendingExchangeReturnBySide(game),
    rackA: game.rackA,
    rackB: game.rackB,
    scores: game.scores,
    status: game.status,
    tileDrawMode: getTileDrawMode(game),
    tilebag: game.tilebag,
    timers: {
      initialSeconds: game.timers.initialSeconds,
      initialSecondsBySide: game.timers.initialSecondsBySide,
      sideUntimed: game.timers.sideUntimed,
      minSeconds: game.timers.minSeconds,
      paused: game.timers.paused,
      untimed: game.timers.untimed,
    },
    turnNumber: game.turnNumber,
  });
}
