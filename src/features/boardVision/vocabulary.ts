// ── What a square can be read as ─────────────────────────────────────────────
//
// A recogniser looking at one square of a physical board can answer one of
// three kinds of thing: "nothing is here", "this physical tile is here", or "a
// tile is here and I cannot tell which". That closed set is the vocabulary every
// vision producer speaks, and it is DERIVED from the tile manifest rather than
// restated, so a producer cannot name a tile the game does not have.
//
// What is deliberately NOT in it: faces. The blank and the two choice tiles
// (`+/-`, `x//`) are single physical tiles whose face is decided by the player
// who plays them. A photograph shows the tile, not the decision — so a face is
// never something a recogniser reports. It is resolved later, by reconstruction
// or by a person.

import type { AmathToken } from "../../constants/tileDefinitions";
import { TILE_TOKENS, manifestFingerprint } from "../../domain/tiles";

/** Every physical tile kind, in manifest order. */
export const TILE_KINDS: readonly AmathToken[] = Object.freeze([...new Set(TILE_TOKENS)]);

/** The square holds no tile. */
export const EMPTY = "empty";
/** The square holds a tile whose kind could not be read. */
export const UNKNOWN = "unknown";

/** One reading of one square. */
export type CellClass = AmathToken | typeof EMPTY | typeof UNKNOWN;

/** The whole vocabulary, in a fixed order. Used to break ties deterministically. */
export const CELL_CLASSES: readonly CellClass[] = Object.freeze([...TILE_KINDS, EMPTY, UNKNOWN]);

const CLASS_ORDER = new Map<CellClass, number>(CELL_CLASSES.map((value, index) => [value, index]));

export function isCellClass(value: unknown): value is CellClass {
  return typeof value === "string" && CLASS_ORDER.has(value as CellClass);
}

export function isTileKind(value: CellClass): value is AmathToken {
  return value !== EMPTY && value !== UNKNOWN;
}

/** Position of a class in `CELL_CLASSES`. */
export function classOrder(value: CellClass): number {
  return CLASS_ORDER.get(value) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * A fingerprint of the vocabulary AND the physical set it was derived from.
 *
 * A trained recogniser's outputs are positions in `CELL_CLASSES`. A model built
 * against a different order, or against a different tile set, would put its
 * probabilities on the wrong names without any error — so a model carries this
 * value, and the runtime refuses one whose value is not its own.
 * FNV-1a, the same construction as `manifestFingerprint`.
 */
export function vocabularyFingerprint(): string {
  let hash = 0x811c9dc5;
  for (const text of [manifestFingerprint(), ...CELL_CLASSES]) {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x0a;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
