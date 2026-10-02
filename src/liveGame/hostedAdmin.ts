import { calculateGameTotals, updateLogScore, type GameState } from "../game";
import { settleNormalClock } from "../features/ranked/rules";

/** Administration refers only to public log IDs and lifecycle decisions. */
export type HostedAction =
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "finish" }
  | { kind: "correct-score"; logId: string; score: number };

export function applyHostedAction(game: GameState, action: HostedAction, now: string): GameState {
  if (
    (game.emailPlayMode !== "hosted" &&
      game.gameMode !== "solo" &&
      game.emailPlayMode !== undefined) ||
    game.botSide ||
    game.roomStage !== "playing" ||
    game.status === "finished"
  )
    throw new Error("Hosted administration unavailable");
  let next = settleNormalClock(game, now);
  if (action.kind === "pause") {
    next = { ...next, status: "draft", timers: { ...next.timers, paused: true } };
  } else if (action.kind === "resume") {
    if (game.status !== "draft") throw new Error("Game is not paused");
    next = { ...next, status: "playing", timers: { ...next.timers, paused: false } };
  } else if (action.kind === "finish") {
    next = { ...next, status: "finished", timers: { ...next.timers, paused: true } };
  } else if (action.kind === "correct-score") {
    // Pause first so a referee correction cannot race a player's next turn.
    if (
      game.status !== "draft" ||
      !Number.isInteger(action.score) ||
      Math.abs(action.score) > 10000 ||
      !game.logs.some((log) => log.id === action.logId && log.action !== "end_game")
    )
      throw new Error("Invalid score correction");
    const logs = updateLogScore(game.logs, action.logId, action.score);
    next = { ...next, logs, scores: calculateGameTotals(game, logs) };
  } else throw new Error("Invalid administration action");
  return { ...next, currentTurnStartedAt: now, lastSavedAt: now };
}
