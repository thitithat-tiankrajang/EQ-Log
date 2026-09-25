// @vitest-environment node
//
// The released recogniser, run through the RUNTIME's own path — the same
// `onnxruntime-web` WASM build the browser worker loads, `createOnnxRunner`,
// `classifierFromLogits` — against the reference outputs exported with the
// model (tests/fixtures/vision/0.1.0, from amath-vision-training parity.py).
//
// Two levels, both blocking:
//   inference   the fixture's own input tensors → logits within the fixture's
//               stated tolerance (1e-3) of the Python/ONNX Runtime reference;
//   full path   the fixture's photo → crops cut by crops.ts (bytes within ±1 of
//               the reference crops) → normalisation → logits.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import * as ort from "onnxruntime-web/wasm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  checkClassifierMeta,
  classifierFromLogits,
  type ClassifierMeta,
  type LogitsRunner,
} from "../src/features/boardVision/classifier";
import {
  CROP_CONTRACT,
  cropSquare,
  normaliseCrops,
  prefilter,
  rectifyBoard,
} from "../src/features/boardVision/crops";
import type { Quad } from "../src/features/boardVision/geometry";
import { createOnnxRunner, type OrtModule } from "../src/features/boardVision/onnxRunner";

const root = process.cwd();
const modelDir = join(root, "public/models/vision/0.1.0");
const fixtureDir = join(root, "tests/fixtures/vision/0.1.0");

type Square = {
  row: number;
  col: number;
  cropRgbGz: string;
  tensorF32: string;
  kindLogits: number[];
  turnLogits: number[];
  top3: { class: string; p: number }[];
};
const fixture = JSON.parse(readFileSync(join(fixtureDir, "cases.json"), "utf8")) as {
  imageRgbGz: string;
  imageSize: [number, number];
  temperature: number;
  tolerance: { cropBytes: number; logits: number };
  cases: { name: string; corners: number[][]; prefilterFactor: number; squares: Square[] }[];
};

let meta: ClassifierMeta;
let run: LogitsRunner;

beforeAll(async () => {
  meta = checkClassifierMeta(JSON.parse(readFileSync(join(modelDir, "meta.json"), "utf8")));
  run = await createOnnxRunner(
    ort as unknown as OrtModule,
    readFileSync(join(modelDir, "classifier.onnx")),
    readFileSync(join(root, "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm")),
  );
}, 60_000);

const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  expect(a.length).toBe(b.length);
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d = Math.max(d, Math.abs(a[i]! - b[i]!));
  return d;
};

describe("the released model, through the runtime's inference path", () => {
  it("is accepted by the runtime contract, and its fixture was made with it", () => {
    expect(meta.modelVersion).toBe("0.1.0");
    expect(fixture.temperature).toBe(meta.temperature);
    expect(fixture.tolerance.logits).toBe(1e-3);
  });

  it.each(
    fixture.cases.flatMap((c) =>
      c.squares.map((s) => [`${c.name} r${s.row}c${s.col}`, s] as const),
    ),
  )("inference parity: %s", async (_name, square) => {
    const bytes = readFileSync(join(fixtureDir, square.tensorF32));
    const input = new Float32Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const { kindLogits, turnLogits } = await run(input, 1);
    expect(maxDiff(kindLogits, square.kindLogits)).toBeLessThanOrEqual(fixture.tolerance.logits);
    expect(maxDiff(turnLogits, square.turnLogits)).toBeLessThanOrEqual(fixture.tolerance.logits);
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))(
    "full-path parity: %s",
    async (_name, c) => {
      const [width, height] = fixture.imageSize;
      const image = {
        width,
        height,
        channels: 3 as const,
        data: new Uint8Array(gunzipSync(readFileSync(join(fixtureDir, fixture.imageRgbGz)))),
      };
      const quad = c.corners as unknown as Quad;
      expect(prefilter(image, quad).factor).toBe(c.prefilterFactor);
      const board = rectifyBoard(image, quad);
      const classifier = classifierFromLogits(meta, run);
      for (const square of c.squares) {
        const crop = cropSquare(board, square.row, square.col);
        const reference = new Uint8Array(
          gunzipSync(readFileSync(join(fixtureDir, square.cropRgbGz))),
        );
        expect(maxDiff(crop, reference)).toBeLessThanOrEqual(fixture.tolerance.cropBytes);
        // Logits: exact inference parity is asserted above on identical input.
        // Here the input may differ by ±1 in a handful of bytes (float32 vs
        // float64 rounding at .5), so the bound is the measured effect of that,
        // not a loosening of the model check: logits within 0.02, the same top-3
        // readings in the same order, calibrated probabilities within 0.005.
        const { kindLogits } = await run(normaliseCrops([{ pixels: crop }]), 1);
        expect(maxDiff(kindLogits, square.kindLogits)).toBeLessThanOrEqual(0.02);
        const [reading] = await classifier.classify([
          { row: square.row, col: square.col, pixels: crop },
        ]);
        const top3 = reading!.kinds
          .map((p, i) => ({ class: meta.classes[i]!, p }))
          .sort((a, b) => b.p - a.p)
          .slice(0, 3);
        expect(top3.map((t) => t.class)).toEqual(square.top3.map((t) => t.class));
        top3.forEach((t, i) =>
          expect(Math.abs(t.p - square.top3[i]!.p)).toBeLessThanOrEqual(0.005),
        );
      }
      expect(CROP_CONTRACT.cropSize).toBe(80);
    },
  );
});
