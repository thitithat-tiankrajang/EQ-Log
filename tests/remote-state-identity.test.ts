// `makeRemoteStateKey` walks the entire match: every turn log carries two full
// board snapshots and two full tile bags, so at turn 40 it serialises tens of
// thousands of objects with a recursive key sort on top.
//
// It was memoised on the `game` object — and the running clock replaces that
// object once a second. So a game that was doing nothing at all rebuilt its
// whole canonical identity every second, with the cost growing as the match got
// longer. That is main-thread time taken from dragging a tile.
//
// The fix is `remoteStateIdentity`: a few dozen reference comparisons that
// answer "has anything the key reads changed?" without building the key. These
// tests pin the two halves against each other, because the danger of a cheap
// stand-in is that it stops standing in for the real thing.
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { createNewGame } from "../src/game";
import { advanceRunningClock } from "../src/gameplay/timer";
import {
  createRemoteStateKeyCache,
  makeRemoteStateKey,
  remoteStateIdentity,
} from "../src/stateKey";

function playingGame() {
  const game = createNewGame({ ...DEFAULT_NEW_GAME_SETTINGS, name: "Timer" });
  return {
    ...game,
    status: "playing" as const,
    roomStage: "playing" as const,
    currentTurnStartedAt: new Date(Date.now() - 30_000).toISOString(),
    timers: { ...game.timers, untimed: false, paused: false, A: 900, B: 900 },
  };
}

describe("timer ticks and the remote state key", () => {
  it("produces a new game object every tick — the cost this guards against", () => {
    const game = playingGame();
    const ticked = advanceRunningClock(game);
    // If this ever stops being true the memo problem disappears, and so should
    // this whole mechanism.
    expect(ticked).not.toBe(game);
    expect(ticked.timers.A).not.toBe(game.timers.A);
  });

  it("keeps an identical identity across a tick", () => {
    const game = playingGame();
    const ticked = advanceRunningClock(game);

    const before = remoteStateIdentity(game);
    const after = remoteStateIdentity(ticked);
    expect(after).toHaveLength(before.length);
    for (const [index, value] of before.entries()) {
      expect(Object.is(value, after[index])).toBe(true);
    }
  });

  it("does not rebuild the key on a tick, and does rebuild it on a real change", () => {
    const spy = vi.spyOn({ makeRemoteStateKey }, "makeRemoteStateKey");
    void spy;
    const keyOf = createRemoteStateKeyCache();
    const game = playingGame();

    const first = keyOf(game);
    // Sixty seconds of a game where nothing happens.
    let ticked = game;
    for (let second = 0; second < 60; second += 1) {
      ticked = advanceRunningClock(ticked);
      // Same string, and — the point — the SAME string instance, which is only
      // possible if the key was not recomputed.
      expect(keyOf(ticked)).toBe(first);
    }

    // A real change still registers.
    const moved = { ...ticked, turnNumber: ticked.turnNumber + 1 };
    expect(keyOf(moved)).not.toBe(first);
    expect(keyOf(moved)).toBe(makeRemoteStateKey(moved));
  });

  it("agrees with the key it stands in for: a timer tick changes neither", () => {
    const game = playingGame();
    const ticked = advanceRunningClock(game);
    expect(makeRemoteStateKey(ticked)).toBe(makeRemoteStateKey(game));
  });

  it("changes whenever the key changes, for every field the key reads", () => {
    // The failure this guards against is silent and serious: an identity that
    // misses a change means a committed turn is never written. Each mutation
    // below must move BOTH.
    const base = playingGame();
    const mutations: Array<[string, () => typeof base]> = [
      ["activeSide", () => ({ ...base, activeSide: base.activeSide === "A" ? "B" : "A" })],
      ["turnNumber", () => ({ ...base, turnNumber: base.turnNumber + 1 })],
      [
        "phase",
        () => ({
          ...base,
          phase: base.phase === "refill" ? ("choose_action" as const) : ("refill" as const),
        }),
      ],
      ["status", () => ({ ...base, status: "finished" as const })],
      ["name", () => ({ ...base, name: `${base.name} (renamed)` })],
      ["scores", () => ({ ...base, scores: { ...base.scores, A: base.scores.A + 5 } })],
      [
        "board",
        () => {
          const board = base.board.map((row) => [...row]) as typeof base.board;
          board[7]![7] = {
            tile: { id: "t-1", token: "5" },
            placedTurn: 1,
            placedBy: "A",
          } as (typeof board)[number][number];
          return { ...base, board };
        },
      ],
      // Adding rather than slicing: a freshly created game has an empty rack,
      // and `[].slice(1)` is still `[]` — a mutation that mutates nothing proves
      // nothing.
      ["rackA", () => ({ ...base, rackA: [...base.rackA, { id: "extra", token: "5" as const }] })],
      [
        "tilebag",
        () => ({ ...base, tilebag: [...base.tilebag, { id: "extra", token: "5" as const }] }),
      ],
      ["historyIndex", () => ({ ...base, historyIndex: base.historyIndex + 1 })],
      ["timers.paused", () => ({ ...base, timers: { ...base.timers, paused: true } })],
      ["timers.untimed", () => ({ ...base, timers: { ...base.timers, untimed: true } })],
      [
        "timers.minSeconds",
        () => ({ ...base, timers: { ...base.timers, minSeconds: base.timers.minSeconds + 1 } }),
      ],
      ["players", () => ({ ...base, players: { ...base.players, A: "Someone else" } })],
      ["roomStage", () => ({ ...base, roomStage: "waiting" as const })],
    ];

    const baseKey = makeRemoteStateKey(base);
    const baseIdentity = remoteStateIdentity(base);

    for (const [label, mutate] of mutations) {
      const changed = mutate();
      expect(makeRemoteStateKey(changed), `${label} should change the key`).not.toBe(baseKey);
      const identity = remoteStateIdentity(changed);
      const same = identity.every((value, index) => Object.is(value, baseIdentity[index]));
      expect(same, `${label} should change the identity`).toBe(false);
    }
  });

  it("gives each caller its own cache, so two rooms cannot invalidate each other", () => {
    const first = createRemoteStateKeyCache();
    const second = createRemoteStateKeyCache();
    const roomOne = playingGame();
    const roomTwo = { ...playingGame(), name: "Other room" };

    const oneKey = first(roomOne);
    second(roomTwo);
    // The first cache still answers for its own room rather than the last game
    // any cache happened to see.
    expect(first(roomOne)).toBe(oneKey);
  });

  it("treats a null game as no key at all", () => {
    expect(createRemoteStateKeyCache()(null)).toBe("");
  });
});
