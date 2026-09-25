// Loaded INTO the page by board-vision-parity.spec.ts (served by the dev
// server, so imports resolve exactly as the app's do). Runs the released model
// through the browser's own ONNX Runtime WASM and through the production
// recognition worker, and reports how far each is from the exported
// reference (tests/fixtures/vision/0.1.0, amath-vision-training parity.py).
import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

import { createOnnxRunner, type OrtModule } from "../../src/features/boardVision/onnxRunner";
import { recognizePhoto, VISION_MODEL_BASE } from "../../src/features/boardVision/recognizerClient";
import type { Quad } from "../../src/features/boardVision/geometry";

type Square = {
  row: number;
  col: number;
  tensorF32: string;
  kindLogits: number[];
  turnLogits: number[];
  top3: { class: string; p: number }[];
};
type Cases = {
  imageRgbGz: string;
  imageSize: [number, number];
  tolerance: { logits: number };
  cases: { name: string; corners: number[][]; squares: Square[] }[];
};

const FIXTURE = "/tests/fixtures/vision/0.1.0/";
const bytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());

export async function runParity() {
  const cases = (await (await fetch(`${FIXTURE}cases.json`)).json()) as Cases;

  // 1. Raw logits through the runtime's own runner, in this browser's WASM.
  const run = await createOnnxRunner(
    ort as unknown as OrtModule,
    await bytes(`${VISION_MODEL_BASE}classifier.onnx`),
    await bytes(wasmUrl),
  );
  let worstLogit = 0;
  for (const c of cases.cases) {
    for (const s of c.squares) {
      const x = new Float32Array((await bytes(FIXTURE + s.tensorF32)).buffer);
      const { kindLogits, turnLogits } = await run(x, 1);
      s.kindLogits.forEach(
        (v, i) => (worstLogit = Math.max(worstLogit, Math.abs(v - kindLogits[i]!))),
      );
      s.turnLogits.forEach(
        (v, i) => (worstLogit = Math.max(worstLogit, Math.abs(v - turnLogits[i]!))),
      );
    }
  }

  // 2. The production path: photo pixels → worker → two-pass recognition.
  // (The dev server sends .gz with Content-Encoding: gzip, so it arrives decoded.)
  const rgb = await bytes(FIXTURE + cases.imageRgbGz);
  const [w, h] = cases.imageSize;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1)
    data.set([rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!, 255], i * 4);
  const native = cases.cases.find((c) => c.name === "native")!;
  const rec = await recognizePhoto(
    { width: w, height: h, channels: 4, data },
    native.corners as unknown as Quad,
    { frameId: "parity" },
  );
  const classes = rec.observation.classifier.classes;
  let worstP = 0;
  let sameTop3 = true;
  let compared = 0;
  for (const s of native.squares) {
    const seen = rec.observation.squares[s.row * 15 + s.col];
    if (!seen) continue; // off the photo: rightly not observed
    compared += 1;
    const top = seen.reading.kinds
      .map((p, i) => [classes[i]!, p] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    top.forEach(([k, p], i) => {
      sameTop3 &&= k === s.top3[i]!.class;
      worstP = Math.max(worstP, Math.abs(p - s.top3[i]!.p));
    });
  }
  return {
    tolerance: cases.tolerance.logits,
    worstLogit,
    worstP,
    sameTop3,
    compared,
    reading: rec.reading,
    crossOriginIsolated,
  };
}
