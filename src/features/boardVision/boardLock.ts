// ── Board lock: is this frame's geometry safe to read? ───────────────────────
//
// Between the camera and the recogniser sits one question, and only one:
// "WHERE is the same physical board in this frame, and is that alignment
// trustworthy enough to cut squares from?" This module answers it. It never
// looks at tile content, never classifies, never scores a reading.
//
// Its rule of thumb: a WRONG square is worse than NO square. Evidence put into
// the wrong board square poisons multi-frame fusion — a later correct view
// cannot outvote it cleanly — while a skipped frame costs only time. So every
// check here fails closed: when in doubt, the frame is not used.
//
//   SEARCHING ──quad──► CANDIDATE ──stable──► LOCKED ◄──stable──┐
//       ▲                    │                  │   ▲            │
//       │ timeout            │ manualLock ──────┘   │ recovers   │
//       │                    ▼                      │            │
//      LOST ◄──────────── DEGRADED ◄── geometry worsens / jump   │
//       │   board gone / too little visible                      │
//       └──re-identified──► RECOVERING ──consistent frames───────┘
//                                │ inconsistent / weak correspondence → LOST
//
// Inference is allowed ONLY in LOCKED, and only when every gate passes.
//
// The tracker itself (optical flow, feature matching against a keyframe) is
// NOT implemented: whatever produces `FrameMeasurement` — today the offline
// simulator — must report the quad AND its own correspondence confidence
// (how sure it is that these are the same physical corners as at lock time).
// Geometry cannot tell a grid shifted by exactly one square from the right
// one when the shift happens slowly; only correspondence can. See
// docs/board-vision/live-evidence.md.

import { BOARD_SIZE } from "../../constants/gameRules";
import { CROP_CONTRACT } from "./crops";
import {
  applyHomography,
  boardToImage,
  invertHomography,
  validateQuad,
  type Homography,
  type Point,
  type Quad,
} from "./geometry";
import type { BoardObservation } from "./observation";

export type TrackState = "searching" | "candidate" | "locked" | "degraded" | "lost" | "recovering";

/** What the (future) tracker reports for one camera frame. */
export type FrameMeasurement = {
  frameId: string;
  /** Milliseconds, monotonic. */
  at: number;
  image: { width: number; height: number };
  /** The grid corners found in this frame (reading 0), or null: not found. */
  quad: Quad | null;
  /** 0–1: the tracker's confidence that `quad` is the SAME physical grid, corner
   *  for corner, as the locked reference. Not a tile score. */
  correspondence: number;
  /** Estimated motion blur in image pixels, when the producer knows it. */
  motionBlurPx?: number;
  /** Per square (row-major, reading 0): covered fraction 0–1, when a separate
   *  occlusion detector supplies it. Geometry never guesses occlusion. */
  occlusion?: readonly number[];
};

/** Geometric safety policy. PROVISIONAL numbers, chosen conservatively;
 *  none is a recognition threshold. */
export type LockPolicy = {
  /** A square must be at least this much inside the image to be read (as recognize.ts). */
  minSquareVisible: number;
  /** Smallest projected side of a square, image px, for that square to be read. */
  minSquarePx: number;
  /** Largest / smallest projected square area on one board (perspective). */
  maxSquareAreaRatio: number;
  /** Interior corner angles of the quad, degrees. */
  minCornerAngle: number;
  maxCornerAngle: number;
  /** Squares readable / 225 needed to use a frame, and below which the lock is lost. */
  minVisibleFraction: number;
  lostVisibleFraction: number;
  /** Frame-to-frame motion of the grid, in squares: allowed = min(cap, base + speed · dt). */
  jumpBaseSquares: number;
  jumpSpeedSquaresPerSec: number;
  /** Hard cap. MUST stay below 0.5: a jump of half a square or more could land on a neighbour. */
  jumpCapSquares: number;
  /** Largest relative change of the quad's shape (side-length ratios) between frames. */
  maxShapeChange: number;
  /** Motion blur allowed, as a fraction of the median square side. */
  maxBlurFraction: number;
  minCorrespondence: number;
  recoverCorrespondence: number;
  lostCorrespondence: number;
  stableFrames: number;
  recoverFrames: number;
  lostFrames: number;
  lostTimeoutMs: number;
  /** Covered fraction above which a square is not read (with an occlusion mask). */
  maxOcclusion: number;
};

export const DEFAULT_LOCK_POLICY: LockPolicy = {
  minSquareVisible: 0.85,
  minSquarePx: 16,
  maxSquareAreaRatio: 6,
  minCornerAngle: 35,
  maxCornerAngle: 145,
  minVisibleFraction: 0.2,
  lostVisibleFraction: 0.05,
  jumpBaseSquares: 0.1,
  jumpSpeedSquaresPerSec: 4,
  jumpCapSquares: 0.45,
  maxShapeChange: 0.15,
  maxBlurFraction: 0.1,
  minCorrespondence: 0.8,
  recoverCorrespondence: 0.9,
  lostCorrespondence: 0.3,
  stableFrames: 5,
  recoverFrames: 5,
  lostFrames: 8,
  lostTimeoutMs: 4000,
  maxOcclusion: 0.3,
};

export type CellReason = "clipped" | "tooSmall" | "occluded" | "noGeometry";

/** Per square: may the evidence layer receive an observation of it from this frame? */
export type CellMask = {
  eligible: readonly boolean[];
  visibility: readonly number[];
  reason: readonly (CellReason | null)[];
};

export type GeometryReport = {
  ok: boolean;
  reasons: string[];
  checks: {
    convex: boolean;
    minSquarePx: number;
    medianSquarePx: number;
    squareAreaRatio: number;
    cornerAngles: number[];
    visibleFraction: number;
    /** Squares the grid moved since the previous frame (null: no previous). */
    jumpSquares: number | null;
    allowedJumpSquares: number | null;
    shapeChange: number | null;
  };
};

export type BoardLock = {
  state: TrackState;
  frameId: string | null;
  at: number | null;
  /** The quad the lock was made on (acquisition). */
  reference: Quad | null;
  /** This frame's quad — only when the frame is usable for inference. */
  current: Quad | null;
  /** The quad last BELIEVED to be the board, and when: the next frame's motion reference. */
  anchor: { quad: Quad; at: number } | null;
  /** Image → canonical board pixels (the 780 × 780 rectified board of crops.ts). */
  toCanonical: Homography | null;
  trackingConfidence: number;
  geometry: GeometryReport | null;
  visibleFraction: number;
  cells: CellMask;
  usableForInference: boolean;
  reason: string | null;
  /** Consecutive frames counted toward the next transition, and when the lock was lost. */
  streak: number;
  misses: number;
  lostAt: number | null;
};

const NO_CELLS: CellMask = {
  eligible: Array<boolean>(225).fill(false),
  visibility: Array<number>(225).fill(0),
  reason: Array<CellReason | null>(225).fill("noGeometry"),
};

export const INITIAL_LOCK: BoardLock = {
  state: "searching",
  frameId: null,
  at: null,
  reference: null,
  current: null,
  anchor: null,
  toCanonical: null,
  trackingConfidence: 0,
  geometry: null,
  visibleFraction: 0,
  cells: NO_CELLS,
  usableForInference: false,
  reason: "no board locked",
  streak: 0,
  misses: 0,
  lostAt: null,
};

// ── geometry checks ────────────────────────────────────────────────────────

const N = BOARD_SIZE;

/** Board coordinates → canonical board pixels (crops.ts: pixel = (board + M) · C). */
export function boardToCanonical(): Homography {
  const { pxPerSquare: C, marginSquares: M } = CROP_CONTRACT;
  return [C, 0, C * M, 0, C, C * M, 0, 0, 1];
}

function compose(a: Homography, b: Homography): Homography {
  // a ∘ b (apply b first)
  const m = (i: number, j: number) =>
    a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
  const out = [m(0, 0), m(0, 1), m(0, 2), m(1, 0), m(1, 1), m(1, 2), m(2, 0), m(2, 1), m(2, 2)];
  return out.map((v) => v / out[8]!);
}

/** Image → canonical pixels for a grid seen through `quad`. */
export function imageToCanonical(quad: Quad): Homography {
  return compose(boardToCanonical(), invertHomography(boardToImage(quad)));
}

/** Per square: fraction inside the image, and its smallest projected side (px). */
export function squareGeometry(quad: Quad, width: number, height: number) {
  const h = boardToImage(quad);
  const grid: Point[][] = [];
  for (let r = 0; r <= N; r += 1) {
    grid.push([]);
    for (let c = 0; c <= N; c += 1) grid[r]!.push(applyHomography(h, [c, r]));
  }
  const visibility: number[] = [];
  const side: number[] = [];
  const area: number[] = [];
  for (let r = 0; r < N; r += 1)
    for (let c = 0; c < N; c += 1) {
      let inside = 0;
      for (let i = 0; i < 5; i += 1)
        for (let j = 0; j < 5; j += 1) {
          const [x, y] = applyHomography(h, [c + 0.1 + 0.2 * i, r + 0.1 + 0.2 * j]);
          if (x >= 0 && y >= 0 && x < width && y < height) inside += 1;
        }
      visibility.push(inside / 25);
      const p = [grid[r]![c]!, grid[r]![c + 1]!, grid[r + 1]![c + 1]!, grid[r + 1]![c]!];
      side.push(
        Math.min(
          ...p.map((a, k) => Math.hypot(p[(k + 1) % 4]![0] - a[0], p[(k + 1) % 4]![1] - a[1])),
        ),
      );
      area.push(
        Math.abs(
          p.reduce((s, a, k) => s + a[0] * p[(k + 1) % 4]![1] - p[(k + 1) % 4]![0] * a[1], 0),
        ) / 2,
      );
    }
  return { visibility, side, area };
}

function cornerAngles(q: Quad): number[] {
  return q.map((p, i) => {
    const a = q[(i + 3) % 4]!;
    const b = q[(i + 1) % 4]!;
    const u = [a[0] - p[0], a[1] - p[1]];
    const v = [b[0] - p[0], b[1] - p[1]];
    const cos =
      (u[0]! * v[0]! + u[1]! * v[1]!) / (Math.hypot(u[0]!, u[1]!) * Math.hypot(v[0]!, v[1]!));
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  });
}

/** How far (in squares of the PREVIOUS frame's grid) the grid's corners moved. */
export function jumpSquares(previous: Quad, current: Quad): number {
  const back = invertHomography(boardToImage(previous));
  return Math.max(
    ...current.map((p, i) => {
      const [x, y] = applyHomography(back, p);
      return Math.hypot(x - BOARD_QUAD_POINTS[i]![0], y - BOARD_QUAD_POINTS[i]![1]);
    }),
  );
}
const BOARD_QUAD_POINTS: Point[] = [
  [0, 0],
  [N, 0],
  [N, N],
  [0, N],
];

function shapeChange(previous: Quad, current: Quad): number {
  const sides = (q: Quad) =>
    q.map((p, i) => Math.hypot(q[(i + 1) % 4]![0] - p[0], q[(i + 1) % 4]![1] - p[1]));
  const a = sides(previous);
  const b = sides(current);
  const ratio = (s: number[]) => [s[0]! / s[2]!, s[1]! / s[3]!, s[0]! / s[1]!];
  return Math.max(...ratio(a).map((v, i) => Math.abs(Math.log(ratio(b)[i]! / v))));
}

/** Deterministic geometric safety checks for one quad (and its motion since `previous`). */
export function assessGeometry(
  quad: Quad,
  image: { width: number; height: number },
  policy: LockPolicy = DEFAULT_LOCK_POLICY,
  previous?: { quad: Quad; at: number },
  at?: number,
  occlusion?: readonly number[],
): { report: GeometryReport; cells: CellMask } {
  const reasons: string[] = [];
  let convex = true;
  try {
    validateQuad(quad);
  } catch {
    convex = false;
    reasons.push("crossed, mirrored or non-convex quad");
  }
  const angles = cornerAngles(quad);
  if (!convex) {
    return {
      report: {
        ok: false,
        reasons,
        checks: {
          convex,
          minSquarePx: 0,
          medianSquarePx: 0,
          squareAreaRatio: Infinity,
          cornerAngles: angles,
          visibleFraction: 0,
          jumpSquares: null,
          allowedJumpSquares: null,
          shapeChange: null,
        },
      },
      cells: NO_CELLS,
    };
  }
  const g = squareGeometry(quad, image.width, image.height);
  const sortedSide = [...g.side].sort((a, b) => a - b);
  const median = sortedSide[112]!;
  const areaRatio = Math.max(...g.area) / Math.max(Math.min(...g.area), 1e-9);
  const reason: (CellReason | null)[] = g.visibility.map((v, i) =>
    v < policy.minSquareVisible
      ? "clipped"
      : g.side[i]! < policy.minSquarePx
        ? "tooSmall"
        : occlusion && (occlusion[i] ?? 0) > policy.maxOcclusion
          ? "occluded"
          : null,
  );
  const eligible = reason.map((r) => r === null);
  const visibleFraction = eligible.filter(Boolean).length / 225;
  if (areaRatio > policy.maxSquareAreaRatio)
    reasons.push(`extreme perspective (square areas differ ${areaRatio.toFixed(1)}×)`);
  if (angles.some((a) => a < policy.minCornerAngle || a > policy.maxCornerAngle))
    reasons.push("extreme corner angle");
  if (median < policy.minSquarePx)
    reasons.push(`board too small (${median.toFixed(1)} px per square)`);
  if (visibleFraction < policy.minVisibleFraction)
    reasons.push(`too little of the board readable (${Math.round(visibleFraction * 225)} squares)`);
  let jump: number | null = null;
  let allowed: number | null = null;
  let shape: number | null = null;
  if (previous) {
    const dt = Math.max(0, ((at ?? previous.at) - previous.at) / 1000);
    allowed = Math.min(
      policy.jumpCapSquares,
      policy.jumpBaseSquares + policy.jumpSpeedSquaresPerSec * dt,
    );
    try {
      jump = jumpSquares(previous.quad, quad);
      shape = shapeChange(previous.quad, quad);
    } catch {
      jump = Infinity;
      shape = Infinity;
    }
    if (jump > allowed)
      reasons.push(`implausible jump (${jump.toFixed(2)} squares, allowed ${allowed.toFixed(2)})`);
    if (shape > policy.maxShapeChange) reasons.push("unstable homography (shape changed too fast)");
  }
  return {
    report: {
      ok: reasons.length === 0,
      reasons,
      checks: {
        convex,
        minSquarePx: sortedSide[0]!,
        medianSquarePx: median,
        squareAreaRatio: areaRatio,
        cornerAngles: angles,
        visibleFraction,
        jumpSquares: jump,
        allowedJumpSquares: allowed,
        shapeChange: shape,
      },
    },
    cells: { eligible, visibility: g.visibility, reason },
  };
}

// ── the lock state machine ─────────────────────────────────────────────────

type Assessment = ReturnType<typeof assessGeometry>;

/** A person (or a future detector + confirmation) says: this quad is the board. */
export function manualLock(
  m: FrameMeasurement,
  policy: LockPolicy = DEFAULT_LOCK_POLICY,
): BoardLock {
  if (!m.quad) return { ...INITIAL_LOCK, reason: "no quad to lock" };
  const a = assessGeometry(m.quad, m.image, policy, undefined, m.at, m.occlusion);
  if (!a.report.ok)
    return { ...INITIAL_LOCK, geometry: a.report, reason: `cannot lock: ${a.report.reasons[0]}` };
  return settle(
    { ...INITIAL_LOCK, state: "locked", reference: m.quad, streak: policy.stableFrames },
    m,
    a,
    1,
    policy,
    { quad: m.quad, at: m.at },
  );
}

/**
 * Write one frame's outcome. `anchor` is the quad now BELIEVED to be the board
 * (and when): the reference for the next frame's motion check. A frame is
 * usable only in LOCKED with every gate passed; otherwise it gets no canonical
 * transform and no eligible squares, whatever its geometry.
 */
function settle(
  base: BoardLock,
  m: FrameMeasurement,
  a: Assessment | null,
  correspondence: number,
  policy: LockPolicy,
  anchor: { quad: Quad; at: number } | null,
  why?: string,
): BoardLock {
  const report = a?.report ?? null;
  const blurOk =
    m.motionBlurPx === undefined ||
    !report ||
    m.motionBlurPx <= policy.maxBlurFraction * report.checks.medianSquarePx;
  const corrOk = correspondence >= policy.minCorrespondence;
  const usable = Boolean(base.state === "locked" && report?.ok && m.quad && blurOk && corrOk);
  const reason = usable
    ? null
    : (why ??
      (base.state !== "locked"
        ? `state: ${base.state}`
        : !report
          ? "no board in this frame"
          : !report.ok
            ? report.reasons[0]!
            : !blurOk
              ? "motion blur"
              : !corrOk
                ? "weak correspondence"
                : "unsafe"));
  const mask = a?.cells ?? NO_CELLS;
  return {
    ...base,
    frameId: m.frameId,
    at: m.at,
    current: usable ? m.quad : null,
    anchor,
    toCanonical: usable ? imageToCanonical(m.quad!) : null,
    trackingConfidence: correspondence,
    geometry: report,
    visibleFraction: report?.checks.visibleFraction ?? 0,
    // geometry's own view of every square, but nothing is eligible unless the frame is usable
    cells: {
      visibility: mask.visibility,
      reason: mask.reason,
      eligible: usable ? mask.eligible : NO_CELLS.eligible,
    },
    usableForInference: usable,
    reason,
  };
}

/** Advance the lock by one camera frame. Pure. */
export function lockStep(
  lock: BoardLock,
  m: FrameMeasurement,
  policy: LockPolicy = DEFAULT_LOCK_POLICY,
): BoardLock {
  const corr = m.quad ? m.correspondence : 0;
  const assess = (withAnchor: boolean): Assessment | null =>
    m.quad
      ? assessGeometry(
          m.quad,
          m.image,
          policy,
          withAnchor && lock.anchor ? lock.anchor : undefined,
          m.at,
          m.occlusion,
        )
      : null;
  const go = (
    state: TrackState,
    patch: Partial<BoardLock>,
    a: Assessment | null,
    anchor: BoardLock["anchor"],
    why?: string,
  ) => settle({ ...lock, ...patch, state }, m, a, corr, policy, anchor, why);
  const here = () => ({ quad: m.quad!, at: m.at });
  const motionRefused = (a: Assessment) =>
    !a.report.checks.convex ||
    a.report.reasons.some((r) => r.startsWith("implausible jump") || r.startsWith("unstable"));

  switch (lock.state) {
    case "searching": {
      const a = assess(false);
      if (!a?.report.ok) return go("searching", { streak: 0 }, a, null, "no usable board");
      return go("candidate", { streak: 1 }, a, here());
    }
    case "candidate": {
      const a = assess(true);
      if (!a?.report.ok) return go("searching", { streak: 0 }, a, null, "candidate not stable");
      const streak = lock.streak + 1;
      return streak >= policy.stableFrames
        ? go("locked", { streak, reference: m.quad, misses: 0 }, a, here())
        : go("candidate", { streak }, a, here());
    }
    case "locked":
    case "degraded": {
      const miss = (why: string, a: Assessment | null) => {
        const misses = lock.misses + 1;
        return misses >= policy.lostFrames
          ? go("lost", { misses, streak: 0, lostAt: m.at }, a, null, why)
          : go("degraded", { misses, streak: 0 }, a, lock.anchor, why); // keep the last believed quad
      };
      if (!m.quad || corr < policy.lostCorrespondence)
        return miss("board not found in this frame", null);
      const a = assess(true)!;
      if (motionRefused(a)) return miss(a.report.reasons[0] ?? "motion refused", a); // a slip is never believed
      if (a.report.checks.visibleFraction < policy.lostVisibleFraction)
        return go("lost", { streak: 0, lostAt: m.at }, a, null, "board out of view");
      if (!a.report.ok || corr < policy.minCorrespondence)
        return go("degraded", { streak: 0, misses: 0 }, a, here()); // believed position, not safe to read
      if (lock.state === "degraded") {
        const streak = lock.streak + 1;
        return streak >= policy.recoverFrames
          ? go("locked", { streak, misses: 0 }, a, here())
          : go("degraded", { streak, misses: 0 }, a, here());
      }
      return go("locked", { streak: lock.streak + 1, misses: 0 }, a, here());
    }
    case "lost": {
      if (lock.lostAt !== null && m.at - lock.lostAt >= policy.lostTimeoutMs)
        return {
          ...INITIAL_LOCK,
          frameId: m.frameId,
          at: m.at,
          reason: "lost too long: acquire the board again",
        };
      const a = assess(false);
      if (!a?.report.ok || corr < policy.recoverCorrespondence)
        return go("lost", {}, a, null, "board not re-identified");
      return go("recovering", { streak: 1, misses: 0 }, a, here());
    }
    case "recovering": {
      const a = assess(true);
      if (!a?.report.ok || corr < policy.recoverCorrespondence)
        return go("lost", { streak: 0, lostAt: lock.lostAt ?? m.at }, a, null, "recovery failed");
      const streak = lock.streak + 1;
      return streak >= policy.recoverFrames
        ? go("locked", { streak, misses: 0 }, a, here())
        : go("recovering", { streak }, a, here());
    }
  }
}

// ── the evidence boundary ──────────────────────────────────────────────────

/**
 * What the evidence layer may receive from a recognised frame: `null` unless
 * the lock AT THAT FRAME was usable and the observation was cut through that
 * lock's own quad; otherwise every square the lock did not make eligible is
 * blanked (`null` = no evidence, never "empty").
 *
 * Recognition is slower than the camera, so the caller keeps the lock snapshot
 * of the frame it sent to the recogniser and passes it here when the result
 * arrives — never the lock as it is by then.
 */
export function gateObservation(
  snapshot: BoardLock,
  observation: BoardObservation,
): BoardObservation | null {
  if (!snapshot.usableForInference || !snapshot.current) return null;
  if (snapshot.frameId !== observation.frameId) return null;
  const same = snapshot.current.every(
    (p, i) => Math.hypot(p[0] - observation.quad[i]![0], p[1] - observation.quad[i]![1]) < 1e-6,
  );
  if (!same) return null;
  return {
    ...observation,
    squares: observation.squares.map((s, i) => (snapshot.cells.eligible[i] ? s : null)),
  };
}
