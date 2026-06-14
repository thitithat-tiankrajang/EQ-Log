// ── Compact codec ───────────────────────────────────────────────────────────
// Lossless (for gameplay) compact encoding of a GameState for localStorage.
//
// Why: the in-memory GameState is verbose and grows fast — every history
// snapshot embeds the full log list, and every TurnLog deep-clones the whole
// board + both racks + the tilebag. Stored as plain JSON that is O(turns²) of
// fat tile objects + 225-cell board arrays.
//
// How we shrink it without changing the game model:
//   • Tile  { id, token, assignedToken? }  →  tokenIndex  | [tokenIndex, assigned]
//       (tile ids are pure identity labels; we regenerate fresh unique ids on
//        decode — nothing references them across save/load.)
//   • Board (15×15, mostly null) → sparse [cellIndex, tileCode, placedTurn, side]
//   • Everything else (scalars, strings, actionDetail) is kept verbatim.
//
// The decoded object is structurally identical to the original except for the
// regenerated tile ids, so App/game logic is untouched.

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
import { aggregatePendingExchangeReturns, getPendingExchangeReturnBySide } from "./game";

export const STORAGE_PREFIX = "c1:";

const TOKENS: AmathToken[] = [
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
  "+", "-", "x", "/", "+/-", "x//", "=", "?",
];
const TOKEN_INDEX: Record<string, number> = Object.fromEntries(
  TOKENS.map((token, index) => [token, index]),
);

const BOARD_DIM = 15;

type TileCode = number | [number, string];
type CellCode = [number, TileCode, number, 0 | 1]; // [cellIndex, tile, placedTurn, side]
type IdFactory = () => string;

// ── Tiles ─────────────────────────────────────────────────────────────────────
function encodeTile(tile: TileInstance): TileCode {
  const index = TOKEN_INDEX[tile.token];
  return tile.assignedToken === undefined ? index : [index, tile.assignedToken];
}

function decodeTile(code: TileCode, nextId: IdFactory): TileInstance {
  if (Array.isArray(code)) {
    return { id: nextId(), token: TOKENS[code[0]], assignedToken: code[1] };
  }
  return { id: nextId(), token: TOKENS[code] };
}

function encodeTiles(tiles: TileInstance[]): TileCode[] {
  return tiles.map(encodeTile);
}

function decodeTiles(codes: TileCode[], nextId: IdFactory): TileInstance[] {
  return codes.map((code) => decodeTile(code, nextId));
}

// ── Board (sparse) ──────────────────────────────────────────────────────────────
function encodeBoard(board: BoardSnapshot): CellCode[] {
  const out: CellCode[] = [];
  for (let r = 0; r < board.length; r += 1) {
    const row = board[r];
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      if (cell) {
        out.push([r * BOARD_DIM + c, encodeTile(cell.tile), cell.placedTurn, cell.side === "A" ? 0 : 1]);
      }
    }
  }
  return out;
}

function decodeBoard(cells: CellCode[], nextId: IdFactory): BoardSnapshot {
  const board: BoardSnapshot = Array.from({ length: BOARD_DIM }, () =>
    Array.from({ length: BOARD_DIM }, () => null as BoardCell | null),
  );
  for (const [cellIndex, tileCode, placedTurn, side] of cells) {
    const r = Math.floor(cellIndex / BOARD_DIM);
    const c = cellIndex % BOARD_DIM;
    board[r][c] = { tile: decodeTile(tileCode, nextId), placedTurn, side: side === 0 ? "A" : "B" };
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

function decodeLog(log: EncodedLog, nextId: IdFactory): TurnLog {
  return {
    ...log,
    rackBefore: decodeTiles(log.rackBefore, nextId),
    rackAfter: decodeTiles(log.rackAfter, nextId),
    boardBefore: decodeBoard(log.boardBefore, nextId),
    boardAfter: decodeBoard(log.boardAfter, nextId),
    tilebagBefore: decodeTiles(log.tilebagBefore, nextId),
    tilebagAfter: decodeTiles(log.tilebagAfter, nextId),
  };
}

// ── Snapshot ────────────────────────────────────────────────────────────────────
type EncodedPendingExchangeReturnBySide = Partial<Record<Side, TileCode[]>>;

type EncodedSnapshot = Omit<
  GameSnapshot,
  "board" | "rackA" | "rackB" | "tilebag" | "pendingExchangeReturn" | "pendingExchangeReturnBySide" | "logs"
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
    name: snapshot.name,
    players: snapshot.players,
    playerMembers: snapshot.playerMembers,
    startingSide: snapshot.startingSide,
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
    pendingExchangeReturn: aggregatePendingExchangeReturns(pendingBySide).length > 0
      ? encodeTiles(aggregatePendingExchangeReturns(pendingBySide))
      : undefined,
    pendingExchangeReturnBySide: encodePendingExchangeReturnBySide(pendingBySide),
    logs: snapshot.logs.map(encodeLog),
  };
}

function decodeSnapshot(snapshot: EncodedSnapshot, nextId: IdFactory): GameSnapshot {
  const pendingBySide = decodePendingExchangeReturnBySide(snapshot, nextId);
  return {
    commitId: snapshot.commitId,
    gameId: snapshot.gameId,
    name: snapshot.name,
    players: snapshot.players,
    playerMembers: snapshot.playerMembers,
    startingSide: snapshot.startingSide ?? (snapshot.activeSide as Side),
    turnNumber: snapshot.turnNumber,
    activeSide: snapshot.activeSide as Side,
    phase: snapshot.phase,
    status: snapshot.status,
    boardSize: snapshot.boardSize,
    timers: snapshot.timers,
    scores: snapshot.scores,
    currentTurnStartedAt: snapshot.currentTurnStartedAt,
    createdAt: snapshot.createdAt,
    board: decodeBoard(snapshot.board, nextId),
    rackA: decodeTiles(snapshot.rackA, nextId),
    rackB: decodeTiles(snapshot.rackB, nextId),
    tilebag: decodeTiles(snapshot.tilebag, nextId),
    pendingExchangeReturn: aggregatePendingExchangeReturns(pendingBySide),
    pendingExchangeReturnBySide: pendingBySide,
    logs: snapshot.logs.map((log) => decodeLog(log, nextId)),
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
  nextId: IdFactory,
): Record<Side, TileInstance[]> {
  if (snapshot.pendingExchangeReturnBySide) {
    const bySide: PendingExchangeReturnBySide = {
      A: snapshot.pendingExchangeReturnBySide.A
        ? decodeTiles(snapshot.pendingExchangeReturnBySide.A, nextId)
        : [],
      B: snapshot.pendingExchangeReturnBySide.B
        ? decodeTiles(snapshot.pendingExchangeReturnBySide.B, nextId)
        : [],
    };
    return { A: bySide.A ?? [], B: bySide.B ?? [] };
  }

  const legacyPending = snapshot.pendingExchangeReturn
    ? decodeTiles(snapshot.pendingExchangeReturn, nextId)
    : [];
  if (legacyPending.length === 0) return { A: [], B: [] };

  const legacySide = snapshot.activeSide === "A" ? "B" : "A";
  return legacySide === "A" ? { A: legacyPending, B: [] } : { A: [], B: legacyPending };
}

// ── Game ────────────────────────────────────────────────────────────────────────
type EncodedGame = EncodedSnapshot & {
  v: 1;
  history: EncodedSnapshot[];
  historyIndex: number;
  lastSavedAt: string;
};

export function encodeGame(game: GameState): EncodedGame {
  return {
    v: 1,
    ...encodeSnapshot(game),
    history: game.history.map(encodeSnapshot),
    historyIndex: game.historyIndex,
    lastSavedAt: game.lastSavedAt,
  };
}

export function decodeGame(payload: EncodedGame): GameState {
  // One monotonic id counter for the whole game → every tile id is unique,
  // which keeps the current state valid (hasDuplicateTileIds) and React keys safe.
  let counter = 0;
  const nextId: IdFactory = () => `t${(counter += 1)}`;
  const current = decodeSnapshot(payload, nextId);
  return {
    ...current,
    history: payload.history.map((snapshot) => decodeSnapshot(snapshot, nextId)),
    historyIndex: payload.historyIndex,
    lastSavedAt: payload.lastSavedAt,
  };
}

// ── Serialize / deserialize for localStorage ────────────────────────────────────
export function serializeGame(game: GameState): string {
  return STORAGE_PREFIX + JSON.stringify(encodeGame(game));
}

/** Accepts both the compact format (c1:) and legacy plain JSON. */
export function deserializeGame(raw: string): GameState | null {
  try {
    if (raw.startsWith(STORAGE_PREFIX)) {
      return decodeGame(JSON.parse(raw.slice(STORAGE_PREFIX.length)) as EncodedGame);
    }
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}
