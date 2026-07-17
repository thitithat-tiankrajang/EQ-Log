// Content-identity key for a GameState, used to recognize this client's own
// Supabase write when it echoes back through the realtime channel.
//
// The key must identify a game by CONTENT, not object identity:
//  • codec.ts regenerates every tile id on decode, so the echo of this
//    client's own write comes back with different tile ids.
//  • Postgres jsonb re-orders object keys, so verbatim-stored objects
//    (logs, actionDetail, …) come back with sorted keys.
// canonicalStringify sorts keys recursively and drops "id" fields so the
// local key and the decoded-echo key match. Without this, applyRemotePayload
// treats every self-echo as an external change and wipes the in-progress
// draft (placed tiles vanish from both rack and board).

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
    if (key === "id" || record[key] === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalStringify(record[key])}`);
  }
  return `{${parts.join(",")}}`;
}

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
