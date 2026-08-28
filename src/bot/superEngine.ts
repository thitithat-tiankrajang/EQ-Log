// ── Owning the Super worker ──────────────────────────────────────────────────
//
// The UI thread's whole relationship with the client-side engine: start it,
// ask it one question at a time, stop it, and know what it is doing.
//
//     initialize()         bring the worker up and load the WASM module
//     calibrate()          measure this device (fixed work, measured time)
//     think(request)       one Super decision
//     cancel()             stop whatever is running, now
//     getStatus()          what the engine is doing, for the UI and for tests
//
// `initialize()` deliberately takes no configuration. The weights are part of
// the REQUEST, not part of the engine's state — the engine resets them to its
// compiled defaults on every call — so there is nothing to install ahead of
// time. That is what lets one worker serve a game pinned to `v1` and a game on
// `v2` without being torn down between them, and it is why a weights change
// needs no restart of anything.
//
// ── Cancellation is a terminate, and it has to be ───────────────────────────
//
// `_engine_handle` is one synchronous C++ call that does not return until the
// search is finished. While it runs, the worker's message loop is not running
// either — so a "cancel" message would be read only AFTER the search it was
// meant to stop had already completed. Cooperative cancellation on this
// boundary is not a design choice; it is unavailable.
//
// Terminating the worker is the operation that actually exists, and it is
// immediate. Its cost is that the WASM module has to be instantiated again —
// measured at 3–8 ms on the reference host, and more in a browser, against a
// superseded search that would otherwise spend another MINUTE of the player's
// CPU and battery on a position that no longer exists.
//
// So `cancel()` terminates, and the next `think()` starts a fresh worker. That
// is why this module owns the worker rather than exporting it: every path that
// invalidates a search — the position changed, the player left, a newer request
// arrived — has to go through one place that knows to kill it.
//
// ── One search at a time ────────────────────────────────────────────────────
//
// A second `think()` while one is running does NOT queue. It cancels the first,
// because the only reason to ask a second question is that the first one's
// answer no longer applies. Queueing them would make the player wait for two
// searches to get one move.
import type {
  CalibrationResult,
  SuperEngineRequest,
  SuperEngineResponse,
  SuperWorkerInbound,
  SuperWorkerOutbound,
} from "./superTypes";
import type { BotProgress } from "./types";

export class SuperEngineError extends Error {
  constructor(
    readonly code: "cancelled" | "worker_failed" | "engine_failed" | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "SuperEngineError";
  }
}

export type SuperEngineStatus =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "ready" }
  | { kind: "calibrating" }
  | { kind: "thinking"; requestId: number; startedAt: number; progress: BotProgress | null };

export type ThinkOptions = {
  request: SuperEngineRequest;
  onProgress?: (progress: BotProgress) => void;
  /** Cancels this search when it aborts. The caller keeps ownership: this
   *  module never invents a reason to stop, it only obeys one. */
  signal?: AbortSignal;
};

export type ThinkOutcome = {
  response: SuperEngineResponse;
  /** Wall time as the WORKER measured it, which is what the player waited for
   *  the search itself. `response.stats.elapsedMs` is the engine's own clock and
   *  excludes the message hops; both are reported because the gap between them
   *  is the WASM boundary's cost and is worth watching. */
  wallMs: number;
};

/** Whether this browser can run the client-side engine at all. */
export function isSuperEngineSupported(): boolean {
  return typeof Worker === "function" && typeof WebAssembly === "object";
}

let worker: Worker | null = null;
let requestCounter = 0;
let status: SuperEngineStatus = { kind: "idle" };
/** How long the WASM module took to instantiate, the last time it did.
 *  Reported because it is a real part of the first move's cost on a cold tab,
 *  and because a number that grows across a session would mean the worker is
 *  being torn down more often than the design expects. */
let lastInitMs: number | null = null;
/** How many threads the loaded engine came up with, and why.
 *  Worth surfacing rather than dropping: "Super took four minutes" and "Super
 *  took four minutes on one thread because the page is not cross-origin
 *  isolated" are the same complaint with and without its cause. */
let lastThreads: { threads: number; reason: string } | null = null;
/** Resolvers for whatever single request is outstanding. Held here rather than
 *  in a closure so `cancel()` can settle it — a terminated worker will never
 *  answer, and a promise nobody settles is a bot that appears to think forever. */
let pending: {
  id: number;
  reject: (error: unknown) => void;
} | null = null;

const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to status changes. Used by the UI to render what the engine is
 *  doing without polling it. */
export function subscribeSuperEngine(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getStatus(): SuperEngineStatus {
  return status;
}

/** Milliseconds the WASM module last took to instantiate, or `null` if it never
 *  has in this tab. */
export function lastInitialisationMs(): number | null {
  return lastInitMs;
}

/** Threads the loaded engine is using, or `null` if it has not come up in this
 *  tab. One thread is the floor every browser can run, not a failure. */
export function lastThreadPlan(): { threads: number; reason: string } | null {
  return lastThreads;
}

function setStatus(next: SuperEngineStatus): void {
  status = next;
  changed();
}

function ensureWorker(): Worker {
  if (worker) return worker;
  if (!isSuperEngineSupported()) {
    throw new SuperEngineError("unsupported", "This browser cannot run the local engine.");
  }
  worker = new Worker(new URL("./engine/superWorker.ts", import.meta.url), { type: "module" });
  // A standing listener for the one message that is not part of any request.
  // Without it `initialize()` would leave `getStatus()` saying "starting"
  // forever — the module would in fact be loaded and ready, and the only thing
  // that ever corrected the status would be the first search finishing.
  worker.addEventListener("message", (event: MessageEvent<SuperWorkerOutbound>) => {
    if (event.data.type !== "ready") return;
    lastInitMs = event.data.initMs;
    lastThreads = { threads: event.data.threads, reason: event.data.threadReason };
    if (status.kind === "starting" || status.kind === "idle") setStatus({ kind: "ready" });
  });
  worker.onerror = (event) => {
    // A worker that failed to load or threw at the top level will never answer.
    // Settle whatever was waiting on it rather than leaving the bot hanging.
    const failure = new SuperEngineError(
      "worker_failed",
      event.message || "The local engine worker failed to start.",
    );
    pending?.reject(failure);
    pending = null;
    stopWorker();
    setStatus({ kind: "idle" });
  };
  return worker;
}

function stopWorker(): void {
  worker?.terminate();
  worker = null;
  // The next worker re-reads the device and may land somewhere else — a tab
  // that was backgrounded, or a phone that has since freed memory.
  lastThreads = null;
}

function send(message: SuperWorkerInbound): void {
  ensureWorker().postMessage(message);
}

/**
 * Bring the engine up before it is needed.
 *
 * Optional — `think()` and `calibrate()` both start the worker themselves. It
 * exists so a Super room can pay the module's instantiation and the chunk's
 * download while the player is still reading the board, rather than on the
 * first turn.
 */
export function initialize(options?: { threads?: number }): void {
  if (!isSuperEngineSupported()) return;
  if (status.kind === "idle") setStatus({ kind: "starting" });
  // `threads` is a diagnostic seam for the benchmark page and a manual escape
  // hatch; a game never passes it and gets the device's own plan.
  send({ type: "initialize", ...(options?.threads ? { threads: options.threads } : {}) });
}

/**
 * Stop whatever is running and tear the worker down.
 *
 * Safe to call at any time, including when nothing is running. Anything
 * outstanding is rejected as `cancelled`, because a terminated worker cannot
 * answer and a caller waiting on a promise that will never settle is the worst
 * of the available outcomes.
 */
export function cancel(): void {
  const outstanding = pending;
  pending = null;
  stopWorker();
  setStatus({ kind: "idle" });
  outstanding?.reject(new SuperEngineError("cancelled", "The local search was cancelled."));
}

/**
 * Measure this device.
 *
 * Runs the engine's built-in benchmark: a fixed number of move-generation nodes
 * over a fixed position. Every device does exactly the same work, so the time
 * it takes is a property of the device and nothing else.
 */
export function calibrate(): Promise<CalibrationResult> {
  // Supersedes a running search, for the same reason `think()` does — and for
  // one more. Only ONE request is tracked at a time, so assigning `pending`
  // over a live search would drop the only reference to its `reject`: cancel it
  // later and the search's promise would never settle, leaving a bot that
  // appears to think forever. Cancelling first makes the hand-off explicit.
  if (pending) cancel();
  const id = ++requestCounter;
  return new Promise<CalibrationResult>((resolve, reject) => {
    pending = { id, reject };
    setStatus({ kind: "calibrating" });
    const target = ensureWorker();
    const onMessage = (event: MessageEvent<SuperWorkerOutbound>) => {
      const message = event.data;
      if (!("id" in message) || message.id !== id) return;
      if (message.type === "calibration") {
        target.removeEventListener("message", onMessage);
        pending = null;
        setStatus({ kind: "ready" });
        resolve(message.result);
      } else if (message.type === "error") {
        target.removeEventListener("message", onMessage);
        pending = null;
        setStatus({ kind: "ready" });
        reject(new SuperEngineError("engine_failed", message.message));
      }
    };
    target.addEventListener("message", onMessage);
    target.postMessage({ type: "calibrate", id } satisfies SuperWorkerInbound);
  });
}

/**
 * One Super decision.
 *
 * Supersedes any search already running: see the note at the top of the file
 * about why a second question means the first answer is no longer wanted.
 */
export function think(options: ThinkOptions): Promise<ThinkOutcome> {
  if (pending) cancel();
  if (options.signal?.aborted) {
    return Promise.reject(new SuperEngineError("cancelled", "The local search was cancelled."));
  }

  const id = ++requestCounter;
  return new Promise<ThinkOutcome>((resolve, reject) => {
    pending = { id, reject };
    setStatus({ kind: "thinking", requestId: id, startedAt: Date.now(), progress: null });

    const target = ensureWorker();
    const finish = () => {
      target.removeEventListener("message", onMessage);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      finish();
      // `cancel()` terminates the worker and rejects `pending`, which is this
      // request. Nothing else can stop a search that is already inside the
      // engine's synchronous call.
      cancel();
    };
    const onMessage = (event: MessageEvent<SuperWorkerOutbound>) => {
      const message = event.data;
      if (!("id" in message) || message.id !== id) return;
      if (message.type === "progress") {
        const current = status;
        if (current.kind === "thinking" && current.requestId === id) {
          setStatus({ ...current, progress: message.progress });
        }
        options.onProgress?.(message.progress);
        return;
      }
      if (message.type === "result") {
        finish();
        pending = null;
        setStatus({ kind: "ready" });
        if (message.response.error) {
          reject(new SuperEngineError("engine_failed", message.response.error));
          return;
        }
        resolve({ response: message.response, wallMs: message.wallMs });
        return;
      }
      if (message.type === "error") {
        finish();
        pending = null;
        setStatus({ kind: "ready" });
        reject(new SuperEngineError("engine_failed", message.message));
      }
    };

    target.addEventListener("message", onMessage);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    target.postMessage({ type: "think", id, request: options.request } satisfies SuperWorkerInbound);
  });
}

/** Test seam: forget every scrap of state between cases. */
export function resetForTests(): void {
  pending = null;
  stopWorker();
  requestCounter = 0;
  status = { kind: "idle" };
  lastInitMs = null;
  listeners.clear();
}
