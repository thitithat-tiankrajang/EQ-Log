import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildAuthurRequest } from "../src/bot/authur/request";
import { makeState, resultOf } from "../src/bot/authur/worker";
import {
  createBoard,
  createInitialTilebag,
  createNewGame,
  tileNeedsAssignment,
  validateMove,
  type TileInstance,
} from "../src/game";
import { decodeGame, encodeGame } from "../src/codec";
import {
  createManifest,
  decideStrong,
  envStateFrom,
  loadStrongModels,
} from "../src/bot/authur/strong.mjs";
import endgame from "./fixtures/authur-endgame.json";
import midgame from "./fixtures/authur-midgame.json";

function authurGame() {
  return createNewGame({
    name: "Human vs Authur",
    playerA: "Human",
    playerB: "Authur",
    startingSide: "B",
    botSide: "B",
    botEngine: "authur",
    botDifficulty: "super",
    tileDrawMode: "play",
  });
}

describe("Authur position boundary", () => {
  it("keeps its identity through the game codec", () => {
    expect(decodeGame(encodeGame(authurGame())).botEngine).toBe("authur");
  });

  it("never sends the real opponent rack or bag to STRONG", () => {
    const game = authurGame();
    const request = buildAuthurRequest(game, "room-1", 5);
    expect(request.rack).toEqual(game.rackB.map((tile) => tile.token));
    expect(request.opponentRackCount).toBe(game.rackA.length);
    expect(request.bagCount).toBe(game.tilebag.length);
    expect(request).not.toHaveProperty("opponentRack");
    expect(request).not.toHaveProperty("bag");
    const state = makeState(request) as unknown as {
      racks: Record<"A" | "B", string[]>;
      bag: string[];
    };
    expect(state.racks.B).toHaveLength(game.rackB.length);
    expect(state.racks.A).toHaveLength(game.rackA.length);
    expect(state.bag).toHaveLength(game.tilebag.length);
  });

  it("refuses a broken tile count instead of selecting from a fake world", () => {
    const request = buildAuthurRequest(authurGame(), "room-1", 5);
    expect(() =>
      makeState({ ...request, opponentRackCount: request.opponentRackCount + 1 }),
    ).toThrow("does not conserve");
  });

  it("never calls a partial bag-zero answer a proven win", () => {
    const request = buildAuthurRequest(authurGame(), "room-1", 5);
    const decision = {
      action: { type: "pass" },
      id: "pass",
      cancelled: false,
      trace: {
        totalMs: 50,
        legalPlace: 0,
        legalExchange: 0,
        generationNodes: 0,
        tier3Nodes: 0,
        evaluations: 1,
        chosenImmediateScore: 0,
        generationComplete: true,
        spaceMapTruncated: false,
      },
      candidates: [],
      endgame: { exact: false, selectedOptimalMargin: 12, mode: "partial" },
    } as never;
    const result = resultOf(request, decision);
    expect(result.endgameSolved).toBe(false);
    expect(result.localReasoning?.expectedFinalDiff).toBeUndefined();
  });

  it("finds the original STRONG winning move from an EQ-Lab game state", async () => {
    const game = createNewGame({
      name: "Endgame",
      playerA: "Authur",
      playerB: "Human",
      startingSide: "A",
      botSide: "A",
      botEngine: "authur",
      botDifficulty: "super",
      tileDrawMode: "play",
    });
    const copies = new Map<string, TileInstance[]>();
    for (const tile of createInitialTilebag()) {
      const list = copies.get(tile.token) ?? [];
      list.push(tile);
      copies.set(tile.token, list);
    }
    const take = (kind: string): TileInstance => {
      const tile = copies.get(kind)?.shift();
      if (!tile) throw new Error(`Missing fixture tile ${kind}`);
      return tile;
    };
    const kindOfId = (id: string) => id.slice(0, id.lastIndexOf("#"));
    game.board = createBoard();
    for (let cell = 0; cell < endgame.board.length; cell += 1) {
      const placed = endgame.board[cell];
      if (!placed) continue;
      const tile = take(placed.kind);
      if (tileNeedsAssignment(tile.token)) tile.assignedToken = placed.face;
      game.board[Math.floor(cell / 15)]![cell % 15] = {
        tile,
        side: placed.side as "A" | "B",
        placedTurn: placed.turn,
      };
    }
    game.rackA = endgame.racks.A.map((id) => take(kindOfId(id)));
    game.rackB = endgame.racks.B.map((id) => take(kindOfId(id)));
    game.tilebag = [];
    game.scores = endgame.scores;
    game.turnNumber = endgame.turnNumber;
    game.activeSide = "A";
    expect([...copies.values()].flat()).toHaveLength(0);

    const request = buildAuthurRequest(game, "endgame-room", 17);
    const state = makeState({ ...request, seed: endgame.seed });
    const decision = await decideStrong(state, endgame.seed, null);
    expect(decision.cancelled).toBe(false);
    expect(decision.trace.generationComplete).toBe(true);
    expect(decision.id).toBe("79c8bb1048edad7e");
    if (decision.action.type !== "place") throw new Error("Expected a placement");
    const used = new Set<string>();
    const placements = decision.action.placements.map((placed) => {
      const tile = game.rackA.find(
        (candidate) => !used.has(candidate.id) && candidate.token === placed.kind,
      );
      if (!tile) throw new Error(`Cannot map Authur tile ${placed.kind}`);
      used.add(tile.id);
      return {
        tile,
        row: Math.floor(placed.cell / 15),
        col: placed.cell % 15,
        assignedToken: tileNeedsAssignment(tile.token) ? placed.face : undefined,
      };
    });
    expect(validateMove(game.board, placements).isValid).toBe(true);
  });

  it("loads the shipped STRONG forests and finishes a real midgame decision", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string) => {
      const name = String(input).split("/").pop();
      if (!name || !["reply-self.json", "reply-opponent.json", "next-turn.json"].includes(name)) {
        return new Response(null, { status: 404 });
      }
      return new Response(
        readFileSync(resolve(process.cwd(), "tests/fixtures/authur-models", name)),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    try {
      const models = await loadStrongModels("models/strong");
      const state = envStateFrom({ ...midgame.snapshot, manifest: createManifest() } as never);
      const decision = await decideStrong(state, 12345, models, {
        config: {
          shortlist: 24,
          worldsTier1: 2,
          worldsTier2: 2,
          finalists: 2,
          worldsTier3: 2,
          tier3Rounds: 1,
        },
      });
      expect(decision.cancelled).toBe(false);
      expect(decision.trace.generationComplete).toBe(true);
      expect(decision.id).toBe("dc985bfb23eed932");
      expect(decision.candidates.some((candidate) => candidate.id === decision.id)).toBe(true);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  }, 30_000);
});
