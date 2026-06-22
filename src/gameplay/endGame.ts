import {
  NO_SCORE_STREAK_LENGTH,
  NO_SCORE_TURNS_PER_SIDE,
  RACK_OUT_MAX_REMAINING,
} from "../constants/gameRules";
import {
  deepClone,
  getRack,
  otherSide,
  tilePoint,
  type ActionType,
  type BoardSnapshot,
  type EndGameDetail,
  type GameState,
  type Side,
  type TileInstance,
  type TurnLog,
} from "../game";

export function createAutomaticEndGameLog({
  boardAfter,
  game,
  logs,
  normalLog,
  rackAfter,
  tilebagAfter,
}: {
  boardAfter: BoardSnapshot;
  game: GameState;
  logs: TurnLog[];
  normalLog: TurnLog;
  rackAfter: TileInstance[];
  tilebagAfter: TileInstance[];
}): TurnLog | null {
  const activeSide = game.activeSide;
  const opponentSide = otherSide(activeSide);
  const opponentRack = getRack(game, opponentSide);
  const now = new Date().toISOString();

  if (normalLog.action === "place_equation" && rackAfter.length === 0) {
    const remainingOpponentAndBag = opponentRack.length + tilebagAfter.length;
    if (remainingOpponentAndBag <= RACK_OUT_MAX_REMAINING) {
      const opponentRackPoints = sumTilePoints(opponentRack);
      const tilebagPoints = sumTilePoints(tilebagAfter);
      const bonusPoints = (opponentRackPoints + tilebagPoints) * 2;
      return createEndGameLog({
        boardAfter,
        detail: {
          reason: "rack_out",
          description: `${game.players[activeSide]} emptied the rack. ${game.players[opponentSide]}'s rack and the tilebag contain ${remainingOpponentAndBag} tile(s).`,
          bonusSide: activeSide,
          bonusPoints,
          opponentRackPoints,
          tilebagPoints,
        },
        endedAt: now,
        game,
        rack: rackAfter,
        side: activeSide,
        tilebagAfter,
      });
    }
  }

  const openingPlacementCompleted = logs.some((log) => log.action === "place_equation");
  if (
    openingPlacementCompleted &&
    isNoScoreAction(normalLog.action) &&
    hasNoScoreStreak(logs)
  ) {
    const rackBySide: Record<Side, TileInstance[]> = {
      A: activeSide === "A" ? rackAfter : getRack(game, "A"),
      B: activeSide === "B" ? rackAfter : getRack(game, "B"),
    };
    const rackPoints: Record<Side, number> = {
      A: sumTilePoints(rackBySide.A),
      B: sumTilePoints(rackBySide.B),
    };
    const bonusSide: Side | undefined =
      rackPoints.A === rackPoints.B ? undefined : rackPoints.A < rackPoints.B ? "A" : "B";
    const bonusPoints = bonusSide ? Math.abs(rackPoints.A - rackPoints.B) : 0;
    const scoringSide = bonusSide ?? activeSide;
    return createEndGameLog({
      boardAfter,
      detail: {
        reason: "no_score_streak",
        description: bonusSide
          ? `${NO_SCORE_STREAK_LENGTH} consecutive non-scoring turns. ${game.players[bonusSide]} has the lower rack total and receives ${bonusPoints} point(s).`
          : `${NO_SCORE_STREAK_LENGTH} consecutive non-scoring turns. Rack totals are tied, so no bonus is awarded.`,
        bonusSide,
        bonusPoints,
        rackPoints,
        noScoreStreak: NO_SCORE_STREAK_LENGTH,
      },
      endedAt: now,
      game,
      rack: rackBySide[scoringSide],
      side: scoringSide,
      tilebagAfter,
    });
  }

  return null;
}

function isNoScoreAction(action: ActionType): boolean {
  return action === "pass" || action === "exchange";
}

function hasNoScoreStreak(logs: TurnLog[]): boolean {
  const recent = logs.slice(-NO_SCORE_STREAK_LENGTH);
  if (recent.length < NO_SCORE_STREAK_LENGTH) return false;
  if (!recent.every((log) => isNoScoreAction(log.action))) return false;
  const counts = recent.reduce<Record<Side, number>>(
    (total, log) => ({ ...total, [log.side]: total[log.side] + 1 }),
    { A: 0, B: 0 },
  );
  return counts.A === NO_SCORE_TURNS_PER_SIDE && counts.B === NO_SCORE_TURNS_PER_SIDE;
}

function sumTilePoints(tiles: TileInstance[]): number {
  return tiles.reduce((sum, tile) => sum + tilePoint(tile), 0);
}

function createEndGameLog({
  boardAfter,
  detail,
  endedAt,
  game,
  rack,
  side,
  tilebagAfter,
}: {
  boardAfter: BoardSnapshot;
  detail: EndGameDetail;
  endedAt: string;
  game: GameState;
  rack: TileInstance[];
  side: Side;
  tilebagAfter: TileInstance[];
}): TurnLog {
  return {
    id: crypto.randomUUID(),
    turnNumber: game.turnNumber,
    side,
    action: "end_game",
    startedAt: endedAt,
    endedAt,
    timerBefore: { A: game.timers.A, B: game.timers.B },
    timerAfter: { A: game.timers.A, B: game.timers.B },
    rackBefore: deepClone(rack),
    rackAfter: deepClone(rack),
    boardBefore: deepClone(boardAfter),
    boardAfter: deepClone(boardAfter),
    tilebagBefore: deepClone(tilebagAfter),
    tilebagAfter: deepClone(tilebagAfter),
    actionDetail: detail,
    calculatedScore: detail.bonusPoints,
    finalScore: detail.bonusPoints,
  };
}
