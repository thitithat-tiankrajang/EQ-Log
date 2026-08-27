// The state key is memoized on object identity (`canonicalStringify`), which is
// what makes it affordable to compute per interaction on a long match. That
// trade rests on one property, and these tests are what hold it:
//
//   nothing in a GameState is ever mutated in place.
//
// If it were, a memoized sub-structure would keep returning the string it
// produced before the mutation, and two genuinely different positions would
// compare equal — the state key's single job. So: identical content must give an
// identical key, and any change anywhere must give a different one.

import { describe, expect, it } from "vitest";

import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { createNewGame, type GameState, type TurnLog } from "../src/game";
import { canonicalStringify, makeRemoteStateKey } from "../src/stateKey";

function withLogs(game: GameState, count: number): GameState {
  const logs = Array.from({ length: count }, (_, i) => ({
    id: `log-${i}`,
    turnNumber: i + 1,
    side: i % 2 ? "B" : "A",
    action: "pass",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:10.000Z",
    timerBefore: { A: 1320, B: 1320 },
    timerAfter: { A: 1310, B: 1320 },
    rackBefore: game.rackA,
    rackAfter: game.rackA,
    boardBefore: game.board,
    boardAfter: game.board,
    tilebagBefore: game.tilebag,
    tilebagAfter: game.tilebag,
    actionDetail: { reason: "no_move" },
    calculatedScore: 0,
    finalScore: 0,
  })) as unknown as TurnLog[];
  return { ...game, logs };
}

describe("canonicalStringify memoization", () => {
  it("gives the same string for the same object", () => {
    const game = withLogs(createNewGame(DEFAULT_NEW_GAME_SETTINGS), 12);
    expect(canonicalStringify(game.logs)).toBe(canonicalStringify(game.logs));
  });

  it("does not confuse two different objects with the same shape", () => {
    const a = { tile: { id: "n1_1", token: "1" } };
    const b = { tile: { id: "n1_2", token: "1" } };
    expect(canonicalStringify(a)).not.toBe(canonicalStringify(b));
  });

  it("still sorts keys, so jsonb round-tripping compares equal", () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe(canonicalStringify({ a: 2, b: 1 }));
  });

  it("sees a change made the way the app makes them — by replacing, not mutating", () => {
    const game = withLogs(createNewGame(DEFAULT_NEW_GAME_SETTINGS), 12);
    const before = makeRemoteStateKey(game);

    // A note edit: a new log object in a new array, exactly as `updateLogNote`
    // produces. The other eleven logs keep their identity and their cached
    // strings; this one must not.
    const logs = game.logs.slice();
    logs[3] = { ...logs[3]!, note: "a thought" };
    expect(makeRemoteStateKey({ ...game, logs })).not.toBe(before);
  });

  it("distinguishes positions that differ only deep in the history", () => {
    const game = withLogs(createNewGame(DEFAULT_NEW_GAME_SETTINGS), 20);
    const logs = game.logs.slice();
    logs[17] = { ...logs[17]!, finalScore: 99 };
    expect(makeRemoteStateKey({ ...game, logs })).not.toBe(makeRemoteStateKey(game));
  });

  it("is unchanged by a clock tick, which is not part of the position", () => {
    const game = withLogs(createNewGame(DEFAULT_NEW_GAME_SETTINGS), 8);
    const ticked: GameState = {
      ...game,
      timers: { ...game.timers, A: game.timers.A - 1 },
      currentTurnStartedAt: new Date(Date.now() + 1000).toISOString(),
    };
    expect(makeRemoteStateKey(ticked)).toBe(makeRemoteStateKey(game));
  });

  it("changes when a tile actually moves", () => {
    const game = withLogs(createNewGame(DEFAULT_NEW_GAME_SETTINGS), 8);
    // A fresh game has not dealt yet, so draw one tile out of the bag — the
    // shape of every refill, and of every placement in reverse.
    const moved: GameState = {
      ...game,
      rackA: [game.tilebag[0]!],
      tilebag: game.tilebag.slice(1),
    };
    expect(makeRemoteStateKey(moved)).not.toBe(makeRemoteStateKey(game));
  });
});
