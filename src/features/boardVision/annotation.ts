// ── Real-photo annotations, for EVALUATION only ──────────────────────────────
//
// The import flow already produces everything an evaluation label needs: the
// grid corners a person placed with the loupe, and — after verification — the
// physical tile on every square. This turns that into the annotation format
// the benchmark reads (amath-vision-training/amathvision/realeval.py,
// `eq-lab/real-board-annotation@1`).
//
// Labels are PHYSICAL kinds. Faces are not recorded: they are not visible,
// and a benchmark of a recogniser must not score them. A square still read
// as `unknown`, or marked unsure by the annotator, is listed as `unsure` and
// is not scored — never guessed.
//
// Caution, stated here because it is easy to forget: a label that started
// from the model's own reading is only as good as the correction applied to
// it. Every square has to be checked against the real board.

import { BOARD_SIZE } from "../../constants/gameRules";
import type { Quad } from "./geometry";
import type { ReadingDecision } from "./recognize";
import type { Reconstruction } from "./types";
import { isTileKind, UNKNOWN } from "./vocabulary";

export const ANNOTATION_FORMAT = "eq-lab/real-board-annotation@1";

/** What the import flow knows about the photo a reconstruction came from. */
export type ImportContext = {
  photoName: string;
  /** The upright photo's size in its ORIGINAL pixels. */
  photoSize: readonly [number, number];
  /** Grid corners in reading 0 (row 1 at the top), in ORIGINAL upright pixels. */
  quad: Quad;
  reading: ReadingDecision;
  modelVersion: string;
  modelDomain: string;
  exifOrientation: number;
};

export type RealBoardAnnotation = {
  format: typeof ANNOTATION_FORMAT;
  image: string;
  gridCorners: number[][];
  board: { r: number; c: number; kind: string }[];
  unsure: { r: number; c: number }[];
  excluded: { r: number; c: number; reason: string }[];
  capture: Record<string, unknown>;
};

export function buildAnnotation(
  reconstruction: Reconstruction,
  context: ImportContext,
  unsure: ReadonlySet<number>,
): RealBoardAnnotation {
  const board: RealBoardAnnotation["board"] = [];
  const unsureCells: RealBoardAnnotation["unsure"] = [];
  reconstruction.cells.forEach((cell, index) => {
    const r = Math.floor(index / BOARD_SIZE);
    const c = index % BOARD_SIZE;
    if (unsure.has(index) || cell.reading === UNKNOWN) {
      unsureCells.push({ r, c });
      return;
    }
    if (isTileKind(cell.reading)) board.push({ r, c, kind: cell.reading });
  });
  return {
    format: ANNOTATION_FORMAT,
    image: context.photoName,
    gridCorners: context.quad.map(([x, y]) => [x, y]),
    board,
    unsure: unsureCells,
    excluded: [],
    capture: {
      tool: "EQ-Lab Study → นำเข้าจากรูป (annotation mode)",
      prefilledBy: context.modelVersion,
      photoSize: context.photoSize,
      exifOrientation: context.exifOrientation,
      readingSide: context.reading,
      note: "labels started from the model's reading and were corrected by the annotator",
    },
  };
}
