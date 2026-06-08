// Persists multiple saved games ("rooms") in localStorage:
//   amath-lab-rooms-index-v1   -> RoomMeta[] (lobby list + summaries)
//   amath-lab-room-<id>        -> full GameState for that room
//   amath-lab-active-room-v1   -> id of the room to resume on reload
// The old single-game save (amath-lab-board-state-v3) is migrated into a room
// the first time the lobby is read, so nothing is lost.

import { GameState, GameStatus, deepClone } from "./game";
import { serializeGame, deserializeGame } from "./codec";

export type RoomMeta = {
  id: string;
  ownerId?: string | null;
  ownerName?: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
  playerA: string;
  playerB: string;
  turnNumber: number;
  scoreA: number;
  scoreB: number;
  status: GameStatus;
};

const INDEX_KEY = "amath-lab-rooms-index-v1";
const ROOM_PREFIX = "amath-lab-room-";
const ACTIVE_KEY = "amath-lab-active-room-v1";
const LEGACY_KEY = "amath-lab-board-state-v3";

function roomKey(id: string): string {
  return `${ROOM_PREFIX}${id}`;
}

function readJSON<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function metaFromGame(id: string, game: GameState, createdAt: string): RoomMeta {
  return {
    id,
    name: game.name,
    createdAt,
    updatedAt: new Date().toISOString(),
    playerA: game.players.A,
    playerB: game.players.B,
    turnNumber: game.turnNumber,
    scoreA: game.scores.A,
    scoreB: game.scores.B,
    status: game.status,
  };
}

function rawIndex(): RoomMeta[] {
  return readJSON<RoomMeta[]>(INDEX_KEY) ?? [];
}

function persistIndex(index: RoomMeta[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

// One-time migration of the legacy single-game save into a room.
function migrateLegacy(): RoomMeta[] {
  const legacy = readJSON<GameState>(LEGACY_KEY);
  if (!legacy || !legacy.gameId) return [];
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  localStorage.setItem(roomKey(id), JSON.stringify(legacy));
  const index = [metaFromGame(id, legacy, now)];
  persistIndex(index);
  localStorage.setItem(ACTIVE_KEY, id);
  localStorage.removeItem(LEGACY_KEY);
  return index;
}

/** Lobby list, newest activity first. Runs the legacy migration on first read. */
export function listRooms(): RoomMeta[] {
  let index = readJSON<RoomMeta[]>(INDEX_KEY);
  if (!index) index = migrateLegacy();
  return [...index].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function readRoom(id: string): GameState | null {
  const raw = localStorage.getItem(roomKey(id));
  return raw ? deserializeGame(raw) : null;
}

/** Persist only the room's GameState (compact codec; safe to call frequently). */
export function saveRoomState(id: string, game: GameState): void {
  localStorage.setItem(roomKey(id), serializeGame(game));
}

/** Update the lobby summary for a room; returns the new index. */
export function touchRoomMeta(id: string, game: GameState): RoomMeta[] {
  const index = rawIndex();
  const existing = index.find((meta) => meta.id === id);
  const createdAt = existing?.createdAt ?? new Date().toISOString();
  const meta = metaFromGame(id, game, createdAt);
  const next = existing
    ? index.map((item) => (item.id === id ? meta : item))
    : [...index, meta];
  persistIndex(next);
  return next;
}

export function writeRoom(id: string, game: GameState): RoomMeta[] {
  saveRoomState(id, game);
  return touchRoomMeta(id, game);
}

/** Create a new room from a game. Does NOT set it active (caller decides). */
export function createRoom(game: GameState): { id: string; index: RoomMeta[] } {
  const id = crypto.randomUUID();
  const index = writeRoom(id, game);
  return { id, index };
}

export function deleteRoom(id: string): RoomMeta[] {
  localStorage.removeItem(roomKey(id));
  const index = rawIndex().filter((meta) => meta.id !== id);
  persistIndex(index);
  if (getActiveRoomId() === id) setActiveRoomId(null);
  return index;
}

export function renameRoom(id: string, name: string): RoomMeta[] {
  const trimmed = name.trim();
  if (!trimmed) return listRooms();
  const game = readRoom(id);
  if (game) saveRoomState(id, { ...game, name: trimmed });
  const index = rawIndex().map((meta) =>
    meta.id === id ? { ...meta, name: trimmed, updatedAt: new Date().toISOString() } : meta,
  );
  persistIndex(index);
  return index;
}

export function duplicateRoom(id: string): { id: string; index: RoomMeta[] } | null {
  const game = readRoom(id);
  if (!game) return null;
  const copy = deepClone(game);
  copy.gameId = crypto.randomUUID();
  copy.name = `${game.name} (Copy)`;
  return createRoom(copy);
}

/** Add an imported game as a new room (fresh ids to avoid collisions). */
export function importRoom(game: GameState): { id: string; index: RoomMeta[] } {
  const copy = deepClone(game);
  copy.gameId = crypto.randomUUID();
  return createRoom(copy);
}

export function getActiveRoomId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveRoomId(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}
