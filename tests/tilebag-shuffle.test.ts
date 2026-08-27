import { describe, expect, it } from "vitest";

import { createInitialTilebag, shuffleTilebagQueue, type TileInstance } from "../src/game";

/** Adjacent positions holding the same token — the statistic the old
 *  even-spacing shuffle drove almost to zero. */
function adjacentSameTokenPairs(tiles: TileInstance[]): number {
  let pairs = 0;
  for (let index = 1; index < tiles.length; index += 1) {
    if (tiles[index].token === tiles[index - 1].token) pairs += 1;
  }
  return pairs;
}

describe("shuffleTilebagQueue", () => {
  const bag = createInitialTilebag();

  it("is a permutation: every tile survives, exactly once", () => {
    const shuffled = shuffleTilebagQueue(bag);
    expect(shuffled).toHaveLength(bag.length);
    expect([...shuffled].map((tile) => tile.id).sort()).toEqual(
      [...bag].map((tile) => tile.id).sort(),
    );
  });

  it("does not mutate its input", () => {
    const before = bag.map((tile) => tile.id);
    shuffleTilebagQueue(bag);
    expect(bag.map((tile) => tile.id)).toEqual(before);
  });

  it("puts one tile in every position about equally often", () => {
    const trials = 6_000;
    const buckets = 10;
    const size = bag.length;
    const target = bag[0].id;
    const counts = new Array<number>(buckets).fill(0);

    for (let trial = 0; trial < trials; trial += 1) {
      const position = shuffleTilebagQueue(bag).findIndex((tile) => tile.id === target);
      counts[Math.floor((position / size) * buckets)] += 1;
    }

    // Chi-square against a flat expectation, 9 degrees of freedom. The 99.9%
    // critical value is 27.88; a uniform shuffle clears it all but one run in a
    // thousand, and the old spaced shuffle failed it by orders of magnitude.
    const expected = trials / buckets;
    const chiSquare = counts.reduce(
      (total, observed) => total + (observed - expected) ** 2 / expected,
      0,
    );
    expect(chiSquare).toBeLessThan(27.88);
    // Generous: the assertion above is the point, and the whole suite runs its
    // files in parallel, so the wall-clock cost of ~600k CSPRNG draws depends on
    // what else is running.
  }, 30_000);

  it("lets identical tokens clump at the rate a fair bag does", () => {
    const size = bag.length;
    const copiesByToken = new Map<string, number>();
    for (const tile of bag) copiesByToken.set(tile.token, (copiesByToken.get(tile.token) ?? 0) + 1);
    // E[adjacent equal pairs] = Σ c(c-1) / n over a uniformly random ordering.
    const expected =
      [...copiesByToken.values()].reduce((total, copies) => total + copies * (copies - 1), 0) /
      size;

    const trials = 1_000;
    let observed = 0;
    for (let trial = 0; trial < trials; trial += 1) {
      observed += adjacentSameTokenPairs(shuffleTilebagQueue(bag));
    }
    const mean = observed / trials;

    expect(mean).toBeGreaterThan(expected * 0.85);
    expect(mean).toBeLessThan(expected * 1.15);
  }, 30_000);
});
