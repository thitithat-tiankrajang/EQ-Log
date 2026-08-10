import {
  createNewGame,
  getGameMode,
  getTileDrawMode,
  makeSnapshot,
  type GameState,
  type NewGameSettings,
  type Side,
} from "./game";

export function getRoomStage(game: Pick<GameState, "roomStage">): "waiting" | "playing" {
  return game.roomStage === "waiting" ? "waiting" : "playing";
}

export function createWaitingGame(settings: NewGameSettings): GameState {
  return resetWaitingGame(createNewGame(settings));
}

export function updateWaitingGame(game: GameState, settings: NewGameSettings): GameState {
  const configured = createNewGame(settings);
  return resetWaitingGame({
    ...configured,
    gameId: game.gameId,
    createdAt: game.createdAt,
  });
}

export function startWaitingGame(game: GameState): GameState {
  const now = new Date().toISOString();
  const started: GameState = {
    ...game,
    roomStage: "playing",
    status: "playing",
    timers: { ...game.timers, paused: false },
    currentTurnStartedAt: now,
    lastSavedAt: now,
  };
  return {
    ...started,
    history: [makeSnapshot(started)],
    historyIndex: 0,
  };
}

export function settingsFromWaitingGame(game: GameState): NewGameSettings {
  const initialSecondsBySide = game.timers.initialSecondsBySide;
  const timerMinutes: Record<Side, number | null> = {
    A: game.timers.sideUntimed?.A ? null : secondsToMinutes(initialSecondsBySide?.A ?? game.timers.A),
    B: game.timers.sideUntimed?.B ? null : secondsToMinutes(initialSecondsBySide?.B ?? game.timers.B),
  };
  return {
    name: game.name,
    gameMode: getGameMode(game),
    playerA: game.players.A,
    playerB: game.players.B,
    playerAMemberId: game.playerMembers?.A ?? null,
    playerBMemberId: game.playerMembers?.B ?? null,
    playerAUserId: game.playerUserIds?.A ?? null,
    playerBUserId: game.playerUserIds?.B ?? null,
    playerAEmail: game.playerEmails?.A ?? null,
    playerBEmail: game.playerEmails?.B ?? null,
    emailPlayMode: game.emailPlayMode,
    emailPlayersCanSeeOpponentRack: game.emailPlayersCanSeeOpponentRack,
    minutes: timerMinutes.A ?? timerMinutes.B ?? undefined,
    timerMinutes,
    startingSide: game.startingSide ?? "A",
    botSide: game.botSide,
    botDifficulty: game.botDifficulty,
    tileDrawMode: getTileDrawMode(game),
    untimed: timerMinutes.A === null && timerMinutes.B === null,
  };
}

export function formatRoomCode(roomId: string): string {
  return roomId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function resolveRoomCode(roomCode: string, roomIds: string[]): string | null {
  const normalized = roomCode.trim().replace(/^.*#\/room\//i, "").split(/[?#/]/)[0];
  if (!normalized) return null;
  const exact = roomIds.find((id) => id.toLowerCase() === normalized.toLowerCase());
  if (exact) return exact;
  const compact = normalized.replace(/-/g, "").toLowerCase();
  const matches = roomIds.filter((id) => id.replace(/-/g, "").toLowerCase().startsWith(compact));
  return matches.length === 1 ? matches[0] : null;
}

export function parseRemoteJoinTarget(value: string): { code?: string; gameId?: string } {
  const trimmed = value.trim();
  const codeMatch = trimmed.match(/[?&]code=([^&#]+)/i);
  if (codeMatch?.[1]) {
    try {
      return { code: decodeURIComponent(codeMatch[1]) };
    } catch {
      return { code: codeMatch[1] };
    }
  }
  const roomMatch = trimmed.match(/#\/(?:room|play)\/([^/?#]+)/i);
  if (roomMatch?.[1]) {
    try {
      return { gameId: decodeURIComponent(roomMatch[1]) };
    } catch {
      return { gameId: roomMatch[1] };
    }
  }
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(trimmed)) return { gameId: trimmed };
  return { code: trimmed };
}

function resetWaitingGame(game: GameState): GameState {
  const waiting: GameState = {
    ...game,
    roomStage: "waiting",
    lobbyReadyBySide: {},
    status: "draft",
    timers: { ...game.timers, paused: true },
  };
  return {
    ...waiting,
    history: [makeSnapshot(waiting)],
    historyIndex: 0,
  };
}

function secondsToMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}
