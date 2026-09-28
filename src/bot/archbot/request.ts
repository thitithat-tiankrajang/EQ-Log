// ── The position ArchBot is asked about ──────────────────────────────────────
//
// Built from the game this tab holds, through the same projection the canonical
// state is built from (`inventoryFrom`), and field for field as the engine
// service builds a Stage 5B request (engine-algo service/src/adapter.ts):
//
//   board        every board tile, sorted by square; `kind` is the physical tile,
//                `token` the face it is played as
//   rack         ArchBot's own rack, in rack order — the ONLY rack in the request
//   bagCount     tiles in the bag plus tiles waiting to return from an exchange
//   oppRackCount the opponent's rack as a COUNT
//   exchange     the same rule the game enforces (`getExchangeRule`)
//   seed         `seedFor(room, revision)`, the one seed convention in EQ-Lab
//
// One deliberate difference from the service's ANALYSIS request: tile ownership
// is labelled from ArchBot's seat. The runtime always plays as "A" and its value
// network reads "placed by self / by opponent" off each board tile, so ArchBot's
// own tiles are "A" and the opponent's "B", whichever seat ArchBot occupies. The
// Analysis adapter passes absolute sides, which inverts ownership for a side-B
// player — a known engine-algo issue this request must never inherit.
//
// Hidden information: nothing here reads the opponent's tiles, the bag's order or
// the tiles waiting to return — only their counts.
import { getRack, otherSide, type GameState, type Side } from "../../game";
import { inventoryFrom } from "../../domain/projection";
import { tokenOfOrdinal } from "../../domain/tiles";
import { getExchangeRule } from "../../gameplay/tilebag";
import { seedFor } from "../superRequest";
import type { ArchBotRequest } from "./decide";

/** How many ranked alternatives Stage 5B reports; the service's BOT_REPORT_TOP_N. */
export const ARCHBOT_TOP_N = 24;

/**
 * Trailing run of scoreless turns — passes and exchanges — counted as the service
 * counts committed commands. A placement ends the run; the end-of-game record is
 * bookkeeping and is skipped.
 */
export function noScoreStreakOf(game: Pick<GameState, "logs">): number {
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

export function buildArchBotRequest(
  game: GameState,
  roomId: string,
  revision: number,
): ArchBotRequest {
  const seat: Side | undefined = game.botSide;
  if (!seat) throw new Error("ArchBot needs a bot seat");
  if (game.activeSide !== seat) throw new Error("It is not ArchBot's turn");
  const opponent = otherSide(seat);
  const pending = game.pendingExchangeReturnBySide;
  const inventory = inventoryFrom({
    tilebag: game.tilebag,
    rackA: game.rackA,
    rackB: game.rackB,
    board: game.board,
    pendingReturnA: pending?.A ?? [],
    pendingReturnB: pending?.B ?? [],
  });

  const board: ArchBotRequest["board"] = [];
  const rack: Array<{ seq: number; kind: string }> = [];
  let bag = 0;
  let pendingReturn = 0;
  let opponentRack = 0;
  inventory.forEach((placement, ordinal) => {
    const kind = tokenOfOrdinal(ordinal);
    switch (placement.at) {
      case "board":
        board.push({
          r: placement.row,
          c: placement.col,
          kind,
          token: placement.assigned ?? kind,
          by: placement.by === seat ? "A" : "B",
          placedTurn: placement.placedTurn,
        });
        break;
      case "rack":
        if (placement.side === seat) rack.push({ seq: placement.seq, kind });
        else opponentRack += 1;
        break;
      case "bag":
        bag += 1;
        break;
      case "pendingReturn":
        pendingReturn += 1;
        break;
    }
  });
  board.sort((first, second) => first.r - second.r || first.c - second.c);
  rack.sort((first, second) => first.seq - second.seq);
  if (opponentRack !== getRack(game, opponent).length) {
    throw new Error("ArchBot's view of the opponent's rack size is inconsistent");
  }

  return {
    board,
    rack: rack.map((entry) => entry.kind),
    bagCount: bag + pendingReturn,
    oppRackCount: opponentRack,
    myScore: game.scores[seat],
    oppScore: game.scores[opponent],
    noScoreStreak: noScoreStreakOf(game),
    exchangeAllowed: getExchangeRule(game).allowed,
    seed: seedFor(roomId, revision),
    topN: ARCHBOT_TOP_N,
    turnNumber: game.turnNumber,
  };
}
