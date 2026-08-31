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
const BOT_RETRY_DELAYS_MS = [1_500, 4_000, 8_000] as const;

/**
 * Consecutive failures on one turn before the player is offered the turn.
 *
 * The retry loop above still never stops on its own. What changes at this count
 * is only that a way out APPEARS: the human used to have one implicitly (they
 * could always play the bot's move) and no longer does, so a wedged engine would
 * otherwise mean a room nobody can advance.
 *
 * Three, matching `BOT_RETRY_DELAYS_MS`: by then the schedule has been walked
 * end to end and about thirteen seconds have passed, which is long enough that
 * the trouble is not a blip and short enough that nobody has given up yet.
 */
export const BOT_ESCAPE_AFTER_FAILURES = 3;
/** Ceiling on a server-supplied wait, so a wrong or hostile number cannot park
 *  the bot for an hour. Above this we fall back to the schedule and keep
 *  asking. */
const BOT_RETRY_HONOURED_MAX_MS = 60_000;

/**
 * How long to wait before asking again.
 *
 * When the server states a wait — `budget_exhausted` and `queue_full` both do —
 * that number is the answer and the schedule below is a guess. Ignoring it is
 * how a refusal that resolves itself in six seconds turned into a retry at 1.5s
 * that failed again, and again, with an error on screen the whole time.
 */
export function botRetryDelay(error: unknown, tries: number): number {
  const stated = error instanceof EngineApiError ? error.detail?.retryAfterMs : undefined;
  if (typeof stated === "number" && stated > 0 && stated <= BOT_RETRY_HONOURED_MAX_MS) {
    // A small margin: retrying on the exact millisecond the window rolls over
    // races the server's own clock.
    return stated + 250;
  }
  return BOT_RETRY_DELAYS_MS[Math.min(tries, BOT_RETRY_DELAYS_MS.length - 1)]!;
}

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
