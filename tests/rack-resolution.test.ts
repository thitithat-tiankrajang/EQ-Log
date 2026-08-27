// The prediction, case by case.
//
// This is the whole feature of typing in a game: a key names a face, and the
// rack decides which tile provides it. The order is what is being pinned —
// exact, then two-faced, then blank — because every way of getting it wrong
// costs the player a tile they wanted to keep.
import { describe, expect, it } from "vitest";

import {
  resolveDrawnTile,
  resolveRackTile,
  tileRequestFromStroke,
} from "../src/gameplay/rackResolution";
import { resolveStudyKey, type TileKeyEvent } from "../src/gameplay/tileKeys";
import type { TileInstance } from "../src/game";

/** A rack written the way a player reads it. */
function rack(...tokens: string[]): TileInstance[] {
  return tokens.map((token, index) => ({ id: `t${index}`, token: token as never }));
}

const face = (value: string) => ({ kind: "face" as const, face: value });

describe("spending the least flexible tile that can do the job", () => {
  it("takes the exact tile over the two-faced one", () => {
    // The case that started this: holding both `+` and `+/-`, `+` must spend
    // the plain one and keep the flexible tile for later.
    const held = rack("+", "+/-");
    const found = resolveRackTile(held, face("+"));
    expect(found?.tile.token).toBe("+");
    expect(found?.via).toBe("exact");
    expect(found?.assignedToken).toBeUndefined();
  });

  it("takes the exact tile over the blank", () => {
    const found = resolveRackTile(rack("5", "?"), face("5"));
    expect(found?.tile.token).toBe("5");
    expect(found?.via).toBe("exact");
  });

  it("takes the two-faced tile over the blank", () => {
    const found = resolveRackTile(rack("?", "+/-"), face("+"));
    expect(found?.tile.token).toBe("+/-");
    expect(found?.via).toBe("choice");
    expect(found?.assignedToken).toBe("+");
  });

  it("falls back to the blank when nothing else can show the face", () => {
    // The other case that started this: no 5 in hand, but a blank will do.
    const found = resolveRackTile(rack("1", "?"), face("5"));
    expect(found?.tile.token).toBe("?");
    expect(found?.via).toBe("blank");
    expect(found?.assignedToken).toBe("5");
  });

  it("prefers by TIER, not by position in the rack", () => {
    // The blank sits first and the exact tile last. A single left-to-right pass
    // would burn the blank; the tiers are what stop it.
    const found = resolveRackTile(rack("?", "+/-", "+"), face("+"));
    expect(found?.tile.token).toBe("+");
  });

  it("breaks ties inside a tier by taking the leftmost", () => {
    // So the rack does not reshuffle under the player between identical keys.
    const held = rack("5", "5");
    expect(resolveRackTile(held, face("5"))?.tile.id).toBe("t0");
  });
});

describe("the faces each tile can show", () => {
  it("reads × and ÷ as the operators they print, not as x and /", () => {
    expect(resolveRackTile(rack("x"), face("×"))?.via).toBe("exact");
    expect(resolveRackTile(rack("/"), face("÷"))?.via).toBe("exact");
    // The internal token spelling is not a face a player can ask for.
    expect(resolveRackTile(rack("x"), face("x"))).toBeNull();
  });

  it("lets the two-faced tiles show only their own two faces", () => {
    expect(resolveRackTile(rack("+/-"), face("-"))?.via).toBe("choice");
    expect(resolveRackTile(rack("x//"), face("÷"))?.via).toBe("choice");
    // `+/-` is not a multiplication sign, however much a blank would be.
    expect(resolveRackTile(rack("+/-"), face("×"))).toBeNull();
  });

  it("lets a blank be a number, an operator or an equals", () => {
    for (const value of ["0", "9", "20", "+", "-", "×", "÷", "="]) {
      expect(resolveRackTile(rack("?"), face(value))?.via, value).toBe("blank");
    }
  });

  it("answers nothing when the rack cannot show the face", () => {
    expect(resolveRackTile(rack("1", "2", "+"), face("9"))).toBeNull();
    expect(resolveRackTile([], face("5"))).toBeNull();
    // Empty slots are not tiles.
    expect(resolveRackTile([null, null], face("5"))).toBeNull();
  });
});

describe("the overrides, for a player who means it", () => {
  it("forces the blank even when the exact tile is in hand", () => {
    // Keeping the 5 for a bingo and paying with the blank is a real decision,
    // and the default must not be the only option.
    const found = resolveRackTile(rack("5", "?"), { kind: "blank", face: "5" });
    expect(found?.tile.token).toBe("?");
    expect(found?.assignedToken).toBe("5");
  });

  it("forces the two-faced tile even when the plain one is in hand", () => {
    const found = resolveRackTile(rack("+", "+/-"), {
      kind: "choice",
      token: "+/-",
      face: "+",
    });
    expect(found?.tile.token).toBe("+/-");
    expect(found?.assignedToken).toBe("+");
  });

  it("refuses an override the rack cannot honour rather than substituting", () => {
    // An override is an instruction, not a preference. Quietly answering it
    // with a different tile would be worse than answering with nothing.
    expect(resolveRackTile(rack("5"), { kind: "blank", face: "5" })).toBeNull();
    expect(resolveRackTile(rack("?"), { kind: "choice", token: "+/-", face: "+" })).toBeNull();
    expect(resolveRackTile(rack("x//"), { kind: "choice", token: "x//", face: "+" })).toBeNull();
  });
});

describe("from keystroke to request", () => {
  const press = (overrides: Partial<TileKeyEvent> & { key: string; code: string }) => ({
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  });

  /** The whole path a keypress takes in a game: key → request → tile in hand. */
  function type(
    held: TileInstance[],
    event: TileKeyEvent,
    armed = false,
  ): ReturnType<typeof resolveRackTile> {
    const action = resolveStudyKey(event, armed);
    if (action?.kind !== "tile") return null;
    const request = tileRequestFromStroke(action.stroke);
    return request ? resolveRackTile(held, request) : null;
  }

  it("predicts for an unmodified key", () => {
    // `5` with no 5 in hand spends the blank — the case that was asked for.
    expect(type(rack("1", "?"), press({ key: "5", code: "Digit5" }))?.via).toBe("blank");
    expect(type(rack("5", "?"), press({ key: "5", code: "Digit5" }))?.via).toBe("exact");
  });

  it("reads the X key as a request for a × face", () => {
    expect(type(rack("x"), press({ key: "x", code: "KeyX" }))?.via).toBe("exact");
    // And the blank can stand in for it.
    expect(type(rack("?"), press({ key: "x", code: "KeyX" }))?.assignedToken).toBe("×");
  });

  it("treats Shift + an operator as an instruction, not a preference", () => {
    const held = rack("+", "+/-");
    expect(type(held, press({ key: "P", code: "KeyP", shiftKey: true }))?.tile.token).toBe("+/-");
    // Without the Shift the same rack answers with the plain tile.
    expect(type(held, press({ key: "p", code: "KeyP" }))?.tile.token).toBe("+");
  });

  it("treats B + a face as an instruction to spend the blank", () => {
    const held = rack("5", "?");
    expect(type(held, press({ key: "5", code: "Digit5" }), true)?.tile.token).toBe("?");
    expect(type(held, press({ key: "5", code: "Digit5" }), false)?.tile.token).toBe("5");
  });

  it("refuses a bare blank, because a blank on the board is playing as something", () => {
    // `B B` puts an unassigned blank in hand in Study. There is no such thing
    // on a board.
    expect(tileRequestFromStroke({ token: "?" })).toBeNull();
    expect(tileRequestFromStroke({ token: "+/-" })).toBeNull();
  });
});

describe("drawing from the bag, where prediction would be a lie", () => {
  it("draws the exact tile and nothing else", () => {
    expect(resolveDrawnTile(rack("5", "?"), face("5"))?.token).toBe("5");
  });

  it("refuses rather than substituting a blank", () => {
    // Playing asks "what should appear on the board" and a blank is a fine
    // answer. Drawing asks "which tile came out of the bag", and answering that
    // with a blank would record a five that was never drawn.
    expect(resolveDrawnTile(rack("1", "?"), face("5"))).toBeNull();
    // The same rack DOES answer the same key when the question is what to play.
    expect(resolveRackTile(rack("1", "?"), face("5"))?.via).toBe("blank");
  });

  it("refuses rather than substituting a two-faced tile", () => {
    expect(resolveDrawnTile(rack("+/-"), face("+"))).toBeNull();
    expect(resolveRackTile(rack("+/-"), face("+"))?.via).toBe("choice");
  });

  it("still honours the overrides, which name a physical tile outright", () => {
    expect(resolveDrawnTile(rack("5", "?"), { kind: "blank", face: "5" })?.token).toBe("?");
    expect(
      resolveDrawnTile(rack("+", "+/-"), { kind: "choice", token: "+/-", face: "+" })?.token,
    ).toBe("+/-");
  });
});
