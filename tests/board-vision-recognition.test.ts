// The recogniser boundary, multi-view evidence, and the two-pass image path.
//
// No trained model is involved: the recogniser is either raw logits (to test
// the adapter) or an oracle that knows the board (to test everything around
// it). A real model plugs in at `classifierFromLogits` and nowhere else.
import { describe, expect, it } from "vitest";

import { BOARD_SIZE } from "../src/constants/gameRules";
import {
  ClassifierMetaError,
  checkClassifierMeta,
  classifierFromLogits,
  readingToCellEvidence,
  type SquareReading,
} from "../src/features/boardVision/classifier";
import { CROP_CONTRACT, squareCrops } from "../src/features/boardVision/crops";
import { GeometryError, readingQuad, type Quad } from "../src/features/boardVision/geometry";
import {
  EvidenceAccumulator,
  type BoardObservation,
} from "../src/features/boardVision/observation";
import { reconstruct } from "../src/features/boardVision/reconstruct";
import { decideReading, observeImage } from "../src/features/boardVision/recognize";
import { vocabularyFingerprint } from "../src/features/boardVision/vocabulary";
import {
  MODEL_CLASSES,
  ORACLE_META,
  oracleClassifier,
  photograph,
  type TruthSquare,
} from "./helpers/boardPhoto";

/** meta.json as amath-vision-training/amathvision/export.py writes it. */
function exportedMeta(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    modelVersion: "0.1.0",
    domain: "synthetic-only — real-world accuracy NOT established",
    vocabularyFingerprint: vocabularyFingerprint(),
    input: {
      name: "crops",
      layout: "NCHW",
      channels: "RGB",
      normalisation: { divide: 255, mean: 0.5, std: 0.5 },
      geometry: {
        pxPerSquare: CROP_CONTRACT.pxPerSquare,
        marginSquares: CROP_CONTRACT.marginSquares,
        canonicalSize: CROP_CONTRACT.canonicalSize,
        cropSize: CROP_CONTRACT.cropSize,
      },
    },
    outputs: {
      kind_logits: { classes: [...MODEL_CLASSES] },
      turn_logits: { classes: [0, 1, 2, 3] },
    },
    calibration: { method: "temperature", temperature: 0.8 },
    unknown: { trained: false, rule: "topK", k: 3 },
    ...overrides,
  };
}

const index = (name: string) => MODEL_CLASSES.indexOf(name as (typeof MODEL_CLASSES)[number]);
function reading(probs: Record<string, number>, turn = 0): SquareReading {
  const rest = 1 - Object.values(probs).reduce((a, b) => a + b, 0);
  const kinds = MODEL_CLASSES.map(
    (c) => probs[c] ?? rest / (MODEL_CLASSES.length - Object.keys(probs).length),
  );
  const turns = [0.01, 0.01, 0.01, 0.01] as [number, number, number, number];
  turns[turn] = 0.97;
  return { kinds, turns };
}
const probability = (e: { logProbabilities: Record<string, number | undefined> }, c: string) =>
  Math.exp(e.logProbabilities[c] ?? -Infinity);

describe("accepting a model", () => {
  it("accepts a model built for this runtime", () => {
    const meta = checkClassifierMeta(exportedMeta());
    expect(meta.classes).toEqual(MODEL_CLASSES);
    expect(meta).toMatchObject({ temperature: 0.8, topK: 3 });
  });

  it.each([
    ["another vocabulary", { vocabularyFingerprint: "00000000" }],
    [
      "crops cut differently",
      {
        input: {
          ...exportedMeta().input,
          geometry: { ...exportedMeta().input.geometry, pxPerSquare: 40 },
        },
      },
    ],
    [
      "a different normalisation",
      {
        input: { ...exportedMeta().input, normalisation: { divide: 255, mean: 0.485, std: 0.229 } },
      },
    ],
    [
      "classes out of order",
      { outputs: { kind_logits: { classes: [...MODEL_CLASSES].reverse() } } },
    ],
    [
      "`unknown` as an output",
      { outputs: { kind_logits: { classes: [...MODEL_CLASSES, "unknown"] } } },
    ],
    ["a face as a class", { outputs: { kind_logits: { classes: ["×", ...MODEL_CLASSES] } } }],
    ["no calibration", { calibration: {} }],
  ])("refuses %s", (_why, override) => {
    expect(() => checkClassifierMeta(exportedMeta(override))).toThrow(ClassifierMetaError);
  });
});

describe("the logits adapter", () => {
  it("normalises the crops, calibrates with the temperature, and keeps the model's class order", async () => {
    const meta = checkClassifierMeta(exportedMeta());
    let seen: { input: Float32Array; count: number } | null = null;
    const classifier = classifierFromLogits(meta, async (input, count) => {
      seen = { input, count };
      const kindLogits = new Float32Array(count * meta.classes.length);
      kindLogits[index("8")] = 4;
      kindLogits[index("3")] = 3;
      return { kindLogits, turnLogits: new Float32Array(count * 4) };
    });
    const pixels = new Uint8Array(CROP_CONTRACT.cropSize ** 2 * 3).fill(255);
    const [out] = await classifier.classify([{ row: 0, col: 0, pixels }]);
    expect(seen!.count).toBe(1);
    expect(seen!.input[0]).toBe(1); // (255/255 − 0.5)/0.5
    const e8 = Math.exp(4 / 0.8);
    const e3 = Math.exp(3 / 0.8);
    const z = e8 + e3 + (meta.classes.length - 2);
    expect(out!.kinds[index("8")]).toBeCloseTo(e8 / z, 6);
    expect(out!.turns).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it("refuses outputs of the wrong shape", async () => {
    const meta = checkClassifierMeta(exportedMeta());
    const classifier = classifierFromLogits(meta, async () => ({
      kindLogits: new Float32Array(3),
      turnLogits: new Float32Array(4),
    }));
    const pixels = new Uint8Array(CROP_CONTRACT.cropSize ** 2 * 3);
    await expect(classifier.classify([{ row: 0, col: 0, pixels }])).rejects.toThrow(
      ClassifierMetaError,
    );
  });
});

describe("a reading as evidence", () => {
  it("keeps the top-K kinds, puts the rest on `unknown`, and carries orientation", () => {
    const e = readingToCellEvidence(reading({ "8": 0.51, "3": 0.31, "9": 0.12 }, 2), ORACLE_META);
    expect(probability(e, "8")).toBeCloseTo(0.51, 6);
    expect(probability(e, "3")).toBeCloseTo(0.31, 6);
    expect(probability(e, "unknown")).toBeCloseTo(0.06, 6);
    expect(Math.exp(e.orientation![2]!)).toBeCloseTo(0.97, 6);
  });

  it("surfaces a flat, out-of-distribution reading as `unknown`", () => {
    const flat = {
      kinds: MODEL_CLASSES.map(() => 1 / MODEL_CLASSES.length),
      turns: [0.25, 0.25, 0.25, 0.25] as const,
    };
    const r = reconstruct({
      cells: Array.from({ length: 225 }, () => readingToCellEvidence(flat, ORACLE_META)),
    });
    expect(r.cells[0]!.reading).toBe("unknown");
    expect(r.cells[0]!.flags).toContain("unreadable");
  });
});

describe("combining observations", () => {
  const blank = (): BoardObservation["squares"][number][] =>
    Array.from({ length: 225 }, () => null);
  const observation = (
    frameId: string,
    square: number,
    r: SquareReading,
    quality: number,
  ): BoardObservation => {
    const squares = blank();
    squares[square] = { reading: r, quality };
    return {
      frameId,
      source: "camera",
      classifier: ORACLE_META,
      quad: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      squares,
    };
  };
  const top = (acc: EvidenceAccumulator, square = 112) => {
    const cell = reconstruct(acc.evidence()).cells[square]!;
    return [cell.reading, cell.confidence] as const;
  };

  it("gives an upload (N = 1) exactly that observation's evidence", () => {
    const r = reading({ "8": 0.51, "3": 0.31, "9": 0.12 });
    const acc = new EvidenceAccumulator();
    acc.add(observation("photo", 112, r, 0.4));
    expect(acc.evidence().cells[112]).toEqual(readingToCellEvidence(r, ORACLE_META, 1));
  });

  it("does not let a later, poorer view erase a strong one", () => {
    const acc = new EvidenceAccumulator();
    acc.add(observation("f1", 112, reading({ "8": 0.98 }), 1));
    acc.add(observation("f2", 112, reading({ "3": 0.9 }), 0.2));
    const [kind, confidence] = top(acc);
    expect(kind).toBe("8");
    expect(confidence).toBeGreaterThan(0.9);
  });

  it("does not let MANY poorer views outvote one strong one", () => {
    const acc = new EvidenceAccumulator();
    acc.add(observation("sharp", 112, reading({ "8": 0.98 }), 0.95));
    for (let i = 0; i < 20; i += 1)
      acc.add(observation(`blur${i}`, 112, reading({ "3": 0.9 }), 0.3));
    expect(top(acc)[0]).toBe("8");
    expect(acc.sources(112)[0]!.frameId).toBe("sharp");
  });

  it("lets a better later view take over", () => {
    const acc = new EvidenceAccumulator();
    acc.add(observation("glare", 112, reading({ "3": 0.6, "8": 0.3 }), 0.25));
    acc.add(observation("clear", 112, reading({ "8": 0.97 }), 1));
    expect(top(acc)[0]).toBe("8");
  });

  it("keeps two good views that disagree as an uncertain square, with both readings", () => {
    const acc = new EvidenceAccumulator();
    acc.add(observation("a", 112, reading({ "6": 0.95 }), 1));
    acc.add(observation("b", 112, reading({ "8": 0.95 }), 1));
    const cell = reconstruct(acc.evidence()).cells[112]!;
    expect(cell.flags).toContain("uncertain");
    expect(
      cell.alternatives
        .slice(0, 2)
        .map((a) => a.reading)
        .sort(),
    ).toEqual(["6", "8"]);
  });

  it("leaves a square no view covered unknown, with no observations", () => {
    const acc = new EvidenceAccumulator();
    acc.add(observation("f1", 112, reading({ "8": 0.98 }), 1));
    expect(acc.evidence().cells[0]).toMatchObject({ observations: 0 });
    expect(reconstruct(acc.evidence()).cells[0]!.reading).toBe("unknown");
  });

  it("refuses to mix recognisers in one scan", () => {
    const acc = new EvidenceAccumulator();
    acc.add(observation("f1", 112, reading({ "8": 0.98 }), 1));
    const other = {
      ...observation("f2", 112, reading({ "8": 0.98 }), 1),
      classifier: { ...ORACLE_META, modelVersion: "0.2.0" },
    };
    expect(() => acc.add(other)).toThrow();
  });
});

describe("one image, two passes", () => {
  const QUAD: Quad = [
    [180, 130],
    [770, 150],
    [840, 700],
    [120, 660],
  ];
  const image = photograph(QUAD, 960, 780);
  // 30 tiles, mostly upright, three set down turned — a real board's mess.
  const truth: TruthSquare[] = Array.from({ length: 225 }, () => null);
  const kinds = ["8", "=", "x//", "?", "13", "+/-", "4", "/", "+", "0"] as const;
  for (let i = 0; i < 30; i += 1)
    truth[(i * 7 + 16) % 225] = { kind: kinds[i % kinds.length]!, turn: i % 11 === 5 ? 2 : 0 };

  it.each([0, 1, 2, 3])(
    "finds row 1 when the corners are given starting %s corners late",
    async (s) => {
      const result = await observeImage(image, readingQuad(QUAD, s), oracleClassifier(truth), {
        frameId: "photo",
        source: "image",
      });
      expect(result.reading).toMatchObject({ decided: true });
      expect(result.quad).toEqual(QUAD);
      const acc = new EvidenceAccumulator();
      acc.add(result.observation);
      const r = reconstruct(acc.evidence());
      for (let i = 0; i < 225; i += 1) expect(r.cells[i]!.reading).toBe(truth[i]?.kind ?? "empty");
      // Faces are not the recogniser's to give: they stay unresolved.
      expect(r.cells.filter((c) => c.flags.includes("faceUnresolved")).length).toBe(
        truth.filter((t) => t && ["x//", "?", "+/-"].includes(t.kind)).length,
      );
    },
  );

  it("marks squares outside the photo as not observed", async () => {
    const cropped = { ...image, width: 500 }; // right part of the board not in the photo
    const data = new Uint8Array(500 * image.height * 3);
    for (let y = 0; y < image.height; y += 1)
      data.set(image.data.subarray(y * 960 * 3, y * 960 * 3 + 500 * 3), y * 500 * 3);
    const result = await observeImage({ ...cropped, data }, QUAD, oracleClassifier(truth), {
      frameId: "p",
      source: "image",
    });
    const unobserved = result.observation.squares.filter((s) => s === null).length;
    expect(unobserved).toBeGreaterThan(50);
    expect(result.observation.squares[7 * BOARD_SIZE]).not.toBeNull(); // left edge, in frame
  });

  it("leaves the side undecided rather than guessing, when there are too few tiles", () => {
    const few = [reading({ "8": 0.9 }, 1), reading({ empty: 0.99 })];
    expect(decideReading(few, MODEL_CLASSES)).toMatchObject({
      decided: false,
      reason: "too few tiles",
    });
  });

  it("leaves the side undecided when the tiles disagree", () => {
    const messy = [0, 1, 2, 3, 0, 1, 2, 3].map((t) => reading({ "8": 0.9 }, t));
    expect(decideReading(messy, MODEL_CLASSES)).toMatchObject({
      decided: false,
      reason: "tiles disagree",
    });
  });

  it("refuses a mirrored corner list before reading anything", async () => {
    const [tl, tr, br, bl] = QUAD;
    await expect(
      observeImage(image, [tl, bl, br, tr], oracleClassifier(truth), {
        frameId: "p",
        source: "image",
      }),
    ).rejects.toThrow(GeometryError);
    expect(squareCrops).toBeTypeOf("function");
  });
});
