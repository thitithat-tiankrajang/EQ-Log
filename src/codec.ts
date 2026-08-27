// ── Compact codec ───────────────────────────────────────────────────────────
// Compact encoding of a GameState for storage and for the wire.
//
// Why compact: the in-memory GameState is verbose and grows fast — every
// history snapshot embeds the full log list, and every TurnLog deep-clones the
// whole board + both racks + the tilebag. Stored as plain JSON that is
// O(turns²) of fat tile objects + 225-cell board arrays.
//
// How it shrinks without changing the game model:
//   • Tile  { id, token, assignedToken? }  →  ordinal | [ordinal, face]
//   • Board (15×15, mostly null) → sparse [cellIndex, tileCode, placedTurn, side]
//   • Everything else (scalars, strings, actionDetail) is kept verbatim.
//
// ── Physical identity ────────────────────────────────────────────────────────
//
// Format v3 stores the tile's ORDINAL: its permanent position in the 100-tile
// manifest. Encoding and decoding are therefore identity-preserving — a game
// that goes out and comes back is the same hundred physical tiles it was.
//
// This is a deliberate reversal. Formats v1 and v2 stored the tile's FACE and
// minted a fresh random id on every decode, on the reasoning that ids were
// "pure identity labels nothing references". They are referenced: by the board,
// by drafts in flight, by every other client reading the same row. Regenerating
// them meant two readers of one saved game disagreed about which tile was
// which, and a client's own write echoed back as an unrecognizable stranger.
//
// v1/v2 payloads are still readable. Their per-tile identity was never written
// down, so it is recovered canonically on the way in (see `identity.ts`) and
// carried verbatim from then on.

import type {
  AmathToken,
  BoardCell,
  BoardSnapshot,
  GameSnapshot,
  GameState,
  PendingExchangeReturnBySide,
  Side,
  TileInstance,
  TurnLog,
} from "./game";
import { BOARD_SIZE } from "./constants/gameRules";
import {
  aggregatePendingExchangeReturns,
  getGameMode,
  getPendingExchangeReturnBySide,
  getTileDrawMode,
} from "./game";
import { InventoryError } from "./domain/inventory";
import { createIdentityAllocator, type IdentityAllocator } from "./domain/identity";
import { inventoryFrom } from "./domain/projection";
import { TILE_TOKENS, tileIdOf, tokenOfOrdinal, tryOrdinalOfTileId } from "./domain/tiles";

export const STORAGE_PREFIX = "c1:";

/** Face table used by the legacy (v1/v2) tile codes. Frozen forever: changing
 *  it would re-interpret every stored game. */
const LEGACY_TOKENS: AmathToken[] = [
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
  "+", "-", "x", "/", "+/-", "x//", "=", "?",
];

const BOARD_DIM = BOARD_SIZE;

type TileCode = number | [number, string];
type CellCode = [number, TileCode, number, 0 | 1]; // [cellIndex, tile, placedTurn, side]

/** How a tile code is to be read: as a manifest ordinal (v3) or as a face that
 *  still needs its physical tile recovered (v1/v2). */
type TileReader = (code: TileCode) => TileInstance;

// ── Tiles ─────────────────────────────────────────────────────────────────────

function encodeTile(tile: TileInstance): TileCode {
  const ordinal = tryOrdinalOfTileId(tile.id);
  if (ordinal === null) {
    throw new InventoryError(
      `Refusing to store "${tile.id}": it is not a tile of the physical set.`,
    );
  }
  if (tokenOfOrdinal(ordinal) !== tile.token) {
    throw new InventoryError(
      `Refusing to store ${tile.id} as a "${tile.token}": that tile is a "${tokenOfOrdinal(ordinal)}".`,
    );
  }
  return tile.assignedToken === undefined ? ordinal : [ordinal, tile.assignedToken];
}

function encodeTiles(tiles: TileInstance[]): TileCode[] {
  return tiles.map(encodeTile);
}

/** v3: the code IS the tile. Nothing is regenerated. */
function readOrdinalTile(code: TileCode): TileInstance {
  const [ordinal, face] = Array.isArray(code) ? code : [code, undefined];
  const tile: TileInstance = { id: tileIdOf(ordinal), token: tokenOfOrdinal(ordinal) };
  return face === undefined ? tile : { ...tile, assignedToken: face };
}

/** v1/v2: the code is a face; the physical tile is recovered canonically. */
function makeLegacyReader(allocator: IdentityAllocator): TileReader {
  return (code: TileCode) => {
    const [index, face] = Array.isArray(code) ? code : [code, undefined];
    const token = LEGACY_TOKENS[index];
    if (token === undefined) {
      throw new InventoryError(`A saved tile refers to face ${index}, which does not exist.`);
    }
    const ordinal = allocator.take(token);
    const tile: TileInstance = { id: tileIdOf(ordinal), token };
    return face === undefined ? tile : { ...tile, assignedToken: face };
  };
}

function decodeTiles(codes: TileCode[], read: TileReader): TileInstance[] {
  return codes.map(read);
}

// ── Board (sparse) ──────────────────────────────────────────────────────────────

function encodeBoard(board: BoardSnapshot): CellCode[] {
  const out: CellCode[] = [];
  for (let r = 0; r < board.length; r += 1) {
    const row = board[r];
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      if (cell) {
        out.push([
          r * BOARD_DIM + c,
          encodeTile(cell.tile),
          cell.placedTurn,
          cell.side === "A" ? 0 : 1,
        ]);
      }
    }
  }
  return out;
}

function decodeBoard(cells: CellCode[], read: TileReader): BoardSnapshot {
  const board: BoardSnapshot = Array.from({ length: BOARD_DIM }, () =>
    Array.from({ length: BOARD_DIM }, () => null as BoardCell | null),
  );
  for (const [cellIndex, tileCode, placedTurn, side] of cells) {
    const r = Math.floor(cellIndex / BOARD_DIM);
    const c = cellIndex % BOARD_DIM;
    board[r][c] = { tile: read(tileCode), placedTurn, side: side === 0 ? "A" : "B" };
  }
  return board;
}

// ── Turn log ────────────────────────────────────────────────────────────────────

type EncodedLog = Omit<
  TurnLog,
  "rackBefore" | "rackAfter" | "boardBefore" | "boardAfter" | "tilebagBefore" | "tilebagAfter"
> & {
  rackBefore: TileCode[];
  rackAfter: TileCode[];
  boardBefore: CellCode[];
  boardAfter: CellCode[];
  tilebagBefore: TileCode[];
  tilebagAfter: TileCode[];
};

function encodeLog(log: TurnLog): EncodedLog {
  return {
    ...log,
    rackBefore: encodeTiles(log.rackBefore),
    rackAfter: encodeTiles(log.rackAfter),
    boardBefore: encodeBoard(log.boardBefore),
    boardAfter: encodeBoard(log.boardAfter),
    tilebagBefore: encodeTiles(log.tilebagBefore),
    tilebagAfter: encodeTiles(log.tilebagAfter),
  };
}

/**
 * A turn log records the past, not the live position, and it never holds the
 * whole set (the opponent's rack is absent). Each container therefore recovers
 * identity on its own; the physical invariant is asserted against the live
 * position only.
 */
function decodeLog(log: EncodedLog, version: 1 | 2 | 3): TurnLog {
  const read = (codes: TileCode[]) => decodeTiles(codes, readerFor(version));
  const readBoard = (cells: CellCode[]) => decodeBoard(cells, readerFor(version));
  return {
    ...log,
    rackBefore: read(log.rackBefore),
    rackAfter: read(log.rackAfter),
    boardBefore: readBoard(log.boardBefore),
    boardAfter: readBoard(log.boardAfter),
    tilebagBefore: read(log.tilebagBefore),
    tilebagAfter: read(log.tilebagAfter),
  };
}

function readerFor(version: 1 | 2 | 3): TileReader {
  return version === 3
    ? readOrdinalTile
    : makeLegacyReader(createIdentityAllocator({ strict: false }));
}

// ── Snapshot ────────────────────────────────────────────────────────────────────

type EncodedPendingExchangeReturnBySide = Partial<Record<Side, TileCode[]>>;

type EncodedSnapshot = Omit<
  GameSnapshot,
  | "board"
  | "rackA"
  | "rackB"
  | "tilebag"
  | "pendingExchangeReturn"
  | "pendingExchangeReturnBySide"
  | "logs"
> & {
  board: CellCode[];
  rackA: TileCode[];
  rackB: TileCode[];
  tilebag: TileCode[];
  pendingExchangeReturn?: TileCode[];
  pendingExchangeReturnBySide?: EncodedPendingExchangeReturnBySide;
  logs: EncodedLog[];
};

function encodeSnapshot(snapshot: GameSnapshot): EncodedSnapshot {
  const pendingBySide = getPendingExchangeReturnBySide(snapshot);
  return {
    commitId: snapshot.commitId,
    gameId: snapshot.gameId,
    revision: snapshot.revision,
    name: snapshot.name,
    gameMode: getGameMode(snapshot),
    players: snapshot.players,
    playerMembers: snapshot.playerMembers,
    playerUserIds: snapshot.playerUserIds,
    playerEmails: snapshot.playerEmails,
    emailPlayMode: snapshot.emailPlayMode,
    emailPlayersCanSeeOpponentRack: snapshot.emailPlayersCanSeeOpponentRack,
    matchControl: snapshot.matchControl,
    roomStage: snapshot.roomStage,
    lobbyReadyBySide: snapshot.lobbyReadyBySide,
    startingSide: snapshot.startingSide,
    botSide: snapshot.botSide,
    botDifficulty: snapshot.botDifficulty,
    // The versions this game's client-side bot is pinned to. Persisted with the
    // game so the pin survives a reload and reaches a SECOND DEVICE — which is
    // the only way it can stop one match being played by two evaluators.
    superEngineVersion: snapshot.superEngineVersion,
    superWeightsVersion: snapshot.superWeightsVersion,
    tileDrawMode: getTileDrawMode(snapshot),
    turnNumber: snapshot.turnNumber,
    activeSide: snapshot.activeSide,
    phase: snapshot.phase,
    status: snapshot.status,
    boardSize: snapshot.boardSize,
    timers: snapshot.timers,
    scores: snapshot.scores,
    currentTurnStartedAt: snapshot.currentTurnStartedAt,
    createdAt: snapshot.createdAt,
    board: encodeBoard(snapshot.board),
    rackA: encodeTiles(snapshot.rackA),
    rackB: encodeTiles(snapshot.rackB),
    tilebag: encodeTiles(snapshot.tilebag),
    pendingExchangeReturn:
      aggregatePendingExchangeReturns(pendingBySide).length > 0
        ? encodeTiles(aggregatePendingExchangeReturns(pendingBySide))
        : undefined,
    pendingExchangeReturnBySide: encodePendingExchangeReturnBySide(pendingBySide),
    logs: snapshot.logs.map(encodeLog),
  };
}

/**
 * Decode one position.
 *
 * `read` is shared across the bag, both racks, the board and both pending
 * buckets so that a legacy payload recovers identity across the WHOLE position
 * — the five "0" tiles are dealt out once, not once per container. That shared
 * allocator is what makes the recovered position a partition of the set rather
 * than five independent guesses.
 */
function decodeSnapshot(
  snapshot: EncodedSnapshot,
  read: TileReader,
  logs: TurnLog[],
): GameSnapshot {
  const pendingBySide = decodePendingExchangeReturnBySide(snapshot, read);
  return {
    commitId: snapshot.commitId,
    gameId: snapshot.gameId,
    revision: snapshot.revision,
    name: snapshot.name,
    gameMode: getGameMode(snapshot),
    players: snapshot.players,
    playerMembers: snapshot.playerMembers,
    playerUserIds: snapshot.playerUserIds,
    playerEmails: snapshot.playerEmails,
    emailPlayMode: snapshot.emailPlayMode,
    emailPlayersCanSeeOpponentRack: snapshot.emailPlayersCanSeeOpponentRack,
    matchControl: snapshot.matchControl,
    roomStage: snapshot.roomStage,
    lobbyReadyBySide: snapshot.lobbyReadyBySide,
    startingSide: snapshot.startingSide ?? (snapshot.activeSide as Side),
    botSide: snapshot.botSide,
    botDifficulty: snapshot.botDifficulty,
    // Absent on every game saved before pinning existed, and on every game that
    // never computed a Super move locally. Left absent rather than defaulted:
    // claiming a game was pinned to the current version when it was not is the
    // one thing a reproducibility record must never do.
    superEngineVersion: snapshot.superEngineVersion,
    superWeightsVersion: snapshot.superWeightsVersion,
    tileDrawMode: snapshot.tileDrawMode ?? "manual",
    turnNumber: snapshot.turnNumber,
    activeSide: snapshot.activeSide as Side,
    phase: snapshot.phase,
    status: snapshot.status,
    boardSize: snapshot.boardSize,
    timers: snapshot.timers,
    scores: snapshot.scores,
    currentTurnStartedAt: snapshot.currentTurnStartedAt,
    createdAt: snapshot.createdAt,
    // Order matters for legacy recovery: the bag is dealt first, then the
    // racks, then the board, then tiles waiting to go back. Fixed, so every
    // client recovers the same assignment.
    tilebag: decodeTiles(snapshot.tilebag, read),
    rackA: decodeTiles(snapshot.rackA, read),
    rackB: decodeTiles(snapshot.rackB, read),
    board: decodeBoard(snapshot.board, read),
    pendingExchangeReturn: aggregatePendingExchangeReturns(pendingBySide),
    pendingExchangeReturnBySide: pendingBySide,
    logs,
  };
}

function encodePendingExchangeReturnBySide(
  pendingBySide: Record<Side, TileInstance[]>,
): EncodedPendingExchangeReturnBySide | undefined {
  const encoded: EncodedPendingExchangeReturnBySide = {};
  if (pendingBySide.A.length > 0) encoded.A = encodeTiles(pendingBySide.A);
  if (pendingBySide.B.length > 0) encoded.B = encodeTiles(pendingBySide.B);
  return encoded.A || encoded.B ? encoded : undefined;
}

function decodePendingExchangeReturnBySide(
  snapshot: EncodedSnapshot,
  read: TileReader,
): Record<Side, TileInstance[]> {
  if (snapshot.pendingExchangeReturnBySide) {
    const bySide: PendingExchangeReturnBySide = {
      A: snapshot.pendingExchangeReturnBySide.A
        ? decodeTiles(snapshot.pendingExchangeReturnBySide.A, read)
        : [],
      B: snapshot.pendingExchangeReturnBySide.B
        ? decodeTiles(snapshot.pendingExchangeReturnBySide.B, read)
        : [],
    };
    return { A: bySide.A ?? [], B: bySide.B ?? [] };
  }

  const legacyPending = snapshot.pendingExchangeReturn
    ? decodeTiles(snapshot.pendingExchangeReturn, read)
    : [];
  if (legacyPending.length === 0) return { A: [], B: [] };

  const legacySide = snapshot.activeSide === "A" ? "B" : "A";
  return legacySide === "A" ? { A: legacyPending, B: [] } : { A: [], B: legacyPending };
}

// ── Game ────────────────────────────────────────────────────────────────────────

type EncodedHistorySnapshot = Omit<EncodedSnapshot, "logs"> & {
  logCount: number;
};

type EncodedGameV1 = EncodedSnapshot & {
  v: 1;
  history: EncodedSnapshot[];
  historyIndex: number;
  lastSavedAt: string;
};

type EncodedGameV2 = EncodedSnapshot & {
  v: 2;
  history: EncodedHistorySnapshot[];
  historyLogs: EncodedLog[];
  historyIndex: number;
  lastSavedAt: string;
};

type EncodedGameV3 = Omit<EncodedGameV2, "v"> & { v: 3 };

type EncodedGame = EncodedGameV1 | EncodedGameV2 | EncodedGameV3;

/** The format written today. Bumped from 2 because tile codes changed meaning
 *  from "which face" to "which physical tile". */
export const CODEC_VERSION = 3;

function encodeHistorySnapshot(snapshot: GameSnapshot): EncodedHistorySnapshot {
  const { logs: _logs, ...encoded } = encodeSnapshot(snapshot);
  return { ...encoded, logCount: snapshot.logs.length };
}

export function encodeGame(game: GameState): EncodedGameV3 {
  const historyLogCatalog = game.history.reduce<TurnLog[]>(
    (longest, snapshot) => (snapshot.logs.length > longest.length ? snapshot.logs : longest),
    game.logs,
  );
  return {
    v: 3,
    ...encodeSnapshot(game),
    history: game.history.map(encodeHistorySnapshot),
    historyLogs: historyLogCatalog.map(encodeLog),
    historyIndex: game.historyIndex,
    lastSavedAt: game.lastSavedAt,
  };
}

/**
 * Decode a stored game.
 *
 * Throws `InventoryError` — with the specific problems listed — when the
 * payload does not describe the 100-tile set. Refusing to open a corrupt game
 * is the point: the alternative is rendering a board that has quietly lost or
 * gained a tile and letting the next move persist it.
 */
export function decodeGame(payload: EncodedGame): GameState {
  const version = (payload.v ?? 1) as 1 | 2 | 3;
  // One allocator for the whole live position, so legacy recovery partitions
  // the physical set instead of dealing each container independently.
  const positionAllocator = version === 3 ? null : createIdentityAllocator();
  const read: TileReader = positionAllocator
    ? makeLegacyReader(positionAllocator)
    : readOrdinalTile;

  const logs = payload.logs.map((log) => decodeLog(log, version));
  const current = decodeSnapshot(payload, read, logs);
  positionAllocator?.assertComplete("saved game");
  assertPhysicalSet(current);

  if (version === 1) {
    const v1 = payload as EncodedGameV1;
    return {
      ...current,
      history: v1.history.map((snapshot) =>
        decodeSnapshot(
          snapshot,
          makeLegacyReader(createIdentityAllocator({ strict: false })),
          snapshot.logs.map((log) => decodeLog(log, version)),
        ),
      ),
      historyIndex: v1.historyIndex,
      lastSavedAt: v1.lastSavedAt,
    };
  }

  const versioned = payload as EncodedGameV2 | EncodedGameV3;
  const historyLogs = versioned.historyLogs.map((log) => decodeLog(log, version));
  return {
    ...current,
    history: versioned.history.map((snapshot) => {
      const { logCount, ...encoded } = snapshot;
      // History snapshots are past positions kept for undo. Each recovers
      // identity on its own; only the live position is authoritative.
      const historyRead: TileReader =
        version === 3 ? readOrdinalTile : makeLegacyReader(createIdentityAllocator({ strict: false }));
      return decodeSnapshot({ ...encoded, logs: [] }, historyRead, historyLogs.slice(0, logCount));
    }),
    historyIndex: versioned.historyIndex,
    lastSavedAt: versioned.lastSavedAt,
  };
}

/** Prove the decoded position really is the closed 100-tile set. */
function assertPhysicalSet(snapshot: GameSnapshot): void {
  inventoryFrom({
    tilebag: snapshot.tilebag,
    rackA: snapshot.rackA,
    rackB: snapshot.rackB,
    board: snapshot.board,
    pendingReturnA: snapshot.pendingExchangeReturnBySide?.A ?? [],
    pendingReturnB: snapshot.pendingExchangeReturnBySide?.B ?? [],
  });
}

/** Faces, in the order the legacy codes indexed them. Exported for tests that
 *  build v1/v2 fixtures. */
export const LEGACY_TOKEN_TABLE: readonly AmathToken[] = LEGACY_TOKENS;

/** Manifest faces by ordinal, for tests and diagnostics. */
export const ORDINAL_TOKEN_TABLE: readonly AmathToken[] = TILE_TOKENS;

// ── Serialize / deserialize for localStorage ────────────────────────────────────

export function serializeGame(game: GameState): string {
  return STORAGE_PREFIX + JSON.stringify(encodeGame(game));
}

/**
 * Accepts the compact format (c1:) and legacy plain JSON.
 *
 * Returns null when the payload cannot be read at all. A payload that reads but
 * does not describe the physical set throws instead, so the caller reports a
 * damaged game rather than opening it.
 */
export function deserializeGame(raw: string): GameState | null {
  let parsed: unknown;
  try {
    parsed = raw.startsWith(STORAGE_PREFIX)
      ? JSON.parse(raw.slice(STORAGE_PREFIX.length))
      : JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (!("v" in parsed)) return parsed as GameState;
  return decodeGame(parsed as EncodedGame);
}
