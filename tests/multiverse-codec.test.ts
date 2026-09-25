// The parked-lines document: exact on the way back, and small on the way out.
import { describe, expect, it } from "vitest";
import {
  continueFrom,
  EMPTY_MULTIVERSE,
  type ContinueResult,
  type Multiverse,
} from "../src/gameplay/multiverse";
import {
  decodeMultiverse,
  encodeMultiverse,
  parkedTurnCount,
} from "../src/gameplay/multiverseCodec";
import { encodeGame } from "../src/codec";
import { exchange, newGame, pass, place, playTurns } from "./helpers/simulateGame";

function ok(result: ContinueResult) {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

/** A game with three lines: the one played, and two explored and left. */
function branchedGame(mode: "play" | "manual") {
  const game = playTurns(newGame(mode), 10);
  const first = ok(
    continueFrom(
      game,
      EMPTY_MULTIVERSE,
      { nodeId: game.logs[3]!.id, phase: "after" },
      { newLineId: () => "first" },
    ),
  );
  const explored = exchange(pass(place(first.game, 4)), 3);
  const second = ok(
    continueFrom(
      explored,
      first.multiverse,
      { nodeId: game.logs[6]!.id, phase: "before" },
      { newLineId: () => "second" },
    ),
  );
  return { game: second.game, multiverse: second.multiverse, original: game };
}

/** Through JSON, the way it travels to Postgres and back. */
function roundTrip(multiverse: Multiverse): Multiverse {
  return decodeMultiverse(JSON.parse(JSON.stringify(encodeMultiverse(multiverse))));
}

describe.each(["play", "manual"] as const)("the stored document, in %s mode", (mode) => {
  const { multiverse } = branchedGame(mode);

  it("gives back exactly what was parked", () => {
    expect(multiverse.lines.length).toBeGreaterThanOrEqual(2);
    expect(roundTrip(multiverse)).toEqual(JSON.parse(JSON.stringify(multiverse)));
  });

  it("stays exact through a second trip", () => {
    const once = roundTrip(multiverse);
    expect(roundTrip(once)).toEqual(once);
  });
});

describe("what it costs", () => {
  it("stores a parked turn in far less than the live game spends on one", () => {
    const { multiverse, original } = branchedGame("play");
    const liveBytesPerTurn =
      JSON.stringify(encodeGame(original).logs).length / original.logs.length;
    // Each parked turn also carries the exact position it was committed with — the live game
    // keeps that in `history` — so compare against a log AND its history snapshot.
    const historyBytesPerTurn =
      JSON.stringify(encodeGame(original).history).length / original.history.length;
    const parkedBytesPerTurn =
      JSON.stringify(encodeMultiverse(multiverse)).length / parkedTurnCount(multiverse);
    expect(parkedBytesPerTurn).toBeLessThan((liveBytesPerTurn + historyBytesPerTurn) * 0.7);
  });

  it("is nothing at all for a game that never branched", () => {
    expect(encodeMultiverse(EMPTY_MULTIVERSE)).toEqual({ v: 1, version: 0, lines: [] });
  });
});

describe("unreadable documents", () => {
  it("are refused whole, not shown in part", () => {
    expect(() => decodeMultiverse(null)).toThrow();
    expect(() => decodeMultiverse({ v: 99, version: 1, lines: [] })).toThrow(/format 99/);
    expect(() => decodeMultiverse({ v: 1, version: 1 })).toThrow(/line list/);
    expect(() =>
      decodeMultiverse({
        v: 1,
        version: 1,
        lines: [{ id: "x", from: null, at: "", logs: [], after: [], tip: "last" }],
      }),
    ).toThrow(/no turns/);
  });
});
