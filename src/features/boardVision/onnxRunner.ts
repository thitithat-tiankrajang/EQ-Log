// ── ONNX Runtime behind the recogniser interface ─────────────────────────────
//
// The only file that knows a model is an ONNX graph. It turns a loaded
// `onnxruntime-web` module and a model's bytes into a `LogitsRunner`, which
// `classifierFromLogits` wraps into the `SquareClassifier` everything else
// uses. Swapping the runtime (WebGPU, a different engine) is this file.
//
// It takes the ort module as an argument rather than importing it, so that
// importing this file never pulls ONNX Runtime into a bundle: the worker
// imports ort dynamically, and tests import it directly under Node.

import type { InferenceSession, Tensor } from "onnxruntime-web";

import type { LogitsRunner } from "./classifier";
import { CROP_CONTRACT } from "./crops";

/** The part of the `onnxruntime-web` module this file uses. */
export type OrtModule = {
  env: {
    wasm: { wasmBinary?: ArrayBufferLike | Uint8Array; numThreads?: number; proxy?: boolean };
  };
  InferenceSession: {
    create(model: Uint8Array, options?: InferenceSession.SessionOptions): Promise<InferenceSession>;
  };
  Tensor: new (type: "float32", data: Float32Array, dims: readonly number[]) => Tensor;
};

/** Names fixed by amath-vision-training/amathvision/export.py. */
const INPUT = "crops";
const KIND = "kind_logits";
const TURN = "turn_logits";

export async function createOnnxRunner(
  ort: OrtModule,
  model: Uint8Array,
  wasmBinary: ArrayBufferLike | Uint8Array,
): Promise<LogitsRunner> {
  // The WASM binary is handed over, not fetched by ONNX Runtime from a guessed
  // path: it is served from this origin (COEP: require-corp), and a test can
  // hand it the same bytes from disk.
  ort.env.wasm.wasmBinary = wasmBinary;
  // One thread: the recogniser already runs off the UI thread, and ONNX
  // Runtime's own thread pool would need SharedArrayBuffer and nested workers.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const session = await ort.InferenceSession.create(model, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  for (const name of [INPUT]) {
    if (!session.inputNames.includes(name))
      throw new Error(`The model has no input named ${name}.`);
  }
  for (const name of [KIND, TURN]) {
    if (!session.outputNames.includes(name))
      throw new Error(`The model has no output named ${name}.`);
  }
  const D = CROP_CONTRACT.cropSize;
  return async (input, count, signal) => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const outputs = await session.run({
      [INPUT]: new ort.Tensor("float32", input, [count, 3, D, D]),
    });
    return {
      kindLogits: outputs[KIND]!.data as Float32Array,
      turnLogits: outputs[TURN]!.data as Float32Array,
    };
  };
}
