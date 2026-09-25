// Geometry decides WHICH SQUARE a crop belongs to. These tests make that
// checkable without a recogniser or a photograph: a flat synthetic board whose
// every square is painted with its own index is projected into a camera image
// through a known perspective, and every crop must come back holding its own
// square — in every reading, through the prefilter, and under measured corner
// error.
import { describe, expect, it } from "vitest";

import { BOARD_SIZE } from "../src/constants/gameRules";
import {
  CROP_CONTRACT,
  normaliseCrops,
  prefilter,
  squareCrops,
} from "../src/features/boardVision/crops";
import { OUTSIDE, photograph } from "./helpers/boardPhoto";
import {
  GeometryError,
  physicalSquare,
  readingQuad,
  squareDisplacement,
  turnInReading,
  validateQuad,
  type Quad,
} from "../src/features/boardVision/geometry";

const { cropSize: D, pxPerSquare: C, marginSquares: M } = CROP_CONTRACT;
const at = (crop: Uint8Array, x: number, y: number) => crop[(y * D + x) * 3]!;

/** Pixels inside the square's own part of the crop, kept 3 px clear of its edges
 *  (bilinear sampling blends neighbours right at a boundary). */
function interior(crop: Uint8Array): number[] {
  const lo = Math.ceil(M * C) + 3;
  const hi = Math.floor((1 + M) * C) - 3;
  const out: number[] = [];
  for (let y = lo; y < hi; y += 4) for (let x = lo; x < hi; x += 4) out.push(at(crop, x, y));
  return out;
}

/** A perspective view: the far edge narrower, the whole thing turned a little. */
const OBLIQUE: Quad = [
  [212.3, 118.9],
  [735.6, 161.2],
  [812.4, 668.7],
  [96.8, 610.1],
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("the crop contract", () => {
  it("is derived, not restated", () => {
    expect(CROP_CONTRACT.canonicalSize).toBe(Math.round((BOARD_SIZE + 2 * M) * C));
    expect(CROP_CONTRACT.cropSize).toBe(Math.round((1 + 2 * M) * C));
  });

  it("normalises bytes into NCHW float32 exactly", () => {
    const pixels = new Uint8Array(D * D * 3);
    pixels[0] = 255; // R of the first pixel
    pixels[5] = 0; // B of the second pixel
    pixels[4] = 51; // G of the second pixel
    const x = normaliseCrops([{ pixels }]);
    expect(x.length).toBe(3 * D * D);
    expect(x[0]).toBe(1); // R plane, pixel 0
    expect(x[D * D + 1]).toBeCloseTo(51 / 255 / 0.5 - 1, 6); // G plane, pixel 1
    expect(x[2 * D * D + 1]).toBe(-1); // B plane, pixel 1
  });
});

describe("rectification maps every crop to its own square", () => {
  const image = photograph(OBLIQUE, 900, 760);

  it("in the reading the corners describe", () => {
    const crops = squareCrops(image, OBLIQUE);
    expect(crops).toHaveLength(BOARD_SIZE * BOARD_SIZE);
    for (const crop of crops) {
      const id = crop.row * BOARD_SIZE + crop.col;
      expect(at(crop.pixels, D / 2, D / 2)).toBe(id);
      expect(new Set(interior(crop.pixels))).toEqual(new Set([id]));
    }
  });

  it("in every reading, with squares renumbered exactly as `physicalSquare` says", () => {
    for (let k = 1; k < 4; k += 1) {
      const crops = squareCrops(image, readingQuad(OBLIQUE, k));
      const seen = new Set<number>();
      for (const crop of crops) {
        const [r, c] = physicalSquare(k, crop.row, crop.col);
        expect(at(crop.pixels, D / 2, D / 2)).toBe(r * BOARD_SIZE + c);
        seen.add(r * BOARD_SIZE + c);
      }
      expect(seen.size).toBe(BOARD_SIZE * BOARD_SIZE);
    }
  });

  it("through the box prefilter, when the photo has far more pixels than a crop uses", () => {
    const big: Quad = [
      [150, 140],
      [1950, 180],
      [1990, 1960],
      [120, 1930],
    ];
    const photo = photograph(big, 2100, 2100);
    expect(prefilter(photo, big).factor).toBe(2);
    for (const crop of squareCrops(photo, big)) {
      expect(at(crop.pixels, D / 2, D / 2)).toBe(crop.row * BOARD_SIZE + crop.col);
    }
  });

  it("reads the context margin from the neighbouring squares, and zero off the image", () => {
    const crops = squareCrops(image, OBLIQUE);
    const middle = crops[7 * BOARD_SIZE + 7]!.pixels;
    expect(at(middle, 2, D / 2)).toBe(7 * BOARD_SIZE + 6); // left context is the left neighbour
    const corner = crops[0]!.pixels;
    expect(at(corner, 1, 1)).toBe(OUTSIDE); // off the grid, on the image
  });
});

describe("refusing geometry that cannot be a board", () => {
  it("refuses a mirrored corner order", () => {
    const [tl, tr, br, bl] = OBLIQUE;
    expect(() => validateQuad([tl, bl, br, tr])).toThrow(GeometryError);
  });

  it("refuses crossed and degenerate corners", () => {
    const [tl, tr, br, bl] = OBLIQUE;
    expect(() => validateQuad([tl, tr, bl, br])).toThrow(GeometryError);
    expect(() => validateQuad([tl, tl, br, bl])).toThrow(GeometryError);
    expect(() => validateQuad([tl, tr, br, [Number.NaN, 0]])).toThrow(GeometryError);
  });

  it("accepts every reading of a real board", () => {
    for (let k = 0; k < 4; k += 1)
      expect(() => validateQuad(readingQuad(OBLIQUE, k))).not.toThrow();
  });
});

describe("orientation", () => {
  it("gives each reading of an upright tile a different turn, composing with the tile's own", () => {
    expect([0, 1, 2, 3].map((k) => turnInReading(k, 0)).sort()).toEqual([0, 1, 2, 3]);
    for (let k = 0; k < 4; k += 1) {
      for (let t = 0; t < 4; t += 1)
        expect(turnInReading(k, t)).toBe((turnInReading(k, 0) + t) % 4);
    }
  });
});

describe("corner error, measured", () => {
  // Corner error in SQUARES (σ of each corner coordinate), against how far
  // square centres end up from where the crop expects them, and how many crops
  // are then centred on the wrong square. Printed, and bounded.
  const image = photograph(OBLIQUE, 900, 760);
  const side = 527 / BOARD_SIZE; // ≈ px per square of OBLIQUE
  const rows: string[] = [];

  it.each([0, 0.05, 0.1, 0.2, 0.35])("σ = %s squares", (sigma) => {
    const random = mulberry32(Math.round(sigma * 1000) + 1);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    const trials = sigma === 0 ? 1 : 6;
    let maxDisp = 0;
    let sumDisp = 0;
    let wrong = 0;
    for (let t = 0; t < trials; t += 1) {
      const used = OBLIQUE.map(([x, y]) => [
        x + gauss() * sigma * side,
        y + gauss() * sigma * side,
      ]) as unknown as Quad;
      const disp = squareDisplacement(OBLIQUE, used);
      maxDisp = Math.max(maxDisp, ...disp);
      sumDisp += disp.reduce((a, b) => a + b, 0) / disp.length;
      for (const crop of squareCrops(image, used)) {
        if (at(crop.pixels, D / 2, D / 2) !== crop.row * BOARD_SIZE + crop.col) wrong += 1;
      }
    }
    const wrongRate = wrong / (trials * BOARD_SIZE * BOARD_SIZE);
    rows.push(
      `σ ${sigma.toFixed(2)}  mean ${(sumDisp / trials).toFixed(3)}  max ${maxDisp.toFixed(3)} squares  crops on wrong square ${(wrongRate * 100).toFixed(2)}%`,
    );
    if (sigma === 0) {
      expect(maxDisp).toBeLessThan(1e-9);
      expect(wrong).toBe(0);
    }
    // Up to a tenth of a square of corner error, every crop stays on its square.
    if (sigma <= 0.1) expect(wrongRate).toBe(0);
    // Displacement never exceeds the corner error by much: it is interpolated.
    expect(maxDisp).toBeLessThan(0.05 + sigma * 4);
    if (sigma === 0.35)
      console.info(`geometry error sweep (OBLIQUE, 6 trials each):\n  ${rows.join("\n  ")}`);
  });
});
