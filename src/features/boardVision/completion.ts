// ── How complete is a scan? ─────────────────────────────────────────────────
//
// A board is not "done" or "not done". Each square is, separately:
//
//   unobserved   no usable view yet                                → needs a view
//   needsView    seen, but not enough independent good views       → needs a view
//   uncertain    well seen, and still visually ambiguous           → a person looks
//   sufficient   well seen and visually clear
//   excluded     a person set it aside (covered, off the board)
//
// so the scanner can say "198 / 225 sufficiently observed · 17 need another
// view · 10 visually uncertain" and point the camera where it helps.
//
// VISUAL only. Semantic / assignment ambiguity — a blank's face, a choice
// tile's face, more tiles of a kind than the set has — is decided by
// `reconstruct` on the evidence, not here; it is reported separately
// (`semantic`), and left null by this module.
//
// The policy has NO defaults on purpose: the thresholds that decide
// "enough" and "clear" belong to the recogniser in use and are to be set from
// its measured behaviour, not invented here.

import type { EvidenceAccumulator } from "./observation";
import { UNKNOWN, type CellClass } from "./vocabulary";

export type CompletionPolicy = {
  /** Independent views (groups) needed before a square counts as well seen. */
  minViews: number;
  /** Quality its best view needs. */
  minBestQuality: number;
  /** Probability of the leading reading needed to call it visually clear. */
  clearAt: number;
};

export type SquareStatus = "unobserved" | "needsView" | "uncertain" | "sufficient" | "excluded";

export type Completion = {
  squares: SquareStatus[];
  counts: Record<SquareStatus, number>;
  /** Squares still worth pointing the camera at (unobserved + needsView). */
  needAnotherView: number;
  /** Not assessed here: `reconstruct` flags faceUnresolved / overspent. */
  semantic: null;
};

export function assessCompletion(
  accumulator: EvidenceAccumulator,
  policy: CompletionPolicy,
  excluded: ReadonlySet<number> = new Set(),
): Completion {
  for (const k of ["minViews", "minBestQuality", "clearAt"] as const) {
    const v = policy[k];
    if (typeof v !== "number" || !Number.isFinite(v))
      throw new Error(`completion policy: ${k} must be a number`);
  }
  const evidence = accumulator.evidence();
  const squares = evidence.cells.map((cell, i): SquareStatus => {
    if (excluded.has(i)) return "excluded";
    const s = accumulator.cell(i);
    if (s.views === 0) return "unobserved";
    if (s.views < policy.minViews || s.bestQuality < policy.minBestQuality) return "needsView";
    let best: CellClass | null = null;
    let top = 0;
    for (const [c, lp] of Object.entries(cell.logProbabilities) as [CellClass, number][]) {
      const p = Math.exp(lp);
      if (p > top) {
        top = p;
        best = c;
      }
    }
    return best === UNKNOWN || top < policy.clearAt ? "uncertain" : "sufficient";
  });
  const counts: Record<SquareStatus, number> = {
    unobserved: 0,
    needsView: 0,
    uncertain: 0,
    sufficient: 0,
    excluded: 0,
  };
  for (const s of squares) counts[s] += 1;
  return { squares, counts, needAnotherView: counts.unobserved + counts.needsView, semantic: null };
}
