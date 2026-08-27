// The whole key table, asserted once.
//
// It is a table, so it is tested as one: every row of the design, the modal
// blank prefix, the navigation keys, and — the point of the redesign — that
// nothing in it is a chord any operating system or browser has already taken.
import { describe, expect, it } from "vitest";

import { resolveStudyKey, type StudyKeyAction, type TileKeyEvent } from "../src/gameplay/tileKeys";

function press(overrides: Partial<TileKeyEvent> & { key: string; code: string }): TileKeyEvent {
  return { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...overrides };
}

/** Resolve with the blank prefix idle. */
const tap = (event: TileKeyEvent) => resolveStudyKey(event, false);
/** Resolve with the blank prefix armed. */
const afterB = (event: TileKeyEvent) => resolveStudyKey(event, true);

const tile = (token: string, assignedToken?: string): StudyKeyAction => ({
  kind: "tile",
  stroke:
    assignedToken === undefined
      ? { token: token as never }
      : { token: token as never, assignedToken },
});

/** Digits as a US/Thai layout prints them with Shift held. */
const SHIFTED = ")!@#$%^&*(";

describe("tiles", () => {
  it("maps 0–9 to the number tiles, on the physical key", () => {
    for (let digit = 0; digit <= 9; digit += 1) {
      expect(tap(press({ key: String(digit), code: `Digit${digit}` }))).toEqual(
        tile(String(digit)),
      );
    }
  });

  it("maps Shift+0–9 to 10–19 whatever the layout prints", () => {
    for (let digit = 0; digit <= 9; digit += 1) {
      expect(tap(press({ key: SHIFTED[digit]!, code: `Digit${digit}`, shiftKey: true }))).toEqual(
        tile(String(10 + digit)),
      );
    }
  });

  it("maps T to 20", () => {
    expect(tap(press({ key: "t", code: "KeyT" }))).toEqual(tile("20"));
    // Thai input mode changes the character, not the key.
    expect(tap(press({ key: "ะ", code: "KeyT" }))).toEqual(tile("20"));
  });

  it("maps P M X D to + − × ÷, and the punctuation as aliases", () => {
    expect(tap(press({ key: "p", code: "KeyP" }))).toEqual(tile("+"));
    expect(tap(press({ key: "m", code: "KeyM" }))).toEqual(tile("-"));
    expect(tap(press({ key: "x", code: "KeyX" }))).toEqual(tile("x"));
    expect(tap(press({ key: "d", code: "KeyD" }))).toEqual(tile("/"));
    expect(tap(press({ key: "=", code: "Equal" }))).toEqual(tile("="));

    expect(tap(press({ key: "+", code: "Equal", shiftKey: true }))).toEqual(tile("+"));
    expect(tap(press({ key: "-", code: "Minus" }))).toEqual(tile("-"));
    expect(tap(press({ key: "/", code: "Slash" }))).toEqual(tile("/"));
  });

  it("keeps the `+` alias a plain tile even though it arrives with Shift held", () => {
    // On almost every layout `+` IS Shift+=. Reading that shift as "the
    // two-faced tile" turned every plus into a `+/-`.
    expect(tap(press({ key: "+", code: "Equal", shiftKey: true }))).toEqual(tile("+"));
    // The two-faced tile is the shifted LETTER, and only that.
    expect(tap(press({ key: "P", code: "KeyP", shiftKey: true }))).toEqual(tile("+/-", "+"));
    // Same rule while the blank is armed.
    expect(afterB(press({ key: "+", code: "Equal", shiftKey: true }))).toEqual(tile("?", "+"));
  });

  it("does not read `*` as ×, so Shift+8 stays the tile 18", () => {
    // The reason × lives on the `x` key: on almost every layout `*` IS Shift+8,
    // and giving it to × would have cost 18 its shortcut.
    expect(tap(press({ key: "*", code: "Digit8", shiftKey: true }))).toEqual(tile("18"));
  });

  it("maps Shift + an operator to the two-faced tile showing that face", () => {
    expect(tap(press({ key: "P", code: "KeyP", shiftKey: true }))).toEqual(tile("+/-", "+"));
    expect(tap(press({ key: "M", code: "KeyM", shiftKey: true }))).toEqual(tile("+/-", "-"));
    expect(tap(press({ key: "X", code: "KeyX", shiftKey: true }))).toEqual(tile("x//", "×"));
    expect(tap(press({ key: "D", code: "KeyD", shiftKey: true }))).toEqual(tile("x//", "÷"));
  });
});

describe("the blank prefix", () => {
  it("arms on B, and on the ? a returning player reaches for", () => {
    expect(tap(press({ key: "b", code: "KeyB" }))).toEqual({ kind: "armBlank" });
    expect(tap(press({ key: "?", code: "Slash", shiftKey: true }))).toEqual({ kind: "armBlank" });
  });

  it("takes the next keystroke as the face, reusing the tile's own key", () => {
    expect(afterB(press({ key: "7", code: "Digit7" }))).toEqual(tile("?", "7"));
    expect(afterB(press({ key: "#", code: "Digit3", shiftKey: true }))).toEqual(tile("?", "13"));
    expect(afterB(press({ key: "t", code: "KeyT" }))).toEqual(tile("?", "20"));
    expect(afterB(press({ key: "p", code: "KeyP" }))).toEqual(tile("?", "+"));
    expect(afterB(press({ key: "d", code: "KeyD" }))).toEqual(tile("?", "÷"));
    // A blank may stand in for `=`.
    expect(afterB(press({ key: "=", code: "Equal" }))).toEqual(tile("?", "="));
  });

  it("gives a bare blank on B B, which is what a blank in hand is", () => {
    expect(afterB(press({ key: "b", code: "KeyB" }))).toEqual({ kind: "bareBlank" });
  });

  it("cancels rather than guessing when the next key is not a face", () => {
    // A blank stands in for a FACE, never for the two-faced tiles themselves.
    expect(afterB(press({ key: "P", code: "KeyP", shiftKey: true }))).toEqual({ kind: "cancel" });
    expect(afterB(press({ key: "q", code: "KeyQ" }))).toEqual({ kind: "cancel" });
    expect(afterB(press({ key: "Escape", code: "Escape" }))).toEqual({ kind: "cancel" });
  });

  it("does not treat navigation keys as faces while armed", () => {
    // Space would otherwise silently re-aim the cursor mid-prefix.
    expect(afterB(press({ key: " ", code: "Space" }))).toEqual({ kind: "cancel" });
  });
});

describe("navigation", () => {
  it("puts the two directions a player alternates between on one tap", () => {
    expect(tap(press({ key: " ", code: "Space" }))).toEqual({
      kind: "toggleDirection",
      cycleAll: false,
    });
    expect(tap(press({ key: " ", code: "Space", shiftKey: true }))).toEqual({
      kind: "toggleDirection",
      cycleAll: true,
    });
  });

  it("maps the arrows, the erases, Escape and Enter", () => {
    expect(tap(press({ key: "ArrowRight", code: "ArrowRight" }))).toEqual({
      kind: "move",
      dir: "right",
    });
    expect(tap(press({ key: "ArrowUp", code: "ArrowUp" }))).toEqual({ kind: "move", dir: "up" });
    expect(tap(press({ key: "Backspace", code: "Backspace" }))).toEqual({ kind: "eraseBack" });
    expect(tap(press({ key: "Delete", code: "Delete" }))).toEqual({ kind: "eraseHere" });
    expect(tap(press({ key: "Escape", code: "Escape" }))).toEqual({ kind: "cancel" });
    expect(tap(press({ key: "Enter", code: "Enter" }))).toEqual({ kind: "confirmStep" });
  });
});

describe("what the table deliberately does not claim", () => {
  it("leaves every Ctrl, Alt and Cmd chord to the platform", () => {
    // This is the whole point of the redesign. Ctrl+digit switches browser tabs
    // on Windows and cannot be intercepted; Ctrl+X is cut; Alt opens the menu
    // bar; ⌃⌘ does not exist off macOS. Shift is the only modifier nobody
    // claims, so it is the only one used.
    for (const modifier of ["ctrlKey", "altKey", "metaKey"] as const) {
      expect(tap(press({ key: "5", code: "Digit5", [modifier]: true }))).toBeNull();
      expect(tap(press({ key: "x", code: "KeyX", [modifier]: true }))).toBeNull();
      expect(tap(press({ key: "b", code: "KeyB", [modifier]: true }))).toBeNull();
      // Even while armed: the browser's chord is still the browser's.
      expect(afterB(press({ key: "5", code: "Digit5", [modifier]: true }))).toBeNull();
    }
  });

  it("ignores keys that are not part of the table", () => {
    expect(tap(press({ key: "q", code: "KeyQ" }))).toBeNull();
    expect(tap(press({ key: "Tab", code: "Tab" }))).toBeNull();
  });
});
