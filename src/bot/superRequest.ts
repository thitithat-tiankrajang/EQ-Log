// ── Client-side adapter: game state → engine request ─────────────────────────
//
// When the Super search runs on the device, THIS FILE is the adapter. Its
// counterpart is `service/src/adapter.ts`, which does the same job on the
// server from canonical state, and the two must agree field for field.
//
// They must agree because they are two descriptions of the same position given
// to the same engine. Where they disagree, the bot plays differently depending
// on where it happened to think — and that difference would be invisible: two
// legal moves, both plausible, no error anywhere.
//
// The correspondence, field by field:
//
//   board            same cells, `kind` = the physical tile, `token` = what it
//                    shows (a blank's assignment)
//   rack             the BOT's rack only
//   bagCount         bag + every pending exchange return, because from the
//                    engine's accounting view a swapped tile is still unseen.
//                    This is what keeps `unseen.total == oppRackCount +
//                    bagCount`, the exact predicate the engine uses to decide a
//                    position is endgame-eligible.
//   oppRackCount     a COUNT, never tiles
//   noScoreStreak    the trailing run of scoreless turns
//   exchangeAllowed  `getExchangeRule`, which counts the BAG ONLY for its
//                    reserve test while `bagCount` above also folds in pending
//                    returns. That looks inconsistent and is not: the two
//                    answer different questions ("can these be swapped now"
//                    versus "how many tiles are unseen"), and the server
//                    reproduces the same pair deliberately.
//   seed             FNV-1a over `roomId:revision` — byte-identical to
//                    `seedFor` in the service, so the same position produces
//                    the same search wherever it runs.
//
// The one thing this file does NOT reproduce is the server's HIDDEN-INFORMATION
// guarantee, and it cannot: a bot room's client already holds the bot's rack —
// it has to, in order to map the engine's answer back onto real tiles — and it
// held it before any of this existed. That is a property of a bot room, not
// something the client-side engine introduced.
import {
  displayToken,
  getRack,
  otherSide,
  type GameState,
  type Side,
} from "../game";
import { getExchangeRule } from "../gameplay/tilebag";
import type { SuperEngineRequest } from "./superTypes";

/**
 * The engine's RNG seed for a position.
 *
 * Deliberately a copy of `seedFor` in `service/src/adapter.ts`, down to the
 * constants. Two implementations of one hash is a maintenance cost worth
 * paying here: it is what makes a client-computed move and a server-computed
 * move the SAME move for the same position, which is the only way the fallback
 * path can be a fallback rather than a second opponent.
 *
 * Keyed by revision rather than turn number because revision is strictly
 * monotonic and finer: two positions inside one turn (a refill, then the
 * action) cannot collide, and re-asking about the same position reproduces the
 * same search.
 */
export function seedFor(roomId: string, revision: number): number {
  const text = `${roomId}:${revision}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483647 || 1;
}

/**
 * Trailing run of scoreless turns.
 *
 * Read off this client's turn log, which records one entry per player ACTION —
 * draws and refills are bookkeeping inside a turn and never become logs here.
 * The server reads the same run off the committed event log and skips
 * `draw`/`refill`/`returnDraw` explicitly, because that log is finer grained.
 * Different sources, same sequence.
 */
export function trailingNoScoreStreak(game: GameState): number {
  let streak = 0;
  for (let index = game.logs.length - 1; index >= 0; index -= 1) {
    const action = game.logs[index]!.action;
    if (action === "end_game") continue;
    if (action === "pass" || action === "exchange") {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

export type SuperRequestOptions = {
  /** The live room's id — `room_live.room_id`, the same value the backend hashes.
   *  NOT `GameState.gameId`, which is a client-generated UUID the server has
   *  never seen. Getting this wrong produces a legal move computed from a
   *  different seed than the server would have used, which is invisible. */
  roomId: string;
  revision: number;
  /**
   * Opponent-rack sample budget, or `null` for the full Super schedule.
   *
   * `null` on every device by default, and the field is then OMITTED from the
   * request entirely — which is what makes this full Super: the engine reads a
   * missing `sampleCap` as `cfg.simSamples`, all 160 samples (engine.cpp:1972).
   * A number here is a deliberately WEAKER bot and arrives only from the
   * experimental adaptive budget.
   */
  sampleCap: number | null;
  weights: Record<string, unknown> | undefined;
  /** How many ranked alternatives to read back, for the "why this move" panel. */
  topN: number;
};

export function buildSuperRequest(
  game: GameState,
  options: SuperRequestOptions,
): SuperEngineRequest {
  const botSide: Side = game.botSide ?? "B";
  const board: SuperEngineRequest["board"] = [];
  for (let row = 0; row < game.board.length; row += 1) {
    const cells = game.board[row]!;
    for (let col = 0; col < cells.length; col += 1) {
      const cell = cells[col];
      if (!cell) continue;
      board.push({ r: row, c: col, kind: cell.tile.token, token: displayToken(cell.tile) });
    }
  }

  const pendingReturns =
    (game.pendingExchangeReturnBySide?.A?.length ?? 0) +
    (game.pendingExchangeReturnBySide?.B?.length ?? 0);

  return {
    board,
    rack: getRack(game, botSide).map((tile) => tile.token as string),
    bagCount: game.tilebag.length + pendingReturns,
    oppRackCount: getRack(game, otherSide(botSide)).length,
    myScore: game.scores[botSide],
    oppScore: game.scores[otherSide(botSide)],
    noScoreStreak: trailingNoScoreStreak(game),
    exchangeAllowed: getExchangeRule(game).allowed,
    difficulty: "super",
    solver: "sim",
    // What makes this `super` rather than `max`: the search stops when its
    // schedule is COMPLETE, not when a deadline fires. A slow device therefore
    // waits longer for the same search rather than finishing a smaller one,
    // which is the entire product requirement in one field.
    unlimited: true,
    ...(options.sampleCap != null ? { sampleCap: options.sampleCap } : {}),
    topN: options.topN,
    seed: seedFor(options.roomId, options.revision),
    ...(options.weights && Object.keys(options.weights).length > 0
      ? { weights: options.weights }
      : {}),
  };
}
