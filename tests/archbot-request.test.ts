// @vitest-environment node
//
// What ArchBot is told about a position — and, as much, what it is not.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decideArchBot } from "../src/bot/archbot/decide";
import { archBotModelPath } from "../src/bot/archbot/identity";
import { valueHeadFromBytes } from "../src/bot/archbot/model";
import { buildArchBotRequest, noScoreStreakOf } from "../src/bot/archbot/request";
import { toArchBotMoveResult } from "../src/bot/archbot/client";
import { mapBotResponse, toBotResponse } from "../src/bot/botController";
import { seedFor } from "../src/bot/superRequest";
import {
  createNewGame,
  validateMove,
  type GameState,
  type Side,
  type TileInstance,
} from "../src/game";

function archBotGame(botSide: Side = "B"): GameState {
  const game = createNewGame({
    name: "Player vs ArchBot",
    playerA: botSide === "A" ? "ArchBot" : "Player",
    playerB: botSide === "B" ? "ArchBot" : "Player",
    startingSide: botSide,
    botSide,
    botEngine: "stage5b",
    botDifficulty: "stage5b64",
    tileDrawMode: "play",
  });
  game.activeSide = botSide;
  return game;
}

/** Take a tile of `token` out of the bag. */
function fromBag(game: GameState, token: string): TileInstance {
  const index = game.tilebag.findIndex((tile) => tile.token === token);
  if (index < 0) throw new Error(`no ${token} left in the bag`);
  return game.tilebag.splice(index, 1)[0]!;
}

function place(
  game: GameState,
  row: number,
  col: number,
  tile: TileInstance,
  side: Side,
  turn = 1,
) {
  game.board[row]![col] = { tile, side, placedTurn: turn };
}

/** 3 + 4 = 7 across the centre by `first`, then = 7 down from its 7 by `second`
 *  (a blank played as 7). */
function withTwoEquations(game: GameState, first: Side, second: Side): GameState {
  ["3", "+", "4", "=", "7"].forEach((token, index) =>
    place(game, 7, 5 + index, fromBag(game, token), first, 1),
  );
  place(game, 8, 9, fromBag(game, "="), second, 2);
  const blank = fromBag(game, "?");
  blank.assignedToken = "7";
  place(game, 9, 9, blank, second, 2);
  return game;
}

describe("ArchBot's request: ownership is relative to ArchBot's seat", () => {
  // The runtime always sits in seat "A" and its value network reads "placed by
  // self / by opponent" from each tile. The production Analysis adapter passes
  // absolute sides, which inverts this for side B; ArchBot must never inherit it.
  it("labels ArchBot's own tiles 'A' and the opponent's 'B' when ArchBot is side B", () => {
    const game = withTwoEquations(archBotGame("B"), "A", "B");
    const request = buildArchBotRequest(game, "room-1", 3);
    const across = request.board.filter((cell) => cell.r === 7);
    const down = request.board.filter((cell) => cell.r > 7);
    expect(across.every((cell) => cell.by === "B")).toBe(true); // the human's tiles
    expect(down.every((cell) => cell.by === "A")).toBe(true); // ArchBot's own tiles
  });

  it("labels the same way when ArchBot is side A", () => {
    const game = withTwoEquations(archBotGame("A"), "A", "B");
    const request = buildArchBotRequest(game, "room-1", 3);
    expect(request.board.filter((cell) => cell.r === 7).every((cell) => cell.by === "A")).toBe(
      true,
    );
    expect(request.board.filter((cell) => cell.r > 7).every((cell) => cell.by === "B")).toBe(true);
  });

  it("keeps each tile's turn and its played face", () => {
    const request = buildArchBotRequest(withTwoEquations(archBotGame(), "A", "B"), "room-1", 3);
    const blank = request.board.find((cell) => cell.kind === "?")!;
    expect(blank).toMatchObject({ r: 9, c: 9, token: "7", placedTurn: 2 });
    expect(request.board.find((cell) => cell.kind === "+")).toMatchObject({
      token: "+",
      placedTurn: 1,
    });
    // Sorted by square, as the service sorts it.
    const order = request.board.map((cell) => cell.r * 15 + cell.c);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe("ArchBot's request: hidden information", () => {
  it("carries ArchBot's own rack and only counts for everything it cannot see", () => {
    const game = archBotGame("B");
    const request = buildArchBotRequest(game, "room-1", 3);
    expect(request.rack).toEqual(game.rackB.map((tile) => tile.token));
    expect(request.oppRackCount).toBe(game.rackA.length);
    expect(request.bagCount).toBe(game.tilebag.length);
    expect(Object.keys(request).sort()).toEqual(
      [
        "bagCount",
        "board",
        "exchangeAllowed",
        "myScore",
        "noScoreStreak",
        "oppRackCount",
        "oppScore",
        "rack",
        "seed",
        "topN",
        "turnNumber",
      ].sort(),
    );
  });

  it("is identical whatever the opponent holds and however the bag is ordered", () => {
    const game = archBotGame("B");
    const before = buildArchBotRequest(game, "room-1", 3);
    // Swap the opponent's whole rack with the bag's first tiles, then reverse the bag.
    const swapped = structuredClone(game);
    const outgoing = swapped.rackA.splice(0, swapped.rackA.length);
    swapped.rackA = swapped.tilebag.splice(0, outgoing.length);
    swapped.tilebag = [...swapped.tilebag, ...outgoing].reverse();
    expect(swapped.rackA.map((t) => t.id)).not.toEqual(game.rackA.map((t) => t.id));
    expect(buildArchBotRequest(swapped, "room-1", 3)).toEqual(before);
  });

  it("counts tiles waiting to return from an exchange as unseen, without naming them", () => {
    const game = archBotGame("B");
    const returning = game.tilebag.splice(0, 3);
    game.pendingExchangeReturnBySide = { A: returning, B: [] };
    const request = buildArchBotRequest(game, "room-1", 3);
    expect(request.bagCount).toBe(game.tilebag.length + 3);
    expect(JSON.stringify(request)).not.toContain(returning[0]!.id);
  });
});

describe("ArchBot's request: the rest of the position", () => {
  it("seeds from the room and revision, the one seed convention", () => {
    const game = archBotGame();
    expect(buildArchBotRequest(game, "room-1", 3).seed).toBe(seedFor("room-1", 3));
    expect(buildArchBotRequest(game, "room-1", 4).seed).not.toBe(seedFor("room-1", 3));
    expect(buildArchBotRequest(game, "room-1", 3)).toEqual(buildArchBotRequest(game, "room-1", 3));
  });

  it("counts the trailing passes and exchanges, as the service counts commands", () => {
    const log = (action: string) => ({ action }) as never;
    expect(noScoreStreakOf({ logs: [log("place_equation"), log("pass"), log("exchange")] })).toBe(
      2,
    );
    expect(noScoreStreakOf({ logs: [log("pass"), log("place_equation")] })).toBe(0);
    expect(noScoreStreakOf({ logs: [log("pass"), log("pass"), log("end_game")] })).toBe(2);
  });

  it("scores from ArchBot's seat", () => {
    const game = archBotGame("B");
    game.scores = { A: 40, B: 25 };
    expect(buildArchBotRequest(game, "room-1", 3)).toMatchObject({ myScore: 25, oppScore: 40 });
  });

  it("refuses to describe a position where it is not ArchBot's turn", () => {
    const game = archBotGame("B");
    game.activeSide = "A";
    expect(() => buildArchBotRequest(game, "room-1", 3)).toThrow("not ArchBot's turn");
  });
});

describe("ArchBot end to end on an EQ-Lab position", () => {
  it("plays a move the game's own validator accepts, for the position it was asked about", async () => {
    const dir = resolve(__dirname, "../public", archBotModelPath("/").slice(1));
    const bytes = (name: string) => {
      const buffer = readFileSync(`${dir}/${name}`);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    };
    const value = await valueHeadFromBytes(bytes("model.json"), bytes("weights.bin"));
    const game = withTwoEquations(archBotGame("B"), "A", "B");
    const decision = decideArchBot(buildArchBotRequest(game, "room-9", 11), value);
    const result = toArchBotMoveResult(
      { key: { roomId: "room-9", revision: 11 }, decision, wallMs: 1, modelMs: 0 },
      "B",
    );
    expect(result).toMatchObject({ gameId: "room-9", revision: 11, side: "B", solver: "stage5b" });
    expect(result).not.toHaveProperty("localReasoning");
    expect(result).not.toHaveProperty("localEngine");
    const mapped = mapBotResponse(game, toBotResponse(result));
    expect(mapped).not.toBeNull();
    if (mapped?.kind === "place") {
      expect(validateMove(game.board, mapped.placements).isValid).toBe(true);
    }
  }, 60_000);
});
