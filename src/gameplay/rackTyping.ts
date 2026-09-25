// Typing a rack out, instead of clicking eight tiles out of a bag.
//
// Transcribing a real game means entering the same eight tiles over and over, and a tile bag is
// a grid of twenty-nine targets to hunt through. Typing is faster because the thing you are
// reading off the table is already a character: you see a 18 and you press 1 then 8.
//
// THE ONE AWKWARD PART, and the reason this is a state machine rather than an input handler:
// `1` and `18` are both tiles. Pressing `1` cannot commit, because `8` may be coming; and it
// cannot wait either, because `1` may be all there is. So a slot holds a DRAFT that is already
// a legal tile and may still grow:
//
//     1        ->  "1"     a tile, and a prefix
//     1 8      ->  "18"    a tile, and no longer a prefix
//     1 8 ⌫    ->  "1"
//     1 8 ⌫ ⌫  ->  ""      the slot is empty
//     1 8 ⌫ ⌫ ⌫ ->  focus moves back a slot, which still holds what it held
//     1 ␣      ->  "1" committed, focus moves on — the space is how you say "that was all"
//
// A second digit is only taken when it makes a real tile. `2` then `5` is not 25, so the 5 is
// refused and the slot stays `2` — refused rather than replaced, because a transcriber reading
// `25` off a rack has misread something, and silently turning it into `5` would hide that.
//
// Operators are one keystroke and commit immediately: there is no operator that is a prefix of
// another.
//
// IT ALSO SPEAKS THE BOARD'S LANGUAGE. `src/gameplay/tileKeys.ts` already defines how this app
// types a tile — `Shift`+digit for 10-19, `T` for 20, `P M X D` for the operators, `Shift` on
// those letters for the two-faced tiles — and that table was chosen by counting what a player
// actually presses. Inventing a second, incompatible one for the rack would mean learning the
// app twice, so every stroke that table understands is understood here too. Digit accumulation
// is the addition, not the replacement: it is the shorter road for someone reading numbers off
// a rack, and it needs no modifier at all.
import type { AmathToken } from "../constants/tileDefinitions";
import { resolveStudyKey, type TileKeyEvent } from "./tileKeys";

/** One rack position while it is being typed. `null` is an empty slot. */
export type Slot = AmathToken | null;

export type TypingState = {
  readonly slots: readonly Slot[];
  /** Which slot the next keystroke goes to. Always within `slots`. */
  readonly focus: number;
};

/** Tokens a second digit can still be appended to: `1` reaches 10-19, `2` reaches only 20. */
function growsInto(current: string, digit: string): AmathToken | null {
  const combined = `${current}${digit}`;
  const value = Number(combined);
  if (!Number.isInteger(value) || value < 10 || value > 20) return null;
  // "01" is not a tile even though it parses as 1.
  if (current === "0") return null;
  return combined as AmathToken;
}

export function createTypingState(size: number, initial?: readonly Slot[]): TypingState {
  const slots: Slot[] = Array.from({ length: size }, (_, i) => initial?.[i] ?? null);
  return { slots, focus: 0 };
}

export type KeyOutcome = {
  readonly state: TypingState;
  /** False when the key meant nothing here — the caller should not swallow the event. */
  readonly handled: boolean;
};

/** A bare `key` is enough for the digit and navigation rules; the rest reads the modifiers. */
function asEvent(key: string | TileKeyEvent): TileKeyEvent {
  return typeof key === "string"
    ? { key, code: "", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }
    : key;
}

/**
 * Apply one keystroke.
 *
 * Everything this does not recognise is returned unhandled, so the surrounding page keeps its
 * own shortcuts — including the one that leaves typing mode.
 */
export function typeKey(state: TypingState, input: string | TileKeyEvent): KeyOutcome {
  const event = asEvent(input);
  const key = event.key;
  const at = state.focus;
  const slots = [...state.slots];
  const current = slots[at] ?? null;
  const unchanged = { state, handled: false };
  if (at < 0 || at >= slots.length) return unchanged;
  // Every OS chord stays the OS's.
  if (event.ctrlKey || event.altKey || event.metaKey) return unchanged;

  const commit = (token: AmathToken): KeyOutcome => {
    slots[at] = token;
    return { state: { slots, focus: Math.min(at + 1, slots.length - 1) }, handled: true };
  };

  // ── an unshifted digit: the one rule that ACCUMULATES ─────────────────────
  if (!event.shiftKey && /^[0-9]$/.test(key)) {
    if (current !== null && /^[0-9]$/.test(current)) {
      const grown = growsInto(current, key);
      // A second digit that makes no tile is refused, and the slot keeps what it had.
      if (grown === null) return { state, handled: true };
      slots[at] = grown;
      return { state: { slots, focus: at }, handled: true };
    }
    // An occupied slot holding anything else is replaced: typing over is how you correct.
    slots[at] = key as AmathToken;
    return { state: { slots, focus: at }, handled: true };
  }

  // ── space: "that was the whole tile" ──────────────────────────────────────
  if (key === " " || key === "Spacebar" || event.code === "Space") {
    // From an empty slot it still advances, so a run of spaces skips tiles you cannot read.
    return { state: { slots, focus: Math.min(at + 1, slots.length - 1) }, handled: true };
  }

  // ── backspace: one digit, then the slot, then the focus ───────────────────
  if (key === "Backspace") {
    if (current !== null && current.length > 1) {
      slots[at] = current.slice(0, -1) as AmathToken;
      return { state: { slots, focus: at }, handled: true };
    }
    if (current !== null) {
      slots[at] = null;
      return { state: { slots, focus: at }, handled: true };
    }
    // Already empty: step back, and leave what is there alone. The transcriber is navigating,
    // not deleting — taking the previous tile as well would destroy work with no undo.
    return { state: { slots, focus: Math.max(0, at - 1) }, handled: true };
  }

  // ── plain navigation ──────────────────────────────────────────────────────
  if (key === "ArrowRight")
    return { state: { slots, focus: Math.min(at + 1, slots.length - 1) }, handled: true };
  if (key === "ArrowLeft") return { state: { slots, focus: Math.max(0, at - 1) }, handled: true };
  if (key === "Home") return { state: { slots, focus: 0 }, handled: true };
  if (key === "End") return { state: { slots, focus: slots.length - 1 }, handled: true };
  if (key === "Delete") {
    slots[at] = null;
    return { state: { slots, focus: at }, handled: true };
  }

  // ── everything else the BOARD already understands ─────────────────────────
  // A rack holds tiles, not a position, so only the strokes that name one tile apply: the
  // cursor and blank-arming verbs belong to the board and are left to it.
  const action = resolveStudyKey(event, false);
  if (action?.kind === "tile") return commit(action.stroke.token);
  if (action?.kind === "armBlank" || action?.kind === "bareBlank") return commit("?");

  return unchanged;
}

/** Put the focus somewhere directly — what a click on a rack slot does. */
export function focusSlot(state: TypingState, index: number): TypingState {
  if (index < 0 || index >= state.slots.length) return state;
  return { ...state, focus: index };
}

/** Set one slot from outside the keyboard — what a click in the tile bag does. */
export function setSlot(state: TypingState, index: number, token: Slot): TypingState {
  if (index < 0 || index >= state.slots.length) return state;
  const slots = [...state.slots];
  slots[index] = token;
  return { slots, focus: Math.min(index + 1, slots.length - 1) };
}

/** The tokens typed so far, in rack order, empties dropped. */
export function typedTokens(state: TypingState): AmathToken[] {
  return state.slots.filter((slot): slot is AmathToken => slot !== null);
}

export function isComplete(state: TypingState): boolean {
  return state.slots.every((slot) => slot !== null);
}
