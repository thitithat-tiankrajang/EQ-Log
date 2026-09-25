// Multi-frame evidence fusion: the invariants a live scanner relies on.
//
// Model-agnostic and camera-free. Observations are written by hand in both
// forms a recogniser can produce: the single-stage 30-way `reading`, and the
// two-stage occupancy (Stage 1) + identity (Stage 2). Scenario traces come
// from tools/vision/fusionScenarios.ts (printable with fusionTrace.ts).
import { describe, expect, it } from "vitest";

import { readingToCellEvidence, type SquareReading } from "../src/features/boardVision/classifier";
import { assessCompletion } from "../src/features/boardVision/completion";
import {
  EvidenceAccumulator,
  qualityFromFactors,
  tileClasses,
  type BoardObservation,
  type SquareObservation,
} from "../src/features/boardVision/observation";
import { reconstruct } from "../src/features/boardVision/reconstruct";
import { EMPTY, UNKNOWN, type CellClass } from "../src/features/boardVision/vocabulary";
import { identity, SCENARIOS, SIM_META, SQUARE, simulate } from "../tools/vision/fusionScenarios";

const META = SIM_META;
const C = SQUARE;

function frame(
  id: string,
  squares: Record<number, SquareObservation | null>,
  group?: string,
): BoardObservation {
  const all: BoardObservation["squares"][number][] = Array.from({ length: 225 }, () => null);
  for (const [i, s] of Object.entries(squares)) all[Number(i)] = s;
  return {
    frameId: id,
    source: "camera",
    ...(group ? { group } : {}),
    classifier: META,
    quad: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    squares: all,
  };
}
const seen = (
  occupancy: number,
  id: Partial<Record<CellClass, number>> | null,
  quality: number,
): SquareObservation => ({ occupancy, ...(id ? { identity: identity(id) } : {}), quality });
const P = (acc: EvidenceAccumulator, c: CellClass, square = C) =>
  Math.exp(acc.evidence().cells[square]!.logProbabilities[c] ?? -Infinity);
const pTile = (acc: EvidenceAccumulator, square = C) => 1 - P(acc, EMPTY, square);
const lead = (acc: EvidenceAccumulator, square = C) => {
  const e = Object.entries(acc.evidence().cells[square]!.logProbabilities) as [CellClass, number][];
  const [c, lp] = e.sort((a, b) => b[1] - a[1])[0]!;
  return [c, Math.exp(lp)] as const;
};

describe("A · strong evidence is not erased by a later bad frame", () => {
  it("several sharp TILE frames, then one blurry EMPTY frame: still strongly TILE", () => {
    const acc = new EvidenceAccumulator();
    for (let i = 0; i < 3; i += 1)
      acc.add(frame(`sharp${i}`, { [C]: seen(0.98, { "8": 0.97 }, 0.95) }));
    const before = pTile(acc);
    acc.add(frame("blurry", { [C]: seen(0.05, null, 0.3) }));
    expect(pTile(acc)).toBeCloseTo(before, 12);
    expect(lead(acc)).toEqual(["8", expect.any(Number)]);
    expect(lead(acc)[1]).toBeGreaterThan(0.95);
  });

  it("even ONE sharp frame is not diluted by a much worse one", () => {
    const acc = new EvidenceAccumulator();
    acc.add(frame("sharp", { [C]: seen(0.99, { "8": 0.97 }, 0.95) }));
    const before = lead(acc);
    acc.add(frame("blurry", { [C]: seen(0.1, { "3": 0.8 }, 0.3) }));
    expect(lead(acc)).toEqual(before);
  });

  it("a later poor view that is NOT far worse is pooled, and still cannot flip a stable square", () => {
    const acc = new EvidenceAccumulator();
    acc.add(frame("a", { [C]: seen(0.99, { "8": 0.97 }, 0.9) }));
    acc.add(frame("b", { [C]: seen(0.99, { "8": 0.97 }, 0.9) }));
    acc.add(frame("wrong", { [C]: seen(0.3, { "3": 0.9 }, 0.6) }));
    expect(lead(acc)[0]).toBe("8");
    expect(pTile(acc)).toBeGreaterThan(0.85);
  });
});

describe("B · repeated independent good evidence increases confidence", () => {
  it("two, then three agreeing independent views are more certain than one", () => {
    const acc = new EvidenceAccumulator();
    const view = () => seen(0.95, { "5": 0.9 }, 0.9);
    acc.add(frame("f1", { [C]: view() }));
    const one = P(acc, "5");
    acc.add(frame("f2", { [C]: view() }));
    const two = P(acc, "5");
    acc.add(frame("f3", { [C]: view() }));
    const three = P(acc, "5");
    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
    expect(pTile(acc)).toBeGreaterThan(0.99);
  });

  it("near-duplicate frames of one pose (one group) are ONE view: no added confidence", () => {
    const acc = new EvidenceAccumulator();
    for (let i = 0; i < 30; i += 1)
      acc.add(frame(`burst${i}`, { [C]: seen(0.95, { "5": 0.8 }, 0.8) }, "pose-1"));
    const single = new EvidenceAccumulator();
    single.add(frame("only", { [C]: seen(0.95, { "5": 0.8 }, 0.8) }));
    expect(P(acc, "5")).toBeCloseTo(P(single, "5"), 12);
    expect(acc.cell(C)).toMatchObject({ views: 1, seen: 30 });
  });

  it("even frames wrongly declared independent add confidence only up to the view cap", () => {
    const acc = new EvidenceAccumulator();
    for (let i = 0; i < 30; i += 1) acc.add(frame(`f${i}`, { [C]: seen(0.95, { "5": 0.8 }, 0.8) }));
    const three = new EvidenceAccumulator();
    for (let i = 0; i < 3; i += 1)
      three.add(frame(`f${i}`, { [C]: seen(0.95, { "5": 0.8 }, 0.8) }));
    expect(P(acc, "5")).toBeCloseTo(P(three, "5"), 12);
  });
});

describe("C · good conflicting evidence stays ambiguous", () => {
  it("6 vs 8 from equally good views: both remain, neither is confident, no third class appears", () => {
    const acc = new EvidenceAccumulator();
    acc.add(frame("a", { [C]: seen(0.99, { "6": 0.95, "5": 0.03 }, 0.9) }));
    acc.add(frame("b", { [C]: seen(0.99, { "8": 0.95, "5": 0.03 }, 0.9) }));
    expect(P(acc, "6")).toBeCloseTo(P(acc, "8"), 6);
    expect(P(acc, "6")).toBeLessThan(0.6);
    expect(P(acc, "5")).toBeLessThan(0.05); // the class both half-allowed does not win
    const cell = reconstruct(acc.evidence()).cells[C]!;
    expect(cell.flags).toContain("uncertain");
    expect(
      cell.alternatives
        .slice(0, 2)
        .map((a) => a.reading)
        .sort(),
    ).toEqual(["6", "8"]);
  });

  it("2 : 1 good disagreement is not collapsed to the majority", () => {
    const acc = new EvidenceAccumulator();
    acc.add(frame("a", { [C]: seen(0.99, { "6": 0.95 }, 0.9) }));
    acc.add(frame("b", { [C]: seen(0.99, { "8": 0.95 }, 0.9) }));
    acc.add(frame("c", { [C]: seen(0.99, { "6": 0.95 }, 0.9) }));
    expect(lead(acc)[0]).toBe("6");
    expect(lead(acc)[1]).toBeLessThan(0.8);
    expect(P(acc, "8")).toBeGreaterThan(0.2);
    expect(reconstruct(acc.evidence()).cells[C]!.flags).toContain("uncertain");
  });

  it("occupancy disagreement between good views stays in the middle", () => {
    const acc = new EvidenceAccumulator();
    acc.add(frame("tile", { [C]: seen(0.97, { "4": 0.95 }, 0.9) }));
    acc.add(frame("empty", { [C]: seen(0.03, null, 0.9) }));
    expect(pTile(acc)).toBeGreaterThan(0.35);
    expect(pTile(acc)).toBeLessThan(0.65);
  });
});

describe("D · quantity does not beat quality", () => {
  it("one excellent view against many terrible ones", () => {
    const acc = new EvidenceAccumulator();
    acc.add(frame("excellent", { [C]: seen(0.995, { "8": 0.98 }, 0.98) }));
    for (let i = 0; i < 50; i += 1)
      acc.add(frame(`terrible${i}`, { [C]: seen(0.05, { "3": 0.9 }, 0.12) }));
    expect(lead(acc)[0]).toBe("8");
    expect(lead(acc)[1]).toBeGreaterThan(0.95);
    expect(acc.sources(C)[0]!.frameId).toBe("excellent");
  });

  it("many medium views that disagree with two good ones do not overpower them", () => {
    const acc = new EvidenceAccumulator();
    acc.add(frame("g1", { [C]: seen(0.99, { "8": 0.95 }, 0.95) }));
    acc.add(frame("g2", { [C]: seen(0.99, { "8": 0.95 }, 0.95) }));
    for (let i = 0; i < 20; i += 1) acc.add(frame(`m${i}`, { [C]: seen(0.9, { "3": 0.9 }, 0.55) }));
    expect(lead(acc)[0]).toBe("8");
  });
});

describe("E, F, G · unseen, clipped, occluded", () => {
  it("E: a square no frame covered stays unknown with zero observations", () => {
    const acc = new EvidenceAccumulator();
    acc.add(frame("f", { [C]: seen(0.99, { "8": 0.97 }, 1) }));
    expect(acc.evidence().cells[0]).toEqual({
      logProbabilities: { [UNKNOWN]: 0 },
      observations: 0,
    });
    expect(acc.cell(0)).toMatchObject({ views: 0, seen: 0, occupancy: null });
  });

  it("F: out-of-frame / clipped squares (null or quality 0) add no evidence, least of all 'empty'", () => {
    const acc = new EvidenceAccumulator();
    acc.add(frame("f1", { [C]: seen(0.97, { "8": 0.95 }, 0.9) }));
    const before = acc.evidence().cells[C];
    acc.add(frame("clipped", { [C]: null }));
    acc.add(frame("zero", { [C]: seen(0.0, null, 0) }));
    expect(acc.evidence().cells[C]).toEqual(before);
    expect(acc.cell(C).seen).toBe(1);
  });

  it("G: a tile occluded for a while keeps its evidence", () => {
    const acc = new EvidenceAccumulator();
    acc.add(frame("a", { [C]: seen(0.99, { "12": 0.96 }, 0.95) }));
    acc.add(frame("b", { [C]: seen(0.99, { "12": 0.96 }, 0.95) }));
    const before = lead(acc);
    for (let i = 0; i < 10; i += 1) acc.add(frame(`hand${i}`, { [C]: null }));
    // a producer that missed the hand reports it at the low quality its visibility gives
    acc.add(
      frame("leaked", {
        [C]: seen(0.05, null, qualityFromFactors({ visibility: 0.3, sharpness: 0.8 })),
      }),
    );
    expect(lead(acc)).toEqual(before);
  });
});

describe("H · order does not matter", () => {
  it("the same observations in any order give identical evidence", () => {
    const rng = mulberry32(7);
    const obs: BoardObservation[] = [];
    for (let f = 0; f < 12; f += 1) {
      const squares: Record<number, SquareObservation | null> = {};
      for (let i = 0; i < 225; i += 1) {
        if (rng() < 0.3) continue;
        const q = Math.round(rng() * 10) / 10; // coarse on purpose: many exact quality ties
        squares[i] =
          rng() < 0.5
            ? seen(rng(), rng() < 0.7 ? { [pick(rng)]: 0.5 + rng() * 0.45 } : null, q)
            : { reading: randomReading(rng), quality: q };
      }
      obs.push(frame(`frame-${f}`, squares, rng() < 0.3 ? `g${f % 3}` : undefined));
    }
    const run = (order: BoardObservation[]) => {
      const acc = new EvidenceAccumulator();
      order.forEach((o) => acc.add(o));
      return JSON.stringify(acc.evidence());
    };
    const reference = run(obs);
    for (let k = 0; k < 8; k += 1) expect(run(shuffle(obs, rng))).toBe(reference);
  });
});

describe("I · no semantic correction", () => {
  it("an equation-invalid but clearly seen board comes out exactly as seen", () => {
    // "= = 9 =" across a row — nonsense as an equation, perfectly visible as tiles.
    const acc = new EvidenceAccumulator();
    const row: Record<number, SquareObservation> = {};
    ["=", "=", "9", "="].forEach((k, j) => (row[105 + j] = seen(0.99, { [k]: 0.97 }, 0.95)));
    acc.add(frame("f1", row));
    acc.add(frame("f2", row));
    const r = reconstruct(acc.evidence());
    expect([105, 106, 107, 108].map((i) => r.cells[i]!.reading)).toEqual(["=", "=", "9", "="]);
    expect(r.cells.slice(105, 109).every((c) => !c.flags.includes("ruleOverride"))).toBe(true);
  });
});

describe("occupancy and identity are separate", () => {
  it("a tile whose kind was never observed is a tile of unknown kind, not a guess", () => {
    const acc = new EvidenceAccumulator();
    acc.add(frame("s1", { [C]: seen(0.97, null, 0.9) }));
    acc.add(frame("s2", { [C]: seen(0.97, null, 0.9) }));
    expect(pTile(acc)).toBeGreaterThan(0.97);
    expect(lead(acc)[0]).toBe(UNKNOWN);
    expect(reconstruct(acc.evidence()).cells[C]!.flags).toContain("unreadable");
  });

  it("identity seen in an early, occupancy-uncertain view is kept and resolved by later views", () => {
    const acc = new EvidenceAccumulator();
    acc.add(frame("early", { [C]: seen(0.5, { "14": 0.9 }, 0.9) })); // Stage 1 unsure; Stage 2 ran anyway
    expect(lead(acc)[0]).not.toBe("14"); // not asserted yet
    acc.add(frame("later", { [C]: seen(0.98, null, 0.9) })); // Stage 1 sure, Stage 2 not run
    expect(lead(acc)[0]).toBe("14"); // the early identity now counts
    expect(acc.cell(C).identityObserved).toBe(true);
  });

  it("identity from a view that believed the square EMPTY carries little weight", () => {
    const acc = new EvidenceAccumulator();
    acc.add(frame("thought-empty", { [C]: seen(0.05, { "3": 0.95 }, 0.95) }));
    acc.add(frame("clear-tile", { [C]: seen(0.99, { "8": 0.95 }, 0.9) }));
    expect(P(acc, "8")).toBeGreaterThan(5 * P(acc, "3"));
  });

  it("Stage-2 identity cannot put a kind into a square Stage 1 sees as empty", () => {
    const acc = new EvidenceAccumulator();
    acc.add(frame("a", { [C]: seen(0.02, { "7": 0.99 }, 0.95) }));
    acc.add(frame("b", { [C]: seen(0.02, { "7": 0.99 }, 0.95) }));
    expect(lead(acc)[0]).toBe(EMPTY);
    expect(P(acc, "7")).toBeLessThan(0.02);
  });

  it("a single-stage reading and the same numbers as occupancy + identity fuse alike", () => {
    const r1 = readingFor({ "6": 0.7, "8": 0.25 }, 0.02);
    const r2 = readingFor({ "8": 0.8, "6": 0.1 }, 0.05);
    const single = new EvidenceAccumulator();
    single.add(frame("a", { [C]: { reading: r1, quality: 0.9 } }));
    single.add(frame("b", { [C]: { reading: r2, quality: 0.8 } }));
    const split = new EvidenceAccumulator();
    for (const [id, r, q] of [
      ["a", r1, 0.9],
      ["b", r2, 0.8],
    ] as const) {
      const e = META.classes.indexOf(EMPTY);
      const occ = 1 - r.kinds[e]!;
      split.add(
        frame(id, {
          [C]: {
            occupancy: occ,
            identity: tileClasses(META).map((c) => r.kinds[META.classes.indexOf(c)]! / occ),
            turns: r.turns,
            quality: q,
          },
        }),
      );
    }
    for (const c of ["6", "8", EMPTY] as CellClass[])
      expect(P(single, c)).toBeCloseTo(P(split, c), 10);
  });

  it("an upload (N = 1) is exactly that observation's evidence", () => {
    const r = readingFor({ "8": 0.51, "3": 0.31, "9": 0.12 }, 0.01);
    const acc = new EvidenceAccumulator();
    acc.add(frame("photo", { [C]: { reading: r, quality: 0.4 } }));
    expect(acc.evidence().cells[C]).toEqual(readingToCellEvidence(r, META, 1));
  });
});

describe("the contract refuses what it cannot interpret", () => {
  it("rejects a frame added twice, a reading plus occupancy, and a wrong-length identity", () => {
    const acc = new EvidenceAccumulator();
    acc.add(frame("f", { [C]: seen(0.9, null, 1) }));
    expect(() => acc.add(frame("f", { [C]: seen(0.9, null, 1) }))).toThrow(/already added/);
    expect(() =>
      acc.add(
        frame("g", { [C]: { reading: readingFor({ "1": 0.9 }, 0), occupancy: 0.9, quality: 1 } }),
      ),
    ).toThrow(/OR/);
    expect(() =>
      acc.add(frame("h", { [C]: { occupancy: 0.9, identity: [1, 0], quality: 1 } })),
    ).toThrow(/tile kinds/);
    expect(() => acc.add(frame("i", { [C]: { quality: 1 } as SquareObservation }))).toThrow(
      /occupancy/,
    );
  });

  it("quality factors combine as a product, clamped to 0–1", () => {
    expect(qualityFromFactors({})).toBe(1);
    expect(qualityFromFactors({ alignment: 0.5, sharpness: 0.8 })).toBeCloseTo(0.4, 12);
    expect(qualityFromFactors({ exposure: 1.4, visibility: -1 })).toBe(0);
  });
});

describe("the simulator scenarios behave as the invariants say", () => {
  const byName = (prefix: string) => simulate(SCENARIOS.find((s) => s.name.startsWith(prefix))!);
  const last = <T>(a: T[]) => a[a.length - 1]!;

  it("1 · bad → … → sharp converges on the truth", () => {
    const t = byName("1");
    expect(t[0]!.top[0]!.reading).not.toBe("7");
    expect(last(t).top[0]).toMatchObject({ reading: "7" });
    expect(last(t).top[0]!.p).toBeGreaterThan(0.99);
  });
  it("2 · blurry wrong frames never move a sharp reading", () => {
    const t = byName("2");
    for (const b of t) expect(b.top[0]).toEqual(t[0]!.top[0]);
  });
  it("3 · alternating good A / B stays uncertain between exactly A and B", () => {
    const b = last(byName("3"));
    expect(
      b.top
        .slice(0, 2)
        .map((x) => x.reading)
        .sort(),
    ).toEqual(["6", "8"]);
    expect(b.top[0]!.p).toBeLessThan(0.8);
  });
  it("4 · unknown until seen, then the reading", () => {
    const t = byName("4");
    expect(t.slice(0, 4).every((b) => b.pTile === null && b.top[0]!.reading === UNKNOWN)).toBe(
      true,
    );
    expect(last(t).top[0]!.reading).toBe("5");
  });
  it("5 · occlusion (marked or leaked at low quality) does not erase", () => {
    const t = byName("5");
    expect(t.every((b) => b.top[0]!.reading === "12")).toBe(true);
  });
  it("6 · degrading geometry does not flip the square", () => {
    const t = byName("6");
    expect(t.every((b) => b.top[0]!.reading === "9")).toBe(true);
    expect(last(t).top[0]!.p).toBeGreaterThanOrEqual(t[1]!.top[0]!.p - 1e-12);
  });
  it("7 · a burst of near-duplicates adds nothing; declared-independent frames are capped", () => {
    const a = byName("7a"),
      b = byName("7b");
    expect(last(a).top[0]!.p).toBeCloseTo(a[0]!.top[0]!.p, 12);
    expect(last(b).top[0]!.p).toBeCloseTo(b[2]!.top[0]!.p, 12);
  });
  it("8 · one excellent view survives thirty terrible ones", () => {
    const t = byName("8");
    expect(t.every((x) => x.top[0]!.reading === "8" && x.top[0]!.p > 0.95)).toBe(true);
  });
});

describe("board completion", () => {
  const policy = { minViews: 2, minBestQuality: 0.7, clearAt: 0.9 };
  it("reports sufficient / needs a view / uncertain / excluded separately, never 'done'", () => {
    const acc = new EvidenceAccumulator();
    const both: Record<number, SquareObservation> = {
      0: seen(0.99, { "1": 0.97 }, 0.95), // sufficient after two views
      1: seen(0.99, { "6": 0.6, "9": 0.35 }, 0.95), // well seen, still ambiguous
      2: seen(0.01, null, 0.95), // clearly empty
    };
    acc.add(
      frame("f1", {
        ...both,
        3: seen(0.99, { "2": 0.97 }, 0.95),
        4: seen(0.99, { "2": 0.97 }, 0.4),
      }),
    );
    acc.add(frame("f2", both));
    const r = assessCompletion(acc, policy, new Set([5]));
    expect(r.squares.slice(0, 6)).toEqual([
      "sufficient",
      "uncertain",
      "sufficient",
      "needsView",
      "needsView",
      "excluded",
    ]);
    expect(r.counts).toEqual({
      sufficient: 2,
      uncertain: 1,
      needsView: 2,
      excluded: 1,
      unobserved: 219,
    });
    expect(r.needAnotherView).toBe(221);
    expect(r.semantic).toBeNull(); // faces / inventory are reconstruct's, not fusion's
  });

  it("has no built-in thresholds: an incomplete policy is refused", () => {
    const acc = new EvidenceAccumulator();
    expect(() => assessCompletion(acc, { minViews: 2, minBestQuality: 0.7 } as never)).toThrow(
      /clearAt/,
    );
  });
});

// ── helpers ──────────────────────────────────────────────────────────────
function readingFor(named: Partial<Record<CellClass, number>>, empty: number): SquareReading {
  const tiles = tileClasses(META);
  const rest = Math.max(0, 1 - empty - Object.values(named).reduce((a, b) => a + (b ?? 0), 0));
  const others = tiles.filter((c) => named[c] === undefined).length;
  return {
    kinds: META.classes.map((c) => (c === EMPTY ? empty : (named[c] ?? rest / others))),
    turns: [0.94, 0.02, 0.02, 0.02],
  };
}
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(rng: () => number): CellClass {
  const t = tileClasses(META);
  return t[Math.floor(rng() * t.length)]!;
}
function randomReading(rng: () => number): SquareReading {
  const raw = META.classes.map(() => rng() ** 4);
  const z = raw.reduce((a, b) => a + b, 0);
  const turns = [rng(), rng(), rng(), rng()];
  const tz = turns.reduce((a, b) => a + b, 0);
  return {
    kinds: raw.map((v) => v / z),
    turns: turns.map((v) => v / tz) as [number, number, number, number],
  };
}
function shuffle<T>(a: T[], rng: () => number): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [b[i], b[j]] = [b[j]!, b[i]!];
  }
  return b;
}
