// ── The border: a verified reconstruction becomes a Study board ─────────────
//
// This is the only way out of the vision world. What comes out is a plain
// `BoardSnapshot`, built by the same helpers the Study editor uses
// (`newStudyTile`, `studyBoardCell`), so it carries nothing the editor would not
// have put there: no confidence, no alternatives, no provenance. From here on
// Study cannot tell — and must not be able to tell — that a camera was involved.
//
// It refuses rather than guesses. A board is only produced when every square is
// settled well enough that there is exactly one board it could mean:
//
//   • no square is merely "a tile, kind unknown";
//   • every blank and choice tile has a face somebody chose — a blank is never
//     quietly turned into a 0, which is what the editor's default would do;
//   • every face is one that tile can actually take;
//   • the physical set contains enough of every kind.
//
// The check is made from the READINGS, not from the flags on them. Flags are
// what the verification screen shows; they are not what this function trusts.

import { BOARD_SIZE } from "../../constants/gameRules";
import type { AmathToken } from "../../constants/tileDefinitions";
import {
  createBoard,
  getAssignmentOptions,
  tileNeedsAssignment,
  type BoardSnapshot,
} from "../../game";
import { newStudyTile, studyBoardCell } from "../study/position";
import { overspentKinds } from "./reconstruct";
import type { Reconstruction } from "./types";
import { UNKNOWN, isCellClass, isTileKind } from "./vocabulary";

export type ConfirmationBlocker =
  | { reason: "unreadable"; row: number; col: number }
  | { reason: "faceUnresolved"; row: number; col: number; kind: AmathToken }
  /** `kind` is null when the square is empty. */
  | { reason: "faceInvalid"; row: number; col: number; kind: AmathToken | null; face: string }
  | { reason: "overspent"; kind: AmathToken; used: number; available: number };

export type StudyBoardResult =
  { ok: true; board: BoardSnapshot } | { ok: false; blockers: readonly ConfirmationBlocker[] };

/** Everything standing between this reconstruction and a Study board. Empty
 *  means `toStudyBoard` will succeed. */
export function confirmationBlockers(reconstruction: Reconstruction): ConfirmationBlocker[] {
  if (reconstruction.cells.length !== BOARD_SIZE * BOARD_SIZE) {
    throw new RangeError(`A reconstruction has ${BOARD_SIZE * BOARD_SIZE} squares.`);
  }
  const blockers: ConfirmationBlocker[] = [];
  reconstruction.cells.forEach((cell, index) => {
    const row = Math.floor(index / BOARD_SIZE);
    const col = index % BOARD_SIZE;
    const reading = cell.reading;
    if (!isCellClass(reading) || reading === UNKNOWN) {
      blockers.push({ reason: "unreadable", row, col });
      return;
    }
    if (!isTileKind(reading)) {
      // Empty. A face on an empty square has nothing to belong to.
      if (cell.face !== null)
        blockers.push({ reason: "faceInvalid", row, col, kind: null, face: cell.face });
      return;
    }
    if (tileNeedsAssignment(reading)) {
      if (cell.face === null) blockers.push({ reason: "faceUnresolved", row, col, kind: reading });
      else if (!getAssignmentOptions(reading).includes(cell.face)) {
        blockers.push({ reason: "faceInvalid", row, col, kind: reading, face: cell.face });
      }
    } else if (cell.face !== null) {
      blockers.push({ reason: "faceInvalid", row, col, kind: reading, face: cell.face });
    }
  });
  for (const entry of overspentKinds(reconstruction.cells)) {
    blockers.push({ reason: "overspent", ...entry });
  }
  return blockers;
}

/**
 * The verified board, as Study holds boards — or the reasons it cannot be one.
 */
export function toStudyBoard(reconstruction: Reconstruction): StudyBoardResult {
  const blockers = confirmationBlockers(reconstruction);
  if (blockers.length > 0) return { ok: false, blockers };

  const board = createBoard();
  reconstruction.cells.forEach((cell, index) => {
    if (!isTileKind(cell.reading)) return;
    board[Math.floor(index / BOARD_SIZE)]![index % BOARD_SIZE] = studyBoardCell(
      newStudyTile(cell.reading, cell.face ?? undefined),
    );
  });
  return { ok: true, board };
}
