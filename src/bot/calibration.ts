// ── How fast is THIS device? ─────────────────────────────────────────────────
//
// Before a player is offered a bot that thinks on their own laptop, somebody
// has to know how long that will take. The only honest way to know is to
// measure the laptop.
//
// What is measured is NOT a Super search. A Super search is the thing whose
// cost we are trying to predict; running one to find out would spend the very
// minutes the calibration exists to warn about. What runs instead is the
// engine's built-in benchmark: a FIXED number of move-generation nodes over a
// FIXED position (see `runCalibration` in amath-engine/src/engine.cpp). Every
// device does exactly the same work, so the only thing that varies is the time
// — which is the definition of a device measurement.
//
// Move generation is the right primitive to measure because a Super decision is
// generation-bound: it issues roughly candidates × samples × 2 generations, and
// every heuristic between them costs under a microsecond.
//
// ── What this file does NOT do ──────────────────────────────────────────────
//
// It does not choose how much Super searches. That is worth stating loudly,
// because it used to: an earlier revision scaled a TABLE of per-budget
// latencies and handed the device the largest sample cap that fitted the
// latency targets. At reference speed that came out at 8 of Super's 160
// opponent-rack samples — so a Champion on an M3 played a bot the backend
// fallback would have played twenty times more search for, and how strong your
// opponent was depended on your laptop.
//
// Every device now runs the identical full schedule. What varies between
// devices is the WAIT, and predicting that wait is this file's only job:
//
//     estimated full-Super latency = reference's full-Super latency
//                                    × (reference throughput / this device's)
//
// The estimate is used to LABEL the device (`tier`) and to warn its owner when
// the wait will be long. It is used for NOTHING else. In particular it does not
// decide whether the device may play: there is no latency cutoff anywhere on
// this path, because Super's defining property is that it searches exhaustively
// and a player who does not want to wait for that already has three weaker bots
// to choose from.
//
// A very slow device therefore runs full Super and takes several minutes over
// it, having been told that it will.
//
// ── The scaling is a linear model, and is stated as one ─────────────────────
//
// It assumes Super latency scales with generation throughput, which is true to
// the extent that the search is generation-bound and false to the extent that
// it is not: memory bandwidth, cache size, and a phone's thermal behaviour over
// a multi-minute run are all real and none of them are in this number. It is a
// first-order estimate for setting expectations, never a promise about a
// particular move — which is why every device also records what it ACTUALLY
// waited (`superTelemetry.ts`), and why that record, not this estimate, is what
// the beta is judged on.
//
// ── Why the result is cached ────────────────────────────────────────────────
//
// A device's speed does not change between page loads. Re-measuring on every
// visit costs the player a second of CPU to learn something already known. The
// cache is keyed by the BENCHMARK NAME, so changing the benchmark in the engine
// invalidates every stored result rather than silently comparing two different
// amounts of work.
import { calibrate, isSuperEngineSupported } from "./superEngine";
import type { CalibrationResult } from "./superTypes";
import type { SuperConfig } from "./superConfig";

export type PerformanceTier = "EXCELLENT" | "GOOD" | "SLOW" | "NOT_RECOMMENDED";

export type DeviceCalibration = {
  benchmark: string;
  nodesPerSec: number;
  elapsedMs: number;
  capBound: boolean;
  measuredAt: number;
  /** Estimated latency of a FULL Super move on this device, in ms. The full
   *  schedule is what this device will actually run, so this is a prediction of
   *  a wait the player will really experience — not of a configuration chosen
   *  to make the number look better. */
  estimatedMoveMs: { p50: number; p95: number };
  tier: PerformanceTier;
  /**
   * Opponent-rack sample budget for this device.
   *
   * `null` — the full Super schedule — on every device, which is the point.
   * It is a number only when an operator has explicitly enabled the
   * EXPERIMENTAL adaptive budget, and in that case the bot is deliberately
   * playing weaker than Super and `adaptiveBudgetApplied` says so.
   */
  sampleCap: number | null;
  /** True only when the experimental adaptive budget actually capped this
   *  device. Carried into telemetry so no run's numbers can be mistaken for
   *  full-strength Super's. */
  adaptiveBudgetApplied: boolean;
  /** Whether to tell the player this machine will take a while. Presentational:
   *  it changes a line of copy and nothing else. */
  warnAboutWait: boolean;
  /** What the device reported about itself. Recorded, never used to decide
   *  anything — a CPU name is not a measurement, which is the whole point of
   *  this file. */
  agent: { userAgent: string; cores: number | null; memoryGb: number | null };
};

// Bumped whenever the stored SHAPE or the MEANING of a stored field changes.
// v1 stored an estimate of a capped search and an `allowed` verdict derived
// from latency targets; both are gone, and reading a v1 entry back would
// silently reinstate a number that described a different search.
const STORAGE_KEY = "eq-lab:device-calibration:v3";

let memory: DeviceCalibration | null = null;
let inFlight: Promise<DeviceCalibration> | null = null;

function describeAgent(): DeviceCalibration["agent"] {
  const navigatorLike = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    cores: typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : null,
    memoryGb: typeof navigatorLike.deviceMemory === "number" ? navigatorLike.deviceMemory : null,
  };
}

/**
 * Predict this device's full-Super wait, and label it.
 *
 * The order of operations is the whole design, so it is worth spelling out:
 *
 *   1. measure the device,
 *   2. scale the reference's FULL-SUPER latency by how much slower it is,
 *   3. label the result, and decide whether to warn about the wait.
 *
 * There is no step four. Nothing here chooses how much Super searches, and
 * nothing here decides whether the device is allowed to play — the two things
 * a function like this is most likely to grow, and the two things that would
 * make one player's Super weaker or absent because of their hardware.
 */
export function classify(
  result: CalibrationResult,
  config: SuperConfig,
): Omit<DeviceCalibration, "measuredAt" | "agent"> {
  const { reference, tiers, warnAboveMs, adaptiveBudget } = config.calibration;
  // How much slower this device is than the reference. Guarded because a zero
  // makes every estimate infinite, and a divide-by-zero label is worse than an
  // unmeasured one.
  const ratio =
    result.nodesPerSec > 0 && reference.nodesPerSec > 0
      ? reference.nodesPerSec / result.nodesPerSec
      : 1;

  // The prediction that matters: what a full-schedule Super move costs here.
  // This is what the device will really run — on every device, without
  // exception — so it is a prediction of a wait somebody will actually sit
  // through rather than of a configuration picked to make the number look good.
  const fullSuper = {
    p50: Math.round(reference.fullSuper.p50Ms * ratio),
    p95: Math.round(reference.fullSuper.p95Ms * ratio),
  };

  // ── the experimental branch, and only when explicitly switched on ─────────
  //
  // Everything below this comment reduces Super's strength. It runs only
  // because an operator set `SUPER_ADAPTIVE_BUDGET`, it is never the default,
  // and it marks its output so that no telemetry from a capped run can be read
  // as full Super's. Note that its latency targets come from inside its own
  // config block: the default path is not given any target to fit.
  let sampleCap: number | null = null;
  let adaptiveBudgetApplied = false;
  let estimated = fullSuper;
  if (adaptiveBudget?.enabled && adaptiveBudget.budgets.length > 0) {
    const targets = adaptiveBudget.targets;
    const scaled = adaptiveBudget.budgets.map((budget) => ({
      sampleCap: budget.sampleCap,
      p50: Math.round(budget.p50Ms * ratio),
      p95: Math.round(budget.p95Ms * ratio),
    }));
    // Largest first, so the first that fits is the most search this device can
    // do inside the targets. `null` (the full schedule) sorts largest.
    const largestFirst = [...scaled].sort(
      (first, second) => (second.sampleCap ?? Infinity) - (first.sampleCap ?? Infinity),
    );
    const affordable = largestFirst.find(
      (budget) => budget.p50 <= targets.p50Ms && budget.p95 <= targets.p95Ms,
    );
    if (affordable && affordable.sampleCap !== null) {
      sampleCap = affordable.sampleCap;
      adaptiveBudgetApplied = true;
      estimated = { p50: affordable.p50, p95: affordable.p95 };
    }
  }

  const band =
    tiers.find(
      (candidate) =>
        candidate.maxEstimatedMoveMs === null || estimated.p50 <= candidate.maxEstimatedMoveMs,
    ) ?? tiers[tiers.length - 1]!;

  return {
    benchmark: result.benchmark,
    nodesPerSec: Math.round(result.nodesPerSec),
    elapsedMs: Math.round(result.elapsedMs),
    capBound: result.capBound,
    estimatedMoveMs: estimated,
    tier: band.tier,
    sampleCap,
    adaptiveBudgetApplied,
    warnAboutWait: estimated.p50 >= warnAboveMs,
  };
}

function readStored(benchmark: string): DeviceCalibration | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeviceCalibration;
    // A stored result from a DIFFERENT benchmark measures different work and is
    // not comparable. Dropped rather than reused.
    if (parsed?.benchmark !== benchmark) return null;
    if (typeof parsed.nodesPerSec !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function store(calibration: DeviceCalibration): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(calibration));
  } catch {
    // Never a reason to refuse a game.
  }
}

/**
 * This device's calibration, measuring it if necessary.
 *
 * `force` re-measures even when a stored result exists — for a diagnostics
 * screen, and for the benchmark harness that collects Champion device numbers.
 *
 * The TIER is always recomputed against the CURRENT config even when the
 * throughput comes from storage: the thresholds are served, so moving one has
 * to re-tier every device that already measured itself, without asking any of
 * them to measure again.
 */
export async function deviceCalibration(
  config: SuperConfig,
  options: { force?: boolean } = {},
): Promise<DeviceCalibration> {
  const benchmark = config.calibration.benchmark;
  if (!options.force) {
    memory ??= readStored(benchmark);
    if (memory && memory.benchmark === benchmark) {
      const retiered: DeviceCalibration = {
        ...memory,
        ...classify(
          {
            mode: "calibrate",
            benchmark: memory.benchmark,
            nodes: 0,
            elapsedMs: memory.elapsedMs,
            nodesPerSec: memory.nodesPerSec,
            moves: 0,
            capBound: memory.capBound,
          },
          config,
        ),
      };
      memory = retiered;
      return retiered;
    }
  }

  if (!isSuperEngineSupported()) {
    throw new Error("This browser cannot run the local engine.");
  }

  inFlight ??= (async () => {
    const result = await calibrate();
    const calibration: DeviceCalibration = {
      ...classify(result, config),
      measuredAt: Date.now(),
      agent: describeAgent(),
    };
    memory = calibration;
    store(calibration);
    return calibration;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** The last calibration this tab knows about, without measuring. `null` when
 *  the device has never been measured. */
export function knownCalibration(): DeviceCalibration | null {
  return memory;
}

export function resetCalibrationForTests(): void {
  memory = null;
  inFlight = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // As above.
  }
}
