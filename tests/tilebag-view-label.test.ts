// What the number over the tile strip is actually counting.
//
// It is not always the bag, and that is the bug this file pins. In the ordinary
// case the count is derived from the board (`84 − tiles played`), which IS the
// bag while both racks are full. Near the end of a game that derivation stops
// working — the bag can no longer refill the opponent — and the count switches
// to the only honest number left: the whole unseen pool, bag plus the
// opponent's rack.
//
// Players read that number to plan, and it went on saying "Tilebag" through the
// switch. At the end of a game it says "3" while the bag is empty, and the 3 is
// the opponent's tiles.
//
// So the label follows `kind`, and `kind` is decided here rather than at each of
// the three places that draw it.
import { describe, expect, it } from "vitest";

import { getTilebagView } from "../src/gameplay/tilebag";
import { createNewGame, setRack, type GameState, type TileInstance } from "../src/game";

function game(): GameState {
  return createNewGame({
    name: "labels",
    playerA: "A",
    playerB: "B",
    startingSide: "A",
    tileDrawMode: "play",
  });
}

function view(state: GameState) {
  return getTilebagView({ game: state, refillNeeded: false, reviewing: false, selectedLog: null });
}

/** Keep `n` tiles in the bag; the rest are treated as played. */
function withBag(state: GameState, n: number): GameState {
  return { ...state, tilebag: state.tilebag.slice(0, n) };
}

function rackOf(state: GameState, n: number): TileInstance[] {
  return state.tilebag.slice(0, n);
}

describe("what the tile count is counting", () => {
  it("is the bag while the bag can still refill the opponent", () => {
    const state = withBag(game(), 40);
    const shown = view(state);

    expect(shown.kind).toBe("bag");
    // Derived from the board, and both racks are full, so it IS the bag.
    expect(shown.remainingCount).toBe(84);
  });

  it("becomes the unseen pool once the bag cannot fill the opponent back up", () => {
    // Bag 1, opponent holding 6 of 8: the bag can no longer top them up, so the
    // board-derived estimate stops being the bag.
    const base = game();
    const state = withBag(setRack(base, "B", rackOf(base, 6)), 1);
    const shown = view(state);

    expect(shown.kind).toBe("unseen");
    expect(shown.remainingCount).toBe(7);
    // Not "opponent rack": the opponent holds 6, and calling 7 their rack would
    // be a different wrong number in the same place.
    expect(shown.remainingCount).not.toBe(6);
  });

  it("is the opponent's rack once the bag is empty", () => {
    const base = game();
    const state = withBag(setRack(base, "B", rackOf(base, 3)), 0);
    const shown = view(state);

    expect(shown.kind).toBe("opponent-rack");
    expect(shown.remainingCount).toBe(3);
  });

  it("names the tile LIST separately, because it is a different set", () => {
    // The strip always shows the unseen pool and cannot be narrowed to the bag:
    // a list of exactly the bag's contents hands the viewer the opponent's rack
    // by subtraction. So it carries its own label rather than the count's.
    const state = withBag(game(), 40);
    const shown = view(state);

    expect(shown.listKind).toBe("unseen");
    expect(shown.kind).toBe("bag");
  });

  it("calls a solo bag a bag — there is no opponent to pool with", () => {
    const solo = createNewGame({
      name: "solo",
      playerA: "A",
      playerB: "A",
      gameMode: "solo",
      startingSide: "A",
      tileDrawMode: "play",
    });
    const shown = view(withBag(solo, 5));

    expect(shown.kind).toBe("bag");
    expect(shown.listKind).toBe("bag");
    expect(shown.remainingCount).toBe(5);
  });
});
