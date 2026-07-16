import {
  ACTION_HIDDEN_TILE_BASE_COUNT,
  EXCHANGE_MIN_RESERVE,
  RACK_SIZE,
} from "../constants/gameRules";
import {
  aggregatePendingExchangeReturns,
  getPendingExchangeReturnBySide,
  getGameMode,
  getRack,
  otherSide,
  setRack,
  shuffleTilebagQueue,
  type GameState,
  type TileInstance,
  type TurnLog,
} from "../game";
import { clearTileAssignment } from "./tiles";

export type TilebagView = {
  tiles: TileInstance[];
  remainingCount: number;
};

export type ExchangeRule = {
  allowed: boolean;
  reserve: number;
  reason?: string;
};

export function refillRackFromQueue(game: GameState): GameState {
  const rack = getRack(game, game.activeSide);
  const pendingBySide = getPendingExchangeReturnBySide(game);
  const needed = Math.max(0, RACK_SIZE - rack.length);
  const drawnTiles = game.tilebag.slice(0, needed).map(clearTileAssignment);
  const remainingQueue = game.tilebag.slice(drawnTiles.length);
  const rackAfter = [...rack, ...drawnTiles];
  const pendingReturn = pendingBySide[game.activeSide].map(clearTileAssignment);
  const nextPendingBySide = { ...pendingBySide, [game.activeSide]: [] };
  const rackReady = rackAfter.length >= RACK_SIZE || remainingQueue.length === 0;
  const tilebagAfter = shuffleTilebagQueue([...remainingQueue, ...pendingReturn]);

  return setRack(
    {
      ...game,
      tilebag: tilebagAfter,
      pendingExchangeReturn: aggregatePendingExchangeReturns(nextPendingBySide),
      pendingExchangeReturnBySide: nextPendingBySide,
      phase: rackReady ? "choose_action" : "refill",
      lastSavedAt: new Date().toISOString(),
    },
    game.activeSide,
    rackAfter,
  );
}

export function getTilebagView({
  game,
  refillNeeded,
  reviewing,
  selectedLog,
}: {
  game: GameState;
  refillNeeded: boolean;
  reviewing: boolean;
  selectedLog: TurnLog | null;
}): TilebagView {
  if (reviewing && selectedLog) return getReplayTilebagView(game, selectedLog);

  if (refillNeeded) {
    const activeRackCount = getRack(game, game.activeSide).length;
    const activeReturnedCount = getPendingExchangeReturnBySide(game)[game.activeSide].length;
    return {
      tiles: game.tilebag,
      remainingCount: getRefillRemainingCount(
        game.tilebag.length,
        activeRackCount,
        activeReturnedCount,
      ),
    };
  }

  if (getGameMode(game) === "solo") {
    return {
      tiles: game.tilebag,
      remainingCount: game.tilebag.length,
    };
  }

  const opponentSide = otherSide(game.activeSide);
  return getActionTilebagView({
    board: game.board,
    opponentRack: getRack(game, opponentSide),
    tilebag: game.tilebag,
  });
}

export function getExchangeRule(game: GameState): ExchangeRule {
  if (getGameMode(game) === "solo") {
    const reserve = game.tilebag.length;
    if (reserve >= EXCHANGE_MIN_RESERVE) return { allowed: true, reserve };
    return {
      allowed: false,
      reserve,
      reason: `Exchange locked: tilebag (${game.tilebag.length}) = ${reserve}; minimum is ${EXCHANGE_MIN_RESERVE}.`,
    };
  }

  const opponentRackCount = getRack(game, otherSide(game.activeSide)).length;
  const reserve = game.tilebag.length + opponentRackCount - RACK_SIZE;
  if (reserve >= EXCHANGE_MIN_RESERVE) return { allowed: true, reserve };
  return {
    allowed: false,
    reserve,
    reason: `Exchange locked: tilebag (${game.tilebag.length}) + opponent rack (${opponentRackCount}) - ${RACK_SIZE} = ${reserve}; minimum is ${EXCHANGE_MIN_RESERVE}.`,
  };
}

function getReplayTilebagView(game: GameState, selectedLog: TurnLog): TilebagView {
  if (getGameMode(game) === "solo") {
    return {
      tiles: selectedLog.tilebagBefore,
      remainingCount: selectedLog.tilebagBefore.length,
    };
  }
  const logIndex = game.logs.findIndex((log) => log.id === selectedLog.id);
  const previousLog = getLastPlayableLogBefore(game.logs, logIndex);
  const opponent = otherSide(selectedLog.side);
  const opponentRack = previousLog?.side === opponent ? previousLog.rackAfter : [];
  return getActionTilebagView({
    board: selectedLog.boardBefore,
    opponentRack,
    tilebag: selectedLog.tilebagBefore,
  });
}

function getActionTilebagView({
  board,
  opponentRack,
  tilebag,
}: {
  board: GameState["board"];
  opponentRack: TileInstance[];
  tilebag: TileInstance[];
}): TilebagView {
  const opponentEmptySlotCount = Math.max(RACK_SIZE - opponentRack.length, 0);
  const boardTileCount = board.reduce(
    (total, row) => total + row.filter((cell) => cell !== null).length,
    0,
  );
  const remainingCount =
    tilebag.length < opponentEmptySlotCount
      ? tilebag.length + opponentRack.length
      : Math.max(ACTION_HIDDEN_TILE_BASE_COUNT - boardTileCount, 0);

  return {
    tiles: [...tilebag, ...opponentRack],
    remainingCount,
  };
}

function getRefillRemainingCount(
  tilebagCount: number,
  activeRackCount: number,
  activeReturnedCount: number,
): number {
  const needed = Math.max(RACK_SIZE - activeRackCount, 0);
  const drawnCount = Math.min(needed, tilebagCount);
  return Math.max(tilebagCount - drawnCount + activeReturnedCount, 0);
}

function getLastPlayableLogBefore(logs: TurnLog[], beforeIndex: number): TurnLog | null {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const log = logs[index];
    if (log.action !== "end_game") return log;
  }
  return null;
}
