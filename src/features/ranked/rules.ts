import {
  advanceToOpponentTurn,
  boardWithPending,
  calculateTotals,
  createNewGame,
  createPlaceDetail,
  getAssignmentOptions,
  getRack,
  otherSide,
  setRack,
  shuffleTilebagQueue,
  validateMove,
  type GameState,
  type PendingPlacement,
  type Side,
  type TurnLog,
} from "../../game";
import { createAutomaticEndGameLog, createSurrenderEndGameLog } from "../../gameplay/endGame";
import { getExchangeRule, refillRackFromQueue } from "../../gameplay/tilebag";

export const RANKED_TIME_OPTIONS = [10, 15, 20, 30] as const;

export type RankedAction =
  | {
      kind: "place";
      placements: { tileId: string; row: number; col: number; assignedToken?: string }[];
    }
  | { kind: "exchange"; tileIds: string[] }
  | { kind: "pass" }
  | { kind: "resign" };

export type RankedResult = { winner: Side | null; reason: "score" | "resign" | "timeout" };

export function createRankedGame(
  creatorId: string,
  creatorName: string,
  minutesA: number,
  minutesB: number,
  startingSide: Side,
): GameState {
  if (!isRankedTime(minutesA) || minutesA !== minutesB)
    throw new Error("Ranked clocks must match.");
  const game = createNewGame({
    name: "Ranked match",
    gameMode: "versus",
    playerA: creatorName,
    playerB: "Waiting for opponent",
    playerAUserId: creatorId,
    playerBUserId: null,
    emailPlayMode: "direct",
    emailPlayersCanSeeOpponentRack: false,
    timerMinutes: { A: minutesA, B: minutesB },
    startingSide,
    tileDrawMode: "play",
  });
  return {
    ...game,
    roomStage: "waiting",
    status: "draft",
    timers: { ...game.timers, paused: true },
    history: [],
  };
}

export function isRankedTime(value: number): boolean {
  return RANKED_TIME_OPTIONS.includes(value as (typeof RANKED_TIME_OPTIONS)[number]);
}

/** Full private position in, lawful next private position out. Only the server calls this. */
export function applyRankedAction(
  game: GameState,
  side: Side,
  action: RankedAction,
  now: string,
): GameState {
  if (game.status !== "playing" || game.roomStage !== "playing")
    throw new Error("Match is not playing.");
  if (game.activeSide !== side && action.kind !== "resign") throw new Error("It is not your turn.");
  const settled = settleRankedClock(game, now);
  if (settled.status === "finished") return settled;
  if (action.kind === "resign")
    return finishRankedGame(settled, { winner: otherSide(side), reason: "resign" }, now, side);

  const rackBefore = getRack(settled, side);
  const boardBefore = settled.board;
  const tilebagBefore = settled.tilebag;
  let boardAfter = boardBefore;
  let rackAfter = rackBefore;
  let tilebagAfter = tilebagBefore;
  let score = 0;
  let actionDetail: TurnLog["actionDetail"];
  let logAction: TurnLog["action"];

  if (action.kind === "place") {
    if (action.placements.length < 1 || action.placements.length > rackBefore.length)
      throw new Error("Invalid placement count.");
    const used = new Set<string>();
    const placements: PendingPlacement[] = action.placements.map((item) => {
      if (used.has(item.tileId)) throw new Error("A tile was used twice.");
      used.add(item.tileId);
      const tile = rackBefore.find((candidate) => candidate.id === item.tileId);
      if (!tile) throw new Error("Tile is not in your rack.");
      if (!Number.isInteger(item.row) || !Number.isInteger(item.col))
        throw new Error("Invalid board square.");
      const options = getAssignmentOptions(tile.token);
      if (options.length > 0 && !options.includes(item.assignedToken ?? ""))
        throw new Error("Invalid tile assignment.");
      if (options.length === 0 && item.assignedToken)
        throw new Error("This tile cannot be reassigned.");
      return { tile, row: item.row, col: item.col, assignedToken: item.assignedToken };
    });
    const validation = validateMove(boardBefore, placements);
    if (!validation.isValid) throw new Error(validation.errors.join(" "));
    boardAfter = boardWithPending(boardBefore, placements, settled.turnNumber, side);
    rackAfter = rackBefore.filter((tile) => !used.has(tile.id));
    score = validation.score;
    actionDetail = createPlaceDetail(validation, placements);
    logAction = "place_equation";
  } else if (action.kind === "exchange") {
    const rule = getExchangeRule(settled);
    if (!rule.allowed) throw new Error(rule.reason ?? "Exchange is unavailable.");
    const unique = new Set(action.tileIds);
    if (!unique.size || unique.size !== action.tileIds.length || unique.size > rackBefore.length)
      throw new Error("Invalid exchange selection.");
    const outgoing = action.tileIds.map((id) => {
      const tile = rackBefore.find((candidate) => candidate.id === id);
      if (!tile) throw new Error("Tile is not in your rack.");
      return tile;
    });
    if (tilebagBefore.length < outgoing.length) throw new Error("Not enough tiles to exchange.");
    const incoming = tilebagBefore.slice(0, outgoing.length);
    rackAfter = [...rackBefore.filter((tile) => !unique.has(tile.id)), ...incoming];
    tilebagAfter = shuffleTilebagQueue([...tilebagBefore.slice(outgoing.length), ...outgoing]);
    actionDetail = { outgoingTiles: outgoing, incomingTiles: incoming };
    logAction = "exchange";
  } else {
    actionDetail = {};
    logAction = "pass";
  }

  const log: TurnLog = {
    id: crypto.randomUUID(),
    turnNumber: settled.turnNumber,
    side,
    action: logAction,
    startedAt: game.currentTurnStartedAt,
    endedAt: now,
    timerBefore: { A: game.timers.A, B: game.timers.B },
    timerAfter: { A: settled.timers.A, B: settled.timers.B },
    rackBefore,
    rackAfter,
    boardBefore,
    boardAfter,
    tilebagBefore,
    tilebagAfter,
    actionDetail,
    calculatedScore: score,
    finalScore: score,
  };
  const logs = [...settled.logs, log];
  const autoEnd = createAutomaticEndGameLog({
    boardAfter,
    game: settled,
    logs,
    normalLog: log,
    rackAfter,
    tilebagAfter,
  });
  const nextLogs = autoEnd ? [...logs, autoEnd] : logs;
  let next: GameState = setRack(
    {
      ...settled,
      board: boardAfter,
      tilebag: tilebagAfter,
      logs: nextLogs,
      scores: calculateTotals(nextLogs),
      status: autoEnd ? "finished" : "playing",
      timers: autoEnd ? { ...settled.timers, paused: true } : settled.timers,
    },
    side,
    rackAfter,
  );
  if (!autoEnd) {
    if (action.kind === "place") next = refillRackFromQueue(next);
    next = advanceToOpponentTurn(next);
  }
  return { ...next, history: [], historyIndex: 0, lastSavedAt: now };
}

export function settleRankedClock(game: GameState, now: string): GameState {
  if (game.status !== "playing" || game.roomStage !== "playing") return game;
  const elapsed = Math.max(
    0,
    Math.floor((Date.parse(now) - Date.parse(game.currentTurnStartedAt)) / 1000),
  );
  if (!Number.isFinite(elapsed) || elapsed < 1) return game;
  const side = game.activeSide;
  const remaining = Math.max(0, game.timers[side] - elapsed);
  const next = {
    ...game,
    timers: { ...game.timers, [side]: remaining },
    currentTurnStartedAt: now,
  };
  return remaining === 0
    ? finishRankedGame(next, { winner: otherSide(side), reason: "timeout" }, now, side)
    : next;
}

export function resultOf(game: GameState): RankedResult | null {
  if (game.status !== "finished") return null;
  const last = game.logs.at(-1);
  const detail =
    last?.action === "end_game"
      ? (last.actionDetail as { reason?: string; surrenderedSide?: Side })
      : null;
  if (detail?.reason === "timeout")
    return {
      winner: detail.surrenderedSide ? otherSide(detail.surrenderedSide) : null,
      reason: "timeout",
    };
  if (detail?.reason === "surrender")
    return {
      winner: detail.surrenderedSide ? otherSide(detail.surrenderedSide) : null,
      reason: "resign",
    };
  return {
    winner: game.scores.A === game.scores.B ? null : game.scores.A > game.scores.B ? "A" : "B",
    reason: "score",
  };
}

function finishRankedGame(
  game: GameState,
  result: RankedResult,
  now: string,
  losingSide: Side,
): GameState {
  const surrenderLog = createSurrenderEndGameLog(game, losingSide);
  const finalLog: TurnLog =
    result.reason === "timeout"
      ? {
          ...surrenderLog,
          actionDetail: {
            ...surrenderLog.actionDetail,
            reason: "timeout",
            description: `${game.players[losingSide]} ran out of time.`,
          } as TurnLog["actionDetail"],
        }
      : surrenderLog;
  return {
    ...game,
    logs: [...game.logs, finalLog],
    status: "finished",
    timers: { ...game.timers, paused: true },
    lastSavedAt: now,
  };
}
