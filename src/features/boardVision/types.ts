// ── Board Vision: the contracts ──────────────────────────────────────────────
//
// Two worlds meet in Study, and this file is the vision side of the border.
//
//   Vision world                         Game world
//   ────────────                         ──────────
//   BoardEvidence   (what was seen)
//        ↓ reconstruct()
//   Reconstruction  (what is believed, and how firmly)
//        ↓ correctCell()  — a person verifies
//   ─────────────── toStudyBoard() ───────────────
//                                        BoardSnapshot → Study, unchanged
//
// Nothing on the left of that line survives crossing it. A `BoardSnapshot`
// coming out of `toStudyBoard` is built by the same helpers the Study editor
// uses and carries no confidence, no alternatives, no provenance: it is
// indistinguishable from a board typed by hand, which is the point.
//
// Every producer — a fixture today, an uploaded photo (V1), a camera (V3) —
// speaks `BoardEvidence`. Everything after it is shared.
//
// ── What is being reconstructed: the PHYSICAL board ─────────────────────────
//
// The goal is what is physically on the table, not the nearest mathematically
// valid board. They differ whenever a bad play went unchallenged, and that
// invalid equation is part of the position. So three kinds of "not sure" are
// kept apart here, and never collapsed into one another:
//
//   visual uncertainty      the image does not say which tile is there
//                           (`uncertain`, `unreadable` — evidence about KIND)
//   assignment ambiguity    the tile is known, but not the face it was played
//                           as: `6 = 6 ± 0` reads correctly either way, so
//                           there is no fact to recover (`faceUnresolved`)
//   equation inconsistency  the readings are confident and no face makes the
//                           run valid (`equationIssues`) — either the board
//                           really holds a bad equation, or something was
//                           misread. Flagged loudly; never "fixed".
//
// A recogniser only ever contributes the first. Equation reasoning may inform
// the second and must only ever REPORT the third; changing a reading to make an
// equation balance is forbidden, and `ruleOverride` exists so that it can
// never happen silently.

import type { AmathToken } from "../../constants/tileDefinitions";
import type { BoardEquationIssue } from "../../game";
import type { CellClass } from "./vocabulary";

// ── Evidence ────────────────────────────────────────────────────────────────

/** A clockwise quarter-turn of a tile's print relative to the board's "up". */
export type QuarterTurn = 0 | 1 | 2 | 3;

/**
 * Natural-log probabilities over `CellClass`.
 *
 * A class that is ABSENT has probability zero under this evidence. Logs rather
 * than probabilities because combining independent observations (a later
 * milestone) is then a sum, and a sum of logs does not underflow the way a
 * product of many small probabilities does.
 */
export type ClassLogProbabilities = Readonly<Partial<Record<CellClass, number>>>;

/**
 * Everything known about one square.
 *
 * Deliberately not "square → tile". A recogniser that is 51% sure of an 8 and
 * 31% sure of a 3 has said something different from one that is 99% sure of an
 * 8, and the difference has to reach the person verifying the board.
 */
export type CellEvidence = {
  /** Normalised: the probabilities sum to 1. */
  logProbabilities: ClassLogProbabilities;
  /**
   * Which way the tile's print faces, when the producer can tell. Absent means
   * "no information", not "upright". Carried now so that orientation reasoning
   * can arrive later without changing this shape.
   */
  orientation?: Readonly<Partial<Record<QuarterTurn, number>>>;
  /** How many observations this summarises: 1 for a single photo, 0 for a
   *  square no observation covered. */
  observations: number;
};

/** The whole board: 225 entries, row-major (`index = row * 15 + col`). */
export type BoardEvidence = {
  cells: readonly CellEvidence[];
};

// ── Reconstruction ──────────────────────────────────────────────────────────

/**
 * Why a square needs a person's attention.
 *
 * Blocking — `toStudyBoard` refuses while any of these stand:
 *   unreadable      a tile is believed to be there but not which one
 *   faceUnresolved  a blank or choice tile whose face nobody has chosen
 *   overspent       more of this kind than the physical set contains
 *
 * Advisory — shown, never blocking:
 *   uncertain       the evidence's own confidence in this reading is low
 *   ruleOverride    the reading is not what the evidence ranked first, and a
 *                   person did not choose it. No V0a rule changes a reading, so
 *                   this is never raised today; it exists so that the solver
 *                   that eventually does cannot do it silently.
 */
export type CellFlag = "unreadable" | "faceUnresolved" | "overspent" | "uncertain" | "ruleOverride";

export type ReadingAlternative = { reading: CellClass; probability: number };

/**
 * Where an assigned face came from. Kept distinct because a default is not a
 * fact: a later stage may pick a face so that a board can cross into Study
 * (whose `BoardSnapshot` cannot say "unresolved"), but until then the
 * reconstruction must still know it was a choice, not an inference.
 *
 *   proven         the only face consistent with the board (not produced yet)
 *   userSelected   a person chose it
 *   systemDefault  picked deterministically so the board can be used, NOT
 *                  inferred (not produced yet)
 *
 * Unresolved is `face: null`, with no provenance.
 */
export type FaceProvenance = "proven" | "userSelected" | "systemDefault";

export type ReconstructedCell = {
  row: number;
  col: number;
  /** What the square is currently believed to hold. */
  reading: CellClass;
  /**
   * The face a blank or choice tile is played as. `null` while unresolved, and
   * always `null` for a tile that has no choice of face. Never defaulted: a
   * blank whose face nobody chose is NOT a 0.
   */
  face: string | null;
  /** How `face` was arrived at; `null` exactly when `face` is. */
  faceProvenance: FaceProvenance | null;
  /** Probability the evidence gives `reading`. A person's correction is not
   *  evidence, so this stays the evidence's number after one. */
  confidence: number;
  /** Every reading the evidence gave any weight to, most probable first. */
  alternatives: readonly ReadingAlternative[];
  /** Who settled `reading`: the evidence's own ranking, or a person. */
  decidedBy: "evidence" | "person";
  flags: readonly CellFlag[];
};

export type OverspentKind = { kind: AmathToken; used: number; available: number };

export type Reconstruction = {
  /** 225 entries, row-major. */
  cells: readonly ReconstructedCell[];
  /** Kinds read more often than the physical set contains them. */
  overspent: readonly OverspentKind[];
  /**
   * Runs that do not read as valid equations — ANNOTATIONS, never corrections.
   * Study accepts boards with invalid runs, and so does a physical game where a
   * bad play went unchallenged, so equation validity is evidence about a
   * reading, not a rule that may rewrite one. Runs that touch an unreadable
   * square or an unresolved face are left out: their "error" is the missing
   * information, which is already flagged on the square itself.
   */
  equationIssues: readonly BoardEquationIssue[];
};

/**
 * What still needs attention, grouped by the KIND of doubt — the three
 * categories above, plus inventory, which is a hard physical limit rather than
 * a doubt. Equation inconsistency is listed by run because it belongs to a run,
 * not to any one of its squares; a finalisation screen should give it more
 * weight than assignment ambiguity, which may be harmless either way.
 */
export type AttentionSummary = {
  visualUncertainty: readonly ReconstructedCell[];
  assignmentAmbiguity: readonly ReconstructedCell[];
  equationInconsistency: readonly BoardEquationIssue[];
  inventoryConflict: readonly OverspentKind[];
};

/** A person's change to one square during verification. */
export type CellCorrection = { reading: CellClass } | { face: string };

// ── Producers ───────────────────────────────────────────────────────────────

/**
 * Something that can turn the physical world into `BoardEvidence`.
 *
 * `produce` is absent while the producer does not exist yet, which is how the
 * entry points can be wired now without pretending to work.
 */
export type BoardEvidenceSource = {
  id: string;
  label: string;
  produce?: (signal: AbortSignal) => Promise<BoardEvidence>;
};
