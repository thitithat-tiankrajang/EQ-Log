// Typing a rack: the exact sequence the transcriber described, keystroke by keystroke.
//
// The interesting rule is that `1` is both a finished tile and the start of `18`, so a slot
// holds something legal that may still grow. Everything below is about where that growing
// starts and stops.
import { describe, expect, it } from "vitest";
import {
  createTypingState,
  focusSlot,
  isComplete,
  setSlot,
  typeKey,
  typedTokens,
  type TypingState,
} from "../src/gameplay/rackTyping";

/** Press a run of keys and return where it ended up. */
function press(state: TypingState, keys: readonly string[]): TypingState {
  return keys.reduce((current, key) => typeKey(current, key).state, state);
}

const rack = () => createTypingState(8);

describe("the sequence from the brief", () => {
  it("1 then 8 makes 18, and backspace takes it apart one digit at a time", () => {
    let state = press(rack(), ["1"]);
    expect(state.slots[0]).toBe("1");

    state = press(state, ["8"]);
    expect(state.slots[0]).toBe("18");

    state = press(state, ["Backspace"]);
    expect(state.slots[0]).toBe("1");

    state = press(state, ["Backspace"]);
    expect(state.slots[0]).toBeNull();
    // Still on the same slot: the tile was emptied, not skipped.
    expect(state.focus).toBe(0);
  });

  it("backspacing an empty slot steps back without destroying what is there", () => {
    let state = press(rack(), ["5", " ", "7"]);
    expect(state.slots[0]).toBe("5");
    expect(state.slots[1]).toBe("7");

    state = press(state, ["Backspace", "Backspace"]);
    expect(state.slots[1]).toBeNull();
    expect(state.focus).toBe(0);
    // The tile behind the focus is untouched — navigating is not deleting.
    expect(state.slots[0]).toBe("5");
  });

  it("space commits whatever the slot holds and moves on, from one digit or two", () => {
    const fromOne = press(rack(), ["1", " "]);
    expect(fromOne.slots[0]).toBe("1");
    expect(fromOne.focus).toBe(1);

    const fromTwo = press(rack(), ["1", "8", " "]);
    expect(fromTwo.slots[0]).toBe("18");
    expect(fromTwo.focus).toBe(1);
  });
});

describe("which second digits are real tiles", () => {
  it("takes 10 through 19", () => {
    for (const second of ["0", "1", "5", "9"]) {
      expect(press(rack(), ["1", second]).slots[0]).toBe(`1${second}`);
    }
  });

  it("takes 20 and nothing else after a 2", () => {
    expect(press(rack(), ["2", "0"]).slots[0]).toBe("20");
    // 25 is not a tile. The 5 is refused and the 2 stays, because a transcriber who typed it
    // has misread the rack and should see that, not a silent 5.
    expect(press(rack(), ["2", "5"]).slots[0]).toBe("2");
  });

  it("takes no second digit after 0 or after 3 through 9", () => {
    expect(press(rack(), ["0", "1"]).slots[0]).toBe("0");
    expect(press(rack(), ["7", "7"]).slots[0]).toBe("7");
  });

  it("still reports the refused key as handled, so the page does not also act on it", () => {
    const after = typeKey(press(rack(), ["2"]), "5");
    expect(after.handled).toBe(true);
    expect(after.state.slots[0]).toBe("2");
  });
});

describe("operators", () => {
  it("commit on one keystroke and move on, because none is a prefix of another", () => {
    const state = press(rack(), ["+", "-", "=", "?"]);
    expect(state.slots.slice(0, 4)).toEqual(["+", "-", "=", "?"]);
    expect(state.focus).toBe(4);
  });

  it("accepts the keys the board already uses for multiply and divide", () => {
    expect(press(rack(), ["x"]).slots[0]).toBe("x");
    expect(press(rack(), ["/"]).slots[0]).toBe("/");
    expect(press(rack(), ["d"]).slots[0]).toBe("/");
    expect(press(rack(), ["p"]).slots[0]).toBe("+");
    expect(press(rack(), ["m"]).slots[0]).toBe("-");
  });

  it("leaves `*` alone, because on this keyboard Shift+8 is the tile 18", () => {
    // `tileKeys.ts` refuses `*` on purpose and says why: the keystroke that produces it is the
    // one that means eighteen. Accepting it here would make the rack and the board disagree
    // about the same key, which is worse than not having the alias.
    expect(press(rack(), ["*"]).slots[0]).toBeNull();
  });

  it("replaces a digit that was typed by mistake", () => {
    const state = press(rack(), ["1", "8"]);
    expect(press(state, ["=", "="]).slots[0]).toBe("=");
  });
});

describe("what the keyboard does not own", () => {
  it("leaves an unrecognised key alone so the page keeps its own shortcuts", () => {
    const outcome = typeKey(rack(), "F5");
    expect(outcome.handled).toBe(false);
    expect(outcome.state).toEqual(rack());
  });

  it("never walks the focus off either end", () => {
    const start = press(rack(), ["ArrowLeft", "ArrowLeft"]);
    expect(start.focus).toBe(0);
    const end = press(rack(), ["End", "ArrowRight", "ArrowRight"]);
    expect(end.focus).toBe(7);
  });
});

describe("the board's own key table still works here", () => {
  const shifted = (digit: string) => ({
    key: digit,
    code: `Digit${digit}`,
    shiftKey: true,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  });

  it("takes Shift+digit as 10-19 in one stroke, the way the board does", () => {
    expect(typeKey(rack(), shifted("8")).state.slots[0]).toBe("18");
    expect(typeKey(rack(), shifted("0")).state.slots[0]).toBe("10");
  });

  it("takes T for twenty", () => {
    expect(press(rack(), ["t"]).slots[0]).toBe("20");
  });

  it("advances after a one-stroke tile, unlike an accumulating digit", () => {
    expect(typeKey(rack(), shifted("8")).state.focus).toBe(1);
    expect(press(rack(), ["1"]).focus).toBe(0);
  });

  it("refuses an OS chord so the browser keeps it", () => {
    const outcome = typeKey(rack(), {
      key: "1",
      code: "Digit1",
      shiftKey: false,
      ctrlKey: true,
      altKey: false,
      metaKey: false,
    });
    expect(outcome.handled).toBe(false);
  });
});

describe("the tile bag still works", () => {
  it("sets a slot from a click and advances, exactly as typing does", () => {
    const state = setSlot(focusSlot(rack(), 3), 3, "20");
    expect(state.slots[3]).toBe("20");
    expect(state.focus).toBe(4);
  });

  it("reports what has been entered, and when the rack is full", () => {
    const partial = press(rack(), ["1", "8", " ", "=", "5"]);
    expect(typedTokens(partial)).toEqual(["18", "=", "5"]);
    expect(isComplete(partial)).toBe(false);

    const full = press(rack(), [
      "1",
      " ",
      "2",
      " ",
      "3",
      " ",
      "4",
      " ",
      "5",
      " ",
      "6",
      " ",
      "7",
      " ",
      "8",
    ]);
    expect(isComplete(full)).toBe(true);
    expect(typedTokens(full)).toHaveLength(8);
  });
});
