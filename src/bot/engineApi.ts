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

import { supabase } from "../supabaseClient";

export const ANALYSIS_LEVELS = ["quick", "normal", "deep", "max"] as const;
export type AnalysisLevel = (typeof ANALYSIS_LEVELS)[number];

export type EngineErrorCode =
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
async function postStream<T>(options: {
  path: string;
  body: Record<string, unknown>;
  onQueued?: (state: EngineQueueState) => void;
  onRunning?: () => void;
  onProgress?: (progress: EngineProgress) => void;
  signal?: AbortSignal;
}): Promise<T> {
  if (!BASE_URL) {
    throw new EngineApiError("unconfigured", "The engine service is not configured.");
  }
  const token = await accessToken();

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${options.path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(options.body),
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

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;
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
      result = JSON.parse(data) as T;
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

  if (!settled || result === undefined) {
    // The stream ended without a verdict. Treated as a failure rather than
    // hopefully retried: the search may or may not have run.
    throw new EngineApiError("offline", "The engine connection ended without a result.");
  }
  return result;
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
};

export function requestBotMove(
  options: {
    gameId: string;
    expectedRevision: number;
    signal?: AbortSignal;
  } & EngineLifecycle,
): Promise<BotMoveResult> {
  return postStream<BotMoveResult>({
    path: `/v1/games/${encodeURIComponent(options.gameId)}/bot-move`,
    body: { expectedRevision: options.expectedRevision },
    ...(options.onQueued ? { onQueued: options.onQueued } : {}),
    ...(options.onRunning ? { onRunning: options.onRunning } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
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
  } & EngineLifecycle,
): Promise<AnalysisResult> {
  return postStream<AnalysisResult>({
    path: `/v1/games/${encodeURIComponent(options.gameId)}/analysis`,
    body: { expectedRevision: options.expectedRevision, level: options.level },
    ...(options.onQueued ? { onQueued: options.onQueued } : {}),
    ...(options.onRunning ? { onRunning: options.onRunning } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}
