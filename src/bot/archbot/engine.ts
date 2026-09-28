// ── The page's side of the ArchBot worker ────────────────────────────────────
//
// One worker per tab, created on first use and kept, so the ~4 MB model is
// downloaded, verified and parsed once rather than once per turn. Requests are
// answered strictly one at a time, in order:
//
//   • Each request gets a fresh id and carries the (room, revision) it is about.
//     Only the request currently in the worker can be answered; an answer with
//     any other id — from a request that was cancelled, or from a worker that has
//     since been replaced — is dropped on the floor.
//   • Cancelling a QUEUED request removes it. Cancelling the RUNNING request
//     terminates the worker (a Stage 5B decision is one synchronous call; nothing
//     else can stop it) and the next request gets a new worker.
//   • A worker that dies (an out-of-memory tab, a script error) fails the request
//     it was running and is replaced for the next one.
//
// Nothing here chooses a move or retries one: it answers "what does Stage 5B play
// in this position", or says why it could not.
import type { ArchBotDecision, ArchBotRequest } from "./decide";
import type { ArchBotModelErrorCode } from "./model";
import type { ArchBotFailureCode, ArchBotFromWorker, ArchBotToWorker } from "./protocol";

export type ArchBotErrorCode = ArchBotFailureCode | "unsupported" | "cancelled";

export class ArchBotError extends Error {
  constructor(
    readonly code: ArchBotErrorCode,
    message: string,
    readonly modelCode?: ArchBotModelErrorCode,
  ) {
    super(message);
    this.name = "ArchBotError";
  }
}

/** The slice of `Worker` the engine uses, so tests can supply their own. */
export type ArchBotWorkerLike = {
  postMessage(message: ArchBotToWorker): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<ArchBotFromWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

/** What a request is about. Returned with the answer so the caller can check it. */
export type ArchBotKey = { roomId: string; revision: number };

export type ArchBotAnswer = {
  key: ArchBotKey;
  decision: ArchBotDecision;
  /** Wall time of the decision inside the worker. */
  wallMs: number;
  /** Time the worker took to load the model, once; 0 when it was already loaded. */
  modelMs: number;
};

export type ArchBotPhase = "loading_model" | "thinking";

type Pending = {
  id: number;
  key: ArchBotKey;
  request: ArchBotRequest;
  resolve: (answer: ArchBotAnswer) => void;
  reject: (error: ArchBotError) => void;
  onPhase?: (phase: ArchBotPhase) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

export class ArchBotEngine {
  #worker: ArchBotWorkerLike | null = null;
  #modelReady = false;
  #nextId = 1;
  #queue: Pending[] = [];
  #running: Pending | null = null;

  constructor(
    private readonly options: {
      createWorker: () => ArchBotWorkerLike;
      modelPath: string;
    },
  ) {}

  /** Start the worker and the model download ahead of the first turn. */
  warm(): void {
    this.#ensureWorker();
  }

  /** Whether a request is in the worker or waiting for it. */
  get busy(): boolean {
    return this.#running !== null || this.#queue.length > 0;
  }

  decide(options: {
    key: ArchBotKey;
    request: ArchBotRequest;
    signal?: AbortSignal;
    onPhase?: (phase: ArchBotPhase) => void;
  }): Promise<ArchBotAnswer> {
    return new Promise<ArchBotAnswer>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new ArchBotError("cancelled", "ArchBot's turn was cancelled."));
        return;
      }
      const pending: Pending = {
        id: this.#nextId++,
        key: { ...options.key },
        request: options.request,
        resolve,
        reject,
        ...(options.onPhase ? { onPhase: options.onPhase } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      };
      if (options.signal) {
        pending.abort = () => this.#cancel(pending);
        options.signal.addEventListener("abort", pending.abort, { once: true });
      }
      this.#queue.push(pending);
      this.#pump();
    });
  }

  /** Terminate the worker and fail everything outstanding. */
  dispose(): void {
    const outstanding = [...(this.#running ? [this.#running] : []), ...this.#queue];
    this.#queue = [];
    this.#running = null;
    this.#killWorker();
    for (const pending of outstanding) {
      this.#settle(pending, new ArchBotError("cancelled", "ArchBot was shut down."));
    }
  }

  #ensureWorker(): ArchBotWorkerLike {
    if (this.#worker) return this.#worker;
    const worker = this.options.createWorker();
    worker.onmessage = (event) => this.#onMessage(worker, event.data);
    worker.onerror = (event) => {
      event.preventDefault?.();
      this.#onCrash(worker, event.message || "ArchBot's worker stopped unexpectedly.");
    };
    this.#worker = worker;
    this.#modelReady = false;
    worker.postMessage({ type: "init", modelPath: this.options.modelPath });
    return worker;
  }

  #killWorker(): void {
    if (!this.#worker) return;
    this.#worker.onmessage = null;
    this.#worker.onerror = null;
    this.#worker.terminate();
    this.#worker = null;
    this.#modelReady = false;
  }

  #pump(): void {
    if (this.#running || this.#queue.length === 0) return;
    const next = this.#queue.shift()!;
    this.#running = next;
    const worker = this.#ensureWorker();
    next.onPhase?.(this.#modelReady ? "thinking" : "loading_model");
    worker.postMessage({
      type: "decide",
      id: next.id,
      modelPath: this.options.modelPath,
      request: next.request,
    });
  }

  #onMessage(worker: ArchBotWorkerLike, message: ArchBotFromWorker): void {
    // A message from a worker this engine has already replaced belongs to nobody.
    if (worker !== this.#worker) return;
    if (message.type === "ready") {
      this.#modelReady = true;
      this.#running?.onPhase?.("thinking");
      return;
    }
    if (message.type === "model-error") {
      // Reported by the eager load. A request that is waiting will receive its
      // own `failed`, because the worker retries the load for it.
      return;
    }
    const running = this.#running;
    if (!running || message.id !== running.id) return; // stale: not the request in the worker
    this.#running = null;
    if (message.type === "decided") {
      this.#modelReady = true;
      this.#settle(running, {
        key: running.key,
        decision: message.decision,
        wallMs: message.wallMs,
        modelMs: message.modelMs,
      });
    } else {
      this.#settle(running, new ArchBotError(message.code, message.message, message.modelCode));
    }
    this.#pump();
  }

  #onCrash(worker: ArchBotWorkerLike, reason: string): void {
    if (worker !== this.#worker) return;
    const running = this.#running;
    this.#running = null;
    this.#killWorker();
    if (running) this.#settle(running, new ArchBotError("compute_failed", reason));
    this.#pump();
  }

  #cancel(pending: Pending): void {
    const queued = this.#queue.indexOf(pending);
    if (queued >= 0) {
      this.#queue.splice(queued, 1);
    } else if (this.#running === pending) {
      this.#running = null;
      this.#killWorker();
    } else {
      return;
    }
    this.#settle(pending, new ArchBotError("cancelled", "ArchBot's turn was cancelled."));
    this.#pump();
  }

  #settle(pending: Pending, outcome: ArchBotAnswer | ArchBotError): void {
    if (pending.abort) pending.signal?.removeEventListener("abort", pending.abort);
    if (outcome instanceof ArchBotError) pending.reject(outcome);
    else pending.resolve(outcome);
  }
}
