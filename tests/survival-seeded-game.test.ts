import { describe, expect, it } from "vitest";
import { createSurvivalTestGame } from "../src/features/survival/seededGame";
import { canonicalFromSnapshot } from "../src/domain/projection";

describe("Survival seed", () => {
  it("recreates the same valid physical position for a seed", () => {
    const first = createSurvivalTestGame(5093, "Tester");
    const second = createSurvivalTestGame(5093, "Tester");
    expect(first.rackA.map((tile) => tile.token)).toEqual(second.rackA.map((tile) => tile.token));
    expect(first.rackB.map((tile) => tile.token)).toEqual(second.rackB.map((tile) => tile.token));
    expect(first.botEngine).toBe("authur");
    expect(first.tilebag).toHaveLength(0);
    expect(canonicalFromSnapshot(first, 1).inventory).toHaveLength(100);
  });

  it("changes the deal when the seed changes", () => {
    const first = createSurvivalTestGame(5093, "Tester");
    const second = createSurvivalTestGame(5094, "Tester");
    expect(first.rackA.map((tile) => tile.token)).not.toEqual(
      second.rackA.map((tile) => tile.token),
    );
  });
});
