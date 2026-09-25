// ── Building evidence ────────────────────────────────────────────────────────
//
// Producers state what they saw as probabilities, because that is what a
// classifier emits and what a person writing a fixture thinks in. This module
// turns those into the normalised log form `CellEvidence` carries, and refuses
// anything that is not a probability distribution over the vocabulary.
//
// It also reads the development fixture format — the one producer that exists
// in V0a. It is the same shape a real producer would hand over, only written by
// hand.

import { BOARD_SIZE } from "../../constants/gameRules";
import type { BoardEvidence, CellEvidence } from "./types";
import { EMPTY, UNKNOWN, isCellClass, type CellClass } from "./vocabulary";

export class EvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceError";
  }
}

/** How far a stated distribution may sum past 1 before it is a mistake rather
 *  than floating-point noise. */
const SUM_TOLERANCE = 1e-6;

/**
 * One observation of one square, from probabilities.
 *
 * Whatever mass the producer did not place on a named class is placed on
 * `unknown`: probability it declined to commit is, by definition, "a reading I
 * cannot name". A distribution that sums past 1 is refused rather than quietly
 * rescaled — that is a producer bug, and rescaling would hide it.
 */
export function cellEvidenceFromProbabilities(
  probabilities: Readonly<Partial<Record<CellClass, number>>>,
): CellEvidence {
  let total = 0;
  const entries: Array<[CellClass, number]> = [];
  for (const [key, value] of Object.entries(probabilities)) {
    if (!isCellClass(key)) throw new EvidenceError(`"${key}" is not something a square can hold.`);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new EvidenceError(`The probability of "${key}" must be between 0 and 1.`);
    }
    if (value > 0) entries.push([key, value]);
    total += value;
  }
  if (total > 1 + SUM_TOLERANCE) {
    throw new EvidenceError(`Probabilities sum to ${total}, which is more than 1.`);
  }

  const residual = Math.max(0, 1 - total);
  if (residual > SUM_TOLERANCE) {
    const at = entries.findIndex(([key]) => key === UNKNOWN);
    if (at >= 0) entries[at] = [UNKNOWN, entries[at]![1] + residual];
    else entries.push([UNKNOWN, residual]);
  }

  // Normalise away the rounding that the tolerance let through, so the stated
  // invariant (sums to exactly 1) holds for every CellEvidence.
  const mass = entries.reduce((sum, [, value]) => sum + value, 0);
  const logProbabilities: Partial<Record<CellClass, number>> = {};
  for (const [key, value] of entries) logProbabilities[key] = Math.log(value / mass);
  return { logProbabilities, observations: 1 };
}

/** A square no observation covered. Its reading is unknown until a person says. */
export function unobservedCell(): CellEvidence {
  return { logProbabilities: { [UNKNOWN]: 0 }, observations: 0 };
}

// ── Development fixtures ────────────────────────────────────────────────────

export const FIXTURE_FORMAT = "eq-lab/board-evidence-fixture@1";

/**
 * A hand-written board of evidence.
 *
 *   {
 *     "format": "eq-lab/board-evidence-fixture@1",
 *     "cells": [ { "r": 7, "c": 5, "p": { "8": 0.51, "3": 0.31, "9": 0.12 } } ]
 *   }
 *
 * Squares that are not listed were seen and are empty, with certainty. `r` and
 * `c` are zero-based, as in `StudyBoardCell`.
 */
export type BoardEvidenceFixture = {
  format: typeof FIXTURE_FORMAT;
  description?: string;
  cells: Array<{ r: number; c: number; p: Partial<Record<CellClass, number>> }>;
};

export function boardEvidenceFromFixture(fixture: unknown): BoardEvidence {
  const source = fixture as Partial<BoardEvidenceFixture> | null;
  if (!source || source.format !== FIXTURE_FORMAT || !Array.isArray(source.cells)) {
    throw new EvidenceError(`Not a ${FIXTURE_FORMAT} document.`);
  }

  const cells: CellEvidence[] = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, () =>
    cellEvidenceFromProbabilities({ [EMPTY]: 1 }),
  );
  const seen = new Set<number>();
  for (const entry of source.cells) {
    const { r, c, p } = entry ?? {};
    if (!isSquareIndex(r) || !isSquareIndex(c)) {
      throw new EvidenceError(`(${String(r)}, ${String(c)}) is not a square on the board.`);
    }
    const index = r * BOARD_SIZE + c;
    if (seen.has(index)) throw new EvidenceError(`Square (${r}, ${c}) is listed twice.`);
    seen.add(index);
    cells[index] = cellEvidenceFromProbabilities(p ?? {});
  }
  return { cells };
}

function isSquareIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < BOARD_SIZE;
}
