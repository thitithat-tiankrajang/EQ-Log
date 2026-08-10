import { describe, expect, it } from "vitest";
import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { RACK_SIZE } from "../src/constants/gameRules";
import { createNewGame, type GameState } from "../src/game";
import { isRemoteGameAhead, isRemoteGameStale, revisionOf, withRevision } from "../src/gameSync";
import { makeRemoteStateKey } from "../src/stateKey";
import {
  applyCanonicalToSnapshot,
  canonicalFromSnapshot,
  decodeCanonical,
  encodeCanonical,
  inventoryFrom,
} from "../src/domain/projection";
import { TILE_COUNT } from "../src/domain/tiles";
import { InventoryError, bagOrder, rackOrder } from "../src/domain/inventory";

function game(overrides: Partial<GameState> = {}): GameState {
  return {
    ...createNewGame({ ...DEFAULT_NEW_GAME_SETTINGS, tileDrawMode: "play" }),
    ...overrides,
  };
}

describe("ordering is decided by the revision and nothing else", () => {
  it("treats a higher revision as ahead and a lower one as stale", () => {
    const local = withRevision(game(), 7);
    expect(isRemoteGameAhead(local, withRevision(local, 8))).toBe(true);
    expect(isRemoteGameAhead(local, withRevision(local, 7))).toBe(false);
    expect(isRemoteGameAhead(local, withRevision(local, 6))).toBe(false);
    expect(isRemoteGameStale(local, withRevision(local, 6))).toBe(true);
    expect(isRemoteGameStale(local, withRevision(local, 7))).toBe(false);
    expect(isRemoteGameStale(local, withRevision(local, 8))).toBe(false);
  });

  it("does not let a shorter log or a lower phase read as older", () => {
    // The previous ordering inferred progress from the shape of the game, so a
    // state with fewer logs, or in an earlier phase, compared as behind and was
    // discarded even when the server had committed it.
    const local = withRevision(game({ phase: "choose_action", turnNumber: 9 }), 4);
    const committed = withRevision(game({ phase: "refill", turnNumber: 2 }), 5);
    expect(isRemoteGameStale(local, committed)).toBe(false);
    expect(isRemoteGameAhead(local, committed)).toBe(true);
  });

  it("does not depend on device clocks", () => {
    const local = withRevision(game({ lastSavedAt: "2999-01-01T00:00:00.000Z" }), 3);
    const committed = withRevision(game({ lastSavedAt: "2000-01-01T00:00:00.000Z" }), 4);
    // A device with a wildly wrong clock cannot make a committed turn look old.
    expect(isRemoteGameAhead(local, committed)).toBe(true);
    expect(isRemoteGameStale(local, committed)).toBe(false);
  });

  it("adopts a different game wholesale rather than comparing positions", () => {
    const local = withRevision(game(), 40);
    const other = withRevision(game({ gameId: "different" }), 1);
    expect(isRemoteGameAhead(local, other)).toBe(true);
    expect(isRemoteGameStale(local, other)).toBe(false);
  });

  it("reads a game saved before revisions as position zero", () => {
    const legacy = game();
    delete (legacy as { revision?: number }).revision;
    expect(revisionOf(legacy)).toBe(0);
    expect(isRemoteGameAhead(withRevision(legacy, 1), legacy)).toBe(false);
    expect(isRemoteGameStale(withRevision(legacy, 1), legacy)).toBe(true);
  });
});

describe("a confirmed commit is recognized as the position already held", () => {
  it("has the same content key before and after the revision is confirmed", () => {
    const local = withRevision(game(), 5);
    const echo = withRevision(local, 6);
    // Same position, new number: the content key must not change, or the echo
    // of this client's own write would read as somebody else's move.
    expect(makeRemoteStateKey(echo)).toBe(makeRemoteStateKey(local));
    expect(isRemoteGameAhead(local, echo)).toBe(true);
  });

  it("distinguishes positions that differ only in which physical tile moved", () => {
    const base = game();
    const swapped: GameState = {
      ...base,
      rackA: [base.rackA[1], base.rackA[0], ...base.rackA.slice(2)],
    };
    expect(makeRemoteStateKey(swapped)).not.toBe(makeRemoteStateKey(base));
  });
});

describe("canonical projection", () => {
  it("round-trips a live game through the wire form without losing a tile", () => {
    const source = game();
    const canonical = canonicalFromSnapshot(source, 3);
    const restored = decodeCanonical(JSON.parse(JSON.stringify(encodeCanonical(canonical))));
    expect(restored.revision).toBe(3);
    expect(restored.inventory).toHaveLength(TILE_COUNT);
    expect(bagOrder(restored.inventory)).toEqual(bagOrder(canonical.inventory));
    expect(rackOrder(restored.inventory, "A")).toEqual(rackOrder(canonical.inventory, "A"));
    expect(rackOrder(restored.inventory, "B")).toEqual(rackOrder(canonical.inventory, "B"));
  });

  it("rebuilds the rendered position a spectator sees from canonical state alone", () => {
    const source = game();
    const canonical = canonicalFromSnapshot(source, 3);
    // A spectator holding only an old shell plus this canonical state.
    const stale: GameState = { ...source, rackA: [], rackB: [], tilebag: [] };
    const rendered = applyCanonicalToSnapshot(stale, canonical);
    expect(rendered.rackA.map((tile) => tile.id)).toEqual(source.rackA.map((tile) => tile.id));
    expect(rendered.rackB.map((tile) => tile.id)).toEqual(source.rackB.map((tile) => tile.id));
    expect(rendered.tilebag.map((tile) => tile.id)).toEqual(source.tilebag.map((tile) => tile.id));
    expect(() => inventoryFrom(rendered)).not.toThrow();
  });

  it("stays the same size as the game grows, unlike the full record", () => {
    const early = game();
    const later: GameState = {
      ...early,
      // A long game's record accumulates a board and two rack copies per turn;
      // the canonical placement table does not.
      logs: Array.from({ length: 60 }, (_, index) => ({
        ...({} as never),
        id: `log-${index}`,
      })) as GameState["logs"],
    };
    const earlySize = JSON.stringify(encodeCanonical(canonicalFromSnapshot(early, 7))).length;
    const laterSize = JSON.stringify(encodeCanonical(canonicalFromSnapshot(later, 7))).length;
    expect(laterSize).toBe(earlySize);
    // And it is small in absolute terms.
    expect(earlySize).toBeLessThan(6000);
  });

  it("refuses canonical state that does not describe the physical set", () => {
    const canonical = encodeCanonical(canonicalFromSnapshot(game(), 1));
    canonical.inventory = (canonical.inventory as unknown[]).slice(1);
    expect(() => decodeCanonical(canonical)).toThrow(InventoryError);
  });

  it("refuses a rendered position that has lost a tile", () => {
    const damaged = game();
    expect(() =>
      canonicalFromSnapshot({ ...damaged, tilebag: damaged.tilebag.slice(1) }, 1),
    ).toThrow(/in no location at all/);
  });

  it("refuses a rendered position that holds the same tile twice", () => {
    const damaged = game();
    expect(() =>
      canonicalFromSnapshot({ ...damaged, rackB: [...damaged.rackB, damaged.rackA[0]] }, 1),
    ).toThrow(/is in both/);
  });

  it("counts a real game's tiles across every location", () => {
    const source = game();
    const canonical = canonicalFromSnapshot(source, 0);
    expect(
      bagOrder(canonical.inventory).length +
        rackOrder(canonical.inventory, "A").length +
        rackOrder(canonical.inventory, "B").length,
    ).toBe(TILE_COUNT);
    expect(rackOrder(canonical.inventory, "A")).toHaveLength(RACK_SIZE);
  });
});
