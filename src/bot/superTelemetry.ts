// ── What the device actually did, move by move ───────────────────────────────
//
// The acceptance criteria for client-side Super are latency percentiles on REAL
// devices, and there is exactly one way to get those: record every move a real
// device makes. A benchmark run on a developer's laptop answers a different
// question — it says what an M3 does, not what a Champion's five-year-old
// Windows laptop does over a whole game while a browser throttles a background
// tab.
//
// So every client-side Super move writes one row here. The rows are small,
// bounded, and local to the device until somebody exports them.
//
// Deliberately NOT sent anywhere automatically. Uploading per-move telemetry is
// a decision about players' data that a performance investigation does not get
// to make on its own; `exportRows()` gives a Champion a file to hand over, and
// that is enough to build the report.
//
// Nothing in here identifies a game, a player, or a position: a row is a
// duration, a count and a device tier.

export type SuperMoveRecord = {
  at: number;
  engineVersion: string;
  weightsVersion: string;
  weightsApplied: number;
  tier: string;
  sampleCap: number | null;
  /** True when the experimental adaptive budget reduced this search. A row
   *  with this set is NOT a measurement of full Super and must never be
   *  averaged into one. */
  adaptiveBudgetApplied: boolean;
  /** What the player waited for the search itself. */
  wallMs: number;
  /** The engine's own clock. `wallMs - engineMs` is the WASM boundary's cost. */
  engineMs: number;
  /** The server round trip for the legality check. */
  validationMs: number;
  nodes: number;
  samples: number;
  /** Tiles on the board when the search started — the phase signal a latency
   *  number is meaningless without. An opening position is the widest search a
   *  game contains and an endgame is among the narrowest, so a p50 that does
   *  not say which is which says nothing. */
  boardTiles: number;
};

/**
 * How many moves are kept.
 *
 * Two full games' worth. Enough for a p95 that means something, small enough
 * that the whole log is a few kilobytes and a device that plays for a month
 * does not accumulate a database.
 */
const MAX_ROWS = 60;
const STORAGE_KEY = "eq-lab:super-telemetry:v1";

let rows: SuperMoveRecord[] | null = null;

function load(): SuperMoveRecord[] {
  if (rows) return rows;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    rows = raw ? (JSON.parse(raw) as SuperMoveRecord[]) : [];
    if (!Array.isArray(rows)) rows = [];
  } catch {
    rows = [];
  }
  return rows;
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows ?? []));
  } catch {
    // Storage is where this is kept, not what it is for. A device that cannot
    // store it still played the move.
  }
}

export function record(row: Omit<SuperMoveRecord, "at">): void {
  const all = load();
  all.push({ ...row, at: Date.now() });
  if (all.length > MAX_ROWS) all.splice(0, all.length - MAX_ROWS);
  save();
}

export function rowsSoFar(): SuperMoveRecord[] {
  return [...load()];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]!;
}

/**
 * This device's Super latency, as measured rather than estimated.
 *
 * `n` is reported alongside because a p95 over four moves is not a p95, and a
 * summary that hides its sample size invites exactly that reading.
 */
export function latencySummary(): { n: number; p50: number; p95: number; max: number } {
  const wall = load().map((row) => row.wallMs);
  return {
    n: wall.length,
    p50: percentile(wall, 0.5),
    p95: percentile(wall, 0.95),
    max: wall.length > 0 ? Math.max(...wall) : 0,
  };
}

/** Everything this device has recorded, as a JSON document a Champion can send
 *  back. Includes the device's own description so a row can be attributed to a
 *  machine without identifying a person. */
export function exportRows(): string {
  const navigatorLike = navigator as Navigator & { deviceMemory?: number };
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      device: {
        userAgent: navigator.userAgent,
        cores: navigator.hardwareConcurrency ?? null,
        memoryGb: navigatorLike.deviceMemory ?? null,
      },
      summary: latencySummary(),
      rows: load(),
    },
    null,
    2,
  );
}

export function clear(): void {
  rows = [];
  save();
}

/**
 * Put the export within reach of a Champion, without building a screen for it.
 *
 * The beta needs latency numbers from real devices, and a mechanism nobody can
 * reach collects nothing. This is deliberately a console handle rather than a
 * UI: the audience is a small, trusted, technical group, the data is a few
 * kilobytes of durations, and a button would be a permanent piece of product
 * built for a temporary question.
 *
 *   copy(window.eqSuperTelemetry.export())   // paste into the beta thread
 *   window.eqSuperTelemetry.summary()        // { n, p50, p95, max }
 *
 * Installed only in a room that is actually using the local engine, so it never
 * appears for a player it would mean nothing to. Remove it — and this comment —
 * when the beta ends and the question has an answer.
 */
export function installConsoleHandle(): void {
  (globalThis as Record<string, unknown>).eqSuperTelemetry = {
    export: exportRows,
    summary: latencySummary,
    rows: rowsSoFar,
    clear,
  };
}
