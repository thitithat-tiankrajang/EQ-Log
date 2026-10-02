import type { RankedMatchView } from "../features/ranked/publicView";
import { displayToken } from "../game";
import { seedFor } from "../bot/superRequest";
import type { SuperEngineRequest } from "../bot/superTypes";
import { EXCHANGE_MIN_RESERVE, RACK_SIZE } from "../constants/gameRules";
import type { LiveGameView } from "./projection";
import { ANALYSIS_LEVEL_SAMPLES, type AnalysisLevel } from "../bot/engineApi";

/** Player analysis accepts only an authorized projection, never a canonical game. */
export function ownAnalysisRequest(
  view: RankedMatchView,
  options?: { logId?: string; level?: AnalysisLevel },
): SuperEngineRequest {
  const logs = [
    ...view.logs,
    ...((view as LiveGameView).timeline?.lines.flatMap((line) => line.logs) ?? []),
  ];
  const historical = options?.logId ? logs.find((log) => log.id === options.logId) : null;
  if (options?.logId && !historical) throw new Error("That turn is unavailable.");
  const hostRack = (view as LiveGameView).hostRacks?.[view.activeSide];
  const side = historical ? historical.side : hostRack ? view.activeSide : view.yourSide;
  if (
    !side ||
    view.status !== "playing" ||
    (historical
      ? historical.side !== view.yourSide || !historical.rackBefore || !historical.analysisContext
      : side !== view.activeSide)
  )
    throw new Error("Analysis requires your current turn.");
  const board: SuperEngineRequest["board"] = [];
  (historical?.boardBefore ?? view.board).forEach((row, r) =>
    row.forEach((placed, c) => {
      if (placed) board.push({ r, c, kind: placed.tile.token, token: displayToken(placed.tile) });
    }),
  );
  let noScoreStreak = 0;
  for (const log of [...view.logs].reverse()) {
    if (log.action === "end_game") continue;
    if (log.score > 0) break;
    noScoreStreak++;
  }
  const opponent = side === "A" ? "B" : "A";
  const bagCount = historical?.analysisContext?.bagCount ?? view.tilebagCount;
  const oppRackCount = historical?.analysisContext?.oppRackCount ?? view.rackCount[opponent];
  return {
    board,
    rack: (historical?.rackBefore ?? hostRack ?? view.yourRack).map((tile) => tile.token),
    bagCount,
    oppRackCount,
    myScore: (historical?.analysisContext?.scores ?? view.scores)[side],
    oppScore: (historical?.analysisContext?.scores ?? view.scores)[opponent],
    noScoreStreak: historical?.analysisContext?.noScoreStreak ?? noScoreStreak,
    exchangeAllowed: bagCount + oppRackCount - RACK_SIZE >= EXCHANGE_MIN_RESERVE,
    difficulty: "super",
    solver: "sim",
    unlimited: true,
    topN: 5,
    ...(options?.level && options.level !== "stage5b64"
      ? { sampleCap: ANALYSIS_LEVEL_SAMPLES[options.level] }
      : {}),
    seed: seedFor(view.id, view.revision),
  };
}

export async function analyzeOwnTurn(
  view: RankedMatchView,
  signal: AbortSignal,
  options?: { logId?: string; level?: AnalysisLevel },
) {
  const request = ownAnalysisRequest(view, options);
  if (options?.level === "stage5b64") {
    const historical = [
      ...view.logs,
      ...((view as LiveGameView).timeline?.lines.flatMap((line) => line.logs) ?? []),
    ].find((log) => log.id === options.logId);
    const { createArchBotEngine } = await import("../bot/archbot/client");
    const engine = createArchBotEngine();
    const side = options.logId
      ? historical!.side
      : (view as LiveGameView).hostRacks
        ? view.activeSide
        : view.yourSide!;
    const board = options.logId ? historical!.boardBefore! : view.board;
    try {
      const result = await engine.decide({
        key: { roomId: view.id, revision: view.revision },
        request: {
          ...request,
          board: request.board.map((cell) => ({
            ...cell,
            by: board[cell.r][cell.c]!.side === side ? "A" : "B",
          })),
        },
        signal,
      });
      return { response: result.decision };
    } finally {
      engine.dispose();
    }
  }
  const engine = await import("../bot/superEngine");
  return engine.think({ request, signal });
}
