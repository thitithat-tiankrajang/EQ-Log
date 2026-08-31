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
import {
  ClientSuperIllegalMove,
  ClientSuperUnavailable,
  ClientSuperValidationUnreachable,
  runClientSuper,
  shouldFallBackToBackend,
  type SuperPin,
} from "./bot/clientSuper";
import * as superTelemetry from "./bot/superTelemetry";
import { LocalAnalysisUnavailable, runLocalAnalysis } from "./bot/localAnalysis";
import { initialize as initializeSuperEngine } from "./bot/superEngine";
import type { GameState, Side } from "./game";
import * as engineDebug from "./engineDebug";
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
  /**
   * This work is running in THIS TAB's worker, not on the service.
   *
   * Two things read it. Cancelling has to put the engine back — stopping a local
   * search means terminating the worker, and the bot will want it back within
   * seconds. And nothing should ask the service to cancel a job it never
   * started.
   */
  local?: boolean;
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
 * A session whose VIEW of the server was lost, as opposed to one that finished or
 * was refused.
 *
 * The distinction matters because discovery skips any key it already holds, and a
 * settled session is held forever. A search the server refused (`stale_revision`,
 * `budget_exhausted`, `analysis_not_allowed`) must stay refused — re-attaching
 * would loop. But `offline` says only that this tab stopped watching: the job is
 * very likely still running, and the message the player is shown promises exactly
 * this reconnection. Without reclaiming, that promise cannot be kept, because the
 * tombstone makes the running job permanently invisible to `GET /jobs`.
 */
function isLostView(status: EngineSessionStatus): boolean {
  return status.kind === "failed" && status.code === "offline";
}

/**
 * What this tab was watching when it was last destroyed, in a `reconnecting`
 * shape carrying the last percentage it saw.
 *
 * Describes nothing the server has confirmed. `adoptHints` is what acts on it,
 * and the attach that follows is what makes it real or throws it away.
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

/**
 * Rejoin, from storage alone, whatever this tab was watching before it died.
 *
 * The bug this replaces: a hint used to be *decoration*. It was read, handed to
 * `discover`, and then sat unused until `GET /jobs` came back — so for the whole
 * of that round trip `analysisFor` answered "nothing is running" and the player,
 * who had watched a bar reach 60% a second earlier, got the Analyze button back.
 * The percentage was in hand the entire time and nothing was allowed to draw it.
 *
 * What makes rejoining directly safe is that a hint records the LEVEL, which is
 * the one part of a job's identity the game row cannot supply and the only reason
 * discovery had to exist. With it, the round trip is not needed: attach IS the
 * confirmation. A job the server has replays its real progress; one it does not
 * have comes back `idle` and the session is dropped. Same authority, one less
 * round trip, and a first frame that tells the truth.
 *
 * Idempotent, because `restoreHints` skips keys already live and `drop` rewrites
 * storage — so a session that has been retired is never adopted twice.
 */
export function adoptHints(roomId: string): void {
  for (const hint of restoreHints(roomId)) {
    if (hint.kind === "analysis" && hint.level) {
      void observeAnalysis({
        roomId,
        revision: hint.revision,
        level: hint.level,
        hint: hint.progress,
      });
    } else if (hint.kind === "bot") {
      void observeBot({
        roomId,
        revision: hint.revision,
        freshlyAdmitted: false,
        hint: hint.progress,
      });
    }
  }
}

// ── internals ────────────────────────────────────────────────────────────────

function update(key: string, patch: Partial<EngineSession>): void {
  const entry = live.get(key);
  if (!entry) {
    engineDebug.note("update_on_missing", { key, patch: patch.status?.kind });
    return;
  }
  if (patch.status && patch.status.kind !== entry.session.status.kind) {
    engineDebug.note("status", {
      key,
      from: entry.session.status.kind,
      to: patch.status.kind,
      ...(patch.status.kind === "failed" ? { code: patch.status.code } : {}),
    });
  }
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
  if (existing) {
    engineDebug.note("begin_deduped", { key: session.key, status: existing.session.status.kind });
    return existing;
  }
  engineDebug.note("begin", { key: session.key, status: session.status.kind });

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
export type LocalSuperContext = {
  /** The position to search, as this tab holds it. Read once, at the moment the
   *  turn starts, so a later render cannot change what the engine was asked. */
  game: GameState;
  /** The engine and weights versions this GAME is pinned to. */
  pin: SuperPin;
};

export function observeBot(options: {
  roomId: string;
  revision: number;
  /** True when this position was just admitted by the server, so no earlier job
   *  for it can exist and the discovery round trip can be skipped. */
  freshlyAdmitted: boolean;
  /** Last percentage this tab saw, so the bar does not blink while attaching. */
  hint?: EngineProgress | null;
  /**
   * Present when this room may compute the move on the DEVICE.
   *
   * The choice of engine lives here rather than in the caller because a session
   * is "the bot's search for this position", and where that search runs is an
   * implementation detail of it. Putting the branch here also puts the FALLBACK
   * here: a local failure continues into the backend path inside the same
   * session, so the UI sees one search that took a while, not one that failed
   * and a second that started.
   */
  local?: LocalSuperContext;
}): Promise<EngineSession> {
  const key = botKey(options.roomId, options.revision);
  // A freshly admitted position is brand new, so no hint can describe it.
  const hint = options.freshlyAdmitted ? null : (options.hint ?? null);
  const entry = begin(
    {
      key,
      kind: "bot",
      roomId: options.roomId,
      revision: options.revision,
      status: options.freshlyAdmitted
        ? { kind: "requesting" }
        : { kind: "reconnecting", progress: hint },
      progress: hint,
    },
    (controller) =>
      (async (): Promise<EngineSession> => {
        const lifecycle = { ...lifecycleFor(key), signal: controller.signal };

        if (options.local) {
          const local = options.local;
          try {
            // No `queued` state: there is no queue. The device starts searching
            // the moment it is asked, which is the entire point.
            engineTrace.mark(key, "engine_start");
            update(key, { status: { kind: "running", progress: get(key)?.progress ?? null } });
            const decision = await runClientSuper({
              game: local.game,
              roomId: options.roomId,
              revision: options.revision,
              pin: local.pin,
              onProgress: (progress) => {
                if (!get(key)?.progress) engineTrace.mark(key, "first_progress");
                update(key, { status: { kind: "running", progress }, progress });
              },
              signal: controller.signal,
            });
            superTelemetry.record({
              engineVersion: decision.telemetry.engineVersion,
              weightsVersion: decision.telemetry.weightsVersion,
              weightsApplied: decision.telemetry.weightsApplied,
              tier: decision.telemetry.tier,
              sampleCap: decision.telemetry.sampleCap,
              adaptiveBudgetApplied: decision.telemetry.adaptiveBudgetApplied,
              wallMs: decision.telemetry.wallMs,
              engineMs: decision.telemetry.engineMs,
              validationMs: decision.telemetry.validationMs,
              nodes: decision.telemetry.nodes,
              samples: decision.telemetry.samples,
              boardTiles: local.game.board.reduce(
                (total, row) => total + row.filter(Boolean).length,
                0,
              ),
            });
            update(key, { status: { kind: "completed" }, result: decision.result });
            engineTrace.end(key, "result");
            return get(key)!;
          } catch (failure) {
            // A cancellation is not a failure to route around: the position is
            // gone and nobody wants this answer from any engine.
            if (controller.signal.aborted) return settleFailed(key, failure);
            if (!shouldFallBackToBackend(failure)) return settleFailed(key, failure);
            engineDebug.note("client_super_fallback", {
              key,
              reason:
                failure instanceof ClientSuperUnavailable
                  ? failure.reason
                  : failure instanceof ClientSuperIllegalMove
                    ? "illegal_move"
                    : failure instanceof ClientSuperValidationUnreachable
                      ? "validation_unreachable"
                      : "engine_failure",
            });
            // Fall through to the backend engine. It was deliberately left in
            // place for exactly this, and a Champion whose device could not
            // finish should get a slower move rather than none.
          }
        }

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

/**
 * What the device needs in order to analyse the turn itself.
 *
 * Present only for the level that runs locally, and only when the shell has a
 * position to hand over. Absent means "ask the service", which is what every
 * other level does and what this one falls back to.
 */
export type LocalAnalysisContext = {
  /** The position as this tab holds it, read once by the caller. */
  game: GameState;
  /** The side on move — the human's. The caller has already refused the bot's. */
  side: Side;
  turnNumber: number;
  pin: { engineVersion?: string; weightsVersion?: string };
};

export function startAnalysis(options: {
  roomId: string;
  revision: number;
  level: AnalysisLevel;
  /**
   * Run this one on the device instead of the service.
   *
   * The same shape of choice `observeBot` makes for a Super turn, and for the
   * same reason: the backend runs one single-threaded process per request, and
   * the browser can put every core on the identical schedule. A local failure
   * continues into the service inside this same session, so the player sees one
   * analysis either way.
   */
  local?: LocalAnalysisContext;
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
        if (options.local) {
          const local = options.local;
          try {
            // No queue and no `queued` state: the device starts the moment it
            // is asked, which is the entire point of moving this level here.
            engineTrace.mark(key, "engine_start");
            update(key, {
              local: true,
              status: { kind: "running", progress: get(key)?.progress ?? null },
            });
            const result = await runLocalAnalysis({
              game: local.game,
              side: local.side,
              roomId: options.roomId,
              revision: options.revision,
              turnNumber: local.turnNumber,
              pin: local.pin,
              onProgress: (progress) => {
                if (!get(key)?.progress) engineTrace.mark(key, "first_progress");
                update(key, { status: { kind: "running", progress }, progress });
              },
              signal: controller.signal,
            });
            update(key, { status: { kind: "completed" }, result });
            engineTrace.end(key, "result");
            return get(key)!;
          } catch (failure) {
            // Cancelling is not a failure to route around: the player asked for
            // this to stop, and starting it again on the server is the opposite
            // of what they asked for.
            if (controller.signal.aborted) return settleFailed(key, failure);
            engineDebug.note("local_analysis_fallback", {
              key,
              reason:
                failure instanceof LocalAnalysisUnavailable ? failure.reason : "engine_failure",
            });
            // Fall through to the service. A device that cannot finish should
            // get a slower analysis, not none — and from here on this session is
            // the service's, so cancelling it must reach the service.
            update(key, { local: false });
          }
        }

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
export async function discover(options: { roomId: string; revision: number }): Promise<void> {
  if (!isEngineApiConfigured) return;
  // Synchronously, and BEFORE the round trip below — that ordering is the whole
  // point. Anything this tab was already watching is rejoined from storage on
  // this tick, so the very next render has a number to draw; the round trip is
  // left to find only what storage could not know about (a job started in
  // another tab, or on a device that has never seen this game).
  adoptHints(options.roomId);
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

async function runDiscovery(options: { roomId: string; revision: number }): Promise<void> {
  let jobs;
  try {
    jobs = await listJobs({ gameId: options.roomId, revision: options.revision });
    engineDebug.note("listJobs", {
      revision: options.revision,
      jobs: jobs.map((job) => `${job.kind}:${job.level ?? "-"}:${job.status}`),
    });
  } catch (failure) {
    // Discovery is an optimisation over "ask again later". A failure here must
    // never destroy a session this tab is already watching.
    engineDebug.note("listJobs_failed", {
      revision: options.revision,
      code: failure instanceof EngineApiError ? failure.code : "unknown",
    });
    return;
  }

  // The server says this work exists. A session this tab merely lost sight of is
  // therefore stale evidence, and holding it would make the running job
  // unreachable: everything below skips a key it already has.
  const reclaim = (key: string): boolean => {
    const existing = live.get(key);
    if (!existing) return true;
    if (!isLostView(existing.session.status)) return false;
    drop(key);
    return true;
  };

  for (const job of jobs) {
    if (job.kind === "analysis" && job.level) {
      const key = analysisKey(options.roomId, options.revision, job.level);
      if (!reclaim(key)) continue;
      void observeAnalysis({
        roomId: options.roomId,
        revision: options.revision,
        level: job.level,
        hint: job.progress ?? null,
      });
    }
    if (job.kind === "bot") {
      const key = botKey(options.roomId, options.revision);
      if (!reclaim(key)) continue;
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
  // Guarded, not just no-op'd: building a stack trace is far too expensive to
  // pay for on every drop when the probe is off.
  if (engineDebug.isEngineDebugging) {
    engineDebug.note("drop", {
      key,
      status: entry.session.status.kind,
      // Who asked. The whole question is which caller retires a live session.
      by: new Error().stack?.split("\n")[2]?.trim().slice(0, 120),
    });
  }
  entry.controller.abort();
  live.delete(key);
  persist(entry.session.roomId);
  changed();
}

/** The player pressed cancel. Tell the server to stop, then forget it. */
export function cancel(key: string): void {
  const entry = live.get(key);
  if (!entry) return;
  const { kind, roomId, revision, level, local } = entry.session;
  drop(key);
  if (local) {
    // Stopping a local search means TERMINATING the worker: nothing else can
    // interrupt a synchronous call inside WASM. Put it back straight away, in
    // the background, rather than at the head of the bot's next turn — which is
    // exactly where the player would otherwise pay for the module download and
    // its instantiation, having just asked to get on with the game.
    initializeSuperEngine();
    return;
  }
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
  if (engineDebug.isEngineDebugging) {
    engineDebug.note("dropStale", {
      currentRevision,
      holding: forRoom(roomId).map((session) => `${session.key}=${session.status.kind}`),
    });
  }
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
