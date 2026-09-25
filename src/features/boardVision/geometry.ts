// ── Board geometry: which square is where ────────────────────────────────────
//
// Geometry answers exactly one question: WHICH SQUARE a piece of the image
// belongs to. What tile is in it is the recogniser's question; what face a
// blank or choice tile was played as is reconstruction's. Nothing here looks
// at tile content.
//
// Coordinates:
//   board   x → columns, y → rows (down), one unit per square; the 15×15 grid
//           spans [0, 15] × [0, 15]. Square (r, c) covers [c, c+1) × [r, r+1).
//   image   continuous pixel coordinates: pixel (i, j) covers [i, i+1) ×
//           [j, j+1), so its centre is (i + 0.5, j + 0.5).
//
// A `Quad` is the four corners of the GRID (not the board's frame) in image
// coordinates, in the order TL, TR, BR, BL of the board as it is to be READ —
// row 1 at the top. The board looks the same from every side, so which
// physical corner is "TL" is not something the picture settles; `readingQuad`
// turns the list, and the recogniser's orientation evidence decides.
//
// Mirrors amath-vision-training/amathvision/{geometry,crops}.py, which is
// what the recogniser was trained through; the crop-parity test holds the two
// together.

import { BOARD_SIZE } from "../../constants/gameRules";

export type Point = readonly [number, number];
export type Quad = readonly [Point, Point, Point, Point];
/** Row-major 3×3, h33 normalised to 1. */
export type Homography = readonly number[];

/** The grid's own corners in board coordinates, TL TR BR BL. */
export const BOARD_QUAD: Quad = [
  [0, 0],
  [BOARD_SIZE, 0],
  [BOARD_SIZE, BOARD_SIZE],
  [0, BOARD_SIZE],
];

export class GeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeometryError";
  }
}

/** Exact 4-point homography (DLT with h33 = 1), `src[i] → dst[i]`. */
export function homographyFromPoints(src: Quad, dst: Quad): Homography {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = src[i]!;
    const [u, v] = dst[i]!;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(a, b);
  return [...h, 1];
}

/** Board coordinates → image, for a grid seen through `quad`. */
export function boardToImage(quad: Quad): Homography {
  return homographyFromPoints(BOARD_QUAD, quad);
}

export function applyHomography(h: Homography, [x, y]: Point): Point {
  const w = h[6]! * x + h[7]! * y + h[8]!;
  return [(h[0]! * x + h[1]! * y + h[2]!) / w, (h[3]! * x + h[4]! * y + h[5]!) / w];
}

export function invertHomography(h: Homography): Homography {
  const [a, b, c, d, e, f, g, k, l] = h as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const A = e * l - f * k;
  const B = -(d * l - f * g);
  const C = d * k - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new GeometryError("The homography is singular.");
  const inv = [
    A,
    -(b * l - c * k),
    b * f - c * e,
    B,
    a * l - c * g,
    -(a * f - c * d),
    C,
    -(a * k - b * g),
    a * e - b * d,
  ].map((v) => v / det);
  return inv.map((v) => v / inv[8]!);
}

/**
 * Whether the quad describes the board as it can physically be seen.
 *
 * A camera never shows a board mirror-imaged; a corner list in the wrong
 * winding (TL, BL, BR, TR) does. Rectifying through it would read every
 * equation backwards, so it is refused rather than guessed at. Degenerate
 * quads (three corners in a line, a corner inside the others) are refused too.
 */
export function validateQuad(quad: Quad): void {
  for (const [x, y] of quad) {
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new GeometryError("A corner is not a number.");
  }
  // Every consecutive turn of a convex, correctly wound quad has the same sign
  // — positive in y-down image coordinates for TL → TR → BR → BL.
  for (let i = 0; i < 4; i += 1) {
    const [ax, ay] = quad[i]!;
    const [bx, by] = quad[(i + 1) % 4]!;
    const [cx, cy] = quad[(i + 2) % 4]!;
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (cross <= 0) {
      throw new GeometryError(
        "The corners are not a convex quadrilateral in TL, TR, BR, BL order (a mirrored or crossed board cannot be read).",
      );
    }
  }
}

/**
 * The same board read from another side: the corner list starts `k` corners
 * later. Reading `k` of a board is what the camera sees rotated by k quarter-
 * turns counter-clockwise.
 */
export function readingQuad(quad: Quad, k: number): Quad {
  const s = ((k % 4) + 4) % 4;
  return [quad[s]!, quad[(s + 1) % 4]!, quad[(s + 2) % 4]!, quad[(s + 3) % 4]!];
}

/** New-reading board coordinates → the original reading's (a rotation of the square). */
function readingTransform(k: number): Homography {
  return homographyFromPoints(BOARD_QUAD, readingQuad(BOARD_QUAD, k));
}

/** Which square of reading 0 the square (row, col) of reading `k` is. */
export function physicalSquare(k: number, row: number, col: number): [number, number] {
  const [x, y] = applyHomography(readingTransform(k), [col + 0.5, row + 0.5]);
  return [Math.floor(y), Math.floor(x)];
}

/** A tile turned `turn` clockwise quarter-turns in reading 0, as it appears in reading `k`. */
export function turnInReading(k: number, turn: number): number {
  const h = readingTransform(k);
  let up: [number, number] = [0, -1];
  for (let t = 0; t < ((turn % 4) + 4) % 4; t += 1) up = [-up[1], up[0]];
  // linear part of the reading transform, inverted, applied to `up`
  const [a, b, , d, e] = h as [number, number, number, number, number];
  const det = a * e - b * d;
  const vx = (e * up[0] - b * up[1]) / det;
  const vy = (-d * up[0] + a * up[1]) / det;
  const degrees = ((Math.atan2(vx, -vy) * 180) / Math.PI + 360) % 360;
  return Math.round(degrees / 90) % 4;
}

/**
 * How far off each square's centre lands when the grid is taken to be `used`
 * but is really `truth` — in squares, per square, row-major.
 *
 * This is the geometry error that matters: a crop whose square centre is more
 * than ~0.5 squares off is centred on the WRONG square, and no recogniser can
 * fix that. Evaluation reports it separately from recognition error.
 */
export function squareDisplacement(truth: Quad, used: Quad): number[] {
  const toImage = boardToImage(truth);
  const fromImage = invertHomography(boardToImage(used));
  const out: number[] = [];
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      const [x, y] = applyHomography(fromImage, applyHomography(toImage, [c + 0.5, r + 0.5]));
      out.push(Math.hypot(x - (c + 0.5), y - (r + 0.5)));
    }
  }
  return out;
}

/** Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1)
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12)
      throw new GeometryError("The corners do not define a board.");
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = m[r]![col]! / m[col]![col]!;
      for (let k = col; k <= n; k += 1) m[r]![k] = m[r]![k]! - f * m[col]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}
