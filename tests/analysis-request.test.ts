// The one thing that must never be true of a device-side analysis.
//
// The top analysis level runs in the player's own browser now, and the browser
// holds the WHOLE game: both racks and the bag, because the sync layer has
// always shipped the full inventory to anyone who can read the room. On the
// server that did not matter — `adapter.ts` built the request from canonical
// state and structurally could not put the opponent's tiles on the wire. Here
// there is no wire, and the same guarantee has to be made by construction.
//
// So: `buildAnalysisRequest` hands the engine exactly one rack — the analysed
// side's — and the opponent reaches it as an integer. A field added carelessly
// to that request would hand a player an engine that can see their opponent's
// tiles, and nothing about the answer would look wrong.
import { describe, expect, it } from "vitest";

import { buildAnalysisRequest, buildSuperRequest, seedFor } from "../src/bot/superRequest";
import { createNewGame, getRack, type GameState } from "../src/game";

function botRoom(): GameState {
  return createNewGame({
    name: "analysis",
    playerA: "Human",
    playerB: "Aether",
    startingSide: "A",
    botSide: "B",
    botDifficulty: "super",
    tileDrawMode: "play",
  });
}

describe("the analysed side's request", () => {
  it("carries the analysed rack and nothing else that is a tile", () => {
    const game = botRoom();
    const request = buildAnalysisRequest(game, {
      side: "A",
      roomId: "room-1",
      revision: 5,
      weights: undefined,
      topN: 24,
    });

    const mine = getRack(game, "A").map((tile) => tile.token as string);
    const theirs = getRack(game, "B").map((tile) => tile.token as string);
    expect([...request.rack].sort()).toEqual([...mine].sort());
    expect(typeof request.oppRackCount).toBe("number");
    expect(request.oppRackCount).toBe(theirs.length);

    // The real assertion: no field anywhere in the request — however it is
    // reshaped later — may hold the opponent's rack as tiles. Serialising the
    // whole document and looking for it is deliberately blunt, because a
    // targeted check only guards the fields somebody remembered to name.
    const withoutRack = JSON.stringify({ ...request, rack: [] });
    const opponentOnly = theirs.filter((token) => !mine.includes(token));
    // A shared token proves nothing (both racks can hold a "5"), so only tokens
    // unique to the opponent are evidence.
    for (const token of opponentOnly) {
      expect(withoutRack).not.toContain(`"${token}"`);
    }
  });

  it("never caps the schedule, whatever the device measured", () => {
    // The adaptive budget exists to keep GAMEPLAY latency tolerable. An analysis
    // is work the player asked for and can cancel, and a level that runs a
    // different number of samples on different machines cannot be compared with
    // itself — which is the whole reason analysis levels are bounded by samples
    // rather than by a clock.
    const request = buildAnalysisRequest(botRoom(), {
      side: "A",
      roomId: "room-1",
      revision: 5,
      weights: undefined,
      topN: 24,
    });

    expect(request.sampleCap).toBeUndefined();
    expect(request.unlimited).toBe(true);
    expect(request.difficulty).toBe("super");
    expect(request.solver).toBe("sim");
  });

  it("describes the same position as the bot's own request, from the other side", () => {
    // Both go through one adapter. If they ever stop agreeing about the board,
    // the bag or the exchange rule, the analysis stops being about the game the
    // bot is playing.
    const game = botRoom();
    const mine = buildAnalysisRequest(game, {
      side: "A",
      roomId: "room-1",
      revision: 5,
      weights: undefined,
      topN: 24,
    });
    const theirs = buildSuperRequest(game, {
      roomId: "room-1",
      revision: 5,
      sampleCap: null,
      weights: undefined,
      topN: 24,
    });

    expect(mine.board).toEqual(theirs.board);
    expect(mine.bagCount).toBe(theirs.bagCount);
    expect(mine.exchangeAllowed).toBe(theirs.exchangeAllowed);
    expect(mine.noScoreStreak).toBe(theirs.noScoreStreak);
    expect(mine.seed).toBe(seedFor("room-1", 5));
    // Mirrored, because they are opposite sides of one position.
    expect(mine.myScore).toBe(theirs.oppScore);
    expect(mine.oppScore).toBe(theirs.myScore);
  });
});
