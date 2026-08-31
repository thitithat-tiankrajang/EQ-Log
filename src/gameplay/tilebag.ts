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
  type Side,
  type TileInstance,
  type TurnLog,
} from "../game";
import { clearTileAssignment } from "./tiles";

/**
 * What `remainingCount` is actually counting.
 *
 * The number is not always the bag, and that is the whole reason this field
 * exists. Near the end of a game the honest count of "tiles you cannot see"
 * stops being derivable from the board alone and becomes the bag plus the
 * opponent's rack — at which point a heading that still says "Tilebag" is
 * telling the player something false about a number they are using to plan.
 *
 * The label follows THIS, never the game state directly, so every surface that
 * shows the count says the same word about it.
 */
export type TilebagCountKind =
  /** Tiles still in the physical bag. */
  | "bag"
  /** Bag + the opponent's rack: everything the viewer cannot see. */
  | "unseen"
  /** The bag is empty, so the unseen pool IS the opponent's rack. */
  | "opponent-rack";

/** What the `tiles` LIST holds, which is not always what the count counts. */
export type TilebagListKind =
  /** Exactly the tiles in the physical bag — safe to pick from. */
  | "bag"
  /** Bag + the opponent's rack. */
  | "unseen";

export type TilebagView = {
  /**
   * In any branch with a live opponent this is the unseen pool (bag + opponent
   * rack), deliberately wider than `remainingCount`: a list narrowed to the real
   * bag would reveal the opponent's rack by subtraction. `listKind` says which
   * of the two it is, so the list can be labelled for what it holds instead of
   * borrowing the count's heading.
   */
  tiles: TileInstance[];
  listKind: TilebagListKind;
  remainingCount: number;
  kind: TilebagCountKind;
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
  concealOpponentRack = false,
  viewerSide = null,
}: {
  game: GameState;
  refillNeeded: boolean;
  reviewing: boolean;
  selectedLog: TurnLog | null;
  concealOpponentRack?: boolean;
  viewerSide?: Side | null;
}): TilebagView {
  if (reviewing && selectedLog) return getReplayTilebagView(game, selectedLog);

  if (concealOpponentRack && getGameMode(game) !== "solo") {
    return {
      // Before the physical bag is empty, a player only knows the combined
      // unseen pool. Once it reaches zero, this naturally becomes the
      // opponent rack and reveals it at the correct time.
      tiles: viewerSide ? [...game.tilebag, ...getRack(game, otherSide(viewerSide))] : game.tilebag,
      listKind: viewerSide ? "unseen" : "bag",
      remainingCount: game.tilebag.length,
      kind: "bag",
    };
  }

  if (refillNeeded) {
    const activeRackCount = getRack(game, game.activeSide).length;
    const activeReturnedCount = getPendingExchangeReturnBySide(game)[game.activeSide].length;
    return {
      tiles: game.tilebag,
      listKind: "bag",
      remainingCount: getRefillRemainingCount(
        game.tilebag.length,
        activeRackCount,
        activeReturnedCount,
      ),
      kind: "bag",
    };
  }

  if (getGameMode(game) === "solo") {
    return {
      tiles: game.tilebag,
      listKind: "bag",
      remainingCount: game.tilebag.length,
      kind: "bag",
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
      listKind: "bag",
      remainingCount: selectedLog.tilebagBefore.length,
      kind: "bag",
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
  // Two different quantities under one number, which is why the branch also
  // decides the label. While the bag can still fill the opponent back up, both
  // racks are effectively full and `84 − board` IS the bag. Once it cannot, the
  // only honest count left is the whole unseen pool.
  const pooled = tilebag.length < opponentEmptySlotCount;
  const remainingCount = pooled
    ? tilebag.length + opponentRack.length
    : Math.max(ACTION_HIDDEN_TILE_BASE_COUNT - boardTileCount, 0);

  return {
    tiles: [...tilebag, ...opponentRack],
    listKind: "unseen",
    remainingCount,
    kind: pooled ? (tilebag.length === 0 ? "opponent-rack" : "unseen") : "bag",
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
