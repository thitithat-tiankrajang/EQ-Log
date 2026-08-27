// ── The Super engine, in a Web Worker ────────────────────────────────────────
//
// The engine is synchronous C++ compiled to WebAssembly. One Super decision is
// a single uninterruptible call that runs for tens of seconds. On the UI thread
// that is not a slow page — it is a frozen one: no rendering, no input, no
// timers, and a browser that eventually offers to kill the tab.
//
// So the call happens here, and the only thing the UI thread ever does about it
// is post a message.
//
// ── Why the module is imported dynamically ──────────────────────────────────
//
// The engine is ~250 KB. Most sessions never play Super — most never play a bot
// at all — and a static import would put that in the first load of the app for
// everybody. The `import()` below makes it a separate chunk fetched the first
// time a Super game actually starts.
//
// ── Cancellation ────────────────────────────────────────────────────────────
//
// There is no cooperative cancel, and pretending otherwise would be the bug.
// `_engine_handle` does not return until the search is finished, and while it
// is running this worker cannot process another message — a `cancel` posted to
// it would sit in the queue until the very search it was meant to stop had
// already completed.
//
// The only thing that actually stops a running search is terminating the
// worker, and that is what the owner (`superEngine.ts`) does. What this file
// contributes to cancellation is the `requestId` on every outbound message: a
// result from a superseded request can still be identified and dropped, whether
// or not the terminate landed first.
import type {
  CalibrationResult,
  SuperEngineResponse,
  SuperWorkerInbound,
  SuperWorkerOutbound,
} from "../superTypes";

type EngineModule = {
  _engine_handle(requestPtr: number): number;
  _engine_alloc(size: number): number;
  _engine_free(ptr: number): void;
  UTF8ToString(ptr: number): string;
  stringToUTF8(str: string, ptr: number, maxBytes: number): void;
  lengthBytesUTF8(str: string): number;
};

let modulePromise: Promise<EngineModule> | undefined;
/** The request every progress report is attributed to. The engine's progress
 *  hook is a global with no request in it, so the worker supplies the identity
 *  the UI needs to ignore a stale bar. */
let activeRequestId = 0;

function post(message: SuperWorkerOutbound) {
  (self as unknown as Worker).postMessage(message);
}

function loadModule(): Promise<EngineModule> {
  modulePromise ??= (async () => {
    const started = performance.now();
    const createModule = (await import("./amath_engine.mjs")).default;
    // The engine reports progress through a global hook (EM_JS in
    // src/wasm_api.cpp). Installed before the first call so no report is lost.
    (globalThis as Record<string, unknown>).__amathProgress = (json: string) => {
      try {
        post({ type: "progress", id: activeRequestId, progress: JSON.parse(json) });
      } catch {
        // A malformed progress line is dropped. Progress is a courtesy to the
        // UI and is never part of a result.
      }
    };
    const module = (await createModule()) as EngineModule;
    post({ type: "ready", initMs: Math.round(performance.now() - started) });
    return module;
  })();
  return modulePromise;
}

/** One request in, one response out. Both sides are JSON across the WASM heap
 *  boundary, and both allocations are freed whatever happens. */
function call(module: EngineModule, request: unknown): unknown {
  const text = JSON.stringify(request);
  const bytes = module.lengthBytesUTF8(text) + 1;
  const inPtr = module._engine_alloc(bytes);
  let outPtr = 0;
  try {
    module.stringToUTF8(text, inPtr, bytes);
    outPtr = module._engine_handle(inPtr);
    return JSON.parse(module.UTF8ToString(outPtr));
  } finally {
    module._engine_free(inPtr);
    if (outPtr) module._engine_free(outPtr);
  }
}

self.onmessage = async (event: MessageEvent<SuperWorkerInbound>) => {
  const message = event.data;
  try {
    if (message.type === "initialize") {
      await loadModule();
      return;
    }
    if (message.type === "calibrate") {
      const module = await loadModule();
      post({
        type: "calibration",
        id: message.id,
        result: call(module, { mode: "calibrate" }) as CalibrationResult,
      });
      return;
    }
    if (message.type === "think") {
      const module = await loadModule();
      activeRequestId = message.id;
      const started = performance.now();
      const response = call(module, message.request) as SuperEngineResponse;
      post({
        type: "result",
        id: message.id,
        response,
        wallMs: Math.round(performance.now() - started),
      });
    }
  } catch (error) {
    post({
      type: "error",
      id: "id" in message ? message.id : 0,
      message: error instanceof Error ? error.message : "engine failure",
    });
  }
};
