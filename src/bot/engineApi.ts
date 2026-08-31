// ── Talking to the backend engine ────────────────────────────────────────────
//
// The engine used to run in this tab. It now runs on a server, and this module
// is the whole client for it.
//
// The important consequence for callers: a request no longer carries a
// position. It carries a game id and the revision the caller believes that game
// is at. The server holds the authoritative state and refuses if the two
// disagree — so a result can never be about a board that has already moved on.
//
// ⚠ `gameId` here means the LIVE ROOM's id — `room_live.room_id`, the value the
// database calls `target_game_id` in every RPC and the value this app tracks as
// `activeRoomId`. It is NOT `GameState.gameId`, which is a client-generated
// UUID from `createNewGame` that the server has never stored and cannot look a
// room up by. The two are both UUIDs and both called "game id", which is
// exactly why this note is here: passing the wrong one is silent at the type
// level and comes back as `not_found` for every request.
//
// Every failure has a named kind, because the UI has to distinguish "try again"
// from "this is no longer your turn" from "the engine is busy", and a bare
// error string cannot carry that.

import * as engineTrace from "../engineTrace";
import { supabase } from "../supabaseClient";

export const ANALYSIS_LEVELS = ["quick", "normal", "deep", "max"] as const;
export type AnalysisLevel = (typeof ANALYSIS_LEVELS)[number];

/**
 * Opponent-rack samples each level asks for. Mirrors `ANALYSIS_LEVEL_CONFIG` in
 * the service, and it is the DENOMINATOR the result badge reports against — a
 * bare "142 samples" reads as though the level were 142 samples long, when it is
 * a 160-sample level a timeout cut short.
 */
export const ANALYSIS_LEVEL_SAMPLES: Record<AnalysisLevel, number> = {
  quick: 4,
  normal: 12,
  deep: 40,
  max: 160,
};

export type EngineErrorCode =
  | "reasoning_unavailable"
  | "unconfigured"
  | "unauthenticated"
  | "forbidden"
  | "analysis_not_allowed"
  | "not_found"
  | "stale_revision"
  | "turn_rule"
  | "bad_request"
  | "body_too_large"
  | "invalid_state"
  | "budget_exhausted"
  | "analysis_in_progress"
  | "queue_full"
  | "engine_timeout"
  | "engine_failed"
  | "analysis_unavailable"
  | "cancelled"
  | "offline"
  | "internal";

export class EngineApiError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
    readonly detail?: { currentRevision?: number; retryAfterMs?: number },
  ) {
    super(message);
    this.name = "EngineApiError";
  }
}

const BASE_URL = (import.meta.env.VITE_ENGINE_API_URL ?? "").replace(/\/+$/, "");

/** Whether a backend engine is configured. Without one there is no bot and no
 *  analysis; the app still plays human-vs-human perfectly well. */
export const isEngineApiConfigured = Boolean(BASE_URL);

async function accessToken(): Promise<string> {
  if (!supabase) {
    throw new EngineApiError("unauthenticated", "Sign-in is required to use the engine.");
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new EngineApiError("unauthenticated", "Your session has expired. Sign in again.");
  }
  return token;
}

// ── streamed requests ────────────────────────────────────────────────────────

export type EngineProgress = {
  phase: "movegen" | "sim" | "endgame";
  percent: number;
  elapsedMs: number;
  etaMs: number;
  detail: string;
};

/**
 * Where a request sits in the engine's queue, as the server reported it.
 *
 * The engine now runs on ONE server with a finite number of CPUs, so a request
 * can genuinely be accepted and then wait. `ahead` is the number of jobs the
 * server said would be served first at the moment it said so; it re-sends the
 * event whenever that changes. It is a fact about the queue, not a prediction:
 * a bot turn arriving later legitimately overtakes queued analysis, and the UI
 * must phrase it as a place in line rather than as a time.
 */
export type EngineQueueState = { ahead: number; position: number };

/** The lifecycle a long engine request goes through, as the server reports it.
 *  Every callback here corresponds to a real server-side transition; none of
 *  them is inferred from a timer on this side. */
export type EngineLifecycle = {
  /** The request was accepted but no engine process exists for it yet. May fire
   *  more than once as the queue moves. Never fires for a request that started
   *  immediately. */
  onQueued?: (state: EngineQueueState) => void;
  /** An engine process is now working on it. */
  onRunning?: () => void;
  /** The engine's own progress report. Only ever real numbers from the search. */
  onProgress?: (progress: EngineProgress) => void;
};

/**
 * Post and read a Server-Sent Events response.
 *
 * `EventSource` cannot be used: it only issues GETs and cannot carry an
 * Authorization header, and this API is authenticated. So the stream is parsed
 * off a `fetch` body directly.
 *
 * A search at full strength can run for minutes, and on a busy server it can
 * wait before it even begins. Streaming is what keeps that survivable — the
 * connection stays warm, and the player is told which of the two is happening
 * rather than watching one spinner that means both.
 */
/**
 * The result of an SSE request. `idle` is the reconnect answer for "there is no
 * job for this position" — a real, expected outcome on the GET path, never an
 * error. The POST path never returns it (a POST that could not start says so
 * with a status code), so `postStream` treats it as a lost stream.
 */
export type SseOutcome<T> = { kind: "result"; result: T } | { kind: "idle" };

/**
 * Open an SSE request and read it to a terminal event.
 *
 * `POST` starts work; `GET` reconnects to work that already exists and may
 * answer `idle`. Everything decidable before the stream opens still arrives as a
 * status code and is read here the same way on both methods; only failures after
 * the head is written arrive as an `error` event.
 */
async function runSse<T>(options: {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
  onQueued?: (state: EngineQueueState) => void;
  onRunning?: () => void;
  onProgress?: (progress: EngineProgress) => void;
  signal?: AbortSignal;
  /** Trace key, when the caller is measuring this request. Off in normal use. */
  traceKey?: string;
}): Promise<SseOutcome<T>> {
  if (!BASE_URL) {
    throw new EngineApiError("unconfigured", "The engine service is not configured.");
  }
  const token = await accessToken();

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${options.path}`, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "text/event-stream",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    if (options.signal?.aborted) {
      throw new EngineApiError("cancelled", "The request was cancelled.");
    }
    throw new EngineApiError("offline", "Could not reach the engine service.");
  }

  // Everything decidable before the search starts still comes back as a status
  // code, so those failures are read exactly as on the plain path.
  if (!response.ok || !response.body) {
    let payload: { code?: string; error?: string; currentRevision?: number; retryAfterMs?: number } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      // keep the defaults
    }
    throw new EngineApiError(
      (payload.code ?? "internal") as EngineErrorCode,
      payload.error ?? "The engine request failed.",
      {
        ...(payload.currentRevision != null ? { currentRevision: payload.currentRevision } : {}),
        ...(payload.retryAfterMs != null ? { retryAfterMs: payload.retryAfterMs } : {}),
      },
    );
  }

  if (options.traceKey) {
    // The server's own decomposition of everything that happened before this
    // head was written — the part the client cannot otherwise see.
    engineTrace.mark(options.traceKey, "head");
    engineTrace.absorbServerTiming(options.traceKey, response.headers.get("Server-Timing"));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outcome: SseOutcome<T> | undefined;
  let settled = false;

  const handleBlock = (block: string) => {
    const event = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? "message";
    const data = /^data:\s*(.+)$/m.exec(block)?.[1];
    if (!data) return;
    // Lifecycle events are advisory: they drive what the player sees, never
    // whether the request succeeds. A malformed one is dropped rather than
    // failing a search that is otherwise fine.
    if (event === "queued") {
      try {
        const state = JSON.parse(data) as Partial<EngineQueueState>;
        const ahead = Number(state.ahead);
        if (Number.isInteger(ahead) && ahead >= 0) {
          options.onQueued?.({ ahead, position: ahead + 1 });
        } else {
          // Accepted-but-waiting is still true even when the count is not
          // usable, and that is the part the player needs.
          options.onQueued?.({ ahead: -1, position: -1 });
        }
      } catch {
        options.onQueued?.({ ahead: -1, position: -1 });
      }
      return;
    }
    if (event === "running") {
      options.onRunning?.();
      return;
    }
    if (event === "progress") {
      try {
        options.onProgress?.(JSON.parse(data) as EngineProgress);
      } catch {
        // A malformed progress line is cosmetic; never fail a search over it.
      }
      return;
    }
    if (event === "result") {
      outcome = { kind: "result", result: JSON.parse(data) as T };
      settled = true;
      return;
    }
    if (event === "idle") {
      // Reconnect only: nothing is running for this position. A settled,
      // non-error verdict the caller acts on, not a failure.
      outcome = { kind: "idle" };
      settled = true;
      return;
    }
    if (event === "error") {
      const payload = JSON.parse(data) as { code?: string; error?: string };
      settled = true;
      throw new EngineApiError(
        (payload.code ?? "internal") as EngineErrorCode,
        payload.error ?? "The engine request failed.",
      );
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split = buffer.indexOf("\n\n");
      while (split >= 0) {
        handleBlock(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf("\n\n");
      }
    }
  } catch (error) {
    if (error instanceof EngineApiError) throw error;
    if (options.signal?.aborted) {
      throw new EngineApiError("cancelled", "The request was cancelled.");
    }
    throw new EngineApiError("offline", "The engine connection was lost.");
  } finally {
    void reader.cancel().catch(() => {});
  }

  if (!settled || outcome === undefined) {
    // The stream ended without a verdict. Treated as a failure rather than
    // hopefully retried: the search may or may not have run.
    throw new EngineApiError("offline", "The engine connection ended without a result.");
  }
  return outcome;
}

/** POST an SSE request that STARTS work and returns its result. The reconnect
 *  `idle` outcome cannot occur here; a POST that could not begin already failed
 *  with a status code, so seeing it means a truncated stream. */
async function postStream<T>(options: {
  path: string;
  body: Record<string, unknown>;
  onQueued?: (state: EngineQueueState) => void;
  onRunning?: () => void;
  onProgress?: (progress: EngineProgress) => void;
  signal?: AbortSignal;
  traceKey?: string;
}): Promise<T> {
  const outcome = await runSse<T>({ method: "POST", ...options });
  if (outcome.kind === "idle") {
    throw new EngineApiError("offline", "The engine connection ended without a result.");
  }
  return outcome.result;
}

// ── bot moves ────────────────────────────────────────────────────────────────

/** What the client needs to apply the bot's move. Deliberately no evaluation
 *  detail: that would describe the bot's own rack. */
export type BotMoveResult = {
  revision: number;
  gameId: string;
  side: "A" | "B";
  move: {
    type: "place" | "exchange" | "pass";
    placements: Array<{ r: number; c: number; kind: string; token: string }>;
    exchange: string[];
    score: number;
  };
  solver: "greedy" | "sim" | "endgame";
  endgameSolved: boolean;
  stats: { elapsedMs: number; nodes: number; samples: number };
  /**
   * Present ONLY when this move was computed on the device.
   *
   * It is how the pin reaches the game record: the versions travel with the
   * move that used them and are written in the same commit, so a game cannot
   * end up claiming a pin for a turn that was actually played by the backend
   * engine. Absent means the backend computed it, which is a fact worth being
   * able to state rather than infer.
   */
  localEngine?: { engineVersion: string; weightsVersion: string };
  /**
   * Present ONLY when this move was computed on the device, and never sent by
   * the server — the backend keeps its report server-side and serves it from
   * `GET /bot-move/reasoning` instead. A device-computed move has no such
   * endpoint behind it, so its report travels with it.
   */
  localReasoning?: BotReasoningReport;
};

export function requestBotMove(
  options: {
    gameId: string;
    expectedRevision: number;
    signal?: AbortSignal;
    traceKey?: string;
  } & EngineLifecycle,
): Promise<BotMoveResult> {
  return postStream<BotMoveResult>({
    path: `/v1/games/${encodeURIComponent(options.gameId)}/bot-move`,
    body: { expectedRevision: options.expectedRevision },
    ...(options.onQueued ? { onQueued: options.onQueued } : {}),
    ...(options.onRunning ? { onRunning: options.onRunning } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.traceKey ? { traceKey: options.traceKey } : {}),
  });
}

/**
 * Reconnect to a bot search already in flight for this room+revision, or read
 * its cached move. Starts NOTHING: if the server has no job for this position it
 * answers `idle`, and the caller decides whether to start one with
 * `requestBotMove`. This is how a player returning to Play rejoins the bot turn
 * they left running instead of launching a second identical search.
 */
export function attachBotMove(
  options: {
    gameId: string;
    expectedRevision: number;
    signal?: AbortSignal;
    traceKey?: string;
  } & EngineLifecycle,
): Promise<SseOutcome<BotMoveResult>> {
  const query = `?revision=${encodeURIComponent(String(options.expectedRevision))}`;
  return runSse<BotMoveResult>({
    method: "GET",
    path: `/v1/games/${encodeURIComponent(options.gameId)}/bot-move${query}`,
    ...(options.onQueued ? { onQueued: options.onQueued } : {}),
    ...(options.onRunning ? { onRunning: options.onRunning } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.traceKey ? { traceKey: options.traceKey } : {}),
  });
}

// ── why the bot played that ──────────────────────────────────────────────────

/** One alternative the engine weighed, with the full value decomposition that
 *  separated it from the move actually played. Mirrors `BotCandidate`. */
export type BotReasoningCandidate = {
  type: "place" | "exchange" | "pass";
  placements: Array<{ r: number; c: number; kind: string; token: string }>;
  exchange: string[];
  score: number;
  scoreComp: number;
  leave: number;
  potential: number;
  oppReply: number;
  mean: number;
  stddev: number;
  value: number;
  chosen: boolean;
  proven?: boolean;
};

/**
 * One page of the engine's ranking for a bot move that has already been played.
 *
 * The summary fields (`equity`, `stats`, `solver`, …) describe the WHOLE search
 * and are repeated on every page, as are `chosen` and `runnerUp` — so any page
 * renders completely on its own without first fetching page one.
 */
export type BotReasoningPage = {
  gameId: string;
  revision: number;
  side: "A" | "B";
  difficulty: string;
  solver: "greedy" | "sim" | "endgame";
  endgameSolved: boolean;
  expectedFinalDiff?: number;
  score: number;
  equity: number;
  stats: {
    moves: number;
    nodes: number;
    elapsedMs: number;
    candidates: number;
    samples: number;
    genCalls?: number;
  };
  /** The window actually served. `offset`/`limit` are the server's clamped
   *  values, not the ones asked for, so a client always knows what it got. */
  page: { offset: number; limit: number; total: number };
  candidates: BotReasoningCandidate[];
  chosenIndex: number | null;
  chosen?: BotReasoningCandidate;
  runnerUp?: BotReasoningCandidate;
};

/**
 * The WHOLE ranking for one move, held on the device that computed it.
 *
 * A Super move is searched in the browser, so the server never ran that search
 * and has nothing to serve the "why this move" panel — it answers
 * `reasoning_unavailable` for every device-computed turn, which is exactly what
 * it should say and exactly not what a player wants to read. The search already
 * produces the same ranking the server would have held (`CLIENT_SUPER_TOP_N`
 * matches the service's `BOT_REPORT_TOP_N`), so it is kept rather than dropped,
 * and the panel pages it locally through `pageOfBotReasoning`.
 *
 * In memory only, for the life of the tab. The server's own copy is bounded and
 * in-memory too; this is the same promise kept on the other side of the wire.
 */
export type BotReasoningReport = Omit<
  BotReasoningPage,
  "page" | "candidates" | "chosenIndex" | "chosen" | "runnerUp"
> & {
  /** Ranked by value, chosen move first among equals: the engine's own order. */
  candidates: BotReasoningCandidate[];
};

/** Page size defaults, mirroring `REASONING_PAGE_*` in the service so a local
 *  page and a served page are the same size for the same request. */
const REASONING_PAGE_DEFAULT = 6;
const REASONING_PAGE_MAX = 24;

function clampPageNumber(value: number | undefined, fallback: number, min: number, max: number) {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * Serve one page out of a locally held report.
 *
 * A faithful copy of what `GET /bot-move/reasoning` does with the same numbers,
 * clamping included, so the panel cannot tell a local page from a served one —
 * and so a paging bug cannot exist on one path and not the other.
 */
export function pageOfBotReasoning(
  report: BotReasoningReport,
  options: { offset?: number; limit?: number } = {},
): BotReasoningPage {
  const ranked = report.candidates;
  const offset = clampPageNumber(options.offset, 0, 0, Math.max(0, ranked.length));
  const limit = clampPageNumber(options.limit, REASONING_PAGE_DEFAULT, 1, REASONING_PAGE_MAX);
  const chosenIndex = ranked.findIndex((candidate) => candidate.chosen);

  return {
    ...report,
    page: { offset, limit, total: ranked.length },
    candidates: ranked.slice(offset, offset + limit),
    chosenIndex: chosenIndex >= 0 ? chosenIndex : null,
    ...(chosenIndex >= 0 ? { chosen: ranked[chosenIndex]! } : {}),
    ...(ranked.length > 1
      ? { runnerUp: ranked[chosenIndex === 0 || chosenIndex < 0 ? 1 : 0]! }
      : {}),
  };
}

/**
 * Read one page of the engine's reasoning for a bot move already on the board.
 *
 * Paged deliberately. The full ranking is dozens of rows with a value
 * decomposition each; fetching all of it to show the first six would spend the
 * bandwidth on every open, and shipping it with the MOVE would spend it on every
 * turn whether or not anyone asks. So the move stays small and this is read on
 * demand, one page at a time.
 *
 * `revision` is the revision the move was COMPUTED for — `BotResponse.revision`,
 * one behind the board by the time the panel opens. The server holds completed
 * searches for a bounded window, so `reasoning_unavailable` (an old move, or a
 * restarted service) is an ordinary answer to show as a sentence, not a fault to
 * retry.
 */
export async function fetchBotReasoning(options: {
  gameId: string;
  revision: number;
  offset?: number;
  limit?: number;
  signal?: AbortSignal;
}): Promise<BotReasoningPage> {
  if (!BASE_URL) {
    throw new EngineApiError("unconfigured", "The engine service is not configured.");
  }
  const token = await accessToken();
  const query = new URLSearchParams({ revision: String(options.revision) });
  if (options.offset != null) query.set("offset", String(options.offset));
  if (options.limit != null) query.set("limit", String(options.limit));

  let response: Response;
  try {
    response = await fetch(
      `${BASE_URL}/v1/games/${encodeURIComponent(options.gameId)}/bot-move/reasoning?${query}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
  } catch {
    if (options.signal?.aborted) throw new EngineApiError("cancelled", "The request was cancelled.");
    throw new EngineApiError("offline", "Could not reach the engine service.");
  }

  if (!response.ok) {
    let payload: { code?: string; error?: string } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      // keep the defaults
    }
    throw new EngineApiError(
      (payload.code ?? "internal") as EngineErrorCode,
      payload.error ?? "The engine request failed.",
    );
  }
  return (await response.json()) as BotReasoningPage;
}

// ── analysis ─────────────────────────────────────────────────────────────────

export type AnalysisFactor = {
  key: "score" | "leave" | "potential" | "oppReply" | "risk" | "margin";
  label: string;
  value: number;
  delta?: number;
};

export type AnalysisCandidate = {
  rank: number;
  kind: "place" | "exchange" | "pass";
  placements: Array<{ r: number; c: number; kind: string; token: string }>;
  exchange: string[];
  immediateScore: number;
  evaluation: number;
  evaluationGap: number;
  factors: AnalysisFactor[];
  provenMargin: number | null;
  recommended: boolean;
  note: string;
};

export type AnalysisResult = {
  level: AnalysisLevel;
  gameId: string;
  revision: number;
  turnNumber: number;
  side: "A" | "B";
  recommendation: AnalysisCandidate;
  alternatives: AnalysisCandidate[];
  summary: string;
  /**
   * Present ONLY when the search ran on this device, and never sent by the
   * server. It is what lets the result say where its numbers came from: the two
   * paths run the same schedule but not under the same ceiling — the service
   * kills the top level at 330s, and a local run has no clock at all.
   */
  localEngine?: { engineVersion: string; weightsVersion: string; threads: number };
  method: {
    solver: "greedy" | "sim" | "endgame";
    samples: number;
    legalMoves: number;
    candidatesEvaluated: number;
    nodes: number;
    elapsedMs: number;
    proven: boolean;
    complete: boolean;
  };
};

export function requestAnalysis(
  options: {
    gameId: string;
    expectedRevision: number;
    level: AnalysisLevel;
    signal?: AbortSignal;
    traceKey?: string;
  } & EngineLifecycle,
): Promise<AnalysisResult> {
  return postStream<AnalysisResult>({
    path: `/v1/games/${encodeURIComponent(options.gameId)}/analysis`,
    body: { expectedRevision: options.expectedRevision, level: options.level },
    ...(options.onQueued ? { onQueued: options.onQueued } : {}),
    ...(options.onRunning ? { onRunning: options.onRunning } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.traceKey ? { traceKey: options.traceKey } : {}),
  });
}

/**
 * Reconnect to an analysis already in flight for this room+revision+level, or
 * read its cached result. Starts nothing and spends no budget; answers `idle`
 * when there is no such job. This is how the Analyze panel restores a running or
 * finished analysis when the player returns to Play, without pressing Analyze
 * again or paying for the same immutable position twice.
 */
export function attachAnalysis(
  options: {
    gameId: string;
    expectedRevision: number;
    level: AnalysisLevel;
    signal?: AbortSignal;
    traceKey?: string;
  } & EngineLifecycle,
): Promise<SseOutcome<AnalysisResult>> {
  const query =
    `?revision=${encodeURIComponent(String(options.expectedRevision))}` +
    `&level=${encodeURIComponent(options.level)}`;
  return runSse<AnalysisResult>({
    method: "GET",
    path: `/v1/games/${encodeURIComponent(options.gameId)}/analysis${query}`,
    ...(options.onQueued ? { onQueued: options.onQueued } : {}),
    ...(options.onRunning ? { onRunning: options.onRunning } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.traceKey ? { traceKey: options.traceKey } : {}),
  });
}

// ── study ────────────────────────────────────────────────────────────────────
//
// The one request in this module that carries a POSITION instead of a game id,
// because there is no game: the player typed the whole thing. The server still
// derives everything that is not theirs to state — how many tiles the opponent
// holds, how many are left in the bag — from the physical set.

export type StudyBoardCell = { r: number; c: number; kind: string; token: string };

export type StudyPositionInput = {
  scoreSelf: number;
  scoreOpponent: number;
  board: StudyBoardCell[];
  rack: string[];
};

export type StudyAnalysisResult = {
  /** The permanent record, or `null` when the search succeeded but the write
   *  did not. The ranking is worth showing either way. */
  recordId: string | null;
  saveError: string | null;
  level: string;
  position: StudyPositionInput & { oppRackCount: number; bagCount: number };
  /** Ranked best first, at most ten — the same ten written to the record. */
  candidates: AnalysisCandidate[];
  summary: string;
  method: AnalysisResult["method"];
};

/**
 * Ask the engine about a made-up position at a chosen bot strength.
 *
 * Unlike `requestAnalysis` this is not about a turn and cannot go stale, so
 * there is no revision to send and no `attach` counterpart: the result is
 * persisted server-side and read back from the study records, not re-attached.
 */
export function requestStudyAnalysis(
  options: StudyPositionInput & {
    level: string;
    signal?: AbortSignal;
    traceKey?: string;
  } & EngineLifecycle,
): Promise<StudyAnalysisResult> {
  return postStream<StudyAnalysisResult>({
    path: "/v1/study/analysis",
    body: {
      scoreSelf: options.scoreSelf,
      scoreOpponent: options.scoreOpponent,
      board: options.board,
      rack: options.rack,
      level: options.level,
    },
    ...(options.onQueued ? { onQueued: options.onQueued } : {}),
    ...(options.onRunning ? { onRunning: options.onRunning } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.traceKey ? { traceKey: options.traceKey } : {}),
  });
}

// ── discovery ────────────────────────────────────────────────────────────────

/** One job the server is holding for a position, as `GET /jobs` describes it.
 *  Describes; never answers — reading a result still goes through `attach*`. */
export type EngineJobListing = {
  kind: "bot" | "analysis";
  level?: AnalysisLevel;
  difficulty?: string;
  status: "queued" | "running" | "completed";
  progress?: EngineProgress;
  queue?: { ahead: number; position: number };
};

/**
 * Ask the server what work already exists for a position.
 *
 * The question this answers is the one the browser could not previously ask. An
 * analysis is identified partly by its LEVEL, and the level is not derivable
 * from the game — so a client that lost its note about what it started could
 * never find the search again, even though the server still had it. Losing that
 * note is ordinary: a second tab never had it, a reload can drop it, a mistimed
 * reset can erase it.
 *
 * Starts nothing, spends no budget, and returns only jobs the caller is
 * authorised to observe.
 */
export async function listJobs(options: {
  gameId: string;
  revision: number;
  signal?: AbortSignal;
}): Promise<EngineJobListing[]> {
  if (!BASE_URL) return [];
  const token = await accessToken();
  const response = await fetch(
    `${BASE_URL}/v1/games/${encodeURIComponent(options.gameId)}/jobs` +
      `?revision=${encodeURIComponent(String(options.revision))}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );
  if (!response.ok) {
    let payload: { code?: string; error?: string; currentRevision?: number } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      // keep the defaults
    }
    throw new EngineApiError(
      (payload.code ?? "internal") as EngineErrorCode,
      payload.error ?? "Could not read engine jobs.",
      payload.currentRevision != null ? { currentRevision: payload.currentRevision } : {},
    );
  }
  const body = (await response.json()) as { jobs?: EngineJobListing[] };
  return Array.isArray(body.jobs) ? body.jobs : [];
}

/**
 * Explicitly cancel an in-flight analysis — the player pressed "cancel".
 * Best-effort: a network failure here is harmless, because an abandoned search
 * is superseded or times out on its own. Distinct from merely closing the page,
 * which the server does NOT treat as cancellation.
 */
export async function cancelAnalysis(options: {
  gameId: string;
  expectedRevision: number;
  level: AnalysisLevel;
}): Promise<boolean> {
  if (!BASE_URL) return false;
  let token: string;
  try {
    token = await accessToken();
  } catch {
    return false;
  }
  try {
    const response = await fetch(
      `${BASE_URL}/v1/games/${encodeURIComponent(options.gameId)}/analysis/cancel`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: options.expectedRevision, level: options.level }),
      },
    );
    const data = (await response.json().catch(() => ({}))) as { cancelled?: boolean };
    return Boolean(data.cancelled);
  } catch {
    return false;
  }
}

// ── client-side Super: configuration and legality ────────────────────────────

/** The Super configuration document, as `service/src/superConfig.ts` serves it. */
export type BotConfigResponse = {
  /** The rollout switch. Server-controlled on purpose: the moment the
   *  client-side path misbehaves, turning it off must not require shipping
   *  anything to a browser. */
  clientSuperEnabled: boolean;
  engineVersion: string;
  weightsVersion: string;
  weights: Record<string, unknown>;
  calibration: {
    benchmark: string;
    reference: {
      benchmark: string;
      device: string;
      nodesPerSec: number;
      /** What the reference device waited for a FULL-schedule Super move. One
       *  latency, not a table of them: every device runs the same schedule, so
       *  there is only one number to scale. */
      fullSuper: { p50Ms: number; p95Ms: number; positions: number };
    };
    /** Bands over estimated full-Super p50. A LABEL for the report and for the
     *  UI. There is no `minimumTier` beside it and there must not be one: a
     *  tier gate is a latency cutoff, and Super does not have one. */
    tiers: Array<{
      tier: "EXCELLENT" | "GOOD" | "SLOW" | "NOT_RECOMMENDED";
      maxEstimatedMoveMs: number | null;
    }>;
    /** Estimated p50 above which the UI warns the player about the wait. Copy,
     *  not a cutoff — crossing it changes what is said, never what is searched. */
    warnAboveMs: number;
    /** EXPERIMENTAL reduced-sample budgets. `enabled` is false unless an
     *  operator deliberately turned it on, and the client must run the full
     *  schedule whenever it is false — a cap is a STRENGTH change. The latency
     *  targets live in here, inside the experiment, so the default path has none. */
    adaptiveBudget: {
      enabled: boolean;
      budgets: Array<{ sampleCap: number | null; p50Ms: number; p95Ms: number }>;
      targets: { p50Ms: number; p95Ms: number };
    };
  };
};

/**
 * What the client-side engine should be configured with.
 *
 * `weightsVersion` asks for a SPECIFIC version rather than the current one, and
 * is how a game in progress keeps playing under the weights it started with.
 * A version this deployment no longer carries is refused rather than
 * substituted — see the endpoint's own comment for why that refusal is the
 * point.
 */
export async function fetchBotConfig(options: {
  weightsVersion?: string;
  signal?: AbortSignal;
}): Promise<BotConfigResponse> {
  if (!BASE_URL) {
    throw new EngineApiError("unconfigured", "No engine service is configured.");
  }
  const token = await accessToken();
  const query = options.weightsVersion
    ? `?weightsVersion=${encodeURIComponent(options.weightsVersion)}`
    : "";
  const response = await fetch(`${BASE_URL}/v1/bot-config${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
    throw new EngineApiError(
      (payload.code ?? "internal") as EngineErrorCode,
      payload.error ?? "Could not read the bot configuration.",
    );
  }
  return (await response.json()) as BotConfigResponse;
}

export type BotMoveValidation = {
  revision: number;
  gameId: string;
  side: "A" | "B";
  valid: boolean;
  score: number;
  reason?: string;
};

/**
 * Ask the server whether a move the DEVICE computed is legal from the position
 * the server is holding.
 *
 * The claim is legality and only legality. It is deliberately not "is this what
 * the engine would have played" — proving that means running the Super search
 * again on the server, which is exactly the CPU cost the client-side path
 * exists to remove.
 *
 * `valid: false` is a SUCCESSFUL call. It reports an illegal move, which is a
 * bug in the engine, a desynced rack, or a position that moved — not a failed
 * request, and the caller must not treat it as one.
 */
export async function validateBotMove(options: {
  gameId: string;
  expectedRevision: number;
  move: {
    type: "place" | "exchange" | "pass";
    placements: Array<{ r: number; c: number; kind: string; token: string }>;
    exchange: string[];
  };
  signal?: AbortSignal;
}): Promise<BotMoveValidation> {
  if (!BASE_URL) {
    throw new EngineApiError("unconfigured", "No engine service is configured.");
  }
  const token = await accessToken();
  const response = await fetch(
    `${BASE_URL}/v1/games/${encodeURIComponent(options.gameId)}/bot-move/validate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: options.expectedRevision, move: options.move }),
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      code?: string;
      error?: string;
      currentRevision?: number;
    };
    throw new EngineApiError(
      (payload.code ?? "internal") as EngineErrorCode,
      payload.error ?? "Could not validate the move.",
      payload.currentRevision != null ? { currentRevision: payload.currentRevision } : {},
    );
  }
  return (await response.json()) as BotMoveValidation;
}
