import { describe, expect, it } from "vitest";
import { AMATH_TOKENS, type AmathToken } from "../src/constants/tileDefinitions";
import {
  ALL_ORDINALS,
  TILE_COUNT,
  TILE_IDS,
  TILE_TOKENS,
  UnknownTileError,
  manifestFingerprint,
  ordinalOfTileId,
  tileIdOf,
  tokenOfOrdinal,
} from "../src/domain/tiles";
import {
  type Inventory,
  InventoryError,
  applyMoves,
  assertInventory,
  bagOrder,
  boardTiles,
  countAt,
  createInventory,
  inventoryProblems,
  normalizeInventory,
  rackOrder,
} from "../src/domain/inventory";

const fullBag = () => createInventory(ALL_ORDINALS);

describe("the physical tile set", () => {
  it("contains exactly 100 tiles", () => {
    expect(TILE_IDS).toHaveLength(TILE_COUNT);
    expect(TILE_TOKENS).toHaveLength(TILE_COUNT);
    expect(TILE_COUNT).toBe(100);
  });

  it("gives every tile a unique stable id", () => {
    expect(new Set(TILE_IDS).size).toBe(TILE_COUNT);
  });

  it("reproduces the printed tile distribution exactly", () => {
    const counted = new Map<AmathToken, number>();
    for (const token of TILE_TOKENS) counted.set(token, (counted.get(token) ?? 0) + 1);
    for (const [token, info] of Object.entries(AMATH_TOKENS)) {
      expect(counted.get(token as AmathToken) ?? 0).toBe(info.count);
    }
    expect(Object.values(AMATH_TOKENS).reduce((total, info) => total + info.count, 0)).toBe(
      TILE_COUNT,
    );
  });

  it("derives a tile's token from its identity, leaving nothing to mutate", () => {
    for (const ordinal of ALL_ORDINALS) {
      expect(tokenOfOrdinal(ordinal)).toBe(TILE_TOKENS[ordinal]);
      expect(ordinalOfTileId(tileIdOf(ordinal))).toBe(ordinal);
    }
  });

  it("refuses to recognize an id that is not part of the set", () => {
    expect(() => ordinalOfTileId("t7f3a1_42")).toThrow(UnknownTileError);
  });

  it("pins the manifest so the physical set cannot silently change", () => {
    // A different fingerprint means live games would be re-identified against a
    // different set of physical tiles. Update this only with a migration.
    expect(manifestFingerprint()).toBe("185b7ef4");
    expect(TILE_IDS[0]).toBe("n0_1");
    expect(TILE_IDS[TILE_COUNT - 1]).toBe("blank_4");
  });
});

describe("the closed inventory", () => {
  it("starts with all 100 tiles in the bag and nowhere else", () => {
    const inventory = fullBag();
    expect(bagOrder(inventory)).toHaveLength(TILE_COUNT);
    expect(countAt(inventory, "rack")).toBe(0);
    expect(countAt(inventory, "board")).toBe(0);
    expect(countAt(inventory, "pendingReturn")).toBe(0);
    expect(inventoryProblems(inventory)).toEqual([]);
  });

  it("rejects a game that does not begin from the complete set", () => {
    expect(() => createInventory(ALL_ORDINALS.slice(0, 99))).toThrow(InventoryError);
    expect(() => createInventory([...ALL_ORDINALS.slice(0, 99), 0])).toThrow(InventoryError);
  });

  it("keeps the count at 100 across a move", () => {
    const moved = applyMoves(fullBag(), [{ ordinal: 3, to: { at: "rack", side: "A", seq: 0 } }]);
    expect(bagOrder(moved)).toHaveLength(99);
    expect(rackOrder(moved, "A")).toEqual([3]);
    expect(moved).toHaveLength(TILE_COUNT);
  });

  it("cannot move one tile to two places in a single transition", () => {
    expect(() =>
      applyMoves(fullBag(), [
        { ordinal: 5, to: { at: "rack", side: "A", seq: 0 } },
        { ordinal: 5, to: { at: "rack", side: "B", seq: 0 } },
      ]),
    ).toThrow(InventoryError);
  });

  it("reports a board collision instead of overwriting a tile", () => {
    const first = applyMoves(fullBag(), [
      { ordinal: 1, to: { at: "board", row: 7, col: 7, placedTurn: 1, by: "A" } },
    ]);
    expect(() =>
      applyMoves(first, [
        { ordinal: 2, to: { at: "board", row: 7, col: 7, placedTurn: 2, by: "B" } },
      ]),
    ).toThrow(/both occupy board square/);
  });

  it("leaves the original untouched when a transition is rejected", () => {
    const before = fullBag();
    const snapshot = JSON.stringify(before);
    expect(() =>
      applyMoves(before, [
        { ordinal: 0, to: { at: "board", row: 99, col: 0, placedTurn: 1, by: "A" } },
      ]),
    ).toThrow(InventoryError);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("refuses a played face on a tile that has no face to choose", () => {
    expect(() =>
      applyMoves(fullBag(), [
        {
          ordinal: ordinalOfTileId("n5_1"),
          to: { at: "board", row: 7, col: 7, placedTurn: 1, by: "A", assigned: "9" },
        },
      ]),
    ).toThrow(/fixed "5" tile/);
  });

  it("refuses a played face on a tile that is not on the board", () => {
    const blank = ordinalOfTileId("blank_1");
    const corrupt = fullBag().slice() as Inventory[number][];
    corrupt[blank] = { at: "rack", side: "A", seq: 0, assigned: "7" } as never;
    expect(inventoryProblems(corrupt)).toContainEqual(
      expect.stringContaining("carries a played face while not on the board"),
    );
  });

  it("detects a tile with no authoritative location", () => {
    const corrupt = fullBag().slice() as Array<Inventory[number] | undefined>;
    corrupt[42] = undefined;
    expect(inventoryProblems(corrupt as Inventory)).toContainEqual(
      expect.stringContaining("has no authoritative location"),
    );
  });

  it("detects an inventory that no longer accounts for 100 tiles", () => {
    const short = fullBag().slice(0, 99);
    expect(() => assertInventory(short)).toThrow(/exactly 100 tiles/);
  });

  it("normalizes ordering so two routes to one position agree byte for byte", () => {
    const viaGaps = applyMoves(fullBag(), [
      { ordinal: 10, to: { at: "rack", side: "A", seq: 40 } },
      { ordinal: 11, to: { at: "rack", side: "A", seq: 90 } },
    ]);
    const viaDense = applyMoves(fullBag(), [
      { ordinal: 10, to: { at: "rack", side: "A", seq: 0 } },
      { ordinal: 11, to: { at: "rack", side: "A", seq: 1 } },
    ]);
    expect(JSON.stringify(viaGaps)).toBe(JSON.stringify(viaDense));
    expect(JSON.stringify(normalizeInventory(viaGaps))).toBe(JSON.stringify(viaGaps));
  });

  it("orders board tiles deterministically for every observer", () => {
    const placed = applyMoves(fullBag(), [
      { ordinal: 9, to: { at: "board", row: 8, col: 1, placedTurn: 1, by: "A" } },
      { ordinal: 8, to: { at: "board", row: 7, col: 7, placedTurn: 1, by: "A" } },
    ]);
    expect(boardTiles(placed).map((tile) => tile.ordinal)).toEqual([8, 9]);
  });
});
