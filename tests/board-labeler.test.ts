// Admin Board Labeler: the data model behind the tool. Pure; no model, no
// camera, no real photos. The UI is covered in board-labeler-ui.test.tsx.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CROP_CONTRACT } from "../src/features/boardVision/crops";
import { applyHomography, boardToImage, type Quad } from "../src/features/boardVision/geometry";
import {
  CELLS,
  DATASET_SCHEMA,
  EMPTY_HISTORY,
  LABELS_SCHEMA,
  LabelError,
  batchOrder,
  boardIdFor,
  canonical,
  complete,
  counts,
  createBoard,
  defaultCorners,
  exportAll,
  exportTraining,
  indexOf,
  neighbour,
  paint,
  readBoard,
  readDataset,
  redo,
  roleChangeNeedsConfirmation,
  rowColOf,
  setCorners,
  setRole,
  squareAtCanonical,
  squareBoxCanonical,
  squareName,
  squaresBetween,
  stroke,
  suggestionsAllowed,
  undo,
  type BoardLabels,
  type ImageMeta,
} from "../src/features/boardVision/labeling/boardLabels";
import { memoryStore } from "../src/features/boardVision/labeling/labelStore";
import { parseHash, routeToHash } from "../src/router";

const T0 = "2026-09-24T10:00:00.000Z";
const T1 = "2026-09-24T10:05:00.000Z";
const QUAD: Quad = [
  [412.5, 300.25],
  [3610, 344],
  [3702.75, 3480],
  [355, 3399.5],
];

function meta(n: number, name = `IMG_${1000 + n}.jpg`): ImageMeta {
  return {
    name,
    sha256: n.toString(16).padStart(4, "0").padEnd(64, "a"),
    bytes: 2_000_000 + n,
    type: "image/jpeg",
    lastModified: 1_700_000_000_000 + n,
    width: 4032,
    height: 3024,
    exifOrientation: 6,
    orientedBy: "browser",
  };
}
const fresh = (n = 1, t = T0) => createBoard(meta(n), "session-a", t);
const tiles = (b: BoardLabels) =>
  b.cells.filter((c) => c.occupancy === "TILE").map((c) => squareName(c.index));

describe("indexing", () => {
  it("row/col 1–15 ↔ row-major index 0–224, named R<row>C<col>", () => {
    expect(indexOf(1, 1)).toBe(0);
    expect(indexOf(1, 15)).toBe(14);
    expect(indexOf(2, 1)).toBe(15);
    expect(indexOf(15, 15)).toBe(224);
    expect(squareName(indexOf(8, 12))).toBe("R8C12");
    for (let i = 0; i < CELLS; i += 1) {
      const { row, col } = rowColOf(i);
      expect(indexOf(row, col)).toBe(i);
    }
  });

  it("a new board: 225 cells, all EMPTY, in order, HUMAN_MANUAL, physicalTileKind null, SEALED_TEST", () => {
    const b = fresh();
    expect(b.schema).toBe(LABELS_SCHEMA);
    expect(b.boardId).toBe(boardIdFor(meta(1).sha256));
    expect(b.role).toBe("SEALED_TEST");
    expect(b.status).toBe("NOT_STARTED");
    expect(b.cells).toHaveLength(225);
    b.cells.forEach((c, i) => {
      expect(c).toEqual({
        ...rowColOf(i),
        index: i,
        occupancy: "EMPTY",
        provenance: "HUMAN_MANUAL",
        physicalTileKind: null,
      });
    });
    expect(counts(b)).toEqual({ TILE: 0, EMPTY: 225, UNSURE: 0, TOTAL: 225 });
    expect(b.modelSuggestionsShown).toBe(false);
    expect(b.labelSource).toBe("HUMAN_MANUAL");
  });
});

describe("corner / grid mapping", () => {
  it("the canonical board puts square (r, c) where the corner homography puts it", () => {
    const { pxPerSquare: C, marginSquares: M, canonicalSize: N } = CROP_CONTRACT;
    expect(N).toBe(780);
    expect(C).toBe(50);
    const h = boardToImage(QUAD);
    // grid corners land exactly on the four corners, in the order TL TR BR BL
    expect(applyHomography(h, [0, 0])[0]).toBeCloseTo(QUAD[0][0], 6);
    expect(applyHomography(h, [15, 0])[1]).toBeCloseTo(QUAD[1][1], 6);
    expect(applyHomography(h, [15, 15])[0]).toBeCloseTo(QUAD[2][0], 6);
    expect(applyHomography(h, [0, 15])[1]).toBeCloseTo(QUAD[3][1], 6);
    for (const [row, col] of [
      [1, 1],
      [8, 12],
      [15, 15],
      [3, 14],
    ] as const) {
      const i = indexOf(row, col);
      const box = squareBoxCanonical(i);
      expect(box).toEqual({ x: (col - 1 + M) * C, y: (row - 1 + M) * C, size: C });
      // its centre, clicked on the canonical board, is that square
      expect(squareAtCanonical(box.x + C / 2, box.y + C / 2)).toBe(i);
      // and the same point, in board coordinates, is the square's centre
      const bx = (box.x + C / 2) / C - M;
      const by = (box.y + C / 2) / C - M;
      expect([bx, by]).toEqual([col - 0.5, row - 0.5]);
    }
    // edges: first/last pixel of a square belong to it; the margin to none
    expect(squareAtCanonical(M * C, M * C)).toBe(0);
    expect(squareAtCanonical(M * C - 0.01, 100)).toBe(-1);
    expect(squareAtCanonical((15 + M) * C, 100)).toBe(-1);
    expect(squareAtCanonical((15 + M) * C - 0.01, (15 + M) * C - 0.01)).toBe(224);
  });

  it("corners are validated, stored in original pixels, and unchanged corners keep the status", () => {
    const b = setCorners(fresh(), QUAD, T1);
    expect(b.corners).toEqual(QUAD);
    expect(b.status).toBe("DRAFT");
    const done = complete(b, true, T1);
    expect(setCorners(done, QUAD, "2026-09-24T11:00:00.000Z")).toBe(done);
    expect(defaultCorners(4032, 3024)[0]).toEqual([
      (4032 - 3024 * 0.7) / 2,
      (3024 - 3024 * 0.7) / 2,
    ]);
    const crossed: Quad = [QUAD[1], QUAD[0], QUAD[2], QUAD[3]];
    expect(() => complete(setCorners(fresh(), crossed, T1), true, T1)).toThrow(LabelError);
  });
});

describe("painting", () => {
  const b0 = setCorners(fresh(), QUAD, T0);

  it("click paints one square", () => {
    const b = paint(b0, [indexOf(8, 12)], "TILE", T1);
    expect(tiles(b)).toEqual(["R8C12"]);
    expect(b0.cells[indexOf(8, 12)]!.occupancy).toBe("EMPTY"); // immutable
  });

  it("drag paints every square crossed, even between far pointer events", () => {
    expect(squaresBetween(indexOf(8, 3), indexOf(8, 9)).map(squareName)).toEqual([
      "R8C3",
      "R8C4",
      "R8C5",
      "R8C6",
      "R8C7",
      "R8C8",
      "R8C9",
    ]);
    expect(squaresBetween(indexOf(1, 1), indexOf(4, 4)).map(squareName)).toEqual([
      "R1C1",
      "R2C2",
      "R3C3",
      "R4C4",
    ]);
    const r = stroke(b0, EMPTY_HISTORY, squaresBetween(indexOf(8, 3), indexOf(8, 9)), "TILE", T1);
    expect(counts(r.board).TILE).toBe(7);
    expect(r.history.past).toHaveLength(1); // one stroke = one undo step
  });

  it("EMPTY is the eraser; UNSURE is its own label; nothing-changed returns the same board", () => {
    let b = paint(b0, [0, 1, 2, 3], "TILE", T1);
    b = paint(b, [1], "EMPTY", T1);
    b = paint(b, [2], "UNSURE", T1);
    expect(counts(b)).toEqual({ TILE: 2, EMPTY: 222, UNSURE: 1, TOTAL: 225 });
    expect(b.cells[2]!.occupancy).toBe("UNSURE");
    expect(paint(b, [1], "EMPTY", T1)).toBe(b);
    expect(() => paint(b, [225], "TILE", T1)).toThrow(LabelError);
  });

  it("undo / redo walk whole strokes; a new stroke clears redo", () => {
    let s = { board: b0, history: EMPTY_HISTORY };
    s = stroke(s.board, s.history, [0, 1], "TILE", T1);
    s = stroke(s.board, s.history, [5], "UNSURE", T1);
    s = undo(s.board, s.history, T1);
    expect(counts(s.board)).toMatchObject({ TILE: 2, UNSURE: 0 });
    s = undo(s.board, s.history, T1);
    expect(counts(s.board).TILE).toBe(0);
    expect(undo(s.board, s.history, T1).board).toBe(s.board); // nothing left
    s = redo(s.board, s.history, T1);
    expect(counts(s.board).TILE).toBe(2);
    s = stroke(s.board, s.history, [9], "TILE", T1);
    expect(s.history.future).toHaveLength(0);
    expect(redo(s.board, s.history, T1).board).toBe(s.board);
  });

  it("counts always sum to 225", () => {
    let b = b0;
    const seq = ["TILE", "UNSURE", "EMPTY", "TILE"] as const;
    for (let k = 0; k < 60; k += 1) {
      b = paint(b, [(k * 37) % 225, (k * 11) % 225], seq[k % 4]!, T1);
      const c = counts(b);
      expect(c.TILE + c.EMPTY + c.UNSURE).toBe(225);
      expect(c.TOTAL).toBe(225);
    }
  });

  it("editing a completed board makes it a draft again", () => {
    const done = complete(paint(b0, [7], "TILE", T0), true, T1);
    expect(done.status).toBe("COMPLETED");
    const again = paint(done, [8], "TILE", T1);
    expect(again.status).toBe("DRAFT");
    expect(again.completedAt).toBeNull();
  });
});

describe("completion", () => {
  it("needs valid corners, a session, and the full-review confirmation", () => {
    const b = paint(fresh(), [3], "TILE", T0);
    expect(() => complete(b, true, T1)).toThrow(/corners/);
    const withCorners = setCorners(b, QUAD, T0);
    expect(() => complete(withCorners, false, T1)).toThrow(/reviewed all 225/);
    expect(() => complete({ ...withCorners, sessionId: "  " }, true, T1)).toThrow(/session/);
    const done = complete(withCorners, true, T1);
    expect(done).toMatchObject({ status: "COMPLETED", completedAt: T1 });
  });
});

describe("storage: autosave / reload fidelity", () => {
  it("a draft reloads exactly: corners, 225 labels, order, metadata", async () => {
    const store = memoryStore();
    const b = paint(
      paint(setCorners(fresh(), QUAD, T0), [0, 17, 224], "TILE", T1),
      [40],
      "UNSURE",
      T1,
    );
    await store.putBoard(b);
    const back = await store.getBoard(b.boardId);
    expect(back).toEqual(b);
    expect(JSON.stringify(canonical(back!))).toBe(JSON.stringify(canonical(b)));
    expect(back!.corners).toEqual(QUAD);
    expect(tiles(back!)).toEqual(["R1C1", "R2C3", "R15C15"]);
  });

  it("a completed board reloads exactly and stays completed", async () => {
    const store = memoryStore();
    const b = complete(paint(setCorners(fresh(), QUAD, T0), [100], "TILE", T0), true, T1);
    await store.putBoard(b);
    const back = (await store.listBoards())[0]!;
    expect(back).toEqual(b);
    expect(back.status).toBe("COMPLETED");
    expect(readBoard(JSON.parse(JSON.stringify(back)))).toEqual(canonical(b));
  });
});

describe("batch navigation", () => {
  const boards = [
    fresh(3, "2026-09-24T10:02:00.000Z"),
    fresh(1, T0),
    fresh(2, "2026-09-24T10:01:00.000Z"),
  ];
  it("orders by upload time and moves Previous / Next without running off the ends", () => {
    const order = batchOrder(boards).map((b) => b.boardId);
    expect(order).toEqual([fresh(1).boardId, fresh(2).boardId, fresh(3).boardId]);
    expect(neighbour(boards, order[0]!, 1)).toBe(order[1]);
    expect(neighbour(boards, order[1]!, 1)).toBe(order[2]);
    expect(neighbour(boards, order[2]!, 1)).toBe(order[2]);
    expect(neighbour(boards, order[0]!, -1)).toBe(order[0]);
    expect(neighbour(boards, null, 1)).toBe(order[0]);
    expect(neighbour([], null, 1)).toBeNull();
  });
});

describe("export / import", () => {
  const a = complete(paint(setCorners(fresh(1), QUAD, T0), [0, 1, 2], "TILE", T0), true, T1);
  const b = paint(setCorners(fresh(2), QUAD, T0), [50], "UNSURE", T1);

  it("round-trips exactly and deterministically", () => {
    const d1 = exportAll([b, a], T1);
    const d2 = exportAll([a, b], T1);
    expect(JSON.stringify(d1)).toBe(JSON.stringify(d2));
    expect(d1.schema).toBe(DATASET_SCHEMA);
    const back = readDataset(JSON.parse(JSON.stringify(d1)));
    expect(back).toEqual([canonical(a), canonical(b)]);
    expect(JSON.stringify(exportAll(back, T1))).toBe(JSON.stringify(d1));
    expect(readDataset(JSON.parse(JSON.stringify(a)))).toEqual([canonical(a)]); // a single board too
  });

  it("every saved cell carries row, col, index, provenance and a null physicalTileKind slot", () => {
    const cell = exportAll([a], T1).boards[0]!.cells[indexOf(1, 2)]!;
    expect(Object.keys(cell)).toEqual([
      "row",
      "col",
      "index",
      "occupancy",
      "provenance",
      "physicalTileKind",
    ]);
    expect(cell).toEqual({
      row: 1,
      col: 2,
      index: 1,
      occupancy: "TILE",
      provenance: "HUMAN_MANUAL",
      physicalTileKind: null,
    });
  });

  it("refuses malformed or model-labelled data", () => {
    const ok = JSON.parse(JSON.stringify(canonical(a))) as BoardLabels;
    expect(() => readBoard({ ...ok, schema: "x" })).toThrow(LabelError);
    expect(() => readBoard({ ...ok, cells: ok.cells.slice(1) })).toThrow(/225/);
    expect(() =>
      readBoard({ ...ok, cells: [ok.cells[1], ok.cells[0], ...ok.cells.slice(2)] }),
    ).toThrow(/order/);
    expect(() =>
      readBoard({ ...ok, cells: ok.cells.map((c, i) => (i ? c : { ...c, provenance: "MODEL" })) }),
    ).toThrow(/HUMAN_MANUAL/);
    expect(() => readBoard({ ...ok, modelSuggestionsShown: true })).toThrow(
      /modelSuggestionsShown/,
    );
    expect(() => readBoard({ ...ok, role: "TEST" })).toThrow(/role/);
  });
});

describe("SEALED_TEST", () => {
  const sealed = complete(paint(setCorners(fresh(1), QUAD, T0), [5], "TILE", T0), true, T1);
  const train = setRole(
    complete(paint(setCorners(fresh(2), QUAD, T0), [6], "TILE", T0), true, T1),
    "TRAIN",
    T1,
    true,
  );
  const dev = setRole(complete(setCorners(fresh(3), QUAD, T0), true, T1), "DEV", T1, true);
  const trainDraft = setRole(
    paint(setCorners(fresh(4), QUAD, T0), [9], "TILE", T0),
    "TRAIN",
    T1,
    true,
  );
  const sealedDraft = paint(setCorners(fresh(5), QUAD, T0), [9], "TILE", T0);

  it("cannot expose suggestions", () => {
    expect(sealed.role).toBe("SEALED_TEST");
    expect(suggestionsAllowed(sealed)).toBe(false);
    expect(suggestionsAllowed(sealedDraft)).toBe(false);
    expect(suggestionsAllowed(fresh())).toBe(false); // the default role
    expect(sealed.modelSuggestionsShown).toBe(false);
    expect(sealed.cells.every((c) => c.provenance === "HUMAN_MANUAL")).toBe(true);
  });

  it("is excluded from the training export, whatever its status, with the reason listed", () => {
    const d = exportTraining([sealed, train, dev, trainDraft, sealedDraft], T1);
    expect(d.kind).toBe("training");
    expect(d.boards.map((b) => b.boardId)).toEqual([train.boardId]);
    const why = Object.fromEntries(d.excluded!.map((e) => [e.boardId, e.reason]));
    expect(why[sealed.boardId]).toMatch(/SEALED_TEST/);
    expect(why[sealedDraft.boardId]).toMatch(/SEALED_TEST/);
    expect(why[dev.boardId]).toMatch(/DEV/);
    expect(why[trainDraft.boardId]).toMatch(/not completed/);
    expect(d.boards.every((x) => x.role === "TRAIN")).toBe(true);
    // a board moved out of the sealed set (with confirmation) says so in its history
    expect(d.boards[0]!.roleHistory[0]).toMatchObject({
      from: "SEALED_TEST",
      to: "TRAIN",
      confirmedLeavingSealed: true,
    });
    // "export all" is the archive, not training data: it keeps the sealed board, marked
    expect(exportAll([sealed], T1).boards[0]!.role).toBe("SEALED_TEST");
  });

  it("changing its role needs explicit confirmation, which is recorded", () => {
    expect(roleChangeNeedsConfirmation(sealed, "TRAIN")).toBe(true);
    expect(roleChangeNeedsConfirmation(sealedDraft, "DEV")).toBe(true);
    expect(roleChangeNeedsConfirmation(fresh(), "DEV")).toBe(false); // nothing labelled yet
    expect(roleChangeNeedsConfirmation(train, "DEV")).toBe(false);
    expect(() => setRole(sealed, "TRAIN", T1)).toThrow(LabelError);
    const moved = setRole(sealed, "TRAIN", "2026-09-25T09:00:00.000Z", true);
    expect(moved.role).toBe("TRAIN");
    expect(moved.roleHistory).toEqual([
      {
        from: "SEALED_TEST",
        to: "TRAIN",
        at: "2026-09-25T09:00:00.000Z",
        confirmedLeavingSealed: true,
      },
    ]);
  });
});

describe("isolation", () => {
  it("lives only under the admin route", () => {
    expect(parseHash("#/admin/vision")).toEqual({ kind: "admin", section: "vision" });
    expect(routeToHash({ kind: "admin", section: "vision" })).toBe("#/admin/vision");
    expect(parseHash("#/admin/users")).toEqual({ kind: "admin", section: "users" });
    expect(parseHash("#/admin/regions")).toEqual({ kind: "admin", section: "regions" });
    expect(parseHash("#/admin/anything")).toEqual({ kind: "admin", section: "users" });
    // only the admin page references the tool, and only lazily
    const admin = readFileSync("src/admin.tsx", "utf8");
    expect(admin).toMatch(/lazy\(\(\) => import\("\.\/components\/admin\/BoardLabeler"\)\)/);
    for (const f of [
      "src/App.tsx",
      "src/app/NonPlayApplication.tsx",
      "src/app/shells/PrimaryNavigation.tsx",
    ]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/BoardLabeler|admin\/vision/);
    }
  });

  it("the labeler imports no recogniser, model, suggestion or equation code", () => {
    const files = [
      "src/components/admin/BoardLabeler.tsx",
      ...readdirSync("src/features/boardVision/labeling").map((f) =>
        join("src/features/boardVision/labeling", f),
      ),
    ];
    const allowed = new Set([
      "react",
      "./board-labeler.css",
      "../../features/boardVision/crops",
      "../../features/boardVision/geometry",
      "../../features/boardVision/photo",
      "../../features/boardVision/labeling/boardLabels",
      "../../features/boardVision/labeling/labelStore",
      "../../../constants/gameRules",
      "../crops",
      "../geometry",
      "../vocabulary",
      "./boardLabels",
    ]);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const specs = [...src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
        (m) => m[1]!,
      );
      for (const s of specs) expect(allowed, `${f} imports ${s}`).toContain(s);
      expect(src).not.toMatch(/onnx|recogni[sz]er|classifier|reconstruct|suggest\(/i);
    }
  });
});
