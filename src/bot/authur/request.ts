import { displayToken, getRack, otherSide, type GameState, type Side } from "../../game";
import { seedFor } from "../superRequest";

/** No opponent tile kinds cross this boundary, even though a bot room stores them. */
export type AuthurRequest = {
  roomId: string;
  revision: number;
  seed: number;
  side: Side;
  board: Array<{ cell: number; kind: string; face: string; side: Side; turn: number }>;
  rack: string[];
  ownPending: string[];
  opponentRackCount: number;
  opponentPendingCount: number;
  bagCount: number;
  scores: Record<Side, number>;
  turnNumber: number;
  noScoreTail: Side[];
};

export function buildAuthurRequest(game: GameState, roomId: string, revision: number): AuthurRequest {
  const side = game.botSide;
  if (!side || game.botEngine !== "authur") throw new Error("Not an Authur game");
  const opponent = otherSide(side);
  const board: AuthurRequest["board"] = [];
  for (let row = 0; row < game.board.length; row += 1) {
    for (let col = 0; col < game.board[row]!.length; col += 1) {
      const placed = game.board[row]![col];
      if (!placed) continue;
      board.push({
        cell: row * game.boardSize + col,
        kind: placed.tile.token,
        face: displayToken(placed.tile),
        side: placed.side,
        turn: placed.placedTurn,
      });
    }
  }
  const noScoreTail: Side[] = [];
  for (let index = game.logs.length - 1; index >= 0 && noScoreTail.length < 6; index -= 1) {
    const log = game.logs[index]!;
    if (log.action === "end_game") continue;
    if (log.finalScore > 0) break;
    noScoreTail.unshift(log.side);
  }
  return {
    roomId,
    revision,
    seed: seedFor(roomId, revision),
    side,
    board,
    rack: getRack(game, side).map((tile) => tile.token),
    ownPending: (game.pendingExchangeReturnBySide?.[side] ?? []).map((tile) => tile.token),
    opponentRackCount: getRack(game, opponent).length,
    opponentPendingCount: game.pendingExchangeReturnBySide?.[opponent]?.length ?? 0,
    bagCount: game.tilebag.length,
    scores: { ...game.scores },
    turnNumber: game.turnNumber,
    noScoreTail,
  };
}
