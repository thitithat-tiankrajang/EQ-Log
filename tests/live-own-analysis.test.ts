import { describe, expect, it } from "vitest";
import { createNewGame, deepClone } from "../src/game";
import { projectLiveGame } from "../src/liveGame/projection";
import { ownAnalysisRequest } from "../src/liveGame/analysis";

describe("authorized own-rack analysis", () => {
  it("cannot distinguish opposite hidden worlds and refuses spectator/opponent analysis", () => {
    const game = createNewGame({
      name: "Analysis",
      playerA: "A",
      playerB: "B",
      startingSide: "A",
      tileDrawMode: "play",
    });
    const other = deepClone(game);
    other.rackB = other.rackB.map((tile) => ({ ...tile, id: "secret", token: "20" }));
    other.tilebag.reverse();
    const view = projectLiveGame("room", 1, game, "A", "normal"),
      changed = projectLiveGame("room", 1, other, "A", "normal");
    expect(ownAnalysisRequest(view)).toEqual(ownAnalysisRequest(changed));
    expect(ownAnalysisRequest(view).rack).toEqual(game.rackA.map((tile) => tile.token));
    expect(ownAnalysisRequest(view)).not.toHaveProperty("tilebag");
    expect(() => ownAnalysisRequest({ ...view, yourSide: null })).toThrow();
    expect(() => ownAnalysisRequest({ ...view, activeSide: "B" })).toThrow();
  });
});
