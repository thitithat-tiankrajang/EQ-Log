// ── The page's side of the recognition worker ────────────────────────────────
//
// One worker per session, created on first use and kept, so the model loads
// once. A recognition cannot be interrupted inside ONNX Runtime, so cancelling
// terminates the worker; the next request starts a fresh one.

import type { PixelImage } from "./crops";
import type { Quad } from "./geometry";
import type { ImageRecognition } from "./recognize";
import type { RecognizeRequest, RecognizeResponse } from "./recognizer.worker";

/** The recogniser this build uses. One place to change it. */
export const VISION_MODEL_VERSION = "0.1.0";
export const VISION_MODEL_BASE = `${import.meta.env.BASE_URL}models/vision/${VISION_MODEL_VERSION}/`;

export type RecognitionStage = "model" | "recognising";

let worker: Worker | null = null;
let nextId = 1;

function ensureWorker(): Worker {
  worker ??= new Worker(new URL("./recognizer.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

function dropWorker(): void {
  worker?.terminate();
  worker = null;
}

export function recognizePhoto(
  image: PixelImage,
  quad: Quad,
  options: { frameId: string; signal?: AbortSignal; onStage?: (stage: RecognitionStage) => void },
): Promise<ImageRecognition> {
  const w = ensureWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const onMessage = (event: MessageEvent<RecognizeResponse>) => {
      const m = event.data;
      if (m.id !== id) return;
      if (m.type === "loading") return options.onStage?.(m.stage);
      cleanup();
      if (m.type === "result") resolve(m.recognition);
      else reject(new Error(m.message));
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      dropWorker();
      reject(new Error(event.message || "The recogniser stopped unexpectedly."));
    };
    const onAbort = () => {
      cleanup();
      dropWorker();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    if (options.signal?.aborted) return onAbort();
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    // A copy is sent (not transferred): the page keeps showing the photo.
    const request: RecognizeRequest = {
      type: "recognize",
      id,
      modelBase: new URL(VISION_MODEL_BASE, location.href).href,
      image,
      quad,
      frameId: options.frameId,
    };
    w.postMessage(request);
  });
}
