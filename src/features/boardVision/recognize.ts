// ── One image → one observation ──────────────────────────────────────────────
//
// The board looks the same from every side, so the corners a person (or a
// detector) gives do not say which one is row 1. Two passes settle it:
//
//   1. crop every square with the corners as given; ask the recogniser for
//      each tile's turn; the side that makes most tiles upright is the side the
//      board is read from;
//   2. re-crop from that side, so that nearly every tile is upright, and read
//      the kinds from this pass.
//
// If the tiles do not agree well enough on a side (too few tiles, or a board
// set down every which way), the side is reported as undecided rather than
// guessed; the caller asks the person.
//
// Geometry alone decides which square each crop is; the recogniser only says
// what is in a crop.

import { BOARD_SIZE } from "../../constants/gameRules";
import type { SquareClassifier, SquareReading } from "./classifier";
import { squareCrops, type PixelImage } from "./crops";
import {
  applyHomography,
  boardToImage,
  readingQuad,
  turnInReading,
  validateQuad,
  type Quad,
} from "./geometry";
import type { BoardObservation } from "./observation";
import { EMPTY } from "./vocabulary";

export type ReadingDecision =
  /** `shift`: rotate the given corner list by this much to reach reading 0. */
  | { decided: true; shift: number; margin: number; tiles: number }
  | { decided: false; reason: "too few tiles" | "tiles disagree"; margin: number; tiles: number };

/** Fewer tiles than this cannot settle which side is up. */
const MIN_TILES = 3;
/** Log-likelihood lead the winning side needs over the runner-up. */
const MIN_MARGIN = Math.log(20);
/** A square counts as observed when this much of it lies inside the image. */
const MIN_VISIBLE = 0.85;

export function decideReading(
  readings: readonly SquareReading[],
  classes: readonly string[],
): ReadingDecision {
  const empty = classes.indexOf(EMPTY);
  const score = [0, 0, 0, 0];
  let tiles = 0;
  for (const r of readings) {
    if (empty >= 0 && r.kinds[empty]! >= 0.5) continue;
    tiles += 1;
    for (let h = 0; h < 4; h += 1) score[h]! += Math.log(Math.max(r.turns[h]!, 1e-9));
  }
  const ranked = [0, 1, 2, 3].sort((a, b) => score[b]! - score[a]!);
  const margin = tiles ? score[ranked[0]!]! - score[ranked[1]!]! : 0;
  if (tiles < MIN_TILES) return { decided: false, reason: "too few tiles", margin, tiles };
  if (margin < MIN_MARGIN) return { decided: false, reason: "tiles disagree", margin, tiles };
  // Upright tiles look turned by `h` when read with the corners shifted by s,
  // where turnInReading(s, 0) = h. Undo that shift.
  const h = ranked[0]!;
  const s = [0, 1, 2, 3].find((k) => turnInReading(k, 0) === h)!;
  return { decided: true, shift: (4 - s) % 4, margin, tiles };
}

/** Fraction of each square (row-major, in the reading `quad` describes) inside the image. */
export function squareVisibility(quad: Quad, width: number, height: number): number[] {
  const h = boardToImage(quad);
  const out: number[] = [];
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      let inside = 0;
      for (let i = 0; i < 5; i += 1) {
        for (let j = 0; j < 5; j += 1) {
          const [x, y] = applyHomography(h, [c + 0.1 + 0.2 * i, r + 0.1 + 0.2 * j]);
          if (x >= 0 && y >= 0 && x < width && y < height) inside += 1;
        }
      }
      out.push(inside / 25);
    }
  }
  return out;
}

export type ImageRecognition = {
  observation: BoardObservation;
  reading: ReadingDecision;
  /** The corners in reading 0 (equal to the input when the side was undecided). */
  quad: Quad;
};

export async function observeImage(
  image: PixelImage,
  quad: Quad,
  classifier: SquareClassifier,
  options: { frameId: string; source: BoardObservation["source"]; signal?: AbortSignal },
): Promise<ImageRecognition> {
  validateQuad(quad);
  const first = await classifier.classify(squareCrops(image, quad), options.signal);
  const reading = decideReading(first, classifier.meta.classes);
  const upright = reading.decided && reading.shift !== 0 ? readingQuad(quad, reading.shift) : quad;
  const readings =
    upright === quad
      ? first
      : await classifier.classify(squareCrops(image, upright), options.signal);
  const visible = squareVisibility(upright, image.width, image.height);
  return {
    reading,
    quad: upright,
    observation: {
      frameId: options.frameId,
      source: options.source,
      classifier: classifier.meta,
      quad: upright,
      squares: readings.map((r, i) =>
        visible[i]! >= MIN_VISIBLE ? { reading: r, quality: 1 } : null,
      ),
    },
  };
}
