// Evaluation labels made from a verified photo import.
import { describe, expect, it } from "vitest";

import {
  ANNOTATION_FORMAT,
  buildAnnotation,
  type ImportContext,
} from "../src/features/boardVision/annotation";
import { boardEvidenceFromFixture } from "../src/features/boardVision/evidence";
import { correctCell, reconstruct } from "../src/features/boardVision/reconstruct";

const context: ImportContext = {
  photoName: "IMG_0412.jpg",
  photoSize: [4032, 3024],
  quad: [
    [812.5, 402.25],
    [3301, 455],
    [3350.75, 2890],
    [760, 2833.5],
  ],
  reading: { decided: true, shift: 2, margin: 40, tiles: 30 },
  modelVersion: "0.1.0",
  modelDomain: "synthetic-only",
  exifOrientation: 6,
};

const evidence = boardEvidenceFromFixture({
  format: "eq-lab/board-evidence-fixture@1",
  cells: [
    { r: 7, c: 7, p: { "?": 0.97 } },
    { r: 7, c: 8, p: { "+/-": 0.97 } },
    { r: 7, c: 9, p: { "8": 0.6, "6": 0.39 } },
    { r: 2, c: 2, p: { unknown: 0.9 } },
  ],
});

describe("a real-photo annotation", () => {
  it("records physical kinds, corners in original pixels, and never a face", () => {
    let r = reconstruct(evidence);
    r = correctCell(r, 7, 7, { face: "5" });
    r = correctCell(r, 7, 9, { reading: "6" }); // the annotator corrects the model
    const a = buildAnnotation(r, context, new Set());
    expect(a.format).toBe(ANNOTATION_FORMAT);
    expect(a.image).toBe("IMG_0412.jpg");
    expect(a.gridCorners).toEqual(context.quad.map(([x, y]) => [x, y]));
    expect(a.board).toEqual([
      { r: 7, c: 7, kind: "?" },
      { r: 7, c: 8, kind: "+/-" },
      { r: 7, c: 9, kind: "6" },
    ]);
    expect(JSON.stringify(a)).not.toContain('"5"'); // the blank's face is not a label
  });

  it("leaves what nobody could read, and what the annotator marked, unscored", () => {
    const a = buildAnnotation(reconstruct(evidence), context, new Set([7 * 15 + 9]));
    expect(a.unsure).toEqual([
      { r: 2, c: 2 },
      { r: 7, c: 9 },
    ]);
    expect(a.board.map((cell) => [cell.r, cell.c])).not.toContainEqual([7, 9]);
  });
});
