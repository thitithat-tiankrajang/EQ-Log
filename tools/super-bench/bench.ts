// ── What a full Super move costs on THIS device ──────────────────────────────
//
//   npm run dev  →  http://127.0.0.1:5173/tools/super-bench/
//
// A page rather than a script because the number that matters is a BROWSER
// number. The engine is the same WASM either way, but a browser's JIT tiering,
// its worker boundary and a laptop's thermal behaviour over a multi-minute run
// are not reproduced by running the module under Node — and Node measurably
// disagrees, at roughly 8.7M generation nodes/s against the browser's ~5.7M on
// the same machine. Predicting a player's wait from the faster of those two
// would under-promise every estimate by a third.
//
// It drives the REAL worker (`src/bot/superEngine.ts`), not a copy of it, so a
// run here exercises the same initialise → calibrate → think → cancel path a
// game does.
//
// The `#beat` counter on the page is the UI-responsiveness check, and it is
// deliberately not an assertion: a frozen UI thread is something you see. It is
// driven by requestAnimationFrame, so it stops dead if the search ever lands on
// the UI thread and keeps ticking for as long as the search stays in the worker.
import {
  SuperEngineError,
  calibrate,
  cancel,
  initialize,
  lastInitialisationMs,
  lastThreadPlan,
  think,
} from "../../src/bot/superEngine";
import { planSuperThreads, readThreadEnvironment } from "../../src/bot/superThreads";
import type { SuperEngineRequest } from "../../src/bot/superTypes";

const out = document.getElementById("out")!;
const beat = document.getElementById("beat")!;
const fpsLabel = document.getElementById("fps")!;

function log(line: string): void {
  out.textContent += `\n${line}`;
}

// ── the UI-thread heartbeat ─────────────────────────────────────────────────
const FRAMES = ["·", "•", "●", "•"];
let frames = 0;
let lastSecond = performance.now();
let fps = 0;
(function tick() {
  frames += 1;
  beat.textContent = FRAMES[Math.floor(frames / 8) % FRAMES.length]!;
  const now = performance.now();
  if (now - lastSecond >= 1000) {
    fps = frames / ((now - lastSecond) / 1000);
    fpsLabel.textContent = `${fps.toFixed(0)} fps`;
    frames = 0;
    lastSecond = now;
  }
  requestAnimationFrame(tick);
})();

// ── measuring memory for real ────────────────────────────────────────────────
//
// `performance.memory` is the wrong tool twice over: it reports only the calling
// realm's JS heap, so it sees neither the WASM heap nor any of the pthread
// workers — which is the entire thing being measured here.
//
// `performance.measureUserAgentSpecificMemory()` measures the whole agent
// cluster: this window, every dedicated worker, and the WASM memory inside them.
// It is only exposed to cross-origin-isolated pages, which is convenient — a
// page that cannot measure this is also a page that cannot run the threaded
// engine.
//
// It resolves after the browser reaches a convenient GC point, so a sample can
// take seconds. That is the price of a number that is not a guess.
type MemoryBreakdown = { bytes: number; types: string[] };
type MemoryMeasurement = { bytes: number; breakdown: MemoryBreakdown[] };
type MemorySample = { label: string; mb: number; workers: number };

// Probed by CALLING it, not by checking that it exists. The property is a
// function in browsers that then throw `SecurityError: not available` on the
// first call — an embedded Chromium does exactly that — and a feature check that
// believes `typeof === "function"` turns the first measurement into an unhandled
// rejection that kills the run with no output. Learned the hard way.
let memoryApiUsable: boolean | null = null;

async function canMeasureMemory(): Promise<boolean> {
  if (memoryApiUsable !== null) return memoryApiUsable;
  const measure = (
    performance as unknown as {
      measureUserAgentSpecificMemory?: () => Promise<MemoryMeasurement>;
    }
  ).measureUserAgentSpecificMemory;
  if (typeof measure !== "function") {
    memoryApiUsable = false;
    return false;
  }
  try {
    await measure.call(performance);
    memoryApiUsable = true;
  } catch {
    memoryApiUsable = false;
  }
  return memoryApiUsable;
}

async function sampleMemory(label: string): Promise<MemorySample | null> {
  if (!(await canMeasureMemory())) return null;
  const measure = (
    performance as unknown as {
      measureUserAgentSpecificMemory: () => Promise<MemoryMeasurement>;
    }
  ).measureUserAgentSpecificMemory;
  const result = await measure.call(performance);
  // Worker realms are counted, not estimated: an orphaned pthread keeps its
  // global scope alive and shows up here as a breakdown entry long after
  // whatever started it has stopped caring.
  const workers = result.breakdown.filter(
    (entry) => entry.bytes > 0 && entry.types.includes("DedicatedWorkerGlobalScope"),
  ).length;
  return { label, mb: result.bytes / 1048576, workers };
}

function logMemory(sample: MemorySample | null): void {
  if (!sample) {
    log("  (memory measurement unavailable — page is not cross-origin isolated)");
    return;
  }
  log(
    `  ${sample.label.padEnd(30)} ${sample.mb.toFixed(1).padStart(7)} MB   ${sample.workers} worker realms`,
  );
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A mid-game position, hard-coded.
 *
 * Mid-game on purpose: it is where Super is most expensive. An opening rack has
 * few candidates and an endgame hands off to the exact solver, so benchmarking
 * either would price a move the player rarely waits for.
 */
const POSITION: SuperEngineRequest = {
  board: [
    { r: 7, c: 7, kind: "8", token: "8" },
    { r: 7, c: 8, kind: "+", token: "+" },
    { r: 7, c: 9, kind: "9", token: "9" },
    { r: 7, c: 10, kind: "=", token: "=" },
    { r: 7, c: 11, kind: "17", token: "17" },
    { r: 6, c: 9, kind: "4", token: "4" },
    { r: 8, c: 9, kind: "3", token: "3" },
    { r: 9, c: 9, kind: "=", token: "=" },
    { r: 10, c: 9, kind: "12", token: "12" },
  ],
  rack: ["2", "5", "11", "x", "-", "=", "?", "0"],
  bagCount: 46,
  oppRackCount: 8,
  myScore: 74,
  oppScore: 66,
  noScoreStreak: 0,
  exchangeAllowed: true,
  difficulty: "super",
  solver: "sim",
  // The two fields that make this full Super: run to the END of the schedule,
  // and say nothing at all about `sampleCap` so the engine uses all 160
  // samples. A `sampleCap` here would be measuring a different, weaker bot.
  unlimited: true,
  topN: 24,
  seed: 20260827,
};

document.getElementById("init")!.addEventListener("click", () => {
  const started = performance.now();
  initialize();
  // `initialize()` is fire-and-forget; the worker answers with `ready`. Poll for
  // the recorded figure rather than inventing a completion event for a
  // benchmark page.
  const poll = setInterval(() => {
    const ms = lastInitialisationMs();
    if (ms === null) return;
    clearInterval(poll);
    log(
      `WASM init: ${ms} ms (worker clock) / ` +
        `${Math.round(performance.now() - started)} ms including chunk fetch`,
    );
  }, 20);
});

document.getElementById("cal")!.addEventListener("click", async () => {
  log("calibrating…");
  const started = performance.now();
  const result = await calibrate();
  log(
    `calibration: ${Math.round(result.nodesPerSec).toLocaleString()} nodes/s ` +
      `over ${Math.round(result.elapsedMs)} ms engine / ` +
      `${Math.round(performance.now() - started)} ms wall  [${result.benchmark}]`,
  );
});

document.getElementById("full")!.addEventListener("click", async () => {
  log("\nFULL Super — this takes MINUTES. Watch the heartbeat above stay smooth.");
  const started = performance.now();
  let worstFps = Infinity;
  const watch = setInterval(() => {
    if (fps > 0) worstFps = Math.min(worstFps, fps);
  }, 500);
  try {
    const outcome = await think({
      request: POSITION,
      onProgress: (progress) => {
        out.textContent = out.textContent!.replace(/\n {2}\d+% .*$/, "");
        log(`  ${Math.round(progress.percent)}% ${progress.phase}`);
      },
    });
    clearInterval(watch);
    const stats = outcome.response.stats;
    // Three clocks, narrowing. The gap between them is the cost of the worker
    // boundary and the WASM heap copies — worth watching, and at this scale
    // reliably lost in the noise of a multi-minute search.
    log(
      `\nFULL Super: ${((performance.now() - started) / 1000).toFixed(1)}s as the UI thread saw it, ` +
        `${(outcome.wallMs / 1000).toFixed(1)}s in the worker, ` +
        `${(stats.elapsedMs / 1000).toFixed(1)}s in the engine`,
    );
    // The assertion that this was Super and not something cheaper wearing the
    // name. 160 is the compiled schedule; anything less means a cap got in.
    log(`samples: ${stats.samples}${stats.samples === 160 ? "  ✓ full schedule" : "  ✗ REDUCED"}`);
    log(`nodes: ${stats.nodes.toLocaleString()}`);
    log(`move: ${outcome.response.type} score=${outcome.response.score}`);
    log(`worst UI frame rate during the search: ${worstFps.toFixed(0)} fps`);
  } catch (failure) {
    clearInterval(watch);
    log(`stopped: ${failure instanceof Error ? failure.message : String(failure)}`);
  }
});

document.getElementById("cancel")!.addEventListener("click", () => {
  cancel();
  log("cancel() — worker terminated");
});

// ── the memory + lifecycle run ───────────────────────────────────────────────
//
// One scripted pass that answers the questions a device policy is allowed to be
// built on, and that a Node measurement cannot answer honestly:
//
//   • what the threaded engine actually costs this browser, per thread count
//   • whether cancelling a live Full Super frees it again
//   • whether the pthread workers die with the worker that owns them
//   • whether repeating start/cancel accumulates anything
//
// It is a page rather than a test because `measureUserAgentSpecificMemory` needs
// a cross-origin-isolated browsing context and a real GC, neither of which jsdom
// has. The verdicts below are printed, not asserted — the numbers are the point,
// and a number that fails an assertion is a number you stop being able to read.
document.getElementById("lifecycle")!.addEventListener("click", async () => {
  const env = readThreadEnvironment();
  const plan = planSuperThreads(env);
  log("\n── memory + lifecycle ───────────────────────────────────────────────");
  log(
    `environment: coi=${env.crossOriginIsolated} sab=${env.sharedArrayBuffer} ` +
      `cores=${env.cores ?? "?"} deviceMemory=${env.memoryGb ?? "not reported"}`,
  );
  log(`plan: ${plan.threads} thread(s), threaded=${plan.threaded} — ${plan.reason}`);
  if (!(await canMeasureMemory())) {
    log(
      "measureUserAgentSpecificMemory() is unavailable in this browser — memory rows " +
        "are skipped here and measured as renderer RSS from outside instead.",
    );
  }

  // Anything left over from an earlier click would be charged to the baseline.
  cancel();
  await settle(1500);
  logMemory(await sampleMemory("baseline (no worker)"));

  // ── after instantiation ───────────────────────────────────────────────────
  initialize();
  // The plan, not the init time: the init time survives a `stopWorker()` and
  // would fall straight through here on a second run.
  while (lastThreadPlan() === null) await settle(50);
  const loaded = lastThreadPlan();
  log(`engine up: ${loaded?.threads ?? "?"} thread(s) — ${loaded?.reason ?? "?"}`);
  await settle(500);
  logMemory(await sampleMemory("after WASM init"));

  // ── during a real Full Super ──────────────────────────────────────────────
  // Not awaited: the whole point is to measure while the search is running, and
  // the search runs in the worker so this thread is free to do it.
  // A holder rather than plain `let`, so the compiler does not narrow these to
  // their initial values — they are written from a callback it cannot see into.
  const cancelled: { settled: "resolved" | "rejected" | "pending"; samples: number | null } = {
    settled: "pending",
    samples: null,
  };
  const search = think({ request: POSITION })
    .then((outcome) => {
      cancelled.settled = "resolved";
      cancelled.samples = outcome.response.stats.samples;
    })
    .catch(() => {
      cancelled.settled = "rejected";
    });
  await settle(6000);
  logMemory(await sampleMemory("during Full Super"));

  // ── cancel it mid-search ──────────────────────────────────────────────────
  const cancelledAt = performance.now();
  cancel();
  await search;
  log(
    `cancel: promise settled as ${cancelled.settled} after ` +
      `${Math.round(performance.now() - cancelledAt)} ms` +
      `${cancelled.settled === "rejected" ? "  ✓" : "  ✗ expected a rejection"}`,
  );
  logMemory(await sampleMemory("immediately after cancel"));
  await settle(3000);
  const afterCancel = await sampleMemory("3s after cancel");
  logMemory(afterCancel);
  log(
    afterCancel && afterCancel.workers === 0
      ? "  ✓ no worker realms remain — the pool died with its owner"
      : `  ✗ ${afterCancel?.workers ?? "?"} worker realms still alive`,
  );

  // ── repeated start/cancel ─────────────────────────────────────────────────
  // The leak this is looking for is per-cycle: a pool that survives terminate()
  // would show up as a staircase rather than a flat line.
  for (let cycle = 1; cycle <= 5; cycle += 1) {
    const attempt = think({ request: POSITION }).catch(() => undefined);
    await settle(1200);
    cancel();
    await attempt;
  }
  await settle(3000);
  logMemory(await sampleMemory("after 5 start/cancel cycles"));

  // ── and it still works afterwards ─────────────────────────────────────────
  log("running one Full Super to completion — minutes; the heartbeat should stay smooth");
  const started = performance.now();
  const finalOutcome = await think({ request: POSITION });
  const stats = finalOutcome.response.stats;
  log(
    `after cancellation the engine still answers: ${((performance.now() - started) / 1000).toFixed(1)}s, ` +
      `${stats.samples} samples${stats.samples === 160 ? "  ✓ full schedule" : "  ✗ REDUCED"}, ` +
      `nodes ${stats.nodes.toLocaleString()}, ${finalOutcome.response.type} score=${finalOutcome.response.score}`,
  );
  log(`equity ${finalOutcome.response.equity}  (compare against the native reference)`);
  logMemory(await sampleMemory("during/after final search"));
  log(
    cancelled.samples === null
      ? "  ✓ the cancelled search never delivered a result"
      : `  ✗ a cancelled search still resolved with ${cancelled.samples} samples`,
  );
  log("── done ────────────────────────────────────────────────────────────");
});

// ── a step API, for driving this page from outside ───────────────────────────
//
// The scripted button above is for a human. This is for a harness that has to
// measure the process from the OUTSIDE between steps — which is the only honest
// way to get browser memory here, since `measureUserAgentSpecificMemory()` is
// present-but-throwing in an embedded Chromium and `performance.memory` sees
// neither the WASM heap nor the workers it lives in.
//
// Chromium runs a page's dedicated workers inside that page's renderer process,
// so the renderer's RSS covers the host worker, every pthread, and all of their
// WASM memory. Sampling it between these steps is directly comparable to the
// `/usr/bin/time -l` numbers the Node measurements produced.
type BenchState = {
  phase: "idle" | "initialising" | "searching" | "done" | "cancelled" | "failed";
  threads: number | null;
  reason: string | null;
  samples: number | null;
  equity: number | null;
  nodes: number | null;
  elapsedMs: number | null;
  settled: string | null;
  resolutions: number;
  seed: number | null;
};

const state: BenchState = {
  phase: "idle",
  threads: null,
  reason: null,
  samples: null,
  equity: null,
  nodes: null,
  elapsedMs: null,
  settled: null,
  resolutions: 0,
  seed: null,
};

let running: Promise<unknown> | null = null;

(window as unknown as { __superBench: unknown }).__superBench = {
  state: () => ({ ...state }),

  async init(threads?: number) {
    state.phase = "initialising";
    initialize(threads ? { threads } : undefined);
    // Wait on the THREAD PLAN, not on `lastInitialisationMs()`. The init time
    // survives a `stopWorker()` (it is a record of the last instantiation);
    // the plan does not, because a new worker re-reads the device. Polling the
    // init time would fall straight through on the second and later cases and
    // report the previous worker's plan.
    while (lastThreadPlan() === null) await settle(50);
    const plan = lastThreadPlan();
    state.threads = plan?.threads ?? null;
    state.reason = plan?.reason ?? null;
    state.phase = "idle";
    return { ...state };
  },

  /** Start a Full Super and return immediately, so the caller can measure while
   *  it runs. Every resolution is counted: a cancelled search that still
   *  delivered a result would show up as an extra one. */
  /** `seed` varies the search without varying the schedule — still all 160
   *  samples. Two tabs given different seeds must return different answers;
   *  if they ever agree, they are sharing something they should not. */
  start(seed?: number) {
    state.phase = "searching";
    state.settled = null;
    state.seed = seed ?? POSITION.seed;
    const started = performance.now();
    running = think({ request: seed ? { ...POSITION, seed } : POSITION })
      .then((outcome) => {
        state.resolutions += 1;
        state.settled = "resolved";
        state.phase = "done";
        state.samples = outcome.response.stats.samples;
        state.equity = outcome.response.equity;
        state.nodes = outcome.response.stats.nodes;
        state.elapsedMs = Math.round(performance.now() - started);
      })
      .catch((error: unknown) => {
        state.settled = error instanceof Error ? error.message : String(error);
        state.phase =
          error instanceof SuperEngineError && error.code === "cancelled" ? "cancelled" : "failed";
        state.elapsedMs = Math.round(performance.now() - started);
      });
    return { ...state };
  },

  async cancelNow() {
    const at = performance.now();
    cancel();
    await running;
    return { ...state, cancelSettleMs: Math.round(performance.now() - at) };
  },

  async waitForResult() {
    await running;
    return { ...state };
  },

  /** Reset everything, including the worker, so a caller can measure a clean
   *  baseline between cases. */
  async reset() {
    cancel();
    await running?.catch(() => undefined);
    running = null;
    state.phase = "idle";
    state.settled = null;
    return { ...state };
  },
};

// ── the scripted memory + lifecycle matrix ───────────────────────────────────
//
// Walks 1, 4 and 8 threads through the whole lifecycle on a fixed clock, marking
// each phase with a timestamp. An outside sampler records the renderer's RSS on
// its own clock; joining the two on time is what produces the memory table.
//
// The phases are held long enough that a sampler at 1 Hz cannot miss one, and
// the search phase is held past the point where the pool has certainly spun up
// and started work.
type PhaseMark = { at: number; phase: string; threads: number | null; note?: string };

(window as unknown as { __superBench: Record<string, unknown> }).__superBench.runMemoryMatrix =
  async function runMemoryMatrix(counts: number[] = [1, 4, 8]) {
    const bench = (window as unknown as { __superBench: Record<string, () => Promise<unknown>> })
      .__superBench as unknown as {
      reset(): Promise<unknown>;
      init(threads?: number): Promise<unknown>;
      start(): unknown;
      cancelNow(): Promise<{ cancelSettleMs: number; settled: string | null; phase: string }>;
      state(): BenchState;
    };
    const marks: PhaseMark[] = [];
    const mark = (phase: string, threads: number | null, note?: string) =>
      marks.push({ at: Date.now(), phase, threads, ...(note ? { note } : {}) });

    for (const threads of counts) {
      await bench.reset();
      await settle(2500);
      mark("baseline", threads);
      await settle(2500);

      await bench.init(threads);
      const loaded = lastThreadPlan();
      mark("after-init", loaded?.threads ?? null, loaded?.reason);
      await settle(2500);

      bench.start();
      await settle(4000);
      mark("searching", loaded?.threads ?? null);
      await settle(8000);

      const cancelled = await bench.cancelNow();
      mark(
        "cancelled",
        loaded?.threads ?? null,
        `${cancelled.settled} in ${cancelled.cancelSettleMs}ms`,
      );
      await settle(4000);
      mark("settled-after-cancel", loaded?.threads ?? null);
      await settle(2000);
    }

    // Repeated start/cancel on the device's own plan. A pool that survives
    // terminate() shows up here as a staircase rather than a flat line.
    await bench.reset();
    await settle(2000);
    await bench.init();
    const plan = lastThreadPlan();
    mark("cycles-start", plan?.threads ?? null, plan?.reason);
    for (let cycle = 0; cycle < 5; cycle += 1) {
      bench.start();
      await settle(1500);
      await bench.cancelNow();
      await settle(500);
    }
    await settle(4000);
    mark("after-5-cycles", plan?.threads ?? null);
    await settle(2000);

    // And it still answers correctly afterwards.
    await bench.init();
    bench.start();
    mark("final-search-start", plan?.threads ?? null);
    const finished = await (
      window as unknown as { __superBench: { waitForResult(): Promise<BenchState> } }
    ).__superBench.waitForResult();
    mark(
      "final-search-done",
      plan?.threads ?? null,
      `samples=${finished.samples} equity=${finished.equity} nodes=${finished.nodes} ` +
        `ms=${finished.elapsedMs} resolutions=${finished.resolutions}`,
    );
    await settle(4000);
    mark("after-final", plan?.threads ?? null);
    return marks;
  };
