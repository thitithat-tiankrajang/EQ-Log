// ── Which tile in hand answers the key that was pressed ──────────────────────
//
// In Study a key names a TILE, because the palette holds all one hundred. In a
// game a key names a FACE — "put a 5 here" — and the rack may answer it in more
// than one way: with the 5 itself, or with a blank standing in for one.
//
// THE RULE IS "SPEND THE LEAST FLEXIBLE TILE THAT CAN DO THE JOB", and it is
// the same answer in three currencies, which is why it is worth being the only
// rule:
//
//   • Flexibility — a `5` is a five and nothing else; a blank is any of
//     twenty-five things. Burning the blank first throws away the option.
//   • Score — the exact tile is worth more than the two-faced tile, which is
//     worth more than the blank (zero). Spending the cheap one first also
//     scores the most.
//   • Predictability — one fixed order. A player who cannot predict which tile
//     a key will spend has to look after every keystroke, which costs more than
//     the keystroke saved.
//
// It is a DEFAULT, never a trap: `Shift`+operator forces the two-faced tile and
// `B`+face forces the blank, so a player who means to burn a blank can say so.

import { BLANK_ASSIGNMENT_OPTIONS } from "../constants/equationRules";
import { AMATH_TOKENS, type AmathToken } from "../constants/tileDefinitions";
import type { TileInstance } from "../game";
import type { TileStroke } from "./tileKeys";

/** A face as the game spells assignments: `×` and `÷`, not `x` and `/`. */
export type TileFace = (typeof BLANK_ASSIGNMENT_OPTIONS)[number];

const BLANK_FACES = new Set<string>(BLANK_ASSIGNMENT_OPTIONS);

/** The faces each two-faced tile can show. */
const CHOICE_FACES: Partial<Record<AmathToken, readonly string[]>> = {
  "+/-": ["+", "-"],
  "x//": ["×", "÷"],
};

/** What a tile shows when it is played as itself. `AMATH_TOKENS[token].token`
 *  is the printed glyph, which is already `×` and `÷` for those two. */
function intrinsicFace(token: AmathToken): string {
  return AMATH_TOKENS[token].token;
}

export type TileRequest =
  /** "Put this face here" — the rack decides which tile provides it. */
  | { kind: "face"; face: string }
  /** Force the two-faced tile, even when the plain one is in hand. */
  | { kind: "choice"; token: "+/-" | "x//"; face: string }
  /** Force the blank, even when the exact tile is in hand. */
  | { kind: "blank"; face: string };

export type RackResolution = {
  tile: TileInstance;
  /** Set only when the tile is playing as something other than itself, which is
   *  exactly when the board needs an assignment. */
  assignedToken?: string;
  /** How the request was answered. The UI says so when it is not `exact`,
   *  because spending a blank without noticing is the one way this rule can
   *  cost a player something. */
  via: "exact" | "choice" | "blank";
};

function canShow(tile: TileInstance, face: string): RackResolution | null {
  if (intrinsicFace(tile.token) === face) return { tile, via: "exact" };
  if (CHOICE_FACES[tile.token]?.includes(face)) {
    return { tile, assignedToken: face, via: "choice" };
  }
  if (tile.token === "?" && BLANK_FACES.has(face)) {
    return { tile, assignedToken: face, via: "blank" };
  }
  return null;
}

/**
 * Find the tile that should answer `request`, or `null` when the rack holds
 * nothing that can.
 *
 * Ties inside a tier go to the leftmost tile, so a rack does not reshuffle
 * itself under the player's eyes between identical keystrokes.
 */
export function resolveRackTile(
  rack: readonly (TileInstance | null)[],
  request: TileRequest,
): RackResolution | null {
  const held = rack.filter((tile): tile is TileInstance => tile !== null);

  if (request.kind === "blank") {
    if (!BLANK_FACES.has(request.face)) return null;
    const blank = held.find((tile) => tile.token === "?");
    return blank ? { tile: blank, assignedToken: request.face, via: "blank" } : null;
  }

  if (request.kind === "choice") {
    if (!CHOICE_FACES[request.token]?.includes(request.face)) return null;
    const choice = held.find((tile) => tile.token === request.token);
    return choice ? { tile: choice, assignedToken: request.face, via: "choice" } : null;
  }

  // The prediction. Three passes rather than one, because the ORDER is the
  // whole feature: a single pass would answer with whichever tile happened to
  // sit leftmost, which is how a blank gets spent on a five that was two slots
  // further along.
  for (const via of ["exact", "choice", "blank"] as const) {
    for (const tile of held) {
      const match = canShow(tile, request.face);
      if (match?.via === via) return match;
    }
  }
  return null;
}

/**
 * Turn a keystroke into a request the rack can answer.
 *
 * The key table is shared with Study, where a stroke names a tile outright. The
 * translation is where the two diverge, and it is one rule: a stroke that named
 * a face WITHOUT saying which tile shows it is a prediction; a stroke that named
 * a specific tile — `Shift`+operator, or `B` and a face — is an instruction.
 *
 * `null` for a bare blank: in hand a blank has no face, but a blank ON THE BOARD
 * must be playing as something, and this is the boundary between the two.
 */
export function tileRequestFromStroke(stroke: TileStroke): TileRequest | null {
  if (stroke.token === "?") {
    return stroke.assignedToken ? { kind: "blank", face: stroke.assignedToken } : null;
  }
  if (stroke.token === "+/-" || stroke.token === "x//") {
    return stroke.assignedToken
      ? { kind: "choice", token: stroke.token, face: stroke.assignedToken }
      : null;
  }
  return { kind: "face", face: intrinsicFace(stroke.token) };
}

/** The face a request asks for, for the "you have no 5" notice. */
export function faceOfRequest(request: TileRequest): string {
  return request.face;
}

/**
 * The physical tile a keystroke names, for DRAWING rather than for playing.
 *
 * Deliberately not the same function as `resolveRackTile`, and deliberately
 * without the prediction. Playing asks "what should appear on the board", and a
 * blank standing in for a five is a perfectly good answer. Drawing asks "which
 * tile did you take out of the bag", and there the prediction would be a lie:
 * pressing `5` at a bag with no fives must say there are none, not hand over a
 * blank and record it as a five.
 *
 * The overrides still mean what they say — `B` draws a blank, `Shift`+operator
 * draws the two-faced tile — because those name a physical tile outright.
 */
export function resolveDrawnTile(
  pile: readonly (TileInstance | null)[],
  request: TileRequest,
): TileInstance | null {
  const held = pile.filter((tile): tile is TileInstance => tile !== null);
  if (request.kind === "blank") return held.find((tile) => tile.token === "?") ?? null;
  if (request.kind === "choice") return held.find((tile) => tile.token === request.token) ?? null;
  return held.find((tile) => intrinsicFace(tile.token) === request.face) ?? null;
}
