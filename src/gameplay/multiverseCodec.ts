// The parked-lines document, as it is stored.
//
// Stored once per branch operation rather than once per move, so it could afford to be
// verbose — and it is kept small anyway, because every byte of it is fetched by anyone who opens
// the map. The live game's codec already writes tiles as manifest ordinals and boards as sparse
// cells; this reuses exactly those forms and adds three observations that hold for every turn:
//
//   • A turn starts on the board the previous turn left. `boardBefore` is written once per line
//     and never again.
//   • A turn only ADDS tiles to the board. `boardAfter` is the handful of cells it added.
//   • A turn does not draw. `tilebagAfter` is `tilebagBefore` unless it says otherwise.
//
// A position (`after`, `tip`) is written without its board, which is the board its own turn left;
// it only carries one where that is not true.
//
// Every shortcut has an explicit fallback to the full value, so the encoding is exact for any
// input, not only for inputs that happen to follow the rules above. The round trip is pinned by
// `tests/multiverse-codec.test.ts`.
import {
  decodeBoardCells,
  decodeTileCodes,
  decodeTurnLog,
  encodeBoardCells,
  encodeTileCodes,
  encodeTurnLog,
  type CellCode,
  type EncodedLog,
  type TileCode,
} from "../codec";
import type { BoardSnapshot, GameStatus, Phase, Side, TurnLog } from "../game";
import type { Multiverse, ParkedLine, Position } from "./multiverse";

export const MULTIVERSE_FORMAT = 1;

type EncodedLineLog = Omit<EncodedLog, "boardBefore" | "boardAfter" | "tilebagAfter"> & {
  /** Absent: the previous turn's `boardAfter`. Always present on a line's first turn. */
  boardBefore?: CellCode[];
  /** Cells `boardAfter` has that `boardBefore` does not (or has differently). */
  boardAdd?: CellCode[];
  /** Cell indexes `boardBefore` has that `boardAfter` does not. Empty in any real game. */
  boardDrop?: number[];
  /** Absent: identical to `tilebagBefore`. */
  tilebagAfter?: TileCode[];
};

type EncodedPosition = {
  t: number;
  s: Side;
  p: Phase;
  st: GameStatus;
  a: TileCode[];
  b: TileCode[];
  bag: TileCode[];
  pr?: { A?: TileCode[]; B?: TileCode[] };
  tm: [number, number];
  sc: [number, number];
  fd?: Partial<Record<Side, number>>;
  /** Only when the board is not the one its turn left. */
  bd?: CellCode[];
};

type EncodedLine = {
  id: string;
  from: string | null;
  at: string;
  logs: EncodedLineLog[];
  /** `0` where no position was recorded. */
  after: (EncodedPosition | 0)[];
  /** `"last"`: identical to the last entry of `after`. */
  tip: EncodedPosition | "last";
};

export type EncodedMultiverse = {
  v: typeof MULTIVERSE_FORMAT;
  version: number;
  lines: EncodedLine[];
};

// ── Encode ───────────────────────────────────────────────────────────────────────

export function encodeMultiverse(multiverse: Multiverse): EncodedMultiverse {
  return {
    v: MULTIVERSE_FORMAT,
    version: multiverse.version,
    lines: multiverse.lines.map(encodeLine),
  };
}

function encodeLine(line: ParkedLine): EncodedLine {
  const logs: EncodedLineLog[] = [];
  let previousAfter: string | null = null;
  for (const log of line.logs) {
    const full = encodeTurnLog(log);
    const { boardBefore: before, boardAfter, tilebagAfter, ...rest } = full;
    const beforeKey = JSON.stringify(before);
    const entry: EncodedLineLog = { ...rest };
    if (beforeKey !== previousAfter) entry.boardBefore = before;
    const delta = boardDelta(before, boardAfter);
    if (delta.add.length > 0) entry.boardAdd = delta.add;
    if (delta.drop.length > 0) entry.boardDrop = delta.drop;
    if (JSON.stringify(tilebagAfter) !== JSON.stringify(full.tilebagBefore)) {
      entry.tilebagAfter = tilebagAfter;
    }
    logs.push(entry);
    previousAfter = JSON.stringify(boardAfter);
  }
  const after = line.after.map((position, index) =>
    position ? encodePosition(position, line.logs[index]!.boardAfter) : (0 as const),
  );
  const lastBoard = line.logs[line.logs.length - 1]!.boardAfter;
  const tip = encodePosition(line.tip, lastBoard);
  const lastAfter = after[after.length - 1];
  return {
    id: line.id,
    from: line.from,
    at: line.parkedAt,
    logs,
    after,
    tip: lastAfter && JSON.stringify(lastAfter) === JSON.stringify(tip) ? "last" : tip,
  };
}

function boardDelta(before: CellCode[], after: CellCode[]): { add: CellCode[]; drop: number[] } {
  const beforeByCell = new Map(before.map((cell) => [cell[0], JSON.stringify(cell)]));
  const afterCells = new Set(after.map((cell) => cell[0]));
  return {
    add: after.filter((cell) => beforeByCell.get(cell[0]) !== JSON.stringify(cell)),
    drop: before.map((cell) => cell[0]).filter((index) => !afterCells.has(index)),
  };
}

function encodePosition(position: Position, turnBoard: BoardSnapshot): EncodedPosition {
  const encoded: EncodedPosition = {
    t: position.turnNumber,
    s: position.activeSide,
    p: position.phase,
    st: position.status,
    a: encodeTileCodes(position.rackA),
    b: encodeTileCodes(position.rackB),
    bag: encodeTileCodes(position.tilebag),
    tm: [position.timers.A, position.timers.B],
    sc: [position.scores.A, position.scores.B],
  };
  const pending = position.pendingExchangeReturnBySide;
  if (pending.A.length > 0 || pending.B.length > 0) {
    encoded.pr = {};
    if (pending.A.length > 0) encoded.pr.A = encodeTileCodes(pending.A);
    if (pending.B.length > 0) encoded.pr.B = encodeTileCodes(pending.B);
  }
  if (position.faceDownCount) encoded.fd = position.faceDownCount;
  const board = encodeBoardCells(position.board);
  if (JSON.stringify(board) !== JSON.stringify(encodeBoardCells(turnBoard))) encoded.bd = board;
  return encoded;
}

// ── Decode ───────────────────────────────────────────────────────────────────────

/**
 * Read a stored document back. Throws on anything malformed: a document that cannot be read is
 * reported as unreadable, never partially shown.
 */
export function decodeMultiverse(raw: unknown): Multiverse {
  if (!raw || typeof raw !== "object") throw new Error("The parked lines are not a document.");
  const doc = raw as Partial<EncodedMultiverse>;
  if (doc.v !== MULTIVERSE_FORMAT) {
    throw new Error(`The parked lines use format ${String(doc.v)}, which this app cannot read.`);
  }
  if (!Array.isArray(doc.lines)) throw new Error("The parked lines have no line list.");
  return {
    version: Number.isFinite(doc.version) ? Number(doc.version) : 0,
    lines: doc.lines.map(decodeLine),
  };
}

function decodeLine(line: EncodedLine): ParkedLine {
  if (!Array.isArray(line.logs) || line.logs.length === 0) {
    throw new Error(`Parked line ${line.id} has no turns.`);
  }
  const logs: TurnLog[] = [];
  let previousAfter: CellCode[] | null = null;
  for (const entry of line.logs) {
    const { boardAdd, boardDrop, ...rest } = entry;
    const before: CellCode[] | null = entry.boardBefore ?? previousAfter;
    if (!before) throw new Error(`Parked line ${line.id} starts without a board.`);
    const dropped = new Set(boardDrop ?? []);
    const added = new Map((boardAdd ?? []).map((cell): [number, CellCode] => [cell[0], cell]));
    const after: CellCode[] = [
      ...before.filter((cell) => !dropped.has(cell[0]) && !added.has(cell[0])),
      ...added.values(),
    ].sort((left, right) => left[0] - right[0]);
    logs.push(
      decodeTurnLog({
        ...rest,
        boardBefore: before,
        boardAfter: after,
        tilebagAfter: entry.tilebagAfter ?? entry.tilebagBefore,
      } as EncodedLog),
    );
    previousAfter = after;
  }
  const after = line.logs.map((_, index) => {
    const position = line.after?.[index];
    return position ? decodePosition(position, logs[index]!.boardAfter) : null;
  });
  const last = after[after.length - 1];
  let tip: Position;
  if (line.tip === "last") {
    if (!last) throw new Error(`Parked line ${line.id} points its tip at a missing position.`);
    tip = last;
  } else {
    tip = decodePosition(line.tip, logs[logs.length - 1]!.boardAfter);
  }
  return { id: String(line.id), from: line.from ?? null, logs, after, tip, parkedAt: line.at };
}

function decodePosition(position: EncodedPosition, turnBoard: BoardSnapshot): Position {
  return {
    board: position.bd ? decodeBoardCells(position.bd) : turnBoard,
    rackA: decodeTileCodes(position.a),
    rackB: decodeTileCodes(position.b),
    tilebag: decodeTileCodes(position.bag),
    pendingExchangeReturnBySide: {
      A: position.pr?.A ? decodeTileCodes(position.pr.A) : [],
      B: position.pr?.B ? decodeTileCodes(position.pr.B) : [],
    },
    timers: { A: position.tm[0], B: position.tm[1] },
    scores: { A: position.sc[0], B: position.sc[1] },
    turnNumber: position.t,
    activeSide: position.s,
    phase: position.p,
    status: position.st,
    ...(position.fd ? { faceDownCount: position.fd } : {}),
  };
}

/** Turns held by the document: what the map will draw beyond the live line. */
export function parkedTurnCount(multiverse: Multiverse): number {
  return multiverse.lines.reduce((total, line) => total + line.logs.length, 0);
}
