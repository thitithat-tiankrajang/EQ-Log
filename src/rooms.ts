// Persists multiple saved games ("rooms") in localStorage:
//   amath-lab-rooms-index-v1   -> RoomMeta[] (lobby list + summaries)
//   amath-lab-room-<id>        -> full GameState for that room
//   amath-lab-active-room-v1   -> id of the room to resume on reload
// The old single-game save (amath-lab-board-state-v3) is migrated into a room
// the first time the lobby is read, so nothing is lost.

import { GameState, GameStatus, Side, deepClone, getGameMode, type GameMode } from "./game";
import { serializeGame, deserializeGame } from "./codec";
import { ROOM_STORAGE_PREFIX, STORAGE_KEYS } from "./constants/storage";
import { roomBelongsToScope, type RoomScope, type RoomVisibility } from "./roomScope";

export type RoomMeta = {
  id: string;
  ownerId?: string | null;
  ownerName?: string | null;
  ownerEmail?: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
  playerA: string;
  playerB: string;
  gameMode?: GameMode;
  memberAId?: string | null;
  memberBId?: string | null;
  inviteUserAId?: string | null;
  inviteUserBId?: string | null;
  inviteEmailA?: string | null;
  inviteEmailB?: string | null;
  startingSide?: Side | null;
  turnNumber: number;
  scoreA: number;
  scoreB: number;
  status: GameStatus;
  visibility?: RoomVisibility;
  regionId?: string | null;
  accessScope?: "public" | "region" | "private";
  archivePolicy?: "public" | "region" | "private" | "none";
  joinPolicy?: "open" | "code_only" | "invite_only";
  roomCode?: string | null;
  modeKey?: string | null;
  hasOpponent?: boolean;
  viewerRole?: "Owner" | "Admin" | "Player A" | "Player B" | "Spectator";
  canManage?: boolean;
};

function roomKey(id: string): string {
  return `${ROOM_STORAGE_PREFIX}${id}`;
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

function metaFromGame(id: string, game: GameState, createdAt: string, scope: RoomScope): RoomMeta {
  return {
    id,
    name: game.name,
    createdAt,
    updatedAt: new Date().toISOString(),
    playerA: game.players.A,
    playerB: game.players.B,
    gameMode: getGameMode(game),
    memberAId: game.playerMembers?.A ?? null,
    memberBId: game.playerMembers?.B ?? null,
    inviteUserAId: game.playerUserIds?.A ?? null,
    inviteUserBId: game.playerUserIds?.B ?? null,
    inviteEmailA: game.playerEmails?.A ?? null,
    inviteEmailB: game.playerEmails?.B ?? null,
    startingSide: game.startingSide ?? game.history[0]?.activeSide ?? null,
    turnNumber: game.turnNumber,
    scoreA: game.scores.A,
    scoreB: game.scores.B,
    status: game.status,
    visibility: scope.visibility,
    regionId: scope.regionId,
  };
}

function rawIndex(): RoomMeta[] {
  return readJSON<RoomMeta[]>(STORAGE_KEYS.roomIndex) ?? [];
}

function persistIndex(index: RoomMeta[]): void {
  localStorage.setItem(STORAGE_KEYS.roomIndex, JSON.stringify(index));
}

// One-time migration of the legacy single-game save into a room.
function migrateLegacy(): RoomMeta[] {
  const legacy = readJSON<GameState>(STORAGE_KEYS.legacyGame);
  if (!legacy || !legacy.gameId) return [];
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  localStorage.setItem(roomKey(id), JSON.stringify(legacy));
  const index = [metaFromGame(id, legacy, now, { visibility: "public", regionId: null })];
  persistIndex(index);
  localStorage.setItem(STORAGE_KEYS.activeRoom, id);
  localStorage.removeItem(STORAGE_KEYS.legacyGame);
  return index;
}

/** Lobby list, newest activity first. Runs the legacy migration on first read. */
export function listRooms(scope: RoomScope = { visibility: "public", regionId: null }): RoomMeta[] {
  let index = readJSON<RoomMeta[]>(STORAGE_KEYS.roomIndex);
  if (!index) index = migrateLegacy();
  return index
    .filter((room) => roomBelongsToScope(room, scope))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Reads see writes, even the ones still waiting to be written.
 *
 * `saveRoomState` defers the encode (see below), so localStorage can be a beat
 * behind the truth. Anything reading a room back in the same session must get
 * what was last saved, not what has last been flushed.
 */
export function readRoom(id: string): GameState | null {
  const pending = pendingStates.get(id);
  if (pending) return pending;
  const raw = localStorage.getItem(roomKey(id));
  return raw ? deserializeGame(raw) : null;
}

// ── Deferred room writes ─────────────────────────────────────────────────────
//
// `saveRoomState` used to encode the entire match — history, and every TurnLog's
// two board snapshots and two tilebags — and write it to localStorage, on the
// calling tick. Its one caller runs on every change to the game, and the running
// clock produces one of those A SECOND, so a long match paid a full
// serialization per second on the main thread for a durability write nothing was
// waiting on.
//
// The write still happens. It happens when the main thread is free, and once per
// burst instead of once per change — and it is forced out before the page can go
// away, which is the only moment at which deferring it could have cost anything.
const pendingStates = new Map<string, GameState>();
let flushScheduled = false;

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  const run = () => {
    flushScheduled = false;
    flushRoomWrites();
  };
  const idle = (
    globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
  ).requestIdleCallback;
  if (idle) idle(run, { timeout: 2_000 });
  else setTimeout(run, 0);
}

/** Persist only the room's GameState (compact codec). Coalesced and deferred —
 *  call it as often as the game changes. */
export function saveRoomState(id: string, game: GameState): void {
  pendingStates.set(id, game);
  scheduleFlush();
}

/** Write everything outstanding now. Called on teardown, and by any operation
 *  whose caller is entitled to assume the room is on disk when it returns. */
export function flushRoomWrites(): void {
  for (const [id, game] of pendingStates) {
    try {
      localStorage.setItem(roomKey(id), serializeGame(game));
    } catch {
      // Quota or private browsing. The in-memory copy still serves this session.
    }
  }
  pendingStates.clear();
}

/** Update the lobby summary for a room; returns the new index. */
export function touchRoomMeta(id: string, game: GameState): RoomMeta[] {
  const index = rawIndex();
  const existing = index.find((meta) => meta.id === id);
  const createdAt = existing?.createdAt ?? new Date().toISOString();
  const scope: RoomScope =
    existing?.visibility === "region" && existing.regionId
      ? { visibility: "region", regionId: existing.regionId }
      : { visibility: "public", regionId: null };
  const meta = metaFromGame(id, game, createdAt, scope);
  const next = existing ? index.map((item) => (item.id === id ? meta : item)) : [...index, meta];
  persistIndex(next);
  return next;
}

/** A deliberate, complete write: state plus lobby summary, on disk when it
 *  returns. Used for creation, import and other one-off operations — never on
 *  the per-change path, which is `saveRoomState`. */
export function writeRoom(id: string, game: GameState): RoomMeta[] {
  saveRoomState(id, game);
  flushRoomWrites();
  return touchRoomMeta(id, game);
}

/** Create a new room from a game. Does NOT set it active (caller decides). */
export function createRoom(
  game: GameState,
  scope: RoomScope = { visibility: "public", regionId: null },
): { id: string; index: RoomMeta[] } {
  const id = crypto.randomUUID();
  saveRoomState(id, game);
  const createdAt = new Date().toISOString();
  const index = [...rawIndex(), metaFromGame(id, game, createdAt, scope)];
  persistIndex(index);
  return { id, index };
}

export function deleteRoom(id: string): RoomMeta[] {
  // Drop the pending write first: flushing it later would resurrect the room.
  pendingStates.delete(id);
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
  const existing = rawIndex().find((room) => room.id === id);
  const scope: RoomScope =
    existing?.visibility === "region" && existing.regionId
      ? { visibility: "region", regionId: existing.regionId }
      : { visibility: "public", regionId: null };
  const copy = deepClone(game);
  copy.gameId = crypto.randomUUID();
  copy.name = `${game.name} (Copy)`;
  return createRoom(copy, scope);
}

/** Add an imported game as a new room (fresh ids to avoid collisions). */
export function importRoom(
  game: GameState,
  scope: RoomScope = { visibility: "public", regionId: null },
): { id: string; index: RoomMeta[] } {
  const copy = deepClone(game);
  copy.gameId = crypto.randomUUID();
  return createRoom(copy, scope);
}

export function getActiveRoomId(): string | null {
  return localStorage.getItem(STORAGE_KEYS.activeRoom);
}

export function setActiveRoomId(id: string | null): void {
  if (id) localStorage.setItem(STORAGE_KEYS.activeRoom, id);
  else localStorage.removeItem(STORAGE_KEYS.activeRoom);
}

// The tab may not get another turn to run script. Whatever is still queued is
// written here or not at all.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushRoomWrites);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushRoomWrites();
  });
}
