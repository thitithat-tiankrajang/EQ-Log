// ── Engine sessions: who is watching the server's work ───────────────────────
//
// The engine job lives on the server. This module is how THIS TAB watches one,
// and the reason it is a module rather than a hook is the whole point:
//
//   REACT COMPONENT LIFETIME ≠ ENGINE JOB LIFETIME ≠ OBSERVATION LIFETIME
//
// The Play route is code-split (`AppRoot`), so leaving Play unmounts the entire
// gameplay tree. When the SSE connection was owned by a component, that unmount
// closed it, and every returning mount had to rediscover, re-attach, and repaint
// from whatever a side cache happened to remember. The bar went back to nothing,
// because the thing that knew the number had been destroyed.
//
// Here the connection is owned by the module. Navigating to the lobby and back
// costs nothing: the stream was never closed, progress kept arriving, and the
// remounted component reads the current value on its first render.
//
// Three rules this module holds to:
//
//   1. **It observes; it never decides.** The server's JobRegistry owns whether
//      a job exists, whether it is deduplicated, when it dies. Nothing here is a
//      second opinion about that — a session is a *view* of a server job, and
//      when the two disagree the server wins.
//   2. **It is a projection source, not a source of truth.** React subscribes
//      and renders. `sessionStorage` is a paint hint for the one case the server
//      cannot cover on the first frame — a reload, where the answer is one round
//      trip away and a blank bar would be a lie.
//   3. **Losing it costs a round trip, never correctness.** Every session is
//      rediscoverable from `GET /jobs`, so a cleared cache, a second tab, or a
//      throttled background page all degrade to "ask the server again".

import {
  EngineApiError,
  attachAnalysis,
  attachBotMove,
  cancelAnalysis,
  isEngineApiConfigured,
  listJobs,
  requestAnalysis,
  requestBotMove,
  type AnalysisLevel,
  type AnalysisResult,
  type BotMoveResult,
  type EngineProgress,
  type EngineQueueState,
} from "./bot/engineApi";
import * as engineTrace from "./engineTrace";

/**
 * What a session is doing, in the server's terms rather than the renderer's.
 *
 * `reconnecting` is deliberately distinct from `requesting`: one means "work
 * exists and we are re-establishing the view of it", the other means "we are
 * asking for work to begin". Collapsing them is what made a returning player see
 * a fresh start where there was none.
 */
export type EngineSessionStatus =
  | { kind: "requesting" }
  | { kind: "reconnecting"; progress: EngineProgress | null }
  | { kind: "queued"; position: number | null }
  | { kind: "running"; progress: EngineProgress | null }
  | { kind: "completed" }
  | { kind: "failed"; code: EngineApiError["code"]; message: string };

export type EngineSessionKind = "bot" | "analysis";

export type EngineSession = {
  key: string;
  kind: EngineSessionKind;
  roomId: string;
  revision: number;
  /** Analysis only. The one part of a job's identity the game row cannot supply. */
  level?: AnalysisLevel;
  status: EngineSessionStatus;
  /** The last progress the server reported, kept across status changes so a
   *  reconnect never has to fall back to nothing. */
  progress: EngineProgress | null;
  result?: BotMoveResult | AnalysisResult;
  startedAt: number;
  updatedAt: number;
};

type Live = {
  session: EngineSession;
  controller: AbortController;
  /** Resolves when the observation settles, so a caller can await the outcome
   *  without owning the observation. */
  promise: Promise<EngineSession>;
};

const live = new Map<string, Live>();
const listeners = new Set<() => void>();
const STORAGE_PREFIX = "eq-lab:engine-session:v1:";

/** Bumped on every change. React's `useSyncExternalStore` needs a snapshot that
 *  is referentially stable between changes, and a version counter gives that
 *  without copying the map. */
let version = 0;

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVersion(): number {
  return version;
}

export function botKey(roomId: string, revision: number): string {
  return `bot:${roomId}:${revision}`;
}

export function analysisKey(roomId: string, revision: number, level: AnalysisLevel): string {
  return `analysis:${roomId}:${revision}:${level}`;
}

export function get(key: string): EngineSession | undefined {
  return live.get(key)?.session;
}

/** Every session this tab is watching for one room, newest first. */
export function forRoom(roomId: string): EngineSession[] {
  return [...live.values()]
    .map((entry) => entry.session)
    .filter((session) => session.roomId === roomId)
    .sort((first, second) => second.startedAt - first.startedAt);
}

/** The analysis session for a position, whatever level it was started at. The
 *  caller does not have to know the level — that is the point of discovery. */
export function analysisFor(roomId: string, revision: number): EngineSession | undefined {
  return forRoom(roomId).find(
    (session) => session.kind === "analysis" && session.revision === revision,
  );
}

export function botFor(roomId: string, revision: number): EngineSession | undefined {
  return live.get(botKey(roomId, revision))?.session;
}

// ── persistence ──────────────────────────────────────────────────────────────
//
// A reload destroys the module, and the server is one round trip away. Mirroring
// the last status means the first frame after a refresh shows the real number
// instead of a bar at nothing. It is never read as authority: `discover()`
// overwrites it, and anything it describes that the server does not confirm is
// dropped.

type StoredSession = Pick<
  EngineSession,
  "key" | "kind" | "roomId" | "revision" | "level" | "progress" | "startedAt"
>;

function storageKey(roomId: string): string {
  return `${STORAGE_PREFIX}${roomId}`;
}

function persist(roomId: string): void {
  try {
    const open = forRoom(roomId)
      .filter((session) => isPending(session.status))
      .map<StoredSession>((session) => ({
        key: session.key,
        kind: session.kind,
        roomId: session.roomId,
        revision: session.revision,
        ...(session.level ? { level: session.level } : {}),
        progress: session.progress,
        startedAt: session.startedAt,
      }));
    if (open.length === 0) window.sessionStorage.removeItem(storageKey(roomId));
    else window.sessionStorage.setItem(storageKey(roomId), JSON.stringify(open));
  } catch {
    // Storage unavailable (private browsing, quota). Costs a round trip on the
    // next reload and nothing else.
  }
}

function isPending(status: EngineSessionStatus): boolean {
  return status.kind !== "completed" && status.kind !== "failed";
}

/**
 * Paint hints for a room, read straight after a reload.
 *
 * Returns sessions in a `reconnecting` shape carrying the last percentage this
 * tab saw. They describe nothing the server has confirmed yet — `discover()` is
 * what makes them real, and anything it does not confirm is dropped.
 */
export function restoreHints(roomId: string): EngineSession[] {
  let stored: StoredSession[] = [];
  try {
    const raw = window.sessionStorage.getItem(storageKey(roomId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("not a session list");
    stored = parsed as StoredSession[];
  } catch {
    try {
      window.sessionStorage.removeItem(storageKey(roomId));
    } catch {
      // nothing else to clear
    }
    return [];
  }

  const hints: EngineSession[] = [];
  for (const entry of stored) {
    if (typeof entry?.key !== "string" || !Number.isInteger(entry.revision)) continue;
    if (entry.kind !== "bot" && entry.kind !== "analysis") continue;
    if (live.has(entry.key)) continue;
    hints.push({
      key: entry.key,
      kind: entry.kind,
      roomId,
      revision: entry.revision,
      ...(entry.level ? { level: entry.level } : {}),
      status: { kind: "reconnecting", progress: entry.progress ?? null },
      progress: entry.progress ?? null,
      startedAt: entry.startedAt ?? Date.now(),
      updatedAt: Date.now(),
    });
  }
  return hints;
}

// ── internals ────────────────────────────────────────────────────────────────

function update(key: string, patch: Partial<EngineSession>): void {
  const entry = live.get(key);
  if (!entry) return;
  entry.session = { ...entry.session, ...patch, updatedAt: Date.now() };
  persist(entry.session.roomId);
  changed();
}

/** Lifecycle callbacks shared by every start and every attach, so a job this tab
 *  rejoined reports exactly as one it launched. */
function lifecycleFor(key: string) {
  return {
    onQueued: (state: EngineQueueState) =>
      (engineTrace.mark(key, "queued"),
      update(key, {
        status: { kind: "queued", position: state.position > 0 ? state.position : null },
      })),
    onRunning: () =>
      // Keep the last percentage rather than dropping to nothing: `running` with
      // no report yet is not the same as `running` at zero, and the server will
      // replay a real number in a moment.
      (engineTrace.mark(key, "engine_start"),
      update(key, { status: { kind: "running", progress: get(key)?.progress ?? null } })),
    onProgress: (progress: EngineProgress) => {
      if (!get(key)?.progress) engineTrace.mark(key, "first_progress");
      update(key, { status: { kind: "running", progress }, progress });
    },
  };
}

function begin(
  session: Omit<EngineSession, "startedAt" | "updatedAt">,
  run: (controller: AbortController) => Promise<EngineSession>,
): Live {
  const existing = live.get(session.key);
  if (existing) return existing;

  const controller = new AbortController();
  const now = Date.now();
  const entry: Live = {
    session: { ...session, startedAt: now, updatedAt: now },
    controller,
    promise: undefined as unknown as Promise<EngineSession>,
  };
  live.set(session.key, entry);
  engineTrace.begin(session.key, `${session.kind} r${session.revision}`);
  entry.promise = run(controller);
  persist(session.roomId);
  changed();
  return entry;
}

function settleFailed(key: string, failure: unknown): EngineSession {
  engineTrace.end(key, "failed");
  const error =
    failure instanceof EngineApiError
      ? failure
      : new EngineApiError("internal", "The engine request failed.");
  update(key, { status: { kind: "failed", code: error.code, message: error.message } });
  return get(key)!;
}

// ── bot ──────────────────────────────────────────────────────────────────────

/**
 * Watch the bot's search for one authoritative position, starting it if the
 * server has none.
 *
 * `alreadyDiscovered` is the round-trip saving requirement: on a turn the client
 * has just watched the server admit, there provably cannot be an older job for
 * that brand-new revision, so the attach-then-post dance is one wasted request.
 * Pass `true` and the POST goes out first. The POST is not thereby less safe —
 * the registry deduplicates by key, so a racing second caller still joins the
 * one search rather than starting another.
 */
export function observeBot(options: {
  roomId: string;
  revision: number;
  /** True when this position was just admitted by the server, so no earlier job
   *  for it can exist and the discovery round trip can be skipped. */
  freshlyAdmitted: boolean;
}): Promise<EngineSession> {
  const key = botKey(options.roomId, options.revision);
  const entry = begin(
    {
      key,
      kind: "bot",
      roomId: options.roomId,
      revision: options.revision,
      status: { kind: options.freshlyAdmitted ? "requesting" : "reconnecting", progress: null },
      progress: null,
    },
    (controller) =>
      (async (): Promise<EngineSession> => {
        const lifecycle = { ...lifecycleFor(key), signal: controller.signal };
        try {
          if (!options.freshlyAdmitted) {
            const attached = await attachBotMove({
              gameId: options.roomId,
              expectedRevision: options.revision,
              ...lifecycle,
            });
            if (attached.kind === "result") {
              update(key, { status: { kind: "completed" }, result: attached.result });
              engineTrace.end(key, "result");
              return get(key)!;
            }
            update(key, { status: { kind: "requesting" } });
          }
          const started = await requestBotMove({
            gameId: options.roomId,
            expectedRevision: options.revision,
            traceKey: key,
            ...lifecycle,
          });
          update(key, { status: { kind: "completed" }, result: started });
          engineTrace.end(key, "result");
          return get(key)!;
        } catch (failure) {
          return settleFailed(key, failure);
        }
      })(),
  );
  return entry.promise;
}

// ── analysis ─────────────────────────────────────────────────────────────────

export function startAnalysis(options: {
  roomId: string;
  revision: number;
  level: AnalysisLevel;
}): Promise<EngineSession> {
  const key = analysisKey(options.roomId, options.revision, options.level);
  const entry = begin(
    {
      key,
      kind: "analysis",
      roomId: options.roomId,
      revision: options.revision,
      level: options.level,
      status: { kind: "requesting" },
      progress: null,
    },
    (controller) =>
      (async (): Promise<EngineSession> => {
        try {
          const result = await requestAnalysis({
            gameId: options.roomId,
            expectedRevision: options.revision,
            level: options.level,
            traceKey: key,
            ...lifecycleFor(key),
            signal: controller.signal,
          });
          update(key, { status: { kind: "completed" }, result });
          engineTrace.end(key, "result");
          return get(key)!;
        } catch (failure) {
          // A broken stream is not proof the POST failed. It may well have
          // reached the server and started a search before the connection went
          // away, and reporting that as a failure would ask the player to pay
          // for the same position twice. Ask the server what actually happened.
          if (failure instanceof EngineApiError && failure.code === "offline") {
            update(key, { status: { kind: "reconnecting", progress: get(key)?.progress ?? null } });
            try {
              const attached = await attachAnalysis({
                gameId: options.roomId,
                expectedRevision: options.revision,
                level: options.level,
                ...lifecycleFor(key),
                signal: controller.signal,
              });
              if (attached.kind === "result") {
                update(key, { status: { kind: "completed" }, result: attached.result });
                return get(key)!;
              }
            } catch {
              // Still unreachable. Fall through and report the original loss;
              // the next discovery pass will find the job if it exists.
            }
          }
          return settleFailed(key, failure);
        }
      })(),
  );
  return entry.promise;
}

/** Rejoin an analysis the server already has. Starts nothing and spends no
 *  budget; a server that has no such job settles the session as `failed` with
 *  the reason, and the panel falls back to offering a fresh one. */
export function observeAnalysis(options: {
  roomId: string;
  revision: number;
  level: AnalysisLevel;
  /** Last percentage this tab saw, so the bar does not blink while attaching. */
  hint?: EngineProgress | null;
}): Promise<EngineSession> {
  const key = analysisKey(options.roomId, options.revision, options.level);
  const entry = begin(
    {
      key,
      kind: "analysis",
      roomId: options.roomId,
      revision: options.revision,
      level: options.level,
      status: { kind: "reconnecting", progress: options.hint ?? null },
      progress: options.hint ?? null,
    },
    (controller) =>
      (async (): Promise<EngineSession> => {
        try {
          const attached = await attachAnalysis({
            gameId: options.roomId,
            expectedRevision: options.revision,
            level: options.level,
            ...lifecycleFor(key),
            signal: controller.signal,
          });
          if (attached.kind === "idle") {
            // The server has nothing. Not an error — the job finished and aged
            // out, or never started. Drop the session so the panel offers a new
            // one instead of showing a search that does not exist.
            drop(key);
            return { ...(get(key) ?? ({} as EngineSession)) };
          }
          update(key, { status: { kind: "completed" }, result: attached.result });
          return get(key)!;
        } catch (failure) {
          return settleFailed(key, failure);
        }
      })(),
  );
  return entry.promise;
}

/**
 * Ask the server what exists for this position and watch all of it.
 *
 * This is what makes recovery server-authoritative. It needs no local pointer,
 * so it works identically after a navigation, a reload, in a second tab, and on
 * a device that has never seen this game — the cases that previously ranged from
 * "loses the percentage" to "the running analysis is unreachable forever".
 */
export async function discover(options: {
  roomId: string;
  revision: number;
  /** Paint hints from `restoreHints`, matched onto whatever the server confirms. */
  hints?: EngineSession[];
}): Promise<void> {
  if (!isEngineApiConfigured) return;
  // Several places legitimately ask at once — the Play shell on mount, the
  // analysis panel, a wake. They are asking the same question about the same
  // position, so they share one answer rather than one round trip each.
  const inFlightKey = `${options.roomId}:${options.revision}`;
  const running = discoveries.get(inFlightKey);
  if (running) return running;
  const attempt = runDiscovery(options).finally(() => discoveries.delete(inFlightKey));
  discoveries.set(inFlightKey, attempt);
  return attempt;
}

const discoveries = new Map<string, Promise<void>>();

async function runDiscovery(options: {
  roomId: string;
  revision: number;
  hints?: EngineSession[];
}): Promise<void> {
  let jobs;
  try {
    jobs = await listJobs({ gameId: options.roomId, revision: options.revision });
  } catch {
    // Discovery is an optimisation over "ask again later". A failure here must
    // never destroy a session this tab is already watching.
    return;
  }

  const hintFor = (kind: EngineSessionKind, level?: string) =>
    options.hints?.find((hint) => hint.kind === kind && (level === undefined || hint.level === level))
      ?.progress ?? null;

  for (const job of jobs) {
    if (job.kind === "analysis" && job.level) {
      const key = analysisKey(options.roomId, options.revision, job.level);
      if (live.has(key)) continue;
      void observeAnalysis({
        roomId: options.roomId,
        revision: options.revision,
        level: job.level,
        // The server's own number when it has one, this tab's last otherwise.
        hint: job.progress ?? hintFor("analysis", job.level),
      });
    }
    if (job.kind === "bot") {
      const key = botKey(options.roomId, options.revision);
      if (live.has(key)) continue;
      const session = observeBot({
        roomId: options.roomId,
        revision: options.revision,
        freshlyAdmitted: false,
      });
      void session;
      if (job.progress) update(key, { progress: job.progress, status: { kind: "running", progress: job.progress } });
    }
  }
}

// ── lifecycle ────────────────────────────────────────────────────────────────

/**
 * Stop watching and forget a session. Does NOT cancel the server's job — that is
 * `cancel()`, and the difference is the whole design: looking away is not the
 * same as calling work off.
 */
export function drop(key: string): void {
  const entry = live.get(key);
  if (!entry) return;
  entry.controller.abort();
  live.delete(key);
  persist(entry.session.roomId);
  changed();
}

/** The player pressed cancel. Tell the server to stop, then forget it. */
export function cancel(key: string): void {
  const entry = live.get(key);
  if (!entry) return;
  const { kind, roomId, revision, level } = entry.session;
  drop(key);
  if (kind === "analysis" && level) {
    void cancelAnalysis({ gameId: roomId, expectedRevision: revision, level });
  }
}

/**
 * Forget everything this tab watches for a room at a revision the game has left.
 *
 * Called when the position advances. Note what it does NOT do: it never cancels,
 * because another observer may still want the answer, and it is keyed on the
 * revision rather than on any component's idea of relevance — a session survives
 * every unmount and every navigation, and only a real change of position ends it.
 */
export function dropStale(roomId: string, currentRevision: number): void {
  for (const session of forRoom(roomId)) {
    if (session.revision !== currentRevision) drop(session.key);
  }
}

/** Test seam. Never called by the app. */
export function resetForTests(): void {
  for (const entry of live.values()) entry.controller.abort();
  live.clear();
  discoveries.clear();
  version = 0;
  listeners.clear();
}
