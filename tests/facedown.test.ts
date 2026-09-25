// Recording a game where most tiles are face down.
//
// The invariant every test below is really about: a rack's SIZE never changes when a tile is
// named. Naming moves a tile from the unseen pool onto the rack and drops the face-down count
// by one, so every rule that reads "how many tiles does this side hold" reads the same number
// before and after. Break that and the bot starts refusing positions for reasons nobody can
// trace back to the turn where the mistake was made.
import { describe, expect, it } from "vitest";
import {
  botCanDecide,
  dealFaceDown,
  exchangeFaceDown,
  faceDownCount,
  nameFaceDown,
  rackConserves,
  rackSize,
  unnameTile,
  whyBotCannotDecide,
} from "../src/gameplay/facedown";
import type { TileInstance } from "../src/game";

const tile = (id: string, token = "5"): TileInstance => ({ id, token }) as TileInstance;

describe("dealing without deciding", () => {
  it("gives a side slots and leaves the pool alone", () => {
    const counts = dealFaceDown({}, "B", 8);
    expect(faceDownCount(counts, "B")).toBe(8);
    expect(faceDownCount(counts, "A")).toBe(0);
  });

  it("counts a rack as named plus face down", () => {
    expect(rackSize([tile("t1"), tile("t2")], 6)).toBe(8);
    expect(rackConserves({ named: [tile("t1")], faceDown: 7, expected: 8 })).toBe(true);
    expect(rackConserves({ named: [tile("t1")], faceDown: 6, expected: 8 })).toBe(false);
  });

  it("refuses to deal a negative number", () => {
    expect(() => dealFaceDown({}, "A", -1)).toThrow(/negative/);
  });
});

describe("naming a tile", () => {
  const pool = [tile("p1", "5"), tile("p2", "="), tile("p3", "+")];

  it("moves it out of the pool and onto the rack, leaving the size alone", () => {
    const before = { B: 3 };
    const after = nameFaceDown({ counts: before, side: "B", rack: [], pool, tileId: "p2" });
    expect(after.rack.map((t) => t.id)).toEqual(["p2"]);
    expect(after.pool.map((t) => t.id)).toEqual(["p1", "p3"]);
    expect(faceDownCount(after.counts, "B")).toBe(2);
    // The whole point: three tiles held before, three held after.
    expect(rackSize(after.rack, faceDownCount(after.counts, "B"))).toBe(3);
  });

  it("refuses a tile that is not in the unseen pool", () => {
    expect(() =>
      nameFaceDown({ counts: { B: 3 }, side: "B", rack: [], pool, tileId: "nope" }),
    ).toThrow(/not in the unseen pool/);
  });

  it("refuses when the side has nothing face down", () => {
    expect(() => nameFaceDown({ counts: {}, side: "B", rack: [], pool, tileId: "p1" })).toThrow(
      /no face-down tile/,
    );
  });

  it("can be taken back, because transcribers misread photographs", () => {
    const named = nameFaceDown({ counts: { B: 3 }, side: "B", rack: [], pool, tileId: "p2" });
    const undone = unnameTile({
      counts: named.counts,
      side: "B",
      rack: named.rack,
      pool: named.pool,
      tileId: "p2",
    });
    expect(undone.rack).toEqual([]);
    expect(undone.pool.map((t) => t.id).sort()).toEqual(["p1", "p2", "p3"]);
    expect(faceDownCount(undone.counts, "B")).toBe(3);
  });
});

describe("an exchange nobody could see", () => {
  it("records the count and keeps the rack whole", () => {
    const after = exchangeFaceDown({ A: 8 }, "A", 4);
    expect(faceDownCount(after, "A")).toBe(8);
  });

  it("refuses to hand in more than the side is holding", () => {
    expect(() => exchangeFaceDown({ A: 3 }, "A", 4)).toThrow(/holds 3 face-down tiles/);
  });
});

describe("what the bot is allowed to be asked", () => {
  it("answers when the side to move is fully named", () => {
    expect(botCanDecide({ A: 0, B: 5 }, "A")).toBe(true);
    expect(whyBotCannotDecide({ A: 0, B: 5 }, "A")).toBeNull();
  });

  it("refuses while the side to move still holds an unnamed tile", () => {
    expect(botCanDecide({ A: 2 }, "A")).toBe(false);
    expect(whyBotCannotDecide({ A: 2 }, "A")).toMatch(/2 face-down tiles/);
    expect(whyBotCannotDecide({ A: 1 }, "A")).toMatch(/1 face-down tile —/);
  });

  it("is untroubled by an ordinary game, which has no counts at all", () => {
    expect(botCanDecide(undefined, "A")).toBe(true);
    expect(botCanDecide({}, "B")).toBe(true);
  });
});
