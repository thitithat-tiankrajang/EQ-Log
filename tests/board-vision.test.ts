// Board Vision V0a: evidence → reconstruction → verification → BoardSnapshot.
//
// No pixels anywhere in this file. What is pinned is the contract a real
// recogniser will later have to feed: uncertainty survives to the person
// verifying, the tile set is a hard limit, faces are never invented, and the
// board that comes out the other side is indistinguishable from a typed one.
import { describe, expect, it } from "vitest";

import { AMATH_TOKENS } from "../src/constants/tileDefinitions";
import {
  EvidenceError,
  boardEvidenceFromFixture,
  cellEvidenceFromProbabilities,
} from "../src/features/boardVision/evidence";
import {
  UNCERTAIN_BELOW,
  attentionSummary,
  correctCell,
  provisionalBoard,
  reconstruct,
} from "../src/features/boardVision/reconstruct";
import { confirmationBlockers, toStudyBoard } from "../src/features/boardVision/toStudyBoard";
import type { BoardEvidence, Reconstruction } from "../src/features/boardVision/types";
import { CELL_CLASSES, TILE_KINDS } from "../src/features/boardVision/vocabulary";
import { newStudyTile, studyBoardCell, toStudyBoardCells } from "../src/features/study/position";
import { createBoard, type BoardSnapshot } from "../src/game";
import sampleBoard from "../src/features/boardVision/fixtures/sampleBoard.json";

type Probabilities = Parameters<typeof cellEvidenceFromProbabilities>[0];

/** A board of evidence: listed squares as given, every other square certainly empty. */
function evidence(cells: Array<[number, number, Probabilities]>): BoardEvidence {
  return boardEvidenceFromFixture({
    format: "eq-lab/board-evidence-fixture@1",
    cells: cells.map(([r, c, p]) => ({ r, c, p })),
  });
}

const at = (reconstruction: Reconstruction, row: number, col: number) =>
  reconstruction.cells[row * 15 + col]!;

describe("the vision vocabulary", () => {
  it("is every physical tile kind, plus empty and unknown — and no faces", () => {
    expect(TILE_KINDS).toEqual(Object.keys(AMATH_TOKENS));
    expect(CELL_CLASSES).toEqual([...Object.keys(AMATH_TOKENS), "empty", "unknown"]);
    // Faces are what a player DECIDES; a photograph cannot report them.
    for (const face of ["×", "÷"]) expect(CELL_CLASSES).not.toContain(face);
  });
});

describe("evidence", () => {
  it("puts the mass a producer did not commit on `unknown`", () => {
    const cell = cellEvidenceFromProbabilities({ "8": 0.51, "3": 0.31, "9": 0.12 });
    const probability = (key: string) =>
      Math.exp((cell.logProbabilities as Record<string, number>)[key]!);
    expect(probability("8")).toBeCloseTo(0.51, 10);
    expect(probability("unknown")).toBeCloseTo(0.06, 10);
    expect(cell.observations).toBe(1);
  });

  it("refuses what is not a distribution over the vocabulary", () => {
    expect(() => cellEvidenceFromProbabilities({ "8": 0.7, "3": 0.6 })).toThrow(EvidenceError);
    expect(() => cellEvidenceFromProbabilities({ "×": 1 } as Probabilities)).toThrow(EvidenceError);
    expect(() => cellEvidenceFromProbabilities({ "8": -0.1 })).toThrow(EvidenceError);
    expect(() =>
      evidence([
        [7, 7, { "1": 1 }],
        [7, 7, { "2": 1 }],
      ]),
    ).toThrow(/listed twice/);
    expect(() => evidence([[15, 0, { "1": 1 }]])).toThrow(EvidenceError);
  });
});

describe("reconstruction", () => {
  it("keeps every alternative, with its probability, for the person verifying", () => {
    const reconstruction = reconstruct(evidence([[7, 7, { "8": 0.51, "3": 0.31, "9": 0.12 }]]));
    const cell = at(reconstruction, 7, 7);

    expect(cell.reading).toBe("8");
    expect(cell.confidence).toBeCloseTo(0.51, 10);
    expect(cell.alternatives.map((alternative) => alternative.reading)).toEqual([
      "8",
      "3",
      "9",
      "unknown",
    ]);
    expect(cell.alternatives.map((alternative) => alternative.probability)).toEqual([
      expect.closeTo(0.51, 10),
      expect.closeTo(0.31, 10),
      expect.closeTo(0.12, 10),
      expect.closeTo(0.06, 10),
    ]);
    expect(cell.flags).toEqual(["uncertain"]);
    // An uncertain reading asks to be looked at; it does not stop the import.
    expect(confirmationBlockers(reconstruction)).toEqual([]);
  });

  it("takes the evidence's first choice everywhere, so nothing is overridden", () => {
    const reconstruction = reconstruct(boardEvidenceFromFixture(sampleBoard));
    for (const cell of reconstruction.cells) {
      expect(cell.reading).toBe(cell.alternatives[0]!.reading);
      expect(cell.flags).not.toContain("ruleOverride");
    }
  });

  it("flags a reading nobody chose that is not the evidence's first choice", () => {
    // No V0a rule does this. The flag is computed for every square regardless
    // of what produced the reading, so a later solver cannot do it silently.
    const reconstruction = reconstruct(evidence([[7, 7, { "8": 0.51, "3": 0.49 }]]));
    const tampered: Reconstruction = {
      ...reconstruction,
      cells: reconstruction.cells.map((cell, index) =>
        index === 7 * 15 + 7 ? { ...cell, reading: "3" } : cell,
      ),
    };
    // Re-derive through the public API: a person re-confirming a DIFFERENT
    // square must not launder the override on this one.
    const rederived = correctCell(tampered, 0, 0, { reading: "empty" });
    expect(at(rederived, 7, 7).flags).toContain("ruleOverride");

    // The same reading chosen by a person is a correction, not an override.
    const corrected = correctCell(reconstruction, 7, 7, { reading: "3" });
    expect(at(corrected, 7, 7).flags).not.toContain("ruleOverride");
    expect(at(corrected, 7, 7).decidedBy).toBe("person");
    expect(at(corrected, 7, 7).confidence).toBeCloseTo(0.49, 10);
  });

  it("treats a square with no committed reading as unreadable, and blocks on it", () => {
    const reconstruction = reconstruct(evidence([[7, 7, { unknown: 0.7, "5": 0.3 }]]));
    expect(at(reconstruction, 7, 7).flags).toContain("unreadable");
    expect(confirmationBlockers(reconstruction)).toEqual([
      { reason: "unreadable", row: 7, col: 7 },
    ]);
    expect(() => correctCell(reconstruction, 7, 7, { reading: "unknown" })).toThrow(RangeError);

    const fixed = correctCell(reconstruction, 7, 7, { reading: "5" });
    expect(toStudyBoard(fixed).ok).toBe(true);
  });

  it("annotates invalid equations without changing a single reading", () => {
    // 1 + 1 = 3 is wrong, and a real board can still hold it.
    const reconstruction = reconstruct(
      evidence([
        [7, 5, { "1": 0.99 }],
        [7, 6, { "+": 0.99 }],
        [7, 7, { "1": 0.99 }],
        [7, 8, { "=": 0.99 }],
        [7, 9, { "3": 0.6, "2": 0.4 }],
      ]),
    );
    expect(reconstruction.equationIssues).toHaveLength(1);
    expect(reconstruction.equationIssues[0]!.expressionText).toBe("1 + 1 = 3");
    // The 2 would balance it. The reading stays the 3 the evidence preferred.
    expect(at(reconstruction, 7, 9).reading).toBe("3");
    expect(at(reconstruction, 7, 9).flags).not.toContain("ruleOverride");
    // And an invalid equation is not a reason to refuse the board.
    expect(toStudyBoard(reconstruction).ok).toBe(true);
  });

  it("does not report a run as invalid when the only problem is missing information", () => {
    const reconstruction = reconstruct(boardEvidenceFromFixture(sampleBoard));
    // Row 8 holds an unresolved ×/÷ and column 8 an unresolved blank and ±:
    // both runs are unevaluable, not wrong. Column 10 (20 ÷ 10 = 2) is fine.
    expect(reconstruction.equationIssues).toEqual([]);
  });
});

describe("faces", () => {
  it("never turns an unresolved blank into a 0", () => {
    const reconstruction = reconstruct(evidence([[7, 7, { "?": 0.97 }]]));
    const cell = at(reconstruction, 7, 7);
    expect(cell.face).toBeNull();
    expect(cell.flags).toContain("faceUnresolved");

    const refused = toStudyBoard(reconstruction);
    expect(refused).toEqual({
      ok: false,
      blockers: [{ reason: "faceUnresolved", row: 7, col: 7, kind: "?" }],
    });

    // The preview draws it as what it physically is: a blank with no face.
    expect(provisionalBoard(reconstruction)[7]![7]!.tile).not.toHaveProperty("assignedToken");

    const resolved = toStudyBoard(correctCell(reconstruction, 7, 7, { face: "7" }));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(toStudyBoardCells(resolved.board)).toEqual([{ r: 7, c: 7, kind: "?", token: "7" }]);
  });

  it.each([
    ["+/-", ["+", "-"]],
    ["x//", ["×", "÷"]],
  ] as const)("holds the %s choice tile unresolved until a face is chosen", (kind, faces) => {
    const reconstruction = reconstruct(evidence([[7, 7, { [kind]: 0.99 }]]));
    expect(at(reconstruction, 7, 7).flags).toContain("faceUnresolved");
    expect(toStudyBoard(reconstruction).ok).toBe(false);

    for (const face of faces) {
      const resolved = toStudyBoard(correctCell(reconstruction, 7, 7, { face }));
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) continue;
      expect(toStudyBoardCells(resolved.board)).toEqual([{ r: 7, c: 7, kind, token: face }]);
    }
  });

  it("refuses a face the tile cannot take, and a face on a tile that has none", () => {
    const choice = reconstruct(evidence([[7, 7, { "+/-": 0.99 }]]));
    expect(() => correctCell(choice, 7, 7, { face: "×" })).toThrow(RangeError);

    const plain = reconstruct(evidence([[7, 7, { "8": 0.99 }]]));
    expect(() => correctCell(plain, 7, 7, { face: "8" })).toThrow(RangeError);

    // A hand-built reconstruction that lies is caught by the adapter, which
    // checks the readings rather than trusting the flags.
    const forged: Reconstruction = {
      ...choice,
      cells: choice.cells.map((cell, index) =>
        index === 7 * 15 + 7 ? { ...cell, face: "×", flags: [] } : cell,
      ),
    };
    expect(toStudyBoard(forged)).toEqual({
      ok: false,
      blockers: [{ reason: "faceInvalid", row: 7, col: 7, kind: "+/-", face: "×" }],
    });
  });

  it("forgets a chosen face when the tile under it is changed", () => {
    const blank = correctCell(reconstruct(evidence([[7, 7, { "?": 0.6, "+/-": 0.4 }]])), 7, 7, {
      face: "5",
    });
    const changed = correctCell(blank, 7, 7, { reading: "+/-" });
    expect(at(changed, 7, 7).face).toBeNull();
    expect(at(changed, 7, 7).flags).toContain("faceUnresolved");
  });
});

describe("inventory", () => {
  it("marks, and refuses, more copies of a kind than the set contains", () => {
    // The set has four 9s. Five were read.
    const nines: Array<[number, number, Probabilities]> = [0, 1, 2, 3, 4].map((col) => [
      7,
      col,
      col === 4 ? { "9": 0.7, "6": 0.3 } : { "9": 0.99 },
    ]);
    const reconstruction = reconstruct(evidence(nines));

    expect(reconstruction.overspent).toEqual([{ kind: "9", used: 5, available: 4 }]);
    for (let col = 0; col < 5; col += 1) {
      expect(at(reconstruction, 7, col).flags).toContain("overspent");
    }
    expect(toStudyBoard(reconstruction)).toEqual({
      ok: false,
      blockers: [{ reason: "overspent", kind: "9", used: 5, available: 4 }],
    });

    // Correcting the doubtful one to its runner-up clears the conflict everywhere.
    const fixed = correctCell(reconstruction, 7, 4, { reading: "6" });
    expect(fixed.overspent).toEqual([]);
    expect(fixed.cells.some((cell) => cell.flags.includes("overspent"))).toBe(false);
    expect(toStudyBoard(fixed).ok).toBe(true);
  });

  it("uses the physical set's counts, not a copy of them", () => {
    const full = Array.from(
      { length: AMATH_TOKENS["="].count },
      (_, col): [number, number, Probabilities] => [0, col, { "=": 1 }],
    );
    expect(reconstruct(evidence(full)).overspent).toEqual([]);
    expect(reconstruct(evidence([...full, [1, 0, { "=": 1 }]])).overspent).toEqual([
      { kind: "=", used: AMATH_TOKENS["="].count + 1, available: AMATH_TOKENS["="].count },
    ]);
  });
});

describe("the border", () => {
  /** The fixture, verified the way a person would verify it. */
  function verifiedSample(): Reconstruction {
    let reconstruction = reconstruct(boardEvidenceFromFixture(sampleBoard));
    reconstruction = correctCell(reconstruction, 3, 7, { face: "2" });
    reconstruction = correctCell(reconstruction, 4, 7, { face: "+" });
    reconstruction = correctCell(reconstruction, 7, 6, { face: "×" });
    return reconstruction;
  }

  it("cannot cross while any face in the fixture is unresolved", () => {
    const blockers = confirmationBlockers(reconstruct(boardEvidenceFromFixture(sampleBoard)));
    expect(blockers).toEqual([
      { reason: "faceUnresolved", row: 3, col: 7, kind: "?" },
      { reason: "faceUnresolved", row: 4, col: 7, kind: "+/-" },
      { reason: "faceUnresolved", row: 7, col: 6, kind: "x//" },
    ]);
  });

  it("produces exactly the board, and the payload, a person typing it would", () => {
    const result = toStudyBoard(verifiedSample());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The same position, built the way the Study editor builds it.
    const typed: BoardSnapshot = createBoard();
    const place = (
      row: number,
      col: number,
      token: Parameters<typeof newStudyTile>[0],
      face?: string,
    ) => {
      typed[row]![col] = studyBoardCell(newStudyTile(token, face));
    };
    place(7, 5, "8");
    place(7, 6, "x//", "×");
    place(7, 7, "3");
    place(7, 8, "=");
    place(7, 9, "2");
    place(7, 10, "4");
    place(3, 7, "?", "2");
    place(4, 7, "+/-", "+");
    place(5, 7, "1");
    place(6, 7, "=");
    place(3, 9, "20");
    place(4, 9, "/");
    place(5, 9, "10");
    place(6, 9, "=");

    expect(toStudyBoardCells(result.board)).toEqual(toStudyBoardCells(typed));
    // Structurally identical apart from the random tile ids.
    const withoutIds = (board: BoardSnapshot) =>
      board.map((line) =>
        line.map((cell) => (cell ? { ...cell, tile: { ...cell.tile, id: "·" } } : null)),
      );
    expect(withoutIds(result.board)).toEqual(withoutIds(typed));
  });

  it("carries nothing from the vision world across", () => {
    const result = toStudyBoard(verifiedSample());
    if (!result.ok) throw new Error("expected a board");

    const keys = new Set<string>();
    for (const line of result.board) {
      for (const cell of line) {
        if (!cell) continue;
        Object.keys(cell).forEach((key) => keys.add(`cell.${key}`));
        Object.keys(cell.tile).forEach((key) => keys.add(`tile.${key}`));
        expect(cell.tile.id).not.toMatch(/^vision:/);
        expect(cell).toMatchObject({ placedTurn: 0, side: "A" });
      }
    }
    expect([...keys].sort()).toEqual([
      "cell.placedTurn",
      "cell.side",
      "cell.tile",
      "tile.assignedToken",
      "tile.id",
      "tile.token",
    ]);
  });

  it("keeps uncertainty below the bar it is measured against", () => {
    const reconstruction = reconstruct(boardEvidenceFromFixture(sampleBoard));
    const uncertain = reconstruction.cells
      .filter((cell) => cell.flags.includes("uncertain"))
      .map((cell) => [cell.row, cell.col, cell.reading]);
    // The 8 (0.51) and the 10 (0.88). Every other square clears UNCERTAIN_BELOW.
    expect(uncertain).toEqual([
      [5, 9, "10"],
      [7, 5, "8"],
    ]);
    expect(UNCERTAIN_BELOW).toBeGreaterThan(0.88);
  });
});

describe("physical truth", () => {
  it("keeps a confidently read invalid equation exactly as scanned", () => {
    // 8 × 3 = 25 — wrong, and quite possibly what is really on the table.
    const reconstruction = reconstruct(
      evidence([
        [7, 4, { "8": 0.99 }],
        [7, 5, { x: 0.99 }],
        [7, 6, { "3": 0.99 }],
        [7, 7, { "=": 0.99 }],
        [7, 8, { "2": 0.98 }],
        [7, 9, { "5": 0.97, "4": 0.02 }],
      ]),
    );
    expect(reconstruction.equationIssues.map((issue) => issue.expressionText)).toEqual([
      "8 × 3 = 2 5",
    ]);
    // Nothing moved toward the "valid" 24: the 4 stays a 2% alternative.
    expect(at(reconstruction, 7, 9).reading).toBe("5");
    expect(reconstruction.cells.some((cell) => cell.flags.includes("ruleOverride"))).toBe(false);
    const result = toStudyBoard(reconstruction);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.board[7]![9]!.tile.token).toBe("5");
  });

  it("keeps visual uncertainty, assignment ambiguity and equation inconsistency apart", () => {
    const reconstruction = reconstruct(
      evidence([
        // 6 = 6 ± 0: the ± is read with certainty; its face is simply not a fact.
        [3, 3, { "6": 0.99 }],
        [3, 4, { "=": 0.99 }],
        [3, 5, { "6": 0.99 }],
        [3, 6, { "+/-": 0.99 }],
        [3, 7, { "0": 0.99 }],
        // A 6 the image cannot separate from an 8.
        [9, 9, { "6": 0.48, "8": 0.45, "9": 0.04 }],
        // 1 = 2, confidently read.
        [12, 0, { "1": 0.99 }],
        [12, 1, { "=": 0.99 }],
        [12, 2, { "2": 0.99 }],
      ]),
    );
    const summary = attentionSummary(reconstruction);
    expect(summary.visualUncertainty.map((cell) => [cell.row, cell.col])).toEqual([[9, 9]]);
    expect(summary.assignmentAmbiguity.map((cell) => [cell.row, cell.col])).toEqual([[3, 6]]);
    // The ± cell is certain as a KIND: its doubt is not visual.
    expect(at(reconstruction, 3, 6).confidence).toBeCloseTo(0.99, 10);
    expect(at(reconstruction, 3, 6).flags).not.toContain("uncertain");
    expect(summary.equationInconsistency.map((issue) => issue.expressionText)).toEqual(["1 = 2"]);
    expect(summary.inventoryConflict).toEqual([]);
  });

  it("records who chose a face, and forgets it with the face", () => {
    const reconstruction = reconstruct(evidence([[7, 7, { "+/-": 0.6, "?": 0.4 }]]));
    expect(at(reconstruction, 7, 7)).toMatchObject({ face: null, faceProvenance: null });
    const chosen = correctCell(reconstruction, 7, 7, { face: "-" });
    expect(at(chosen, 7, 7)).toMatchObject({ face: "-", faceProvenance: "userSelected" });
    const changed = correctCell(chosen, 7, 7, { reading: "?" });
    expect(at(changed, 7, 7)).toMatchObject({ face: null, faceProvenance: null });
  });
});
