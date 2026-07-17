import type { GameState } from "../game";
import { getRoomStage } from "../pregame";

/**
 * Derive the visible clock from the persisted turn timestamp. The database
 * stores the last settled clock plus its timestamp, so refreshing a client
 * cannot give the active side more time.
 */
export function advanceRunningClock(game: GameState, nowMs = Date.now()): GameState {
  if (
    getRoomStage(game) !== "playing" ||
    game.status !== "playing" ||
    game.timers.paused ||
    game.timers.untimed ||
    game.timers.sideUntimed?.[game.activeSide]
  ) {
    return game;
  }

  const anchorMs = Date.parse(game.currentTurnStartedAt);
  if (!Number.isFinite(anchorMs)) {
    return { ...game, currentTurnStartedAt: new Date(nowMs).toISOString() };
  }

  const elapsedSeconds = Math.floor(Math.max(0, nowMs - anchorMs) / 1000);
  if (elapsedSeconds < 1) return game;

  const side = game.activeSide;
  return {
    ...game,
    timers: {
      ...game.timers,
      [side]: Math.max(game.timers[side] - elapsedSeconds, game.timers.minSeconds),
    },
    currentTurnStartedAt: new Date(anchorMs + elapsedSeconds * 1000).toISOString(),
  };
}
