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
// The engine is ~250 KB (~370 KB threaded). Most sessions never play Super —
// most never play a bot at all — and a static import would put that in the first
// load of the app for everybody. The `import()` calls below make it a separate
// chunk fetched the first time a Super game actually starts.
//
// ── Two engines, one of which may not exist here ────────────────────────────
//
// `amath_engine_mt.mjs` runs the sample loop on several cores. It is the same
// search — same 160 samples, same seed, same move, reduced in sample order so
// the arithmetic cannot drift — and it is between two and four times faster
// (amath-engine/docs/parallel-sample-loop.md).
//
// It also cannot instantiate at all unless the page is cross-origin isolated,
// because pthreads need SharedArrayBuffer. So the single-threaded module stays
// the floor: `superThreads.ts` decides which one this device gets, and if the
// threaded one will not come up we walk down to it rather than failing the game
// to the backend.
//
// The thread count sizes the pthread pool AND goes into the request, and those
// have to be the same number — the engine asking for more threads than the pool
// holds would have `pthread_create` reach for a Worker that only this thread's
// event loop could spawn, and this thread is blocked inside the engine call.
// One plan, both uses, which is why the request is stamped here rather than
// built with a thread count on the UI side.
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
import {
  degradeThreadPlan,
  planSuperThreads,
  readThreadEnvironment,
  type SuperThreadPlan,
} from "../superThreads";
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

type LoadedEngine = { module: EngineModule; plan: SuperThreadPlan };

let enginePromise: Promise<LoadedEngine> | undefined;
/** The request every progress report is attributed to. The engine's progress
 *  hook is a global with no request in it, so the worker supplies the identity
 *  the UI needs to ignore a stale bar. */
let activeRequestId = 0;

function post(message: SuperWorkerOutbound) {
  (self as unknown as Worker).postMessage(message);
}

/** Install the progress hook. A global, because the engine reports through
 *  EM_JS (amath-engine/src/wasm_api.cpp) and EM_JS has no user pointer to carry
 *  a callback in. Installed before the first call so no report is lost. */
function installProgressHook() {
  (globalThis as Record<string, unknown>).__amathProgress = (json: string) => {
    try {
      post({ type: "progress", id: activeRequestId, progress: JSON.parse(json) });
    } catch {
      // A malformed progress line is dropped. Progress is a courtesy to the
      // UI and is never part of a result.
    }
  };
}

/**
 * Bring up one engine at one thread count.
 *
 * `__amathThreads` is read by the module's own startup code — the `wasm-mt`
 * target compiles `PTHREAD_POOL_SIZE` as a JS expression over exactly this
 * global — so it has to be set BEFORE the factory runs, not passed to it.
 */
async function instantiate(plan: SuperThreadPlan): Promise<EngineModule> {
  (globalThis as Record<string, unknown>).__amathThreads = plan.threads;
  const createModule = plan.threaded
    ? (await import("./amath_engine_mt.mjs")).default
    : (await import("./amath_engine.mjs")).default;
  return (await createModule()) as EngineModule;
}

function loadEngine(): Promise<LoadedEngine> {
  enginePromise ??= (async () => {
    const started = performance.now();
    installProgressHook();

    // Walk down until something starts. A device that cannot afford the pool
    // says so by throwing here — the pool's memory is committed at
    // instantiation, so this is where "eight threads is too much for this
    // phone" actually surfaces — and every step down runs the identical search.
    let plan: SuperThreadPlan | null = planSuperThreads(readThreadEnvironment());
    let lastError: unknown;
    while (plan) {
      try {
        const module = await instantiate(plan);
        post({
          type: "ready",
          initMs: Math.round(performance.now() - started),
          threads: plan.threads,
          threadReason: plan.reason,
        });
        return { module, plan };
      } catch (error) {
        lastError = error;
        plan = degradeThreadPlan(plan);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("engine failed to start");
  })();
  return enginePromise;
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
      await loadEngine();
      return;
    }
    if (message.type === "calibrate") {
      const { module } = await loadEngine();
      post({
        type: "calibration",
        id: message.id,
        // Single-threaded on purpose: the benchmark's whole point is that every
        // device did the SAME work, and a throughput number that silently
        // included a core count would not be comparable between devices.
        result: call(module, { mode: "calibrate" }) as CalibrationResult,
      });
      return;
    }
    if (message.type === "think") {
      const { module, plan } = await loadEngine();
      activeRequestId = message.id;
      const started = performance.now();
      // The thread count is stamped on here, next to the pool it has to match,
      // and NOT in `buildSuperRequest`. That keeps the client adapter identical
      // to the backend's `adapter.ts` field for field: `threads` is a property
      // of where the search runs, not of the position.
      const response = call(module, {
        ...message.request,
        ...(plan.threads > 1 ? { threads: plan.threads } : {}),
      }) as SuperEngineResponse;
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
