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
} from "./engineApi";
import type { BotProgress, BotResponse } from "./types";

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
 * the revision it holds and refuses a mismatch, so a move computed for a
 * position the game has already left cannot come back and be applied to a
 * newer one.
 */
export function thinkWithBot(
  game: GameState,
  onProgress: (progress: BotProgress) => void,
): BotThinkHandle {
  const controller = new AbortController();
  const promise = requestBotMove({
    gameId: game.gameId,
    expectedRevision: game.revision ?? 0,
    onProgress: (progress) => onProgress(toBotProgress(progress)),
    signal: controller.signal,
  }).then(toBotResponse);

  return {
    promise,
    // Aborting the request also releases the server-side reference to the
    // search; the engine process is stopped once nobody is waiting on it.
    cancel: () => controller.abort(),
  };
}

/** Whether a failed bot request is worth retrying, or is a settled refusal.
 *  A stale revision resolves itself — the game moved on and the caller will
 *  compose a fresh request against the new position. */
export function isRetryableBotFailure(error: unknown): boolean {
  if (!(error instanceof EngineApiError)) return true;
  return error.code === "queue_full" || error.code === "offline" || error.code === "internal";
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
