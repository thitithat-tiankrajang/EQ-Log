// ── How many cores Super gets ────────────────────────────────────────────────
//
// Super's search is one fixed schedule — 160 opponent-rack samples, the same on
// every device — and this file decides how many threads run it. That is a
// latency decision and only a latency decision: the engine reduces its samples
// in sample order regardless of thread count, so one thread and eight return the
// same move with the same numbers behind it (amath-engine's
// docs/parallel-sample-loop.md, and tests/test_parallel_sim.cpp holds it).
//
// This is exactly why the number MAY be taken from the hardware, when
// `sampleCap` may not. A device-chosen sample budget is a different, weaker bot
// wearing the name; a device-chosen thread count is the same bot answering
// sooner. If that distinction ever blurs, the thing to protect is the schedule,
// not this file.
//
// ── One number, two consumers ────────────────────────────────────────────────
//
// The count returned here sizes the WASM pthread pool AND fills the request's
// `threads` field. Those must be the same number: asking the engine for more
// threads than the pool holds makes `pthread_create` reach for a Worker it does
// not have, and the host worker's event loop — the only thing that could spawn
// one — is blocked inside the engine call for the whole search. So the plan is
// computed once, in `superWorker.ts`, and used for both.

/** The engine clamps to this too (`MAX_SIM_THREADS` in engine.cpp). Past eight
 *  the pool's ~12 MB-per-worker starts to cost more than the cores return. */
export const MAX_SUPER_THREADS = 8;

export type SuperThreadPlan = {
  /** Threads the sample loop may use, and the size of the pthread pool. */
  threads: number;
  /**
   * Whether to load the `-pthread` engine at all.
   *
   * False is not a degraded mode, it is the module that has always shipped. A
   * threaded build cannot even instantiate without `SharedArrayBuffer`, so this
   * is a load-bearing check rather than an optimisation.
   */
  threaded: boolean;
  /** Why, in a few words. Goes to telemetry and to the bot's stats panel, where
   *  "1 thread" without a reason is a bug report waiting to happen. */
  reason: string;
};

/** The bits of the environment this decision reads. Named so tests can hand it
 *  a device instead of mutating globals. */
export type ThreadEnvironment = {
  crossOriginIsolated?: boolean;
  sharedArrayBuffer?: boolean;
  /** `navigator.hardwareConcurrency`. */
  cores?: number;
  /** `navigator.deviceMemory`, in GB. Chromium only — `undefined` everywhere
   *  else, which is a lack of information and never a small number. */
  memoryGb?: number;
};

export function readThreadEnvironment(scope: typeof globalThis = globalThis): ThreadEnvironment {
  const nav = (scope as { navigator?: Navigator & { deviceMemory?: number } }).navigator;
  return {
    crossOriginIsolated: (scope as { crossOriginIsolated?: boolean }).crossOriginIsolated === true,
    sharedArrayBuffer:
      typeof (scope as { SharedArrayBuffer?: unknown }).SharedArrayBuffer === "function",
    cores: nav?.hardwareConcurrency,
    memoryGb: nav?.deviceMemory,
  };
}

const SINGLE = (reason: string): SuperThreadPlan => ({ threads: 1, threaded: false, reason });

/**
 * Decide the thread count for this device.
 *
 * Deliberately generous where the device can take it and conservative only
 * where a measurement says to be. A player on a fast laptop waits a minute
 * instead of four; a player on a two-core phone gets the same move and is not
 * asked to give up their UI thread for it.
 */
export function planSuperThreads(env: ThreadEnvironment): SuperThreadPlan {
  // A `-pthread` module needs SharedArrayBuffer, and SharedArrayBuffer needs the
  // page to be cross-origin isolated. Both are checked: the headers can be right
  // while a browser still withholds the constructor.
  if (!env.crossOriginIsolated) return SINGLE("page is not cross-origin isolated");
  if (!env.sharedArrayBuffer) return SINGLE("SharedArrayBuffer unavailable");

  // Absent `hardwareConcurrency` is not "assume many". A browser that does not
  // report its cores is a browser we know nothing about.
  const cores = Math.floor(env.cores ?? 1);
  if (!Number.isFinite(cores) || cores <= 1) return SINGLE("single core reported");

  // Two and three cores keep one for everything else. The search runs in a
  // worker, but the UI thread still has to paint a progress bar for minutes, and
  // taking the last core to make a two-core phone 1.8x faster buys the wait at
  // the cost of the thing the player is looking at.
  let threads = cores <= 3 ? cores - 1 : Math.min(cores, MAX_SUPER_THREADS);

  // Memory, where the browser will say. Every pooled worker costs ~12 MB the
  // moment the module instantiates, used or not, on top of an engine whose peak
  // is already ~130 MB in the end-game. `deviceMemory` is coarse and Chromium-
  // only; where it is missing this does nothing rather than guessing.
  if (env.memoryGb != null) {
    if (env.memoryGb <= 1) return SINGLE("device reports ≤1 GB of memory");
    if (env.memoryGb <= 2) threads = Math.min(threads, 2);
    else if (env.memoryGb <= 4) threads = Math.min(threads, 4);
  }

  if (threads <= 1) return SINGLE("no core to spare");
  return {
    threads,
    threaded: true,
    reason: `${cores} cores reported${env.memoryGb != null ? `, ${env.memoryGb} GB` : ""}`,
  };
}

/**
 * The next plan to try after one failed to come up.
 *
 * Instantiation is where a device that cannot afford the pool finds out, and it
 * finds out as an exception rather than a number. Halving is the cheapest useful
 * retry: it costs at most three attempts to reach the single-threaded module,
 * which always works, and every step down is still the identical search.
 */
export function degradeThreadPlan(plan: SuperThreadPlan): SuperThreadPlan | null {
  if (!plan.threaded) return null;
  const halved = Math.floor(plan.threads / 2);
  if (halved <= 1) return SINGLE("threaded engine would not start");
  return { threads: halved, threaded: true, reason: `retrying with ${halved} threads` };
}

/**
 * Force a thread count, for measurement and for a manual escape hatch.
 *
 * The device gates are still absolute: this cannot conjure threads on a page
 * that is not cross-origin isolated, because there the threaded module does not
 * load at all. What it can do is ask for FEWER threads than the planner would
 * take, or pin a specific count so a benchmark can compare 1, 4 and 8 on one
 * machine.
 *
 * It changes latency and nothing else. There is no thread count at which the
 * engine runs a different search — that is the property `test_parallel_sim.cpp`
 * exists to hold — so this is safe to expose in a way `sampleCap` would never
 * be.
 */
export function forceSuperThreads(threads: number, env: ThreadEnvironment): SuperThreadPlan {
  if (!Number.isFinite(threads) || threads <= 1) return SINGLE("forced to a single thread");
  if (!env.crossOriginIsolated) return SINGLE("page is not cross-origin isolated");
  if (!env.sharedArrayBuffer) return SINGLE("SharedArrayBuffer unavailable");
  return {
    threads: Math.min(Math.floor(threads), MAX_SUPER_THREADS),
    threaded: true,
    reason: `forced to ${Math.min(Math.floor(threads), MAX_SUPER_THREADS)} threads`,
  };
}
