// ── Observations, and combining them ─────────────────────────────────────────
//
// An uploaded photo is ONE observation of the board; a scan is many. Both go
// through the same accumulator, so the upload path is simply N = 1 — no
// separate code for it, and a scanner is "more of the same", not a new path.
//
// What one aligned frame says about one square (`SquareObservation`):
//
//   occupancy   P(a physical tile is here)                    — Stage 1
//   identity    P(physical kind | a tile is here)             — Stage 2, optional
//   turns       which way the print faces                     — optional
//   quality     0–1, how far THIS view of THIS square can be trusted
//               (alignment × sharpness × visibility × exposure …), estimated
//               by the producer, never by the recogniser
//
// Today's single-stage recogniser gives one 30-way `reading` instead; it is
// read as occupancy = 1 − P(empty) and identity = the tile kinds renormalised,
// so both recognisers meet the same fusion. A square that is out of frame,
// covered or unusable in a frame is `null` there and contributes NOTHING — in
// particular no evidence that it is empty.
//
// The combining rule, per square (docs/board-vision/live-evidence.md):
//
//   1. Views are grouped. Frames that share a `group` are near-duplicates (the
//      scanner decides: the same pose, a burst): a group counts as ONE view,
//      its best. Thirty identical frames are one confirmation, not thirty.
//   2. Only the BEST_VIEWS best groups (by quality) are kept, and of those
//      only views at least MIN_RELATIVE_QUALITY × the best one's quality are
//      pooled. A sharp early view is never pushed out by poorer later ones,
//      is not diluted by views far worse than itself, and many blurry views
//      cannot outvote a clear one by number.
//   3. Occupancy and identity are pooled SEPARATELY, each as a LINEAR pool
//      weighted by quality² (identity additionally by that view's own
//      occupancy, so a view that thought "probably empty" says little about
//      which tile). Linear pooling keeps disagreement visible: two good views
//      reading 6 and 8 give "6 or 8", never a third class both half-allowed.
//   4. Confidence may GROW only through agreement: the pool is sharpened by
//          γ = 1 + INDEPENDENCE · (n_eff − 1) · κ²     (capped)
//      where n_eff is the effective number of views and κ how much they agree
//      (the chance two of them, drawn by weight, name the same class). Views
//      that agree make the square more certain; views that disagree (κ ≈ 0)
//      leave the linear pool as it is. INDEPENDENCE < 1 because separate
//      camera frames still share light, blur and the recogniser's own biases.
//   5. Everything is a symmetric function of the kept views, and ties are
//      broken by frameId — the result does not depend on arrival order.
//
// It combines VISUAL evidence only. It knows nothing of equations, faces or
// the tile inventory: a confidently seen tile that makes an equation invalid
// comes out exactly as it was seen.

import { readingToCellEvidence, type ClassifierMeta, type SquareReading } from "./classifier";
import { unobservedCell } from "./evidence";
import type { Quad } from "./geometry";
import type { BoardEvidence } from "./types";
import { EMPTY, type CellClass } from "./vocabulary";

/** Why a view is as good as it is. Diagnostic; fusion uses `quality`.
 *  Each 0–1, 1 = no problem. `qualityFromFactors` is their product. */
export type QualityFactors = Partial<
  Record<"alignment" | "sharpness" | "visibility" | "exposure" | "motion", number>
>;

export type SquareObservation = {
  /** Single-stage recogniser: a distribution over `classifier.classes`. */
  reading?: SquareReading;
  /** Stage 1: P(a physical tile is here). */
  occupancy?: number;
  /** Stage 2: P(kind | tile), aligned with `tileClasses(classifier)`. Needs `occupancy`. */
  identity?: readonly number[];
  /** Orientation of the print when not inside `reading`. */
  turns?: readonly [number, number, number, number];
  /** 0–1: how far this view can be trusted for THIS square (1 = a clear, fully
   *  visible square). Estimated by the producer; never by the recogniser. */
  quality: number;
  factors?: QualityFactors;
};

export type BoardObservation = {
  frameId: string;
  source: "image" | "camera" | "fixture";
  /** Frames sharing a group are near-duplicates and count as one view (the
   *  best). Default: the frameId — every frame independent. */
  group?: string;
  /** The recogniser that read it. One accumulator never mixes recognisers. */
  classifier: Pick<ClassifierMeta, "modelVersion" | "classes" | "topK">;
  /** The grid corners in THIS frame's image, in reading 0 (row 1 at the top). */
  quad: Quad;
  /** 225 entries, row-major in reading 0. `null`: not usable in this frame
   *  (out of frame, covered, too degraded) — contributes nothing. */
  squares: readonly (SquareObservation | null)[];
};

/** Groups (independent views) kept per square. */
export const BEST_VIEWS = 3;

/** Fusion constants. PROVISIONAL: chosen for safety, not fitted — fit them on
 *  real multi-frame captures once the live recogniser exists. */
export type FusionPolicy = {
  bestViews: number;
  /** Weight of a view = quality^qualityPower. */
  qualityPower: number;
  /** 0 = frames never add confidence; 1 = independent views, fully. */
  independence: number;
  /** Cap on the sharpening exponent γ. */
  maxSharpen: number;
  /** Views below this fraction of the square's best quality are not pooled. */
  minRelativeQuality: number;
};
export const DEFAULT_FUSION: FusionPolicy = {
  bestViews: BEST_VIEWS,
  qualityPower: 2,
  independence: 0.5,
  maxSharpen: 3,
  minRelativeQuality: 0.5,
};

export function qualityFromFactors(factors: QualityFactors): number {
  return Object.values(factors).reduce<number>((q, f) => q * Math.min(1, Math.max(0, f ?? 1)), 1);
}

/** The model classes that are tiles (every class except `empty`), in order. */
export function tileClasses(meta: Pick<ClassifierMeta, "classes">): CellClass[] {
  return meta.classes.filter((c) => c !== EMPTY);
}

type View = {
  frameId: string;
  group: string;
  quality: number;
  occupancy: number;
  identity: number[] | null;
  turns: readonly [number, number, number, number] | null;
  /** Kept only for the N = 1 path, which returns the reading exactly. */
  reading: SquareReading | null;
};

const better = (a: View, b: View) =>
  b.quality - a.quality || (a.frameId < b.frameId ? -1 : a.frameId > b.frameId ? 1 : 0);

export class EvidenceAccumulator {
  private readonly kept: View[][] = Array.from({ length: 225 }, () => []);
  private readonly seen = new Array<number>(225).fill(0);
  private readonly frameIds = new Set<string>();
  private meta: BoardObservation["classifier"] | null = null;
  private readonly policy: FusionPolicy;

  constructor(policy: Partial<FusionPolicy> = {}) {
    this.policy = { ...DEFAULT_FUSION, ...policy };
  }

  get frames(): number {
    return this.frameIds.size;
  }

  add(observation: BoardObservation): void {
    if (observation.squares.length !== 225)
      throw new RangeError("An observation covers 225 squares.");
    if (this.frameIds.has(observation.frameId))
      throw new Error(
        `Frame ${observation.frameId} was already added: a frame is one observation.`,
      );
    const m = observation.classifier;
    if (
      this.meta &&
      (this.meta.modelVersion !== m.modelVersion || this.meta.classes.join() !== m.classes.join())
    ) {
      throw new Error("One scan cannot mix recognisers; start a new accumulator.");
    }
    this.meta ??= m;
    this.frameIds.add(observation.frameId);
    const group = observation.group ?? observation.frameId;
    observation.squares.forEach((square, i) => {
      if (!square || !(square.quality > 0)) return;
      const view = toView(square, m, observation.frameId, group);
      this.seen[i] = (this.seen[i] ?? 0) + 1;
      const list = this.kept[i]!;
      const same = list.findIndex((v) => v.group === group);
      if (same >= 0) {
        if (better(view, list[same]!) < 0) list[same] = view; // a group is its best frame
      } else list.push(view);
      list.sort(better);
      list.length = Math.min(list.length, this.policy.bestViews);
    });
  }

  /** Which frames the evidence for square `index` comes from, best first. */
  sources(index: number): { frameId: string; group: string; quality: number }[] {
    return (this.kept[index] ?? []).map((v) => ({
      frameId: v.frameId,
      group: v.group,
      quality: v.quality,
    }));
  }

  /** What is known about one square, for completion reporting. */
  cell(index: number): CellSummary {
    const kept = this.kept[index] ?? [];
    const list = kept.filter(
      (v) => v.quality >= (kept[0]?.quality ?? 0) * this.policy.minRelativeQuality,
    );
    const fused = list.length ? this.fuseSquare(list) : null;
    return {
      views: list.length,
      seen: this.seen[index] ?? 0,
      bestQuality: list[0]?.quality ?? 0,
      occupancy: fused ? fused.occupancy : null,
      identityObserved: list.some((v) => v.identity !== null),
    };
  }

  evidence(): BoardEvidence {
    const meta = this.meta;
    return {
      cells: this.kept.map((list) => {
        if (!meta || list.length === 0) return unobservedCell();
        // One usable view: exactly what it said (an upload is N = 1).
        const usable = list.filter(
          (v) => v.quality >= list[0]!.quality * this.policy.minRelativeQuality,
        );
        if (usable.length === 1 && usable[0]!.reading)
          return readingToCellEvidence(usable[0]!.reading, meta, 1);
        const f = this.fuseSquare(list);
        const tiles = tileClasses(meta);
        const kinds = meta.classes.map((c) => {
          if (c === EMPTY) return 1 - f.occupancy;
          // No identity seen: the tile mass stays unnamed and becomes `unknown`.
          return f.identity ? f.occupancy * f.identity[tiles.indexOf(c)]! : 0;
        });
        return readingToCellEvidence({ kinds, turns: f.turns }, meta, usable.length);
      }),
    };
  }

  private fuseSquare(kept: View[]) {
    const p = this.policy;
    const floor = kept[0]!.quality * p.minRelativeQuality;
    const list = kept.filter((v) => v.quality >= floor);
    const w = list.map((v) => Math.pow(v.quality, p.qualityPower));
    const occ = pool(
      list.map((v) => [v.occupancy, 1 - v.occupancy]),
      w,
      p,
    )[0]!;
    const withId = list
      .map((v, i) => [v, w[i]! * v.occupancy] as const)
      .filter(([v, wi]) => v.identity && wi > 0);
    const identity = withId.length
      ? pool(
          withId.map(([v]) => v.identity!),
          withId.map(([, wi]) => wi),
          p,
        )
      : null;
    const withTurns = list.map((v, i) => [v, w[i]!] as const).filter(([v]) => v.turns);
    const turns = (withTurns.length
      ? linear(
          withTurns.map(([v]) => [...v.turns!]),
          withTurns.map(([, wi]) => wi),
        )
      : [0.25, 0.25, 0.25, 0.25]) as unknown as [number, number, number, number];
    return { occupancy: occ, identity, turns };
  }
}

export type CellSummary = {
  /** Independent views (groups) currently pooled: kept, and not far below the best. */
  views: number;
  /** Usable observations ever added (including dropped duplicates / poorer views). */
  seen: number;
  bestQuality: number;
  /** Fused P(tile), null if never observed. */
  occupancy: number | null;
  identityObserved: boolean;
};

function toView(
  s: SquareObservation,
  meta: Pick<ClassifierMeta, "classes">,
  frameId: string,
  group: string,
): View {
  const tiles = tileClasses(meta);
  if (s.reading) {
    if (s.occupancy !== undefined || s.identity !== undefined)
      throw new Error("A square observation is a reading OR occupancy/identity, not both.");
    const e = meta.classes.indexOf(EMPTY);
    const occupancy = 1 - (e >= 0 ? s.reading.kinds[e]! : 0);
    const identity =
      occupancy > 1e-9
        ? meta.classes.flatMap((c, i) => (c === EMPTY ? [] : [s.reading!.kinds[i]! / occupancy]))
        : null;
    return {
      frameId,
      group,
      quality: s.quality,
      occupancy,
      identity,
      turns: s.reading.turns,
      reading: s.reading,
    };
  }
  if (s.occupancy === undefined || !(s.occupancy >= 0 && s.occupancy <= 1))
    throw new Error("A square observation needs a reading or an occupancy probability.");
  if (s.identity && s.identity.length !== tiles.length)
    throw new Error(
      `identity has ${s.identity.length} entries; the recogniser has ${tiles.length} tile kinds.`,
    );
  const sum = s.identity?.reduce((a, b) => a + b, 0) ?? 1;
  return {
    frameId,
    group,
    quality: s.quality,
    occupancy: s.occupancy,
    identity: s.identity ? s.identity.map((v) => v / sum) : null,
    turns: s.turns ?? null,
    reading: null,
  };
}

function linear(dists: number[][], w: number[]): number[] {
  const total = w.reduce((a, b) => a + b, 0);
  return dists[0]!.map((_, k) => dists.reduce((s, d, i) => s + w[i]! * d[k]!, 0) / total);
}

/** Linear pool, then sharpened by agreement (see the header). */
function pool(dists: readonly (readonly number[])[], w: number[], p: FusionPolicy): number[] {
  const d = dists.map((x) => [...x]);
  const mean = linear(d, w);
  if (d.length < 2) return mean;
  const total = w.reduce((a, b) => a + b, 0);
  const nEff = (total * total) / w.reduce((a, b) => a + b * b, 0);
  let agree = 0;
  let pairs = 0;
  for (let i = 0; i < d.length; i += 1)
    for (let j = i + 1; j < d.length; j += 1) {
      const pw = w[i]! * w[j]!;
      agree += pw * d[i]!.reduce((s, v, k) => s + v * d[j]![k]!, 0);
      pairs += pw;
    }
  const kappa = pairs > 0 ? agree / pairs : 0;
  const gamma = Math.min(p.maxSharpen, 1 + p.independence * (nEff - 1) * kappa * kappa);
  const sharp = mean.map((v) => Math.pow(v, gamma));
  const z = sharp.reduce((a, b) => a + b, 0);
  return z > 0 ? sharp.map((v) => v / z) : mean;
}
