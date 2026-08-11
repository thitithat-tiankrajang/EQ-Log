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

/** Reshape the service's answer into the response shape the app already
 *  applies. The evaluation fields are absent by design — the bot's reasoning
 *  concerns tiles the requester may not see — so they are reported as zero
 *  rather than invented. */
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
 * Whether a failed bot request is worth retrying.
 *
 * **Everything is, now.** This used to answer a second, unstated question —
 * "and if not, should the bot pass?" — and every code that fell out of the list
 * became a turn the bot threw away. `turn_rule` was reachable from an ordinary
 * race (the client asking about a position the server had not been told about
 * yet) and cost the player a scoring move.
 *
 * A pass is a real, irreversible game action. Nothing about a failed HTTP
 * request is evidence that passing is the right move, so no failure produces
 * one: the bot waits, retries, and says why. The only thing that can pass is the
 * engine authoritatively choosing to.
 *
 * The distinctions that remain are about HOW to retry, not whether:
 * `stale_revision` waits for state to catch up rather than re-asking the same
 * question, because the question itself was wrong.
 */
export function isRetryableBotFailure(error: unknown): boolean {
  if (!(error instanceof EngineApiError)) return true;
  // A desync is retried by re-deriving the position, not by re-sending — see
  // `isDesyncBotFailure`. Everything else is worth asking again.
  return !isDesyncBotFailure(error);
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
