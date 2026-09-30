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
// a match.
//
// Observation of a running search does NOT live here — see `engineSessions.ts`.
// This module is the translation layer: engine answer in, game action out.
import {
  getRack,
  tileNeedsAssignment,
  type AmathToken,
  type GameState,
  type PendingPlacement,
  type TileInstance,
} from "../game";
import { EngineApiError, isEngineApiConfigured, type BotMoveResult } from "./engineApi";
import type { BotResponse } from "./types";

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

/**
 * Reshape the service's answer into the response shape the app already applies.
 *
 * The evaluation fields are OMITTED, not zeroed. They used to be written as
 * `0`, and the "why this move" panel read them back as facts: it printed a
 * value of `0.00` the engine never computed and "0 alternatives considered"
 * about a search that had weighed dozens. Absent is the truthful encoding of
 * "this response does not carry that" — the panel asks
 * `fetchBotReasoning` for the real numbers, a page at a time.
 */
export function toBotResponse(result: BotMoveResult): BotResponse {
  return {
    type: result.move.type,
    // The position this answer is about. Preserved rather than dropped: without
    // it the application step has no way to tell a move for the current turn
    // from one that arrived after the game moved on.
    revision: result.revision,
    placements: result.move.placements,
    exchange: result.move.exchange,
    score: result.move.score,
    solver: result.solver,
    endgameSolved: result.endgameSolved,
    stats: {
      nodes: result.stats.nodes,
      elapsedMs: result.stats.elapsedMs,
      samples: result.stats.samples,
    },
    // Carried, not dropped: this is the only place the versions a device
    // actually ran can reach the game record, and a pin written from anywhere
    // else would be a claim about a turn rather than a fact from it.
    ...(result.localEngine ? { localEngine: result.localEngine } : {}),
    // Same reason as the pin: this is the only copy that exists for a
    // device-computed move, and dropping it here is what made the "why this
    // move" panel say the server had forgotten a search it never ran.
    ...(result.localReasoning ? { localReasoning: result.localReasoning } : {}),
  };
}

// At most three requests for one unchanged turn. Exhaustion leaves the turn
// intact and the error visible; only a returned legal move can advance it.
const BOT_RETRY_DELAYS_MS = [1_500, 4_000, 8_000] as const;
export const BOT_MAX_ATTEMPTS = 3;
export const BOT_ESCAPE_AFTER_FAILURES = 3;

export function isRetryableBotFailure(error: unknown): boolean {
  return (
    error instanceof EngineApiError &&
    [
      "offline",
      "queue_full",
      "bot_in_progress",
      "request_throttled",
      "engine_timeout",
      "engine_failed",
      "internal",
      "archbot_model_unavailable",
      "archbot_failed",
    ].includes(error.code)
  );
}

export function botRetryDelay(error: unknown, tries: number): number {
  const base = BOT_RETRY_DELAYS_MS[Math.min(tries, BOT_RETRY_DELAYS_MS.length - 1)]!;
  const stated = error instanceof EngineApiError ? error.detail?.retryAfterMs : undefined;
  // Honor long waits instead of converting them into frequent short retries.
  return typeof stated === "number" && Number.isFinite(stated) && stated > 0
    ? Math.max(base, Math.min(stated + 250, 2_147_483_647))
    : base;
}

export function scheduleBotRetry(
  error: unknown,
  tries: number,
  retry: () => void,
): ReturnType<typeof setTimeout> | undefined {
  if (!isRetryableBotFailure(error) || tries + 1 >= BOT_MAX_ATTEMPTS) return undefined;
  const stated = error instanceof EngineApiError ? error.detail?.retryAfterMs : undefined;
  // An unrepresentable wait stops; never retry earlier than the server asked.
  if (typeof stated === "number" && stated > 2_147_483_397) return undefined;
  return setTimeout(retry, botRetryDelay(error, tries));
}

/**
 * Failures that mean "this client and the server disagree about what the game
 * is". Re-sending the same request cannot help; the position has to be
 * re-derived from authoritative state first.
 *
 * `turn_rule` joins `stale_revision` here. It is the answer you get for asking
 * about a position the server holds but whose turn does not match what you
 * believe — which, before the request was gated on a confirmed revision, was the
 * routine outcome of asking one round trip too early.
 */
export function isDesyncBotFailure(error: unknown): boolean {
  return (
    error instanceof EngineApiError &&
    (error.code === "stale_revision" || error.code === "turn_rule")
  );
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
        (candidate) =>
          !used.has(candidate.id) && candidate.token === (placement.kind as AmathToken),
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
