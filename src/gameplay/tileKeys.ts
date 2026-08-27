// ── Typing a position ────────────────────────────────────────────────────────
//
// Designed around one measurement: what a player actually types. Of the 100
// physical tiles, 47 are single digits, 16 are operators and 11 are `=` — 74%
// of every keystroke. Those get an unmodified key each. The rest is arranged so
// nothing common needs a reach.
//
//   75%  one key, no modifier      0–9, + − × ÷, =, 20
//   21%  one key with Shift        10–19, the two-faced tiles
//    4%  two keys, no modifier     blank (b, then the face)
//
// ≈1.04 keystrokes per tile, and 79% of tiles never touch a modifier.
//
// THE MODIFIER RULE: Shift, and nothing else. No Ctrl, no Alt, no Cmd — every
// one of them is spoken for by an operating system or a browser, and not the
// same ones on each:
//
//   • Ctrl+digit switches browser tabs on Windows and cannot be intercepted.
//   • Ctrl+X is cut on Windows; Ctrl+D bookmarks; Alt opens the menu bar.
//   • ⌃⌘ exists only on macOS. On Windows the same combination is Ctrl+Win,
//     which the shell takes.
//
// Shift is the one modifier no platform claims, so the whole table is identical
// on Windows and macOS with nothing to document per-OS and no numpad anywhere.
//
// LAYOUT INDEPENDENCE: digits and letters are matched on the PHYSICAL key
// (`event.code`), with the produced character accepted as a fallback. Switching
// to a Thai input mode changes every character on the keyboard and changes
// nothing here. The known exception is AZERTY, where the number row needs Shift
// to produce digits at all and the letters sit elsewhere; positional matching
// inverts Shift for those users.

import type { AmathToken } from "../constants/tileDefinitions";

/** A tile to place, and the face it is played as when it has a choice. */
export type TileStroke = { token: AmathToken; assignedToken?: string };

export type TileKeyEvent = {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
};

/** What a keystroke resolves to while composing. */
export type StudyKeyAction =
  | { kind: "tile"; stroke: TileStroke }
  /** Arm the blank: the NEXT keystroke names the face it stands in for. */
  | { kind: "armBlank" }
  /** A blank with no face — what a blank is while it is still in hand. */
  | { kind: "bareBlank" }
  | { kind: "toggleDirection"; cycleAll: boolean }
  | { kind: "move"; dir: "right" | "down" | "left" | "up" }
  | { kind: "eraseBack" }
  | { kind: "eraseHere" }
  | { kind: "cancel" }
  | { kind: "confirmStep" };

/**
 * The four operators, as a slot that is independent of how the key is spelled.
 *
 * Letters rather than punctuation, because the shifted forms of the punctuation
 * keys are already taken by the characters they print — `Shift+=` IS `+`, so it
 * cannot also mean "the +/− tile played as +". With letters, Shift is free to
 * carry one rule across all four: lower case is the plain tile, upper case is
 * the two-faced tile showing that face.
 */
type OperatorSlot = "plus" | "minus" | "times" | "divide";

const OPERATOR_BY_CODE: Record<string, OperatorSlot> = {
  KeyP: "plus",
  KeyM: "minus",
  KeyX: "times",
  KeyD: "divide",
};

/** The characters that name an operator directly. Kept as aliases because they
 *  are what a player reaches for first, and none of them collides: `Shift+8`
 *  (`*`) is deliberately NOT among them, since that keystroke is the tile 18. */
const OPERATOR_BY_CHAR: Record<string, OperatorSlot> = {
  "+": "plus",
  "-": "minus",
  "/": "divide",
};

const PLAIN_TILE: Record<OperatorSlot, AmathToken> = {
  plus: "+",
  minus: "-",
  times: "x",
  divide: "/",
};

const CHOICE_TILE: Record<OperatorSlot, TileStroke> = {
  plus: { token: "+/-", assignedToken: "+" },
  minus: { token: "+/-", assignedToken: "-" },
  times: { token: "x//", assignedToken: "×" },
  divide: { token: "x//", assignedToken: "÷" },
};

/** The face a blank takes when it stands in for an operator. Spelled as the
 *  game spells assignments, which is `×` and `÷` rather than `x` and `/`. */
const BLANK_FACE: Record<OperatorSlot, string> = {
  plus: "+",
  minus: "-",
  times: "×",
  divide: "÷",
};

/**
 * The LETTER form of an operator — the only form Shift applies to.
 *
 * Matched on the physical key first, then on the produced character so a
 * layout that puts these letters elsewhere still works.
 */
function operatorFromLetter(event: TileKeyEvent): OperatorSlot | null {
  const byCode = OPERATOR_BY_CODE[event.code];
  if (byCode) return byCode;
  const letter = event.key.length === 1 ? event.key.toLowerCase() : "";
  if (letter === "p") return "plus";
  if (letter === "m") return "minus";
  if (letter === "x") return "times";
  if (letter === "d") return "divide";
  return null;
}

/**
 * The PUNCTUATION alias, which always means the plain tile.
 *
 * Shift deliberately does not apply here, because on most layouts `+` IS
 * `Shift+=` — the shift is how you produce the character, not a second meaning
 * layered on top of it. Reading it as one turned every `+` into the `+/-` tile.
 */
function operatorFromChar(event: TileKeyEvent): OperatorSlot | null {
  return OPERATOR_BY_CHAR[event.key] ?? null;
}

/** 0–9 unshifted, 10–19 shifted, 20 on its own key. Returns the face as the
 *  game spells it, which is also the tile's own name. */
function numberFace(event: TileKeyEvent): string | null {
  const digit = /^Digit([0-9])$/.exec(event.code);
  if (digit?.[1]) {
    const value = Number(digit[1]);
    return event.shiftKey ? String(10 + value) : String(value);
  }
  if (event.code === "KeyT" || event.key.toLowerCase() === "t") return "20";
  return null;
}

function isEqualsKey(event: TileKeyEvent): boolean {
  return event.key === "=" || (event.code === "Equal" && !event.shiftKey);
}

function isBlankKey(event: TileKeyEvent): boolean {
  // `?` is offered alongside `b` because it is what a blank used to be drawn
  // as, and it is the first thing a returning player tries.
  return event.code === "KeyB" || event.key.toLowerCase() === "b" || event.key === "?";
}

/** Whether a keystroke belongs to the browser rather than to this page. */
function isSystemChord(event: TileKeyEvent): boolean {
  return event.ctrlKey || event.altKey || event.metaKey;
}

/**
 * What a keystroke means while composing a position.
 *
 * `armed` is whether the blank prefix is waiting for a face. `null` means the
 * keystroke belongs to the browser and must reach it untouched.
 */
export function resolveStudyKey(event: TileKeyEvent, armed: boolean): StudyKeyAction | null {
  // Every OS shortcut stays the OS's. This is also what makes the table the
  // same on both platforms: there is nothing here to collide with.
  if (isSystemChord(event)) return null;

  if (event.key === "Escape") return { kind: "cancel" };

  if (armed) {
    // One keystroke, consumed as the blank's face. Anything that is not a face
    // cancels rather than guessing.
    if (isBlankKey(event)) return { kind: "bareBlank" };
    const face = numberFace(event);
    if (face) return { kind: "tile", stroke: { token: "?", assignedToken: face } };
    if (isEqualsKey(event)) return { kind: "tile", stroke: { token: "?", assignedToken: "=" } };
    // A blank stands in for a FACE, so the two-faced tiles — `Shift` + a letter
    // — are not among the things it can be. The punctuation aliases are still
    // fine even though `+` arrives with Shift held: there the shift is how the
    // character is produced, not a second meaning.
    const letterFace = operatorFromLetter(event);
    if (letterFace && !event.shiftKey) {
      return { kind: "tile", stroke: { token: "?", assignedToken: BLANK_FACE[letterFace] } };
    }
    const charFace = operatorFromChar(event);
    if (charFace) {
      return { kind: "tile", stroke: { token: "?", assignedToken: BLANK_FACE[charFace] } };
    }
    return { kind: "cancel" };
  }

  // ── navigation ────────────────────────────────────────────────────────────
  if (event.code === "Space" || event.key === " ") {
    return { kind: "toggleDirection", cycleAll: event.shiftKey };
  }
  if (event.key === "ArrowRight") return { kind: "move", dir: "right" };
  if (event.key === "ArrowDown") return { kind: "move", dir: "down" };
  if (event.key === "ArrowLeft") return { kind: "move", dir: "left" };
  if (event.key === "ArrowUp") return { kind: "move", dir: "up" };
  if (event.key === "Backspace") return { kind: "eraseBack" };
  if (event.key === "Delete") return { kind: "eraseHere" };
  if (event.key === "Enter") return { kind: "confirmStep" };

  // ── tiles ─────────────────────────────────────────────────────────────────
  if (isBlankKey(event)) return { kind: "armBlank" };
  if (isEqualsKey(event)) return { kind: "tile", stroke: { token: "=" } };

  const letterSlot = operatorFromLetter(event);
  if (letterSlot) {
    return {
      kind: "tile",
      stroke: event.shiftKey ? CHOICE_TILE[letterSlot] : { token: PLAIN_TILE[letterSlot] },
    };
  }
  const charSlot = operatorFromChar(event);
  if (charSlot) return { kind: "tile", stroke: { token: PLAIN_TILE[charSlot] } };

  const face = numberFace(event);
  if (face) return { kind: "tile", stroke: { token: face as AmathToken } };

  return null;
}

/** The shortcut legend the composer shows under the board. */
export const KEY_LEGEND: ReadonlyArray<{ group: string; keys: string; means: string }> = [
  { group: "เบี้ย", keys: "0 – 9", means: "เลข 0–9" },
  { group: "เบี้ย", keys: "⇧ + 0 – 9", means: "เลข 10–19" },
  { group: "เบี้ย", keys: "T", means: "เลข 20" },
  { group: "เบี้ย", keys: "P   M   X   D", means: "+   −   ×   ÷" },
  { group: "เบี้ย", keys: "=", means: "=" },
  { group: "เบี้ย", keys: "⇧ + P / M", means: "เบี้ย +/− เล่นเป็น + หรือ −" },
  { group: "เบี้ย", keys: "⇧ + X / D", means: "เบี้ย ×/÷ เล่นเป็น × หรือ ÷" },
  {
    group: "Blank",
    keys: "B  แล้วตามด้วยปุ่มของสิ่งที่จะแทน",
    means: "เช่น B 7 · B ⇧3 · B P · B =",
  },
  { group: "Blank", keys: "B  B", means: "Blank เปล่า (ใส่ในมือ)" },
  { group: "เคอร์เซอร์", keys: "Space", means: "สลับทิศ → ↔ ↓" },
  { group: "เคอร์เซอร์", keys: "⇧ + Space", means: "วนครบสี่ทิศ" },
  { group: "เคอร์เซอร์", keys: "← ↑ → ↓", means: "เลื่อนทีละช่อง (ไม่เปลี่ยนทิศ)" },
  { group: "เคอร์เซอร์", keys: "⌫", means: "ถอยหนึ่งช่องแล้วลบ" },
  { group: "เคอร์เซอร์", keys: "Delete", means: "ลบช่องที่ยืนอยู่" },
  { group: "เคอร์เซอร์", keys: "Esc", means: "ยกเลิก B ที่ค้าง · ปิดเคอร์เซอร์" },
  { group: "ขั้นตอน", keys: "Enter", means: "ยืนยันขั้นตอนนี้ (เมื่อพร้อม)" },
];
