// Bridge between EQ-Lab game state and the C++ engine.
//
// The engine now runs on a backend service rather than as WASM in this tab, so
// what crosses this boundary changed shape: the client no longer describes the
// position. It names the game and the revision it believes the game is at, and
// the server reads the authoritative state for itself. A client that is wrong
// about the revision is refused rather than answered.
//
// What did NOT change is the safety net below it. Every bot move is still
// re-validated by the official game validator before it is committed, so an
// engine bug — or a service returning something unexpected — can never corrupt
// a match; it degrades to a pass.
import {
  getRack,
  tileNeedsAssignment,
  type AmathToken,
  type GameState,
  type PendingPlacement,
  type TileInstance,
} from "../game";
import {
  EngineApiError,
  isEngineApiConfigured,
  requestBotMove,
  type BotMoveResult,
  type EngineProgress,
  type EngineQueueState,
} from "./engineApi";
import type { BotProgress, BotResponse } from "./types";

/**
 * What the bot is doing right now, from the player's point of view.
 *
 * The engine used to run in this tab, so "asked" and "computing" were the same
 * instant. It now runs on a shared server with a bounded number of CPUs, and
 * those are three different states — a bot that has not moved because it is
 * WAITING FOR A SLOT is not a bot that is thinking, and telling the player it
 * is thinking would be a lie the progress bar then has to keep up.
 */
export type BotThinkingState =
  | { kind: "requesting" }
  /** Accepted by the server, waiting for engine capacity. `position` is the
   *  server's own count of jobs ahead, or null when it could not be trusted. */
  | { kind: "queued"; position: number | null }
  /** An engine process is working on it. `progress` is absent until the engine
   *  reports its first sample — indeterminate, rather than a fake 0%. */
  | { kind: "running"; progress: BotProgress | null };

export type BotThinkHandle = {
  promise: Promise<BotResponse>;
  cancel: () => void;
};

/**
 * Nothing to warm up any more.
 *
 * This used to spin up a Web Worker and instantiate the WASM module so the
 * first bot turn had no startup hiccup. The engine now lives on a server that
 * is already running, so the call is kept as a no-op rather than removed:
 * `App.tsx` still calls it when a bot room opens, and a hook that costs nothing
 * is a better seam than one that has to be threaded out of a 5,000-line
 * component.
 */
export function warmUpBotEngine(): void {
  // Deliberately empty.
}

/** Whether a bot can play at all in this deployment. */
export const isBotAvailable = isEngineApiConfigured;

function toBotProgress(progress: EngineProgress): BotProgress {
  return {
    phase: progress.phase,
    percent: progress.percent,
    elapsedMs: progress.elapsedMs,
    etaMs: progress.etaMs,
    // The server does not report a running best score: it would describe the
    // bot's own rack, and the player watching the bar is the opponent.
    bestScore: 0,
    detail: progress.detail,
  };
}

/** Reshape the service's answer into the response shape the app already
 *  applies. The evaluation fields are absent by design — the bot's reasoning
 *  concerns tiles the requester may not see — so they are reported as zero
 *  rather than invented. */
function toBotResponse(result: BotMoveResult): BotResponse {
  return {
    type: result.move.type,
    placements: result.move.placements,
    exchange: result.move.exchange,
    score: result.move.score,
    equity: 0,
    solver: result.solver,
    endgameSolved: result.endgameSolved,
    stats: {
      moves: 0,
      nodes: result.stats.nodes,
      elapsedMs: result.stats.elapsedMs,
      candidates: 0,
      samples: result.stats.samples,
    },
  };
}

/**
 * Ask the backend for the bot's move in this game at this revision.
 *
 * `game.revision` is the whole concurrency story. The server compares it with
 * the revision it holds and refuses a mismatch — at admission AND again when a
 * queued job finally reaches a CPU — so a move computed for a position the game
 * has already left cannot come back and be applied to a newer one.
 *
 * `onState` is called with every lifecycle change the server reports, so the
 * caller can distinguish waiting from thinking instead of showing one spinner
 * for both.
 */
export function thinkWithBot(
  game: GameState,
  onState: (state: BotThinkingState) => void,
): BotThinkHandle {
  const controller = new AbortController();
  const promise = requestBotMove({
    gameId: game.gameId,
    expectedRevision: game.revision ?? 0,
    onQueued: (state: EngineQueueState) =>
      onState({ kind: "queued", position: state.position > 0 ? state.position : null }),
    // The engine reports progress only once it is actually searching, so
    // "running with nothing to show yet" is a real state, rendered as an
    // indeterminate one rather than as a fabricated 0%.
    onRunning: () => onState({ kind: "running", progress: null }),
    onProgress: (progress) => onState({ kind: "running", progress: toBotProgress(progress) }),
    signal: controller.signal,
  }).then(toBotResponse);

  return {
    promise,
    // Aborting the request also releases the server-side reference to the
    // search; the engine process is stopped once nobody is waiting on it, and a
    // job still in the queue gives its place back immediately.
    cancel: () => controller.abort(),
  };
}

/**
 * Whether a failed bot request is worth retrying, or is a settled refusal.
 *
 * This matters far more now than it did with a per-tab engine. `queue_full` is
 * no longer exotic: it is the ordinary response of a busy single-CPU server,
 * and treating it as a permanent failure would make the bot PASS its turn
 * because someone else was analysing. A pass is a real, scoring, irreversible
 * game action — never the right answer to server load.
 *
 * A stale revision is deliberately NOT retryable-as-a-pass either: it means the
 * server's view of the game has moved past ours, and the only safe response is
 * to wait for state to catch up.
 */
export function isRetryableBotFailure(error: unknown): boolean {
  if (!(error instanceof EngineApiError)) return true;
  // `engine_timeout` is deliberately absent: the service's ceilings sit above
  // the engine's own, so reaching one means a malfunction that another five
  // minutes of the same shared CPU will not fix.
  return error.code === "queue_full" || error.code === "offline" || error.code === "internal";
}

/** Failures where committing ANY move on the bot's behalf would be wrong,
 *  because the server and this client disagree about what the game is. */
export function isDesyncBotFailure(error: unknown): boolean {
  return error instanceof EngineApiError && error.code === "stale_revision";
}

export type MappedBotMove =
  | { kind: "place"; placements: PendingPlacement[] }
  | { kind: "exchange"; outgoingIds: string[] }
  | { kind: "pass" };

/**
 * Map an engine response back onto concrete rack tile instances.
 * Returns null when the response cannot be honored (e.g. a tile is missing) —
 * the caller then falls back to a pass so the match never breaks.
 */
export function mapBotResponse(game: GameState, response: BotResponse): MappedBotMove | null {
  const botSide = game.botSide ?? "B";
  const rack = getRack(game, botSide);

  if (response.type === "place") {
    const used = new Set<string>();
    const placements: PendingPlacement[] = [];
    for (const placement of response.placements) {
      const tile = rack.find(
        (candidate) => !used.has(candidate.id) && candidate.token === (placement.kind as AmathToken),
      );
      if (!tile) return null;
      used.add(tile.id);
      const needsAssignment = tileNeedsAssignment(tile.token);
      const cleanTile: TileInstance = needsAssignment
        ? { ...tile, assignedToken: placement.token }
        : { id: tile.id, token: tile.token };
      placements.push({
        tile: cleanTile,
        row: placement.r,
        col: placement.c,
        assignedToken: needsAssignment ? placement.token : undefined,
      });
    }
    return { kind: "place", placements };
  }

  if (response.type === "exchange") {
    const used = new Set<string>();
    for (const kind of response.exchange) {
      const tile = rack.find(
        (candidate) => !used.has(candidate.id) && candidate.token === (kind as AmathToken),
      );
      if (!tile) return null;
      used.add(tile.id);
    }
    return { kind: "exchange", outgoingIds: Array.from(used) };
  }

  return { kind: "pass" };
}
