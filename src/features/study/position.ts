// ── A Study position, in the two forms it takes ──────────────────────────────
//
// Study holds its board as the game's own `BoardSnapshot`, and sends it to the
// engine service as a flat list of `StudyBoardCell`s. Those two forms and the
// conversions between them live here, and only here.
//
// There used to be one copy of each conversion per place that needed it: the
// editor built the wire list inline, the saved-record view rebuilt a board
// inline, and the cell type was declared twice. That was harmless while typing
// was the only way a board arrived. It stops being harmless the moment a second
// producer exists — a board read from a photo must reach the engine as exactly
// the bytes the same board typed by hand would, and "exactly" is only something
// one function can promise.

import type { AmathToken, BoardCell, BoardSnapshot, TileInstance } from "../../game";
import { createBoard } from "../../game";

/**
 * One occupied square, as the engine service reads it and the study archive
 * stores it.
 *
 * `kind` and `token` are strings rather than `AmathToken` because this is also
 * the shape READ BACK from the database, which is not something the type system
 * can vouch for. The service validates both on the way in (`parseStudyPosition`).
 */
export type StudyBoardCell = {
  r: number;
  c: number;
  /** The physical tile. */
  kind: string;
  /** The face it is played as; differs from `kind` only for `?`, `+/-` and `x//`. */
  token: string;
};

/**
 * A new tile for a Study position.
 *
 * `assignedToken` is left OFF the object — not set to `undefined` — when there
 * is no face, which is how the board editor has always built plain tiles. The
 * difference is invisible to the engine but not to a deep equality check, and
 * this module's whole job is that two routes to the same board are equal.
 */
export function newStudyTile(token: AmathToken, assignedToken?: string): TileInstance {
  return assignedToken
    ? { id: crypto.randomUUID(), token, assignedToken }
    : { id: crypto.randomUUID(), token };
}

/**
 * A square holding `tile`, in a position nobody played.
 *
 * Study has no turns and no sides, so every tile is placed on turn 0 by side A.
 * Nothing reads those two fields for a study position; they are filled because
 * `BoardCell` requires them, and filled the same way everywhere.
 */
export function studyBoardCell(tile: TileInstance): BoardCell {
  return { tile, placedTurn: 0, side: "A" };
}

/** The face a tile is played as, for the engine's `token` field: the assigned
 *  face when it has one, otherwise the tile's own name. */
export function studyFaceOf(tile: TileInstance): string {
  return tile.assignedToken ?? tile.token;
}

/** The board as the engine service is asked about it: occupied squares only,
 *  row-major. */
export function toStudyBoardCells(board: BoardSnapshot): StudyBoardCell[] {
  return board.flatMap((line, r) =>
    line.flatMap((cell, c) =>
      cell ? [{ r, c, kind: cell.tile.token, token: studyFaceOf(cell.tile) }] : [],
    ),
  );
}

/**
 * A board rebuilt from stored cells, for DISPLAY.
 *
 * The ids are the square's coordinates rather than fresh UUIDs so that the same
 * record renders to the same picture every time. Nothing is validated: this is
 * for showing a record the service already accepted, not for admitting a new one.
 */
export function boardFromStudyCells(cells: readonly StudyBoardCell[]): BoardSnapshot {
  const board = createBoard();
  for (const cell of cells) {
    const row = board[cell.r];
    if (!row) continue;
    const token = cell.kind as AmathToken;
    row[cell.c] = studyBoardCell(
      cell.token && cell.token !== cell.kind
        ? { id: `${cell.r}:${cell.c}`, token, assignedToken: cell.token }
        : { id: `${cell.r}:${cell.c}`, token },
    );
  }
  return board;
}
