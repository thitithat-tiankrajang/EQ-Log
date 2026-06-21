import { EXCHANGE_MIN_RESERVE, RACK_SIZE } from "../constants/gameRules";
import {
  aggregatePendingExchangeReturns,
  getPendingExchangeReturnBySide,
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

  const opponentSide = otherSide(game.activeSide);
  return getActionTilebagView({
    opponentRack: getRack(game, opponentSide),
    tilebag: game.tilebag,
  });
}

export function getExchangeRule(game: GameState): ExchangeRule {
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
  const logIndex = game.logs.findIndex((log) => log.id === selectedLog.id);
  const previousLog = getLastPlayableLogBefore(game.logs, logIndex);
  const opponent = otherSide(selectedLog.side);
  const opponentRack = previousLog?.side === opponent ? previousLog.rackAfter : [];
  return getActionTilebagView({
    opponentRack,
    tilebag: selectedLog.tilebagBefore,
  });
}

function getActionTilebagView({
  opponentRack,
  tilebag,
}: {
  opponentRack: TileInstance[];
  tilebag: TileInstance[];
}): TilebagView {
  return {
    tiles: [...tilebag, ...opponentRack],
    // During action selection, this is every tile hidden from the active player.
    // Any exchange return due this turn is already part of tilebag after refill.
    remainingCount: tilebag.length + opponentRack.length,
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
