// The contract a trained recogniser is built against.
//
// A model's outputs are positions in CELL_CLASSES, so any change to the tile
// set or to the class order silently re-labels every output of every existing
// model. The fingerprint is pinned here so that such a change fails loudly and
// comes with its consequence attached: re-export the contract
// (tools/vision/exportContract.ts) and retrain.
import { describe, expect, it } from "vitest";

import { AMATH_TOKENS } from "../src/constants/tileDefinitions";
import { manifestFingerprint } from "../src/domain/tiles";
import { CELL_CLASSES, vocabularyFingerprint } from "../src/features/boardVision/vocabulary";
import { visionContract } from "../tools/vision/visionContract";

describe("the vision training contract", () => {
  it("is pinned: changing it means retraining every recogniser", () => {
    expect(vocabularyFingerprint()).toBe("b9fea6ae");
    expect(CELL_CLASSES).toHaveLength(31);
  });

  it("exports the runtime's own vocabulary, in the runtime's order", () => {
    const contract = visionContract();
    expect(contract.cellClasses).toEqual([...CELL_CLASSES]);
    expect(contract.manifestFingerprint).toBe(manifestFingerprint());
    expect(contract.tiles.map((tile) => tile.kind)).toEqual(Object.keys(AMATH_TOKENS));
  });

  it("carries the runtime's crop geometry, so training does not restate it", () => {
    expect(visionContract().crop).toEqual({
      pxPerSquare: 50,
      marginSquares: 0.3,
      canonicalSize: 780,
      cropSize: 80,
      mean: 0.5,
      std: 0.5,
    });
  });

  it("describes what is PRINTED, never an assigned face", () => {
    const byKind = Object.fromEntries(visionContract().tiles.map((tile) => [tile.kind, tile]));
    expect(byKind["?"]).toMatchObject({ printed: "", point: 0, assignable: true });
    expect(byKind["+/-"]).toMatchObject({ printed: "+/-", faces: ["+", "-"] });
    expect(byKind["x//"]).toMatchObject({ printed: "x/÷", faces: ["×", "÷"] });
    expect(byKind["x"]).toMatchObject({ printed: "×", assignable: false, faces: [] });
  });
});
