// Deterministic multi-frame scenarios for the evidence fusion — no camera, no
// model. Each step is what ONE processed frame says about ONE square (square
// 112, the centre); `see: null` means the square was not usable in that
// frame (out of view, covered, too degraded — the producer's call).
//
//   npx vite-node tools/vision/fusionTrace.ts        prints how the belief moves
//   tests/board-vision-fusion.test.ts                 asserts it
//
// Every scenario works in the TWO-STAGE form (occupancy + identity) the
// Stage-1 / Stage-2 recognisers will produce.

import {
  EvidenceAccumulator,
  qualityFromFactors,
  tileClasses,
  type BoardObservation,
  type FusionPolicy,
  type QualityFactors,
} from "../../src/features/boardVision/observation";
import {
  CELL_CLASSES,
  EMPTY,
  UNKNOWN,
  type CellClass,
} from "../../src/features/boardVision/vocabulary";

export const SQUARE = 112;
export const SIM_META: BoardObservation["classifier"] = {
  modelVersion: "simulated",
  classes: CELL_CLASSES.filter((c) => c !== UNKNOWN),
  topK: 3,
};

export type Step = {
  label: string;
  /** Either a quality, or the factors it is the product of. */
  quality?: number;
  factors?: QualityFactors;
  group?: string;
  see: null | { occupancy: number; identity?: Partial<Record<CellClass, number>> };
};
export type Scenario = { name: string; truth: CellClass; steps: Step[] };

/** A distribution over the tile kinds: the named ones, the rest spread evenly. */
export function identity(named: Partial<Record<CellClass, number>>): number[] {
  const tiles = tileClasses(SIM_META);
  const rest = Math.max(0, 1 - Object.values(named).reduce((a, b) => a + (b ?? 0), 0));
  const others = tiles.filter((c) => named[c] === undefined).length;
  return tiles.map((c) => named[c] ?? rest / others);
}

const sharp = (id: Partial<Record<CellClass, number>>, label = "sharp"): Step => ({
  label,
  quality: 0.95,
  see: { occupancy: 0.99, identity: id },
});

export const SCENARIOS: Scenario[] = [
  {
    name: "1 · bad → bad → medium → sharp → sharp",
    truth: "7",
    steps: [
      {
        label: "bad (blur)",
        quality: 0.2,
        see: { occupancy: 0.6, identity: { "7": 0.35, "1": 0.35, "4": 0.1 } },
      },
      {
        label: "bad (glare)",
        quality: 0.25,
        see: { occupancy: 0.55, identity: { "1": 0.4, "7": 0.3 } },
      },
      {
        label: "medium",
        quality: 0.6,
        see: { occupancy: 0.9, identity: { "7": 0.75, "1": 0.15 } },
      },
      sharp({ "7": 0.97 }),
      sharp({ "7": 0.97 }, "sharp again"),
    ],
  },
  {
    name: "2 · sharp and correct, then several blurry and wrong",
    truth: "8",
    steps: [
      sharp({ "8": 0.97 }),
      ...Array.from({ length: 6 }, (_, i): Step => ({
        label: `blurry #${i + 1}`,
        quality: 0.3,
        see: { occupancy: 0.25, identity: { "3": 0.6, "8": 0.2 } },
      })),
    ],
  },
  {
    name: "3 · good A ↔ good B (6 vs 8)",
    truth: "6",
    steps: Array.from({ length: 6 }, (_, i): Step => ({
      label: i % 2 ? "good: 8" : "good: 6",
      quality: 0.9,
      see: { occupancy: 0.99, identity: i % 2 ? { "8": 0.95 } : { "6": 0.95 } },
    })),
  },
  {
    name: "4 · unseen for the first half, then visible",
    truth: "5",
    steps: [
      ...Array.from({ length: 4 }, (_, i): Step => ({
        label: `out of view #${i + 1}`,
        quality: 0,
        see: null,
      })),
      sharp({ "5": 0.95 }),
      sharp({ "5": 0.95 }, "sharp again"),
    ],
  },
  {
    name: "5 · tile temporarily occluded (a hand)",
    truth: "12",
    steps: [
      sharp({ "12": 0.96 }),
      sharp({ "12": 0.96 }, "sharp again"),
      { label: "occluded (marked unusable)", see: null },
      { label: "occluded (marked unusable)", see: null },
      // a producer that missed the hand: the finger read as an empty square, at the low
      // quality its visibility estimate gives it
      {
        label: "occluded, leaked",
        factors: { visibility: 0.3, sharpness: 0.8 },
        see: { occupancy: 0.05 },
      },
      sharp({ "12": 0.96 }, "visible again"),
    ],
  },
  {
    name: "6 · geometry degrades while the phone moves",
    truth: "9",
    steps: [
      {
        label: "aligned",
        factors: { alignment: 0.95, sharpness: 0.95 },
        see: { occupancy: 0.99, identity: { "9": 0.93 } },
      },
      {
        label: "drifting",
        factors: { alignment: 0.8, sharpness: 0.9 },
        see: { occupancy: 0.95, identity: { "9": 0.75, "6": 0.15 } },
      },
      {
        label: "misaligned",
        factors: { alignment: 0.5, sharpness: 0.7 },
        see: { occupancy: 0.7, identity: { "6": 0.5, "9": 0.3 } },
      },
      {
        label: "neighbour in crop",
        factors: { alignment: 0.3, sharpness: 0.6 },
        see: { occupancy: 0.35, identity: { "6": 0.7 } },
      },
      { label: "lost", factors: { alignment: 0.2, sharpness: 0.5 }, see: { occupancy: 0.2 } },
    ],
  },
  {
    name: "7a · 30 near-duplicate frames of one pose (one group)",
    truth: "5",
    steps: Array.from({ length: 30 }, (_, i): Step => ({
      label: `burst #${i + 1}`,
      quality: 0.8,
      group: "pose-1",
      see: { occupancy: 0.95, identity: { "5": 0.8 } },
    })),
  },
  {
    name: "7b · the same 30 frames, wrongly declared independent",
    truth: "5",
    steps: Array.from({ length: 30 }, (_, i): Step => ({
      label: `frame #${i + 1}`,
      quality: 0.8,
      see: { occupancy: 0.95, identity: { "5": 0.8 } },
    })),
  },
  {
    name: "8 · one excellent view against thirty terrible ones",
    truth: "8",
    steps: [
      { label: "excellent", quality: 0.98, see: { occupancy: 0.995, identity: { "8": 0.98 } } },
      ...Array.from({ length: 30 }, (_, i): Step => ({
        label: `terrible #${i + 1}`,
        quality: 0.12,
        see: { occupancy: 0.1, identity: { "3": 0.9 } },
      })),
    ],
  },
];

export function observation(step: Step, frame: number): BoardObservation {
  const squares: BoardObservation["squares"][number][] = Array.from({ length: 225 }, () => null);
  const quality = step.quality ?? (step.factors ? qualityFromFactors(step.factors) : 1);
  if (step.see && quality > 0)
    squares[SQUARE] = {
      occupancy: step.see.occupancy,
      ...(step.see.identity ? { identity: identity(step.see.identity) } : {}),
      quality,
      ...(step.factors ? { factors: step.factors } : {}),
    };
  return {
    frameId: `f${String(frame).padStart(3, "0")}`,
    source: "camera",
    ...(step.group ? { group: step.group } : {}),
    classifier: SIM_META,
    quad: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    squares,
  };
}

export type Belief = {
  step: string;
  pTile: number | null;
  top: { reading: CellClass; p: number }[];
  views: number;
  seen: number;
};

function belief(acc: EvidenceAccumulator, label: string): Belief {
  const cell = acc.evidence().cells[SQUARE]!;
  const summary = acc.cell(SQUARE);
  const top = (Object.entries(cell.logProbabilities) as [CellClass, number][])
    .map(([reading, lp]) => ({ reading, p: Math.exp(lp) }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 3);
  const empty = cell.logProbabilities[EMPTY];
  return {
    step: label,
    pTile: summary.views === 0 ? null : 1 - (empty === undefined ? 0 : Math.exp(empty)),
    top,
    views: summary.views,
    seen: summary.seen,
  };
}

/** Feed a scenario frame by frame; the belief after each frame. */
export function simulate(s: Scenario, policy: Partial<FusionPolicy> = {}): Belief[] {
  const acc = new EvidenceAccumulator(policy);
  return s.steps.map((step, i) => {
    acc.add(observation(step, i));
    return belief(acc, step.label);
  });
}
