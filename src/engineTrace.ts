// ── Where the time before a search goes ──────────────────────────────────────
//
// "The bot feels slow" is not a number, and the stages it could be blaming are
// on both sides of a network boundary. This turns it into a decomposition:
//
//   commit_ack     the human's move being accepted by the database — the step
//                  that MINTS the revision, and therefore the earliest moment an
//                  engine request can legally exist
//   launch         confirmed revision → engine request on the wire
//   server_auth    token verification                     (from Server-Timing)
//   server_context reading the canonical position         (from Server-Timing)
//   server_gates   turn rules, metering, admission        (from Server-Timing)
//   queued         accepted, waiting for a CPU
//   engine_start   an engine process exists
//   first_progress the engine's first real report
//   result         the answer
//   applied        the answer written back to the game
//
// Off by default and free when off: no marks, no timers, no listeners. Turn it
// on with `?enginetrace=1`, which also persists for the session so a reload or a
// navigation does not lose the run being measured.
//
// **It records durations and stage names.** No tokens, no board, no rack, no
// bag, no player identity. The room id is included because a measurement you
// cannot attribute to a game is not worth taking, and it is already in the
// address bar.

const STORAGE_KEY = "eq-lab:engine-trace";

function enabledFromEnvironment(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("enginetrace");
    if (flag === "1") {
      window.sessionStorage.setItem(STORAGE_KEY, "1");
      return true;
    }
    if (flag === "0") {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return false;
    }
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

const enabled = enabledFromEnvironment();

/** Whether tracing is on. Exported so callers can skip building a label. */
export const isEngineTracing = enabled;

type Run = {
  label: string;
  startedAt: number;
  lastAt: number;
  stages: Array<{ stage: string; ms: number; sinceStart: number }>;
};

const runs = new Map<string, Run>();

/**
 * Begin (or restart) a timed run.
 *
 * `key` is the job identity, so the stages of one bot turn stay together even
 * though they are recorded from four different places.
 */
export function begin(key: string, label: string): void {
  if (!enabled) return;
  const now = performance.now();
  runs.set(key, { label, startedAt: now, lastAt: now, stages: [] });
}

/** Record reaching a stage. Silently ignored when no run is open — a reconnect
 *  legitimately joins a turn this tab never started. */
export function mark(key: string, stage: string): void {
  if (!enabled) return;
  const run = runs.get(key);
  if (!run) return;
  const now = performance.now();
  run.stages.push({
    stage,
    ms: Math.round((now - run.lastAt) * 10) / 10,
    sinceStart: Math.round((now - run.startedAt) * 10) / 10,
  });
  run.lastAt = now;
}

/**
 * Fold the server's own decomposition in.
 *
 * `Server-Timing` carries the stages that happened before the response head was
 * written, which is exactly the part the client cannot see. Durations only.
 */
export function absorbServerTiming(key: string, header: string | null): void {
  if (!enabled || !header) return;
  const run = runs.get(key);
  if (!run) return;
  for (const entry of header.split(",")) {
    const name = /^\s*([^;]+)/.exec(entry)?.[1]?.trim();
    const duration = /dur=([0-9.]+)/.exec(entry)?.[1];
    if (!name || !duration) continue;
    run.stages.push({
      stage: `server_${name}`,
      ms: Math.round(Number(duration) * 10) / 10,
      sinceStart: run.stages.at(-1)?.sinceStart ?? 0,
    });
  }
}

/** Close a run and print its decomposition. */
export function end(key: string, outcome: string): void {
  if (!enabled) return;
  const run = runs.get(key);
  if (!run) return;
  // Marked before the run is removed; `mark` is a no-op once it is gone.
  mark(key, outcome);
  runs.delete(key);
  const total = Math.round((performance.now() - run.startedAt) * 10) / 10;
  console.groupCollapsed(`[engine-trace] ${run.label} — ${total}ms (${outcome})`);
  console.table([...run.stages, { stage: "TOTAL", ms: total, sinceStart: total }]);
  console.groupEnd();
}
