import { describe, expect, it } from "vitest";
import {
  applyRankedAction,
  createRankedGame,
  settleRankedClock,
} from "../src/features/ranked/rules";
import { rankedPublicView } from "../src/features/ranked/publicView";
import { rankTier, ratingDelta } from "../src/features/ranked/rating";

const creator = "00000000-0000-4000-8000-000000000001";
const opponent = "00000000-0000-4000-8000-000000000002";
const matchId = "00000000-0000-4000-8000-000000000003";

function match() {
  const waiting = createRankedGame(creator, "A", 15, 15, "A");
  return {
    ...waiting,
    playerUserIds: { A: creator, B: opponent },
    players: { A: "A", B: "B" },
    roomStage: "playing" as const,
    status: "playing" as const,
    timers: { ...waiting.timers, paused: false },
    currentTurnStartedAt: "2026-09-25T00:00:00.000Z",
  };
}

describe("ranked server rules", () => {
  it("requires equal, approved clock settings", () => {
    expect(() => createRankedGame(creator, "A", 30, 10, "A")).toThrow("must match");
    expect(() => createRankedGame(creator, "A", 999, 999, "A")).toThrow("must match");
  });

  it("keeps even the owner's rack closed while waiting for both players", () => {
    const waiting = createRankedGame(creator, "A", 15, 15, "A");
    const view = rankedPublicView(matchId, 0, waiting, creator);
    expect(view.status).toBe("waiting");
    expect(view.yourRack).toEqual([]);
    expect(JSON.stringify(view)).not.toContain(waiting.rackA[0].id);
    const matched = { ...waiting, playerUserIds: { A: creator, B: opponent } };
    const opponentView = rankedPublicView(matchId, 1, matched, opponent);
    expect(opponentView.status).toBe("matched");
    expect(opponentView.yourRack).toEqual([]);
    expect(JSON.stringify(opponentView)).not.toContain(waiting.rackB[0].id);
  });

  it("never projects the other rack, the queue, or historical opponent racks", () => {
    const started = match();
    const afterPass = applyRankedAction(started, "A", { kind: "pass" }, "2026-09-25T00:00:10.000Z");
    const a = rankedPublicView(matchId, 2, afterPass, creator);
    const b = rankedPublicView(matchId, 2, afterPass, opponent);
    const opponentTileId = afterPass.rackB[0].id;
    expect(a.yourRack).toEqual(afterPass.rackA);
    expect(b.yourRack).toEqual(afterPass.rackB);
    expect(a.logs[0].rackBefore).toBeDefined();
    expect(b.logs[0].rackBefore).toBeUndefined();
    expect(JSON.stringify(a)).not.toContain(opponentTileId);
    expect("tilebag" in a).toBe(false);
  });

  it("rejects another player's tile and out-of-turn moves", () => {
    const game = match();
    expect(() =>
      applyRankedAction(game, "B", { kind: "pass" }, "2026-09-25T00:00:01.000Z"),
    ).toThrow("not your turn");
    expect(() =>
      applyRankedAction(
        game,
        "A",
        { kind: "place", placements: [{ tileId: game.rackB[0].id, row: 7, col: 7 }] },
        "2026-09-25T00:00:01.000Z",
      ),
    ).toThrow("not in your rack");
  });

  it("scores a legal placement and draws replacements on the server", () => {
    const started = match();
    const rack = [
      { id: "ranked-one-a", token: "1" as const },
      { id: "ranked-plus", token: "+" as const },
      { id: "ranked-one-b", token: "1" as const },
      { id: "ranked-equals", token: "=" as const },
      { id: "ranked-two", token: "2" as const },
    ];
    const game = { ...started, rackA: rack };
    const next = applyRankedAction(
      game,
      "A",
      {
        kind: "place",
        placements: rack.map((tile, index) => ({
          tileId: tile.id,
          row: 7,
          col: index + 5,
        })),
      },
      "2026-09-25T00:00:01.000Z",
    );
    expect(next.logs[0].action).toBe("place_equation");
    expect(next.scores.A).toBeGreaterThan(0);
    expect(next.board[7][7]?.tile.token).toBe("1");
    expect(next.activeSide).toBe("B");
    expect(next.rackA).toHaveLength(8);
  });

  it("settles a clock on server time and gives timeout to the opponent", () => {
    const game = match();
    const finished = settleRankedClock(game, "2026-09-25T00:15:01.000Z");
    expect(finished.status).toBe("finished");
    expect(rankedPublicView(matchId, 2, finished, creator).result).toEqual({
      winner: "B",
      reason: "timeout",
    });
  });

  it("uses outcome-only Elo with a faster provisional period", () => {
    expect(ratingDelta(1000, 1000, 1, 0)).toBe(20);
    expect(ratingDelta(1000, 1000, 0, 10)).toBe(-12);
    expect(ratingDelta(1000, 1000, 0.5, 3)).toBe(0);
    expect(rankTier(1000)).toBe("Silver");
    expect(rankTier(1800)).toBe("Master");
  });
});
