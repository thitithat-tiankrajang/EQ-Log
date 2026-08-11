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
 * The fields the key is built from, in one place.
 *
 * Split out so `remoteStateIdentity` below cannot drift from what is actually
 * serialized: both walk this object, one stringifying it and one taking the
 * identity of its parts.
 */
function keyedFields(game: GameState) {
  return {
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
  };
}

/**
 * Content key for a position. Deliberately excludes `revision` — the key must
 * identify the position itself, so that a confirmed commit (same content, new
 * revision) is recognized as the position this client already has.
 *
 * **This is O(the whole game history.)** `logs` holds two full board snapshots
 * and two full bags per turn, and every one of them is walked and sorted here.
 * At turn 40 that is tens of thousands of objects. Call it when the POSITION
 * changes, and only then — see `remoteStateIdentity`.
 */
export function makeRemoteStateKey(game: GameState): string {
  return canonicalStringify(keyedFields(game));
}

/**
 * A cheap stand-in for "has the keyed content changed?".
 *
 * The running clock rewrites `game` and `game.timers` once a second, and the
 * board, racks, bag and logs keep their identities across that rewrite because
 * every update in this codebase is a shallow spread. So comparing the IDENTITY
 * of each keyed part answers, in a few dozen reference comparisons, the question
 * `makeRemoteStateKey` was answering by serializing the entire match.
 *
 * The timer VALUES (`timers.A`, `timers.B`) are deliberately absent, exactly as
 * they are absent from the key: a tick changes what is displayed, never what is
 * synchronized. Every scalar the key does read is included by value, so a
 * settings change still registers.
 *
 * Correctness rests on one property: nothing mutates a keyed sub-object in
 * place. `remote-state-identity.test.ts` pins the two halves against each other.
 */
export function remoteStateIdentity(game: GameState): readonly unknown[] {
  const fields = keyedFields(game);
  return [
    fields.activeSide,
    fields.board,
    fields.gameId,
    fields.gameMode,
    fields.historyIndex,
    fields.logs,
    fields.name,
    fields.phase,
    fields.playerUserIds,
    fields.playerEmails,
    fields.emailPlayMode,
    fields.emailPlayersCanSeeOpponentRack,
    fields.matchControl,
    fields.roomStage,
    fields.lobbyReadyBySide,
    fields.players,
    // Rebuilt arrays: compare their contents' identities, not the wrapper's.
    ...fields.pendingExchangeReturn,
    fields.pendingExchangeReturn.length,
    fields.pendingExchangeReturnBySide.A,
    fields.pendingExchangeReturnBySide.B,
    fields.rackA,
    fields.rackB,
    fields.scores,
    fields.status,
    fields.tileDrawMode,
    fields.tilebag,
    fields.timers.initialSeconds,
    fields.timers.initialSecondsBySide,
    fields.timers.sideUntimed,
    fields.timers.minSeconds,
    fields.timers.paused,
    fields.timers.untimed,
    fields.turnNumber,
  ];
}

/**
 * `makeRemoteStateKey`, skipped when nothing it reads has changed.
 *
 * Stateful by design: it holds the last identity and the key that went with it.
 * One instance per caller — `createRemoteStateKeyCache()` rather than a module
 * singleton, so two rooms cannot share a slot and invalidate each other.
 */
export function createRemoteStateKeyCache(): (game: GameState | null) => string {
  let last: { identity: readonly unknown[]; key: string } | null = null;
  return (game) => {
    if (!game) return "";
    const identity = remoteStateIdentity(game);
    if (
      last &&
      last.identity.length === identity.length &&
      last.identity.every((value, index) => Object.is(value, identity[index]))
    ) {
      return last.key;
    }
    const key = makeRemoteStateKey(game);
    last = { identity, key };
    return key;
  };
}
