// The browser must cut crops exactly as the recogniser was trained on them.
//
// tests/fixtures/vision/crop-parity was produced by the TRAINING side
// (amath-vision-training/amathvision/crops.py) from one synthetic photo. Here
// the runtime's crops.ts cuts the same squares from the same pixels and the
// same corners; every byte must agree to within ±1 (Python samples in float32,
// this in float64, so a value can land on the other side of a .5).
//
// Two cases: `native`, and `prefiltered` — corners scaled up so that the 2×
// box prefilter runs and most of the board falls off the image, which
// exercises the out-of-bounds rule as well.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  CROP_CONTRACT,
  cropSquare,
  prefilter,
  rectifyBoard,
} from "../src/features/boardVision/crops";
import type { Quad } from "../src/features/boardVision/geometry";

const dir = join(process.cwd(), "tests/fixtures/vision/crop-parity");
type Case = {
  name: string;
  quad: number[][];
  prefilterFactor: number;
  squares: { row: number; col: number; file: string }[];
};
const doc = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8")) as {
  width: number;
  height: number;
  contract: Record<string, number>;
  cases: Case[];
};
const image = {
  width: doc.width,
  height: doc.height,
  channels: 3 as const,
  data: new Uint8Array(gunzipSync(readFileSync(join(dir, "image.rgb.gz")))),
};

describe("crop parity with the training pipeline", () => {
  it("was made under the same crop contract", () => {
    expect(doc.contract).toEqual({
      pxPerSquare: CROP_CONTRACT.pxPerSquare,
      marginSquares: CROP_CONTRACT.marginSquares,
      canonicalSize: CROP_CONTRACT.canonicalSize,
      cropSize: CROP_CONTRACT.cropSize,
    });
  });

  it.each(doc.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const quad = c.quad as unknown as Quad;
    expect(prefilter(image, quad).factor).toBe(c.prefilterFactor);
    const board = rectifyBoard(image, quad);
    let worst = 0;
    let differing = 0;
    for (const square of c.squares) {
      const expected = new Uint8Array(gunzipSync(readFileSync(join(dir, square.file))));
      const actual = cropSquare(board, square.row, square.col);
      expect(actual.length).toBe(expected.length);
      for (let i = 0; i < actual.length; i += 1) {
        const d = Math.abs(actual[i]! - expected[i]!);
        worst = Math.max(worst, d);
        if (d) differing += 1;
      }
    }
    expect(worst).toBeLessThanOrEqual(1);
    // ±1 is for the rare value sitting on a rounding boundary, not a habit.
    expect(differing / (c.squares.length * CROP_CONTRACT.cropSize ** 2 * 3)).toBeLessThan(0.01);
  });
});
