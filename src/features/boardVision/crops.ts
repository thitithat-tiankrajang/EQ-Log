// ── The crop contract: from a photo to one image per square ──────────────────
//
// A recogniser is trained on crops made one exact way, and at runtime it must
// be fed crops made the same way — a crop that differs by a sampling
// convention is a different input, and nothing downstream would notice. This
// module is the runtime's statement of that way. The training side's is
// amath-vision-training/amathvision/crops.py; the crop-parity test compares
// the two byte for byte (±1 for float rounding) on a shared fixture, and a
// model's meta.json states the geometry it was trained with, which
// `checkClassifierMeta` requires to equal `CROP_CONTRACT`.
//
//   1. Prefilter: s = mean grid-edge length / 15 (px per square). If
//      s >= 2·C, box-downsample by f = floor(s / C) (mean of each f×f block,
//      rounded half up) and divide the corners by f.
//   2. H: board square coordinates → image (the four grid corners).
//   3. Canonical board, N×N: pixel (x, y) samples the image at
//      H((x + 0.5)/C − M, (y + 0.5)/C − M), bilinearly between pixel centres;
//      a neighbour outside the image contributes 0.
//   4. Square (r, c): the D×D window at (c·C, r·C), rounded half up to bytes.
//   5. Normalise: (v/255 − mean)/std, RGB, NCHW float32.
//
// It knows nothing about tiles. Which square a crop belongs to is decided
// here and nowhere else; what is IN it is the recogniser's business.

import { BOARD_SIZE } from "../../constants/gameRules";
import { applyHomography, boardToImage, type Quad, validateQuad } from "./geometry";

const PX_PER_SQUARE = 50;
const MARGIN_SQUARES = 0.3;

export const CROP_CONTRACT = Object.freeze({
  /** C: canonical pixels per square. */
  pxPerSquare: PX_PER_SQUARE,
  /** M: context kept around each square, in squares — tile tops are displaced
   *  by parallax and by placement, so a crop is more than its square. */
  marginSquares: MARGIN_SQUARES,
  /** N = (15 + 2M)·C. */
  canonicalSize: Math.round((BOARD_SIZE + 2 * MARGIN_SQUARES) * PX_PER_SQUARE),
  /** D = (1 + 2M)·C. */
  cropSize: Math.round((1 + 2 * MARGIN_SQUARES) * PX_PER_SQUARE),
  mean: 0.5,
  std: 0.5,
});

/** Pixels, row-major. `channels` 3 (RGB) or 4 (RGBA, e.g. ImageData; alpha ignored). */
export type PixelImage = {
  width: number;
  height: number;
  channels: 3 | 4;
  data: Uint8Array | Uint8ClampedArray;
};

/** The rectified board with its context margin: N×N×3, float, [0, 255]. */
export type CanonicalBoard = { size: number; data: Float32Array };

/** One square's crop: D×D×3 bytes, RGB. `row`, `col` are in the reading used. */
export type SquareCrop = { row: number; col: number; pixels: Uint8Array };

export function pxPerSquare(quad: Quad): number {
  let total = 0;
  for (let i = 0; i < 4; i += 1) {
    const [ax, ay] = quad[i]!;
    const [bx, by] = quad[(i + 1) % 4]!;
    total += Math.hypot(bx - ax, by - ay);
  }
  return total / 4 / BOARD_SIZE;
}

/** Step 1. Returns the image and corners the rest of the contract works on. */
export function prefilter(
  image: PixelImage,
  quad: Quad,
): { image: PixelImage; quad: Quad; factor: number } {
  const C = CROP_CONTRACT.pxPerSquare;
  const s = pxPerSquare(quad);
  if (s < 2 * C) return { image, quad, factor: 1 };
  const f = Math.floor(s / C);
  const w = Math.floor(image.width / f);
  const h = Math.floor(image.height / f);
  const out = new Uint8Array(w * h * 3);
  const area = f * f;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let ch = 0; ch < 3; ch += 1) {
        let sum = 0;
        for (let dy = 0; dy < f; dy += 1) {
          const row = (y * f + dy) * image.width;
          for (let dx = 0; dx < f; dx += 1)
            sum += image.data[(row + x * f + dx) * image.channels + ch]!;
        }
        out[(y * w + x) * 3 + ch] = Math.floor(sum / area + 0.5);
      }
    }
  }
  const scaled = quad.map(([x, y]) => [x / f, y / f] as const) as unknown as Quad;
  return { image: { width: w, height: h, channels: 3, data: out }, quad: scaled, factor: f };
}

/** Steps 1–3. */
export function rectifyBoard(image: PixelImage, quad: Quad): CanonicalBoard {
  validateQuad(quad);
  const { image: img, quad: q } = prefilter(image, quad);
  const { pxPerSquare: C, marginSquares: M, canonicalSize: N } = CROP_CONTRACT;
  const h = boardToImage(q);
  const out = new Float32Array(N * N * 3);
  const { width, height, channels, data } = img;
  const px = (ix: number, iy: number, ch: number): number =>
    ix < 0 || iy < 0 || ix >= width || iy >= height ? 0 : data[(iy * width + ix) * channels + ch]!;
  for (let y = 0; y < N; y += 1) {
    const v = (y + 0.5) / C - M;
    for (let x = 0; x < N; x += 1) {
      const [sx, sy] = applyHomography(h, [(x + 0.5) / C - M, v]);
      const fx0 = sx - 0.5;
      const fy0 = sy - 0.5;
      const x0 = Math.floor(fx0);
      const y0 = Math.floor(fy0);
      const fx = fx0 - x0;
      const fy = fy0 - y0;
      const o = (y * N + x) * 3;
      for (let ch = 0; ch < 3; ch += 1) {
        out[o + ch] =
          px(x0, y0, ch) * (1 - fx) * (1 - fy) +
          px(x0 + 1, y0, ch) * fx * (1 - fy) +
          px(x0, y0 + 1, ch) * (1 - fx) * fy +
          px(x0 + 1, y0 + 1, ch) * fx * fy;
      }
    }
  }
  return { size: N, data: out };
}

/** Step 4. */
export function cropSquare(board: CanonicalBoard, row: number, col: number): Uint8Array {
  const { pxPerSquare: C, cropSize: D } = CROP_CONTRACT;
  const out = new Uint8Array(D * D * 3);
  for (let y = 0; y < D; y += 1) {
    const src = ((row * C + y) * board.size + col * C) * 3;
    for (let i = 0; i < D * 3; i += 1) out[y * D * 3 + i] = Math.floor(board.data[src + i]! + 0.5);
  }
  return out;
}

/** Steps 1–4 for every square, row-major, in the reading `quad` describes. */
export function squareCrops(image: PixelImage, quad: Quad): SquareCrop[] {
  const board = rectifyBoard(image, quad);
  const crops: SquareCrop[] = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1)
      crops.push({ row, col, pixels: cropSquare(board, row, col) });
  }
  return crops;
}

/** Step 5: n crops → one float32 tensor, NCHW. */
export function normaliseCrops(crops: readonly Pick<SquareCrop, "pixels">[]): Float32Array {
  const { cropSize: D, mean, std } = CROP_CONTRACT;
  const plane = D * D;
  const out = new Float32Array(crops.length * 3 * plane);
  crops.forEach(({ pixels }, n) => {
    for (let i = 0; i < plane; i += 1) {
      for (let ch = 0; ch < 3; ch += 1)
        out[(n * 3 + ch) * plane + i] = (pixels[i * 3 + ch]! / 255 - mean) / std;
    }
  });
  return out;
}
