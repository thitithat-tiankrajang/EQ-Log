// ── Board Labeler: trusted occupancy ground truth for real board photos ──────
//
// Admin-only. A person marks, for each of the 225 squares of a real board
// photo, whether a physical tile is there: TILE, EMPTY or UNSURE. Nothing
// here identifies WHICH tile (that is a later field, `physicalTileKind`, left
// null today), and nothing here ever looks at a model: every label is
// HUMAN_MANUAL.
//
// Coordinates, fixed by the schema:
//   • corners are the 15×15 GRID's corners (not the frame), TL TR BR BL as the
//     board is read, in pixels of the UPRIGHT ORIGINAL image (EXIF applied
//     once, full resolution — photo.ts `decodePhoto` divides by its `scale`);
//   • squares are row-major, `index` 0–224; `row` / `col` are 1–15 as the
//     labeler shows them ("R8C12"). Study's cells are 0-based r/c: use
//     `index` (= (row − 1) · 15 + (col − 1)) to join the two.
//
// Everything is plain data and every function returns a new object, so a
// saved board reloads EXACTLY: same corners, same 225 labels, same order.

import { BOARD_SIZE } from "../../../constants/gameRules";
import { CROP_CONTRACT } from "../crops";
import { GeometryError, validateQuad, type Quad } from "../geometry";
import { vocabularyFingerprint } from "../vocabulary";

export const LABELS_SCHEMA = "eq-lab/board-occupancy-labels@1";
export const DATASET_SCHEMA = "eq-lab/board-occupancy-dataset@1";
export const CELLS = BOARD_SIZE * BOARD_SIZE;

export type Occupancy = "TILE" | "EMPTY" | "UNSURE";
export type DatasetRole = "DEV" | "TRAIN" | "SEALED_TEST";
export type BoardStatus = "NOT_STARTED" | "DRAFT" | "COMPLETED";
export type Provenance = "HUMAN_MANUAL";
export const OCCUPANCIES: readonly Occupancy[] = ["TILE", "EMPTY", "UNSURE"];
export const ROLES: readonly DatasetRole[] = ["DEV", "TRAIN", "SEALED_TEST"];
export const DEFAULT_ROLE: DatasetRole = "SEALED_TEST";

export type LabeledCell = {
  row: number; // 1–15
  col: number; // 1–15
  index: number; // 0–224, row-major
  occupancy: Occupancy;
  provenance: Provenance;
  /** Stage 2, later: the PHYSICAL tile kind of a TILE square. Always null today. */
  physicalTileKind: null;
};

export type ImageMeta = {
  name: string;
  /** Hex SHA-256 of the file's bytes: the image's identity. */
  sha256: string;
  bytes: number;
  type: string;
  lastModified: number;
  /** Upright original pixels (EXIF applied once). */
  width: number;
  height: number;
  exifOrientation: number;
  orientedBy: "browser" | "app" | "none";
};

export type RoleChange = {
  from: DatasetRole;
  to: DatasetRole;
  at: string;
  confirmedLeavingSealed: boolean;
};

export type BoardLabels = {
  schema: typeof LABELS_SCHEMA;
  boardId: string;
  sessionId: string;
  role: DatasetRole;
  status: BoardStatus;
  image: ImageMeta;
  coordinateSpace: "upright-original-pixels";
  corners: Quad | null;
  cells: LabeledCell[];
  labelSource: "HUMAN_MANUAL";
  /** Always false: this tool shows no model output, for any role. */
  modelSuggestionsShown: false;
  /** For the later Stage-2 labels (physicalTileKind). */
  vocabularyFingerprint: string;
  roleHistory: RoleChange[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export class LabelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelError";
  }
}

// ── indexing ─────────────────────────────────────────────────────────────
export const indexOf = (row: number, col: number): number => (row - 1) * BOARD_SIZE + (col - 1);
export const rowColOf = (index: number): { row: number; col: number } => ({
  row: Math.floor(index / BOARD_SIZE) + 1,
  col: (index % BOARD_SIZE) + 1,
});
export const squareName = (index: number): string => {
  const { row, col } = rowColOf(index);
  return `R${row}C${col}`;
};

function emptyCells(): LabeledCell[] {
  return Array.from({ length: CELLS }, (_, index) => ({
    ...rowColOf(index),
    index,
    occupancy: "EMPTY" as const,
    provenance: "HUMAN_MANUAL" as const,
    physicalTileKind: null,
  }));
}

export function boardIdFor(sha256: string): string {
  return `board-${sha256.slice(0, 16)}`;
}

export function createBoard(
  image: ImageMeta,
  sessionId: string,
  now: string,
  role: DatasetRole = DEFAULT_ROLE,
): BoardLabels {
  return {
    schema: LABELS_SCHEMA,
    boardId: boardIdFor(image.sha256),
    sessionId,
    role,
    status: "NOT_STARTED",
    image: { ...image },
    coordinateSpace: "upright-original-pixels",
    corners: null,
    cells: emptyCells(),
    labelSource: "HUMAN_MANUAL",
    modelSuggestionsShown: false,
    vocabularyFingerprint: vocabularyFingerprint(),
    roleHistory: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

// Any edit makes a board a DRAFT (a completed board must be completed again).
function edited(b: BoardLabels, now: string): BoardLabels {
  return { ...b, status: "DRAFT", updatedAt: now, completedAt: null };
}

export function counts(b: Pick<BoardLabels, "cells">): Record<Occupancy | "TOTAL", number> {
  const c = { TILE: 0, EMPTY: 0, UNSURE: 0, TOTAL: b.cells.length };
  for (const cell of b.cells) c[cell.occupancy] += 1;
  return c;
}

// ── corners ──────────────────────────────────────────────────────────────
export function cornersProblem(quad: Quad | null): string | null {
  if (!quad) return "Place the four grid corners.";
  try {
    validateQuad(quad);
    return null;
  } catch (e) {
    if (e instanceof GeometryError)
      return "Corners are crossed or mirrored: 1 → 2 → 3 → 4 must go clockwise around the grid (TL, TR, BR, BL as read).";
    throw e;
  }
}

export function setCorners(b: BoardLabels, quad: Quad, now: string): BoardLabels {
  const q = quad.map(([x, y]) => [x, y] as const) as unknown as Quad;
  if (b.corners && b.corners.every(([x, y], i) => x === q[i]![0] && y === q[i]![1])) return b; // unchanged: keep status
  return { ...edited(b, now), corners: q };
}

/** A starting square in the middle of the photo (70% of the short side) —
 *  a place to drag from, never a guess at where the board is. */
export function defaultCorners(width: number, height: number): Quad {
  const side = Math.min(width, height) * 0.7;
  const x = (width - side) / 2;
  const y = (height - side) / 2;
  return [
    [x, y],
    [x + side, y],
    [x + side, y + side],
    [x, y + side],
  ];
}

export function resetCorners(b: BoardLabels, now: string): BoardLabels {
  return { ...edited(b, now), corners: null };
}

// ── painting, with undo / redo ───────────────────────────────────────────
export type Occupancies = readonly Occupancy[];
export const occupanciesOf = (b: BoardLabels): Occupancy[] => b.cells.map((c) => c.occupancy);

/** Paint `indices` (one click or one whole drag stroke) with `occupancy`. */
export function paint(
  b: BoardLabels,
  indices: Iterable<number>,
  occupancy: Occupancy,
  now: string,
): BoardLabels {
  const set = new Set<number>();
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= CELLS)
      throw new LabelError(`square ${i} is not on the board`);
    set.add(i);
  }
  if (![...set].some((i) => b.cells[i]!.occupancy !== occupancy)) return b;
  const cells = b.cells.map((c) => (set.has(c.index) ? { ...c, occupancy } : c));
  return { ...edited(b, now), cells };
}

export function withOccupancies(b: BoardLabels, occ: Occupancies, now: string): BoardLabels {
  if (occ.length !== CELLS) throw new LabelError("225 labels expected");
  return { ...edited(b, now), cells: b.cells.map((c, i) => ({ ...c, occupancy: occ[i]! })) };
}

/** Session-only history of painting strokes. */
export type History = { past: Occupancy[][]; future: Occupancy[][] };
export const EMPTY_HISTORY: History = { past: [], future: [] };
const HISTORY_LIMIT = 200;

export function stroke(
  b: BoardLabels,
  h: History,
  indices: Iterable<number>,
  occupancy: Occupancy,
  now: string,
) {
  const next = paint(b, indices, occupancy, now);
  if (next === b) return { board: b, history: h };
  return {
    board: next,
    history: { past: [...h.past, occupanciesOf(b)].slice(-HISTORY_LIMIT), future: [] },
  };
}
export function undo(b: BoardLabels, h: History, now: string) {
  const prev = h.past[h.past.length - 1];
  if (!prev) return { board: b, history: h };
  return {
    board: withOccupancies(b, prev, now),
    history: { past: h.past.slice(0, -1), future: [occupanciesOf(b), ...h.future] },
  };
}
export function redo(b: BoardLabels, h: History, now: string) {
  const next = h.future[0];
  if (!next) return { board: b, history: h };
  return {
    board: withOccupancies(b, next, now),
    history: { past: [...h.past, occupanciesOf(b)], future: h.future.slice(1) },
  };
}

/** Squares crossed by a drag from square `a` to square `b` (inclusive), so a fast
 *  drag never skips a square between two pointer events. */
export function squaresBetween(a: number, b: number): number[] {
  const A = rowColOf(a);
  const B = rowColOf(b);
  const steps = Math.max(Math.abs(B.row - A.row), Math.abs(B.col - A.col));
  const out: number[] = [];
  for (let s = 0; s <= steps; s += 1) {
    const t = steps === 0 ? 0 : s / steps;
    out.push(
      indexOf(Math.round(A.row + (B.row - A.row) * t), Math.round(A.col + (B.col - A.col) * t)),
    );
  }
  return [...new Set(out)];
}

// ── review and completion ────────────────────────────────────────────────
export function completionProblem(b: BoardLabels, reviewedAll: boolean): string | null {
  const c = cornersProblem(b.corners);
  if (c) return c;
  if (!b.sessionId.trim()) return "Give the board a session ID.";
  if (!reviewedAll) return "Confirm you reviewed all 225 squares.";
  return null;
}

export function complete(b: BoardLabels, reviewedAll: boolean, now: string): BoardLabels {
  const problem = completionProblem(b, reviewedAll);
  if (problem) throw new LabelError(problem);
  return { ...b, status: "COMPLETED", updatedAt: now, completedAt: now };
}

export function setSession(b: BoardLabels, sessionId: string, now: string): BoardLabels {
  return { ...edited(b, now), sessionId };
}

// ── roles: SEALED_TEST is protected ──────────────────────────────────────
/** Leaving SEALED_TEST once a board has been worked on needs an explicit confirmation. */
export function roleChangeNeedsConfirmation(b: BoardLabels, to: DatasetRole): boolean {
  return b.role === "SEALED_TEST" && to !== "SEALED_TEST" && b.status !== "NOT_STARTED";
}

export function setRole(
  b: BoardLabels,
  to: DatasetRole,
  now: string,
  confirmLeavingSealed = false,
): BoardLabels {
  if (!ROLES.includes(to)) throw new LabelError(`unknown role ${String(to)}`);
  if (to === b.role) return b;
  const needs = roleChangeNeedsConfirmation(b, to);
  if (needs && !confirmLeavingSealed)
    throw new LabelError(
      "This board is SEALED_TEST. Moving it out of the sealed test set needs explicit confirmation.",
    );
  return {
    ...b,
    role: to,
    updatedAt: now,
    roleHistory: [...b.roleHistory, { from: b.role, to, at: now, confirmedLeavingSealed: needs }],
  };
}

/** Model suggestions of any kind: never for SEALED_TEST. (No suggestion source is
 *  wired into the labeler at all today; this is the gate any future one must pass.) */
export function suggestionsAllowed(b: Pick<BoardLabels, "role">): boolean {
  return b.role !== "SEALED_TEST";
}

// ── export / import ──────────────────────────────────────────────────────
export type Dataset = {
  schema: typeof DATASET_SCHEMA;
  kind: "all" | "training";
  exportedAt: string;
  boards: BoardLabels[];
  excluded?: { boardId: string; role: DatasetRole; status: BoardStatus; reason: string }[];
};

/** Deterministic: boards by boardId, cells by index, fixed key order. */
export function canonical(b: BoardLabels): BoardLabels {
  return {
    schema: LABELS_SCHEMA,
    boardId: b.boardId,
    sessionId: b.sessionId,
    role: b.role,
    status: b.status,
    image: {
      name: b.image.name,
      sha256: b.image.sha256,
      bytes: b.image.bytes,
      type: b.image.type,
      lastModified: b.image.lastModified,
      width: b.image.width,
      height: b.image.height,
      exifOrientation: b.image.exifOrientation,
      orientedBy: b.image.orientedBy,
    },
    coordinateSpace: "upright-original-pixels",
    corners: b.corners ? (b.corners.map(([x, y]) => [x, y]) as unknown as Quad) : null,
    cells: [...b.cells]
      .sort((x, y) => x.index - y.index)
      .map((c) => ({
        row: c.row,
        col: c.col,
        index: c.index,
        occupancy: c.occupancy,
        provenance: c.provenance,
        physicalTileKind: null,
      })),
    labelSource: "HUMAN_MANUAL",
    modelSuggestionsShown: false,
    vocabularyFingerprint: b.vocabularyFingerprint,
    roleHistory: b.roleHistory.map((r) => ({
      from: r.from,
      to: r.to,
      at: r.at,
      confirmedLeavingSealed: r.confirmedLeavingSealed,
    })),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    completedAt: b.completedAt,
  };
}

export function exportAll(boards: BoardLabels[], now: string): Dataset {
  return {
    schema: DATASET_SCHEMA,
    kind: "all",
    exportedAt: now,
    boards: [...boards].sort(byId).map(canonical),
  };
}

/** Training data: COMPLETED boards with role TRAIN only. SEALED_TEST is never
 *  included, whatever its status; every exclusion is listed with its reason. */
export function exportTraining(boards: BoardLabels[], now: string): Dataset {
  const included: BoardLabels[] = [];
  const excluded: NonNullable<Dataset["excluded"]> = [];
  for (const b of [...boards].sort(byId)) {
    const why =
      b.role === "SEALED_TEST"
        ? "SEALED_TEST is never training data"
        : b.role === "DEV"
          ? "DEV boards are for development evaluation, not training"
          : b.status !== "COMPLETED"
            ? "not completed"
            : null;
    if (why) excluded.push({ boardId: b.boardId, role: b.role, status: b.status, reason: why });
    else included.push(canonical(b));
  }
  if (included.some((b) => b.role !== "TRAIN"))
    throw new LabelError("internal: a non-TRAIN board reached the training export");
  return { schema: DATASET_SCHEMA, kind: "training", exportedAt: now, boards: included, excluded };
}

const byId = (a: BoardLabels, b: BoardLabels) =>
  a.boardId < b.boardId ? -1 : a.boardId > b.boardId ? 1 : 0;

/** Validate and read one board (as exported). */
export function readBoard(raw: unknown): BoardLabels {
  const b = raw as Partial<BoardLabels> | null;
  if (!b || b.schema !== LABELS_SCHEMA) throw new LabelError(`not a ${LABELS_SCHEMA} board`);
  if (typeof b.boardId !== "string" || !b.boardId) throw new LabelError("boardId missing");
  if (!ROLES.includes(b.role as DatasetRole)) throw new LabelError("bad role");
  if (!["NOT_STARTED", "DRAFT", "COMPLETED"].includes(b.status as string))
    throw new LabelError("bad status");
  if (!b.image || typeof b.image.sha256 !== "string")
    throw new LabelError("image metadata missing");
  if (b.corners !== null && cornersProblem(b.corners as Quad))
    throw new LabelError(`${b.boardId}: invalid corners`);
  if (!Array.isArray(b.cells) || b.cells.length !== CELLS)
    throw new LabelError(`${b.boardId}: 225 cells expected`);
  b.cells.forEach((c, i) => {
    const want = rowColOf(i);
    if (c.index !== i || c.row !== want.row || c.col !== want.col)
      throw new LabelError(`${b.boardId}: cell ${i} out of order`);
    if (!OCCUPANCIES.includes(c.occupancy))
      throw new LabelError(`${b.boardId}: bad occupancy at ${squareName(i)}`);
    if (c.provenance !== "HUMAN_MANUAL")
      throw new LabelError(`${b.boardId}: labels must be HUMAN_MANUAL`);
    if (c.physicalTileKind !== null && c.physicalTileKind !== undefined)
      throw new LabelError(`${b.boardId}: physicalTileKind is not labelled yet`);
  });
  if (b.status === "COMPLETED" && cornersProblem(b.corners as Quad | null))
    throw new LabelError(`${b.boardId}: completed without corners`);
  if (b.modelSuggestionsShown !== false)
    throw new LabelError(`${b.boardId}: modelSuggestionsShown must be false`);
  return canonical({
    ...(b as BoardLabels),
    cells: b.cells.map((c) => ({ ...c, physicalTileKind: null })),
  });
}

export function readDataset(raw: unknown): BoardLabels[] {
  const d = raw as Partial<Dataset> | null;
  if (d && d.schema === DATASET_SCHEMA && Array.isArray(d.boards)) return d.boards.map(readBoard);
  if (d && (d as { schema?: string }).schema === LABELS_SCHEMA) return [readBoard(d)];
  throw new LabelError(`not a ${DATASET_SCHEMA} (or ${LABELS_SCHEMA}) document`);
}

// ── batch navigation ─────────────────────────────────────────────────────
/** Boards in a stable order: upload time, then file name, then id. */
export function batchOrder(boards: BoardLabels[]): BoardLabels[] {
  return [...boards].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      a.image.name.localeCompare(b.image.name) ||
      byId(a, b),
  );
}
export function neighbour(
  boards: BoardLabels[],
  currentId: string | null,
  step: -1 | 1,
): string | null {
  const order = batchOrder(boards);
  if (!order.length) return null;
  const i = order.findIndex((b) => b.boardId === currentId);
  if (i < 0) return order[0]!.boardId;
  return order[Math.min(order.length - 1, Math.max(0, i + step))]!.boardId;
}

// ── the rectified board the labels are painted on ───────────────────────
// crops.ts `rectifyBoard`: canonical pixel p ↔ board coordinate p / C − M,
// so square (row, col) spans [(c + M)·C, (c + 1 + M)·C) — 50 px squares in a
// 780-px canonical image with a 0.3-square margin all round.
/** The square under canonical pixel (x, y), or −1 off the grid (the margin). */
export function squareAtCanonical(x: number, y: number): number {
  const { pxPerSquare: C, marginSquares: M } = CROP_CONTRACT;
  const bx = x / C - M;
  const by = y / C - M;
  if (!(bx >= 0 && by >= 0 && bx < BOARD_SIZE && by < BOARD_SIZE)) return -1;
  return Math.floor(by) * BOARD_SIZE + Math.floor(bx);
}

/** Top-left canonical pixel and side of a square. */
export function squareBoxCanonical(index: number): { x: number; y: number; size: number } {
  const { pxPerSquare: C, marginSquares: M } = CROP_CONTRACT;
  const { row, col } = rowColOf(index);
  return { x: (col - 1 + M) * C, y: (row - 1 + M) * C, size: C };
}
