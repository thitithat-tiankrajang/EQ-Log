import type { GameState } from "./game";

export function isRemoteGameAhead(localGame: GameState, remoteGame: GameState): boolean {
  if (remoteGame.gameId !== localGame.gameId) return true;
  return compareGameProgress(remoteGame, localGame) > 0;
}

export function isRemoteGameStale(localGame: GameState, remoteGame: GameState): boolean {
  if (remoteGame.gameId !== localGame.gameId) return false;
  const progress = compareGameProgress(remoteGame, localGame);
  if (progress > 0) return false;

  const remoteSavedAt = parseTimestamp(remoteGame.lastSavedAt);
  const localSavedAt = parseTimestamp(localGame.lastSavedAt);
  if (progress < 0) {
    // A newer, lower-progress state is a deliberate undo. A lower-progress
    // state with an older timestamp is a delayed realtime event.
    return remoteSavedAt <= localSavedAt;
  }
  return remoteSavedAt < localSavedAt;
}

function compareGameProgress(first: GameState, second: GameState): number {
  if (first.logs.length !== second.logs.length) return first.logs.length - second.logs.length;
  if (first.turnNumber !== second.turnNumber) return first.turnNumber - second.turnNumber;

  const firstStatus = statusRank(first.status);
  const secondStatus = statusRank(second.status);
  if (firstStatus !== secondStatus) return firstStatus - secondStatus;

  return phaseRank(first.phase) - phaseRank(second.phase);
}

function statusRank(status: GameState["status"]): number {
  if (status === "finished") return 2;
  if (status === "playing") return 1;
  return 0;
}

function phaseRank(phase: GameState["phase"]): number {
  if (phase === "choose_action") return 2;
  if (phase === "perform_action") return 1;
  return 0;
}

function parseTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
