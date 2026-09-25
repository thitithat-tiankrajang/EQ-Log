// ── The recogniser, as the rest of the app sees it ──────────────────────────
//
// A recogniser is a REPLACEABLE PART. Everything around it — geometry,
// evidence, reconstruction, verification, Study — is written against the
// interface below, never against a particular model, so a better model is a
// new `meta.json` + weights and nothing else.
//
// Its job is exactly one thing: given the crop of ONE square, say which
// PHYSICAL tile kind is there (or that it is empty), and which way the print is
// turned. It is never told which square the crop came from, never asked for
// a face (`+/-`, `x//`, `?` are single physical tiles; their face is not
// printed), and never shown an equation. Geometry decides WHICH SQUARE;
// the recogniser decides WHAT TILE; faces and equations are decided
// downstream and may not overrule confident physical evidence.
//
//   meta.json ──checkClassifierMeta──► ClassifierMeta
//   run(tensor) ─classifierFromLogits─► SquareClassifier   (e.g. an ONNX worker)
//   SquareClassifier.classify(crops) ──► SquareReading[]   (calibrated)
//   readingToCellEvidence ─────────────► CellEvidence      (V0a's contract)

import { CROP_CONTRACT, normaliseCrops, type SquareCrop } from "./crops";
import { cellEvidenceFromProbabilities } from "./evidence";
import type { CellEvidence, QuarterTurn } from "./types";
import {
  CELL_CLASSES,
  UNKNOWN,
  isCellClass,
  vocabularyFingerprint,
  type CellClass,
} from "./vocabulary";

/** What a recogniser says about one crop. Probabilities are CALIBRATED. */
export type SquareReading = {
  /** Aligned with `ClassifierMeta.classes`; sums to 1. */
  kinds: readonly number[];
  /** Clockwise quarter-turns of the print, as seen in the crop; sums to 1.
   *  Meaningless for an empty square. */
  turns: readonly [number, number, number, number];
};

export type ClassifierMeta = {
  modelVersion: string;
  vocabularyFingerprint: string;
  /** The model's output order: a subsequence of CELL_CLASSES, never `unknown`. */
  classes: readonly CellClass[];
  temperature: number;
  /** Keep this many most-probable classes; the rest of the mass is `unknown`. */
  topK: number;
  /** Stated by the model so that a synthetic-only model can say so in the UI. */
  domain: string;
};

export interface SquareClassifier {
  readonly meta: ClassifierMeta;
  classify(crops: readonly SquareCrop[], signal?: AbortSignal): Promise<SquareReading[]>;
}

export class ClassifierMetaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassifierMetaError";
  }
}

/** meta.json as read, before anything about it is trusted. */
type MetaJson = {
  schemaVersion?: unknown;
  modelVersion?: unknown;
  vocabularyFingerprint?: unknown;
  domain?: unknown;
  outputs?: { kind_logits?: { classes?: unknown } };
  input?: {
    geometry?: Record<string, unknown>;
    normalisation?: Record<string, unknown>;
    layout?: unknown;
    channels?: unknown;
  };
  calibration?: { temperature?: unknown };
  unknown?: { k?: unknown };
};

/**
 * Accept a model's meta.json only if the model was built for THIS runtime:
 * same vocabulary and tile set (fingerprint), class names this runtime knows
 * in this runtime's order, the exact crop geometry and normalisation of
 * `CROP_CONTRACT`. A model that disagrees on any of these would put its
 * probabilities on the wrong names or read differently cut crops — without
 * erroring — so it is refused here, loudly.
 */
export function checkClassifierMeta(raw: unknown): ClassifierMeta {
  const meta = (raw ?? {}) as MetaJson;
  const fail = (why: string): never => {
    throw new ClassifierMetaError(`Refusing model ${String(meta.modelVersion ?? "?")}: ${why}`);
  };
  if (meta.schemaVersion !== 1) fail("unsupported meta schema");
  if (meta.vocabularyFingerprint !== vocabularyFingerprint()) {
    fail(
      `it was trained for vocabulary ${String(meta.vocabularyFingerprint)}, this app is ${vocabularyFingerprint()}`,
    );
  }
  const listed = meta.outputs?.kind_logits?.classes;
  if (!Array.isArray(listed) || listed.length === 0)
    return fail("it does not list its output classes");
  if (!listed.every(isCellClass)) fail("it names a class this app does not have");
  const classes = listed as CellClass[];
  if (classes.includes(UNKNOWN)) fail("`unknown` is derived at runtime, never a model output");
  const order = classes.map((c) => CELL_CLASSES.indexOf(c));
  if (order.some((v, i) => i > 0 && v <= order[i - 1]!))
    fail("its classes are not in the runtime's order");
  const g = meta.input?.geometry ?? {};
  for (const key of ["pxPerSquare", "marginSquares", "canonicalSize", "cropSize"] as const) {
    if (g[key] !== CROP_CONTRACT[key]) {
      fail(
        `its crops are cut with ${key} = ${String(g[key])}, the runtime uses ${CROP_CONTRACT[key]}`,
      );
    }
  }
  const n = meta.input?.normalisation ?? {};
  if (n.divide !== 255 || n.mean !== CROP_CONTRACT.mean || n.std !== CROP_CONTRACT.std) {
    fail("different input normalisation");
  }
  if (meta.input?.layout !== "NCHW" || meta.input?.channels !== "RGB")
    fail("different tensor layout");
  const temperature = meta.calibration?.temperature;
  if (typeof temperature !== "number" || !(temperature > 0))
    return fail("no calibration temperature");
  const topK = meta.unknown?.k;
  if (typeof topK !== "number" || !Number.isInteger(topK) || topK < 1)
    return fail("no unknown rule");
  return {
    modelVersion: String(meta.modelVersion),
    vocabularyFingerprint: String(meta.vocabularyFingerprint),
    classes,
    temperature,
    topK,
    domain: String(meta.domain ?? ""),
  };
}

/** What a runtime (ONNX in a worker, a test double…) has to provide: raw logits. */
export type LogitsRunner = (
  input: Float32Array,
  count: number,
  signal?: AbortSignal,
) => Promise<{ kindLogits: Float32Array; turnLogits: Float32Array }>;

function softmax(logits: ArrayLike<number>, offset: number, n: number, temperature = 1): number[] {
  let max = -Infinity;
  for (let i = 0; i < n; i += 1) max = Math.max(max, logits[offset + i]! / temperature);
  const e = Array.from({ length: n }, (_, i) => Math.exp(logits[offset + i]! / temperature - max));
  const total = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / total);
}

/** A SquareClassifier from any logits runtime: normalise, run, calibrate. */
export function classifierFromLogits(meta: ClassifierMeta, run: LogitsRunner): SquareClassifier {
  return {
    meta,
    async classify(crops, signal) {
      if (crops.length === 0) return [];
      const { kindLogits, turnLogits } = await run(normaliseCrops(crops), crops.length, signal);
      const k = meta.classes.length;
      if (kindLogits.length !== crops.length * k || turnLogits.length !== crops.length * 4) {
        throw new ClassifierMetaError(
          `Model ${meta.modelVersion} returned outputs of the wrong shape.`,
        );
      }
      return crops.map((_, i) => ({
        kinds: softmax(kindLogits, i * k, k, meta.temperature),
        turns: softmax(turnLogits, i * 4, 4) as unknown as [number, number, number, number],
      }));
    },
  };
}

/**
 * One reading as V0a evidence. The `topK` most probable classes keep their
 * probability; whatever is left over becomes `unknown`
 * (`cellEvidenceFromProbabilities` assigns residual mass there). A confident
 * reading is barely touched; a flat, out-of-distribution one surfaces as
 * `unknown` — which is how the runtime can say "something is here and I
 * cannot tell what" without the model having been trained to.
 */
export function readingToCellEvidence(
  reading: SquareReading,
  meta: Pick<ClassifierMeta, "classes" | "topK">,
  observations = 1,
): CellEvidence {
  const ranked = reading.kinds
    .map((p, i) => [meta.classes[i]!, p] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, meta.topK);
  const probabilities: Partial<Record<CellClass, number>> = {};
  for (const [name, p] of ranked) probabilities[name] = Math.min(1, Math.max(0, p));
  const evidence = cellEvidenceFromProbabilities(probabilities);
  const orientation: Partial<Record<QuarterTurn, number>> = {};
  reading.turns.forEach((p, t) => {
    orientation[t as QuarterTurn] = Math.log(Math.max(p, 1e-12));
  });
  return { ...evidence, orientation, observations };
}
