// ── From evidence to a candidate board ──────────────────────────────────────
//
// V0a reconstruction is deliberately plain: each square takes the reading its
// evidence ranks first, and nothing is changed by rules. What it DOES establish
// is everything a stronger solver will have to respect:
//
//   • uncertainty survives — every alternative the evidence gave weight to is
//     kept, with its probability, all the way to the person verifying;
//   • tile inventory is a HARD constraint, and a board that breaks it is
//     marked, never clamped;
//   • equation validity is only an annotation — Study and real games both admit
//     boards with invalid runs, so a run failing to balance is a reason to look,
//     not a licence to rewrite;
//   • a face is never assumed — a blank or choice tile stays unresolved until a
//     person (or, later, a solver that says so) resolves it;
//   • nothing changes a reading silently — any reading that is not the
//     evidence's first choice and was not chosen by a person is flagged
//     `ruleOverride`, computed here for every square whatever produced it.
//
// Flags are DERIVED: `derive` recomputes all of them from the readings after
// every change, so there is no way for a correction to leave a stale flag
// behind.

import { BOARD_SIZE } from "../../constants/gameRules";
import { AMATH_TOKENS, type AmathToken } from "../../constants/tileDefinitions";
import {
  createBoard,
  findBoardEquationIssues,
  getAssignmentOptions,
  tileNeedsAssignment,
  type BoardEquationIssue,
  type BoardSnapshot,
} from "../../game";
import { studyBoardCell } from "../study/position";
import { EvidenceError } from "./evidence";
import type {
  AttentionSummary,
  BoardEvidence,
  CellCorrection,
  CellEvidence,
  CellFlag,
  OverspentKind,
  ReadingAlternative,
  ReconstructedCell,
  Reconstruction,
} from "./types";
import {
  TILE_KINDS,
  UNKNOWN,
  classOrder,
  isCellClass,
  isTileKind,
  type CellClass,
} from "./vocabulary";

const SQUARES = BOARD_SIZE * BOARD_SIZE;

/**
 * Below this, a reading the evidence settled on is shown as uncertain.
 *
 * A presentation threshold, not a correctness one: an uncertain square does not
 * block confirmation, it asks to be looked at. The number becomes meaningful
 * only once a real recogniser is calibrated against it.
 */
export const UNCERTAIN_BELOW = 0.9;

export function reconstruct(evidence: BoardEvidence): Reconstruction {
  if (evidence.cells.length !== SQUARES) {
    throw new EvidenceError(
      `Evidence must cover ${SQUARES} squares, not ${evidence.cells.length}.`,
    );
  }
  const cells = evidence.cells.map((cell, index): ReconstructedCell => {
    const alternatives = alternativesOf(cell);
    const first = alternatives[0] ?? { reading: UNKNOWN, probability: 0 };
    return {
      row: Math.floor(index / BOARD_SIZE),
      col: index % BOARD_SIZE,
      reading: first.reading,
      face: null,
      faceProvenance: null,
      confidence: first.probability,
      alternatives,
      decidedBy: "evidence",
      flags: [],
    };
  });
  return derive(cells);
}

/**
 * Apply a person's decision about one square.
 *
 * Choosing a reading — including the one already shown — is the person
 * vouching for it, so the square stops being "uncertain". Choosing a face does
 * the same for the reading it is a face of. Neither changes `confidence`,
 * which remains what the evidence said.
 *
 * Throws on a decision that cannot be represented (a face for a tile that has
 * none, a face the tile cannot take, or "unknown" as a choice). Those are UI
 * bugs, and a thrown error is how they get found rather than stored.
 */
export function correctCell(
  reconstruction: Reconstruction,
  row: number,
  col: number,
  correction: CellCorrection,
): Reconstruction {
  const index = row * BOARD_SIZE + col;
  const cell = reconstruction.cells[index];
  if (!cell || row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) {
    throw new RangeError(`(${row}, ${col}) is not a square on the board.`);
  }

  let next: ReconstructedCell;
  if ("reading" in correction) {
    const reading = correction.reading;
    if (!isCellClass(reading) || reading === UNKNOWN) {
      throw new RangeError(`"${String(reading)}" is not a reading a person can choose.`);
    }
    next = {
      ...cell,
      reading,
      // Keeping the face only makes sense when the tile did not change.
      face: reading === cell.reading ? cell.face : null,
      faceProvenance: reading === cell.reading ? cell.faceProvenance : null,
      confidence: probabilityOf(cell.alternatives, reading),
      decidedBy: "person",
    };
  } else {
    const kind = cell.reading;
    if (!isTileKind(kind) || !tileNeedsAssignment(kind)) {
      throw new RangeError(`The tile at (${row}, ${col}) has no face to choose.`);
    }
    if (!getAssignmentOptions(kind).includes(correction.face)) {
      throw new RangeError(`"${correction.face}" is not a face ${kind} can be played as.`);
    }
    next = {
      ...cell,
      face: correction.face,
      faceProvenance: "userSelected",
      decidedBy: "person",
    };
  }

  const cells = reconstruction.cells.slice();
  cells[index] = next;
  return derive(cells);
}

/** What is left to look at, by kind of doubt (see `AttentionSummary`). */
export function attentionSummary(reconstruction: Reconstruction): AttentionSummary {
  const withFlag = (flag: CellFlag) =>
    reconstruction.cells.filter((cell) => cell.flags.includes(flag));
  return {
    visualUncertainty: reconstruction.cells.filter(
      (cell) => cell.flags.includes("uncertain") || cell.flags.includes("unreadable"),
    ),
    assignmentAmbiguity: withFlag("faceUnresolved"),
    equationInconsistency: reconstruction.equationIssues,
    inventoryConflict: reconstruction.overspent,
  };
}

/**
 * Kinds read more often than the physical set holds them, in manifest order.
 * The one definition of the inventory check — the adapter asks this too.
 */
export function overspentKinds(
  cells: readonly Pick<ReconstructedCell, "reading">[],
): OverspentKind[] {
  const used = new Map<AmathToken, number>();
  for (const cell of cells) {
    if (isCellClass(cell.reading) && isTileKind(cell.reading)) {
      used.set(cell.reading, (used.get(cell.reading) ?? 0) + 1);
    }
  }
  return TILE_KINDS.flatMap((kind) => {
    const count = used.get(kind) ?? 0;
    const available = AMATH_TOKENS[kind].count;
    return count > available ? [{ kind, used: count, available }] : [];
  });
}

/**
 * The reconstruction drawn as a board — for LOOKING AT, never for Study.
 *
 * An unreadable square is drawn empty (its flag says a tile is there), and an
 * unresolved blank or choice tile is drawn without a face, which is exactly how
 * the physical tile looks. This board cannot be confirmed; `toStudyBoard` is
 * the only way across.
 */
export function provisionalBoard(reconstruction: Pick<Reconstruction, "cells">): BoardSnapshot {
  const board = createBoard();
  for (const cell of reconstruction.cells) {
    if (!isTileKind(cell.reading)) continue;
    const id = `vision:${cell.row}:${cell.col}`;
    board[cell.row]![cell.col] = studyBoardCell(
      cell.face
        ? { id, token: cell.reading, assignedToken: cell.face }
        : { id, token: cell.reading },
    );
  }
  return board;
}

// ── internals ──────────────────────────────────────────────────────────────

function alternativesOf(cell: CellEvidence): ReadingAlternative[] {
  const alternatives: ReadingAlternative[] = [];
  for (const [reading, logProbability] of Object.entries(cell.logProbabilities)) {
    if (!isCellClass(reading) || typeof logProbability !== "number") continue;
    const probability = Math.exp(logProbability);
    if (probability > 0) alternatives.push({ reading, probability });
  }
  // Ties are broken by vocabulary order, so the same evidence always yields
  // the same first choice.
  return alternatives.sort(
    (a, b) => b.probability - a.probability || classOrder(a.reading) - classOrder(b.reading),
  );
}

function probabilityOf(alternatives: readonly ReadingAlternative[], reading: CellClass): number {
  return alternatives.find((alternative) => alternative.reading === reading)?.probability ?? 0;
}

function needsFace(cell: ReconstructedCell): boolean {
  return isTileKind(cell.reading) && tileNeedsAssignment(cell.reading) && cell.face === null;
}

function derive(cells: ReconstructedCell[]): Reconstruction {
  const overspent = overspentKinds(cells);
  const overspentSet = new Set(overspent.map((entry) => entry.kind));

  const flagged = cells.map((cell): ReconstructedCell => {
    const flags: CellFlag[] = [];
    if (cell.reading === UNKNOWN) flags.push("unreadable");
    if (needsFace(cell)) flags.push("faceUnresolved");
    if (isTileKind(cell.reading) && overspentSet.has(cell.reading)) flags.push("overspent");
    if (cell.decidedBy === "evidence") {
      if (cell.confidence < UNCERTAIN_BELOW) flags.push("uncertain");
      if (cell.alternatives[0]?.reading !== cell.reading) flags.push("ruleOverride");
    }
    return { ...cell, flags };
  });

  return { cells: flagged, overspent, equationIssues: equationIssuesOf(flagged) };
}

/**
 * Invalid runs, minus the ones whose only problem is missing information.
 *
 * A run next to an unreadable square is not the whole run (the provisional
 * board draws that square empty, cutting it in two), and a run holding an
 * unresolved face cannot be evaluated at all. Reporting either would be noise
 * that disappears the moment the flagged square is resolved.
 */
function equationIssuesOf(cells: readonly ReconstructedCell[]): BoardEquationIssue[] {
  const incomplete = (row: number, col: number): boolean => {
    if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) return false;
    const cell = cells[row * BOARD_SIZE + col]!;
    return cell.reading === UNKNOWN || needsFace(cell);
  };
  return findBoardEquationIssues(provisionalBoard({ cells })).filter((issue) => {
    const first = issue.cells[0]!;
    const last = issue.cells[issue.cells.length - 1]!;
    const [dr, dc] = issue.direction === "horizontal" ? [0, 1] : [1, 0];
    return !(
      incomplete(first.row - dr, first.col - dc) ||
      incomplete(last.row + dr, last.col + dc) ||
      issue.cells.some((cell) => incomplete(cell.row, cell.col))
    );
  });
}
