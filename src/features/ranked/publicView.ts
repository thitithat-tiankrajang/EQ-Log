import type { BoardSnapshot, GameState, Side, TileInstance, TurnLog } from "../../game";
import { resultOf } from "./rules";

export type RankedTurnView = {
  id: string;
  turnNumber: number;
  side: Side;
  action: TurnLog["action"];
  score: number;
  exchangedCount: number;
  boardAfter: BoardSnapshot;
  rackBefore?: TileInstance[];
  rackAfter?: TileInstance[];
};

export type RankedMatchView = {
  id: string;
  revision: number;
  status: "waiting" | "matched" | "playing" | "finished";
  playerAId: string;
  playerBId: string | null;
  players: Record<Side, string>;
  startingSide: Side;
  activeSide: Side;
  turnNumber: number;
  scores: Record<Side, number>;
  timers: Record<Side, number>;
  clockStartedAt: string;
  board: BoardSnapshot;
  tilebagCount: number;
  rackCount: Record<Side, number>;
  readyBySide: Partial<Record<Side, boolean>>;
  yourSide: Side | null;
  yourRack: TileInstance[];
  logs: RankedTurnView[];
  result: ReturnType<typeof resultOf>;
  ratingChange?: { before: number; after: number };
};

/** This allowlist is the ONLY game payload the ranked endpoint may return. */
export function rankedPublicView(
  id: string,
  revision: number,
  game: GameState,
  viewerId: string,
): RankedMatchView {
  const yourSide: Side | null =
    game.playerUserIds?.A === viewerId ? "A" : game.playerUserIds?.B === viewerId ? "B" : null;
  return {
    id,
    revision,
    status:
      game.roomStage === "waiting"
        ? game.playerUserIds?.B
          ? "matched"
          : "waiting"
        : game.status === "finished"
          ? "finished"
          : "playing",
    playerAId: game.playerUserIds?.A ?? "",
    playerBId: game.playerUserIds?.B ?? null,
    players: game.players,
    startingSide: game.startingSide ?? "A",
    activeSide: game.activeSide,
    turnNumber: game.turnNumber,
    scores: game.scores,
    timers: { A: game.timers.A, B: game.timers.B },
    clockStartedAt: game.currentTurnStartedAt,
    board: game.board,
    tilebagCount: game.tilebag.length,
    rackCount: { A: game.rackA.length, B: game.rackB.length },
    readyBySide: { A: game.lobbyReadyBySide?.A ?? false, B: game.lobbyReadyBySide?.B ?? false },
    yourSide,
    yourRack:
      game.roomStage === "playing"
        ? yourSide === "A"
          ? game.rackA
          : yourSide === "B"
            ? game.rackB
            : []
        : [],
    logs: game.logs.map((log) => ({
      id: log.id,
      turnNumber: log.turnNumber,
      side: log.side,
      action: log.action,
      score: log.finalScore,
      exchangedCount:
        log.action === "exchange"
          ? (log.actionDetail as { outgoingTiles: TileInstance[] }).outgoingTiles.length
          : 0,
      boardAfter: log.boardAfter,
      ...(yourSide === log.side ? { rackBefore: log.rackBefore, rackAfter: log.rackAfter } : {}),
    })),
    result: resultOf(game),
  };
}
