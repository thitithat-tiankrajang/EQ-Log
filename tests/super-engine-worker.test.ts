// Cancellation, supersession, and not leaving a caller waiting forever.
//
// These are the properties that decide whether a bot that thinks locally is
// safe to ship, and none of them is about the search being correct:
//
//   • a stale search must STOP, not merely be ignored. Ignoring it leaves a
//     minute of a player's CPU and battery burning on a position that no longer
//     exists — on a laptop that is a fan, on a phone it is the browser killing
//     the tab.
//   • a superseded request must be settled, not abandoned. A promise nobody
//     resolves is a bot that appears to think forever, and the turn never ends.
//   • a worker that dies must settle everything waiting on it, for the same
//     reason.
//
// The engine itself is stubbed. What is under test is the OWNERSHIP: who
// terminates what, and when.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SuperEngineError,
  calibrate,
  cancel,
  getStatus,
  initialize,
  resetForTests,
  think,
} from "../src/bot/superEngine";
import type { SuperEngineRequest } from "../src/bot/superTypes";

/** Every worker this test has constructed, in order, so a test can assert that
 *  a cancel really terminated one and that the next request built a new one. */
const built: FakeWorker[] = [];

class FakeWorker implements Partial<Worker> {
  terminated = false;
  onerror: ((event: unknown) => void) | null = null;
  readonly posted: unknown[] = [];
  readonly #listeners = new Set<(event: MessageEvent) => void>();

  constructor() {
    built.push(this);
  }

  addEventListener(_type: string, listener: (event: MessageEvent) => void): void {
    this.#listeners.add(listener);
  }

  removeEventListener(_type: string, listener: (event: MessageEvent) => void): void {
    this.#listeners.delete(listener);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Deliver a message as the real worker would. */
  emit(data: unknown): void {
    for (const listener of [...this.#listeners]) {
      listener({ data } as MessageEvent);
    }
  }
}

const REQUEST: SuperEngineRequest = {
  board: [],
  rack: ["5", "+", "="],
  bagCount: 80,
  oppRackCount: 8,
  myScore: 0,
  oppScore: 0,
  noScoreStreak: 0,
  exchangeAllowed: true,
  difficulty: "super",
  solver: "sim",
  unlimited: true,
  seed: 1,
};

function result(id: number) {
  return {
    type: "result",
    id,
    wallMs: 1234,
    response: {
      type: "pass",
      placements: [],
      exchange: [],
      score: 0,
      equity: 1,
      solver: "sim",
      endgameSolved: false,
      stats: { moves: 1, nodes: 2, elapsedMs: 3, candidates: 1, samples: 8 },
    },
  };
}

beforeEach(() => {
  built.length = 0;
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("WebAssembly", {});
  resetForTests();
});

afterEach(() => {
  resetForTests();
  vi.unstubAllGlobals();
});

describe("the local engine's worker", () => {
  it("is built once and reused across consecutive moves", async () => {
    const first = think({ request: REQUEST });
    built[0]!.emit(result(1));
    await first;

    const second = think({ request: REQUEST });
    built[0]!.emit(result(2));
    await second;

    // A whole game is twenty-odd moves. Rebuilding the worker — and
    // re-instantiating the WASM module — for each of them would pay a startup
    // cost per turn that the design says is paid once.
    expect(built).toHaveLength(1);
    expect(built[0]!.terminated).toBe(false);
  });

  it("TERMINATES the worker on cancel rather than ignoring the result", async () => {
    const pending = think({ request: REQUEST });
    expect(built[0]!.terminated).toBe(false);

    cancel();

    // The search is inside a synchronous WASM call; nothing but a terminate
    // stops it. A design that merely stopped listening would leave a superseded
    // Super search running for minutes on the player's own CPU.
    expect(built[0]!.terminated).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });

  it("settles a cancelled request instead of abandoning it", async () => {
    const pending = think({ request: REQUEST });
    cancel();
    // A promise nobody settles is a bot that appears to think forever and a
    // turn that never ends. The rejection is what lets the caller fall back.
    await expect(pending).rejects.toBeInstanceOf(SuperEngineError);
    expect(getStatus().kind).toBe("idle");
  });

  it("cancels an in-flight search when a newer one arrives", async () => {
    const stale = think({ request: REQUEST });
    const staleWorker = built[0]!;

    const fresh = think({ request: { ...REQUEST, seed: 2 } });
    // The only reason to ask a second question is that the first answer no
    // longer applies. Queueing them would make the player wait for two searches
    // to get one move.
    expect(staleWorker.terminated).toBe(true);
    await expect(stale).rejects.toMatchObject({ code: "cancelled" });

    expect(built).toHaveLength(2);
    built[1]!.emit(result(2));
    await expect(fresh).resolves.toMatchObject({ wallMs: 1234 });
  });

  it("obeys an abort signal by terminating", async () => {
    const controller = new AbortController();
    const pending = think({ request: REQUEST, signal: controller.signal });
    controller.abort();
    expect(built[0]!.terminated).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });

  it("refuses immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(think({ request: REQUEST, signal: controller.signal })).rejects.toMatchObject({
      code: "cancelled",
    });
    // And builds nothing: a search that is already unwanted must not start.
    expect(built).toHaveLength(0);
  });

  it("ignores a progress report from a superseded request", async () => {
    const stale = think({ request: REQUEST });
    await expect(
      (async () => {
        cancel();
        await stale;
      })(),
    ).rejects.toBeTruthy();

    const fresh = think({ request: REQUEST });
    const worker = built[1]!;
    const seen: number[] = [];
    void fresh.catch(() => {});
    // id 1 belongs to the cancelled request. A bar that moved on it would be
    // showing the progress of a search for a position that no longer exists.
    worker.emit({ type: "progress", id: 1, progress: { percent: 99 } });
    worker.emit({ type: "progress", id: 2, progress: { percent: 10 } });
    const status = getStatus();
    expect(status.kind).toBe("thinking");
    if (status.kind === "thinking") expect(status.progress?.percent).toBe(10);
    expect(seen).toEqual([]);
  });

  it("settles what is waiting when the worker itself dies", async () => {
    const pending = think({ request: REQUEST });
    built[0]!.onerror?.({ message: "boom" });
    // Nothing will ever answer. The caller has to learn that, or the turn hangs.
    await expect(pending).rejects.toMatchObject({ code: "worker_failed" });
  });

  it("reports an engine error as an engine error, not as a move", async () => {
    const pending = think({ request: REQUEST });
    built[0]!.emit({ type: "error", id: 1, message: "bad rack tile" });
    await expect(pending).rejects.toMatchObject({ code: "engine_failed" });
  });

  it("does not orphan a running search when a calibration starts", async () => {
    const search = think({ request: REQUEST });
    const worker = built[0]!;
    void calibrate().catch(() => {});
    // Only one request is tracked at a time. If calibration simply overwrote
    // that slot, the search's `reject` would be the only reference dropped —
    // and its promise would never settle, which is a bot that appears to think
    // forever and a turn that never ends.
    await expect(search).rejects.toMatchObject({ code: "cancelled" });
    expect(worker.terminated).toBe(true);
  });

  it("reaches ready on its own after initialize()", () => {
    initialize();
    expect(getStatus().kind).toBe("starting");
    built[0]!.emit({ type: "ready", initMs: 12 });
    // Without a standing listener for this message, a warmed-up engine would
    // report "starting" until the first search finished.
    expect(getStatus().kind).toBe("ready");
  });
});
