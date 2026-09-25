// Play a game through the same transitions the board does, without the board.
//
// `commit` mirrors `commitLog` in App.tsx step for step — record the turn, keep the mover
// active, auto-draw and hand over in play mode, open a refill in manual mode — and pushes the
// same history snapshot. Branching reads positions back out of exactly that history, so a
// simulator that skipped any of it would be testing a game that does not exist.
//
// Moves are physically real (tiles leave racks, land on the board, go back to the bag) but not
// equation-valid: nothing here reads the equations, and the physical set is what must add up.
import {
  advanceToOpponentTurn,
  aggregatePendingExchangeReturns,
  boardWithPending,
  calculateTotals,
  createNewGame,
  deepClone,
  finalizeRefillTransition,
  getPendingExchangeReturnBySide,
  getRack,
  getTileDrawMode,
  isRackReady,
  pushActionSnapshot,
  setRack,
  type ActionType,
  type BoardSnapshot,
  type GameState,
  type PendingPlacement,
  type TileInstance,
  type TurnActionDetail,
  type TurnLog,
} from "../../src/game";
import { RACK_SIZE } from "../../src/constants/gameRules";
import { refillRackFromQueue } from "../../src/gameplay/tilebag";
import { clearTileAssignment } from "../../src/gameplay/tiles";

let serial = 0;

export function newGame(mode: "play" | "manual" = "play"): GameState {
  const game = createNewGame({
    name: "Multiverse",
    playerA: "Ann",
    playerB: "Ben",
    startingSide: "A",
    tileDrawMode: mode,
  });
  return mode === "manual" ? manualRefill(game) : game;
}

/** Manual mode: draw from the front of the bag until the rack is ready, as the host would. */
export function manualRefill(game: GameState): GameState {
  let current = game;
  while (current.phase === "refill" && !isRackReady(current)) {
    const rack = getRack(current, current.activeSide);
    const tile = current.tilebag[0]!;
    const tilebag = current.tilebag.slice(1);
    const rackReady = rack.length + 1 >= RACK_SIZE || tilebag.length === 0;
    const pendingBySide = getPendingExchangeReturnBySide(current);
    const returned = rackReady ? pendingBySide[current.activeSide] : [];
    const nextPending = rackReady ? { ...pendingBySide, [current.activeSide]: [] } : pendingBySide;
    const filled = setRack(
      {
        ...current,
        tilebag: returned.length > 0 ? [...tilebag, ...returned] : tilebag,
        pendingExchangeReturn: aggregatePendingExchangeReturns(nextPending),
        pendingExchangeReturnBySide: nextPending,
      },
      current.activeSide,
      [...rack, tile],
    );
    current = rackReady ? finalizeRefillTransition(filled) : filled;
  }
  return current;
}

function turnLog(
  game: GameState,
  action: ActionType,
  rackBefore: TileInstance[],
  rackAfter: TileInstance[],
  boardAfter: BoardSnapshot,
  detail: TurnActionDetail,
  score: number,
): TurnLog {
  serial += 1;
  return {
    id: `turn-${serial}`,
    turnNumber: game.turnNumber,
    side: game.activeSide,
    action,
    startedAt: game.currentTurnStartedAt,
    endedAt: new Date(Date.parse(game.currentTurnStartedAt) + 1000).toISOString(),
    timerBefore: { A: game.timers.A, B: game.timers.B },
    timerAfter: { A: game.timers.A, B: game.timers.B },
    rackBefore,
    rackAfter: deepClone(rackAfter),
    boardBefore: deepClone(game.board),
    boardAfter: deepClone(boardAfter),
    tilebagBefore: deepClone(game.tilebag),
    tilebagAfter: deepClone(game.tilebag),
    actionDetail: detail,
    calculatedScore: score,
    finalScore: score,
  };
}

/** `App.commitLog`, minus React. */
function commit(
  game: GameState,
  log: TurnLog,
  boardAfter: BoardSnapshot,
  rackAfter: TileInstance[],
  floatingTiles?: TileInstance[],
): GameState {
  const logs = [...game.logs, log];
  const pendingBySide = getPendingExchangeReturnBySide(game);
  const nextPending = floatingTiles
    ? { ...pendingBySide, [game.activeSide]: floatingTiles }
    : pendingBySide;
  const moved = setRack(
    {
      ...game,
      board: boardAfter,
      pendingExchangeReturn: aggregatePendingExchangeReturns(nextPending),
      pendingExchangeReturnBySide: nextPending,
      logs,
      scores: calculateTotals(logs),
    },
    game.activeSide,
    rackAfter,
  );
  let next: GameState;
  if (getTileDrawMode(moved) === "play") {
    next = advanceToOpponentTurn(isRackReady(moved) ? moved : refillRackFromQueue(moved));
  } else if (!isRackReady(moved)) {
    next = { ...moved, phase: "refill" };
  } else {
    next = advanceToOpponentTurn(moved);
  }
  return pushActionSnapshot(next);
}

export function pass(game: GameState): GameState {
  const rack = getRack(game, game.activeSide);
  const log = turnLog(game, "pass", deepClone(rack), rack, game.board, {}, 0);
  return settle(commit(game, log, game.board, deepClone(rack)));
}

export function exchange(game: GameState, count: number): GameState {
  const rack = getRack(game, game.activeSide);
  const outgoing = rack.slice(0, count);
  const kept = rack.slice(count);
  const log = turnLog(
    game,
    "exchange",
    deepClone(rack),
    kept,
    game.board,
    { outgoingTiles: outgoing, incomingTiles: [] },
    0,
  );
  return settle(commit(game, log, game.board, kept, outgoing.map(clearTileAssignment)));
}

/** Put the first `count` rack tiles in a row of empty squares. */
export function place(game: GameState, count: number, score = count * 3): GameState {
  const rack = getRack(game, game.activeSide);
  const row = game.board.findIndex((cells) => cells.every((cell) => cell === null));
  if (row < 0) throw new Error("The simulator ran out of empty rows.");
  const placements: PendingPlacement[] = rack
    .slice(0, count)
    .map((tile, col) => ({ tile, row, col }));
  const boardAfter = boardWithPending(game.board, placements, game.turnNumber, game.activeSide);
  const kept = rack.slice(count).map(clearTileAssignment);
  const log = turnLog(
    game,
    "place_equation",
    deepClone(rack),
    kept,
    boardAfter,
    {
      placedTiles: placements.map((placement) => ({
        tileId: placement.tile.id,
        token: placement.tile.token,
        displayToken: placement.tile.token,
        row: placement.row,
        col: placement.col,
      })),
      equationsDetected: [],
      isMoveValid: true,
      errors: [],
    },
    score,
  );
  return settle(commit(game, log, boardAfter, kept));
}

/** In manual mode the host refills before the turn can pass; do it, like a host would. */
function settle(game: GameState): GameState {
  return getTileDrawMode(game) === "manual" ? manualRefill(game) : game;
}

/** A game `turns` long, alternating place and pass so both sides move and the board fills. */
export function playTurns(game: GameState, turns: number): GameState {
  let current = game;
  for (let turn = 0; turn < turns; turn += 1) {
    current = turn % 3 === 2 ? exchange(current, 2) : place(current, 2 + (turn % 2));
  }
  return current;
}
