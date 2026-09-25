// ── Recognition, off the UI thread ───────────────────────────────────────────
//
// Cutting 225 crops twice (two passes) and running the recogniser on them is
// hundreds of milliseconds of solid work; on the UI thread that would freeze
// the page. So all of it happens here, and the page only posts a photo and a
// set of corners.
//
// Everything heavy is reached from here and only from here: ONNX Runtime is
// imported dynamically, its WASM binary is a separate asset served from this
// origin, and the model is fetched on first use. A visitor who never imports a
// board downloads none of it.
//
// The model's meta.json is checked against this app's contract BEFORE the
// model is downloaded — a model built for another vocabulary, crop geometry
// or normalisation is refused, never run.

import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

import { checkClassifierMeta, classifierFromLogits, type SquareClassifier } from "./classifier";
import type { PixelImage } from "./crops";
import type { Quad } from "./geometry";
import { createOnnxRunner, type OrtModule } from "./onnxRunner";
import { observeImage, type ImageRecognition } from "./recognize";

export type RecognizeRequest = {
  type: "recognize";
  id: number;
  /** Directory holding meta.json and classifier.onnx, ending in "/". */
  modelBase: string;
  image: PixelImage;
  quad: Quad;
  frameId: string;
};

export type RecognizeResponse =
  | { type: "loading"; id: number; stage: "model" | "recognising" }
  | { type: "result"; id: number; recognition: ImageRecognition }
  | { type: "error"; id: number; message: string };

const loaded = new Map<string, Promise<SquareClassifier>>();

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

function classifierAt(base: string): Promise<SquareClassifier> {
  let pending = loaded.get(base);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(`${base}meta.json`);
      if (!response.ok)
        throw new Error(`Could not load the recogniser's description (${response.status}).`);
      const meta = checkClassifierMeta(await response.json());
      const [ort, model, wasm] = await Promise.all([
        import("onnxruntime-web/wasm"),
        fetchBytes(`${base}classifier.onnx`),
        fetchBytes(wasmUrl),
      ]);
      return classifierFromLogits(
        meta,
        await createOnnxRunner(ort as unknown as OrtModule, model, wasm),
      );
    })();
    loaded.set(base, pending);
    pending.catch(() => loaded.delete(base)); // a failed load may be retried
  }
  return pending;
}

self.onmessage = async (event: MessageEvent<RecognizeRequest>) => {
  const request = event.data;
  if (request.type !== "recognize") return;
  const post = (message: RecognizeResponse) => self.postMessage(message);
  try {
    post({ type: "loading", id: request.id, stage: "model" });
    const classifier = await classifierAt(request.modelBase);
    post({ type: "loading", id: request.id, stage: "recognising" });
    const recognition = await observeImage(request.image, request.quad, classifier, {
      frameId: request.frameId,
      source: "image",
    });
    post({ type: "result", id: request.id, recognition });
  } catch (error) {
    post({
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
