// Offline tracking simulator — no camera, no model, no image pixels.
//
// A pinhole camera moves over the 15×15 board plane; each camera frame's TRUE
// grid quad is known exactly. A simulated tracker reports that quad with
// noise and with scripted faults (missing frames, weak correspondence, a slip
// of whole squares — the grid is periodic, which is exactly how a real
// tracker goes wrong — occlusion and motion blur metadata). The board lock
// (src/features/boardVision/boardLock.ts) runs on those measurements.
//
// An ORACLE recogniser stands in for Stage 1/2: for each square the lock
// believes it is cropping, it reports what is really at the TRUE board
// position the crop covers — so a mislocked grid produces genuinely
// wrong-square evidence, and the tests can show the gate keeps it out.
//
//   tests/board-vision-tracking.test.ts   asserts on these scenarios

import {
  DEFAULT_LOCK_POLICY,
  gateObservation,
  INITIAL_LOCK,
  lockStep,
  manualLock,
  type BoardLock,
  type FrameMeasurement,
  type LockPolicy,
} from "../../src/features/boardVision/boardLock";
import { CROP_CONTRACT } from "../../src/features/boardVision/crops";
import {
  applyHomography,
  BOARD_QUAD,
  boardToImage,
  invertHomography,
  type Point,
  type Quad,
} from "../../src/features/boardVision/geometry";
import {
  EvidenceAccumulator,
  tileClasses,
  type BoardObservation,
} from "../../src/features/boardVision/observation";
import { CELL_CLASSES, UNKNOWN, type CellClass } from "../../src/features/boardVision/vocabulary";

export const IMAGE = { width: 1280, height: 720 };

/** Camera pose over the board: look-at point (squares), yaw about the board normal,
 *  tilt away from top-down, distance (squares), focal length (px). */
export type Pose = {
  tx: number;
  ty: number;
  yaw: number;
  tilt: number;
  distance: number;
  focal: number;
};
export const BASE_POSE: Pose = { tx: 7.5, ty: 7.5, yaw: 0, tilt: 0, distance: 22, focal: 1000 };

export function project(pose: Pose, [x, y]: Point): Point {
  const px = x - pose.tx;
  const py = y - pose.ty;
  const cz = Math.cos(pose.yaw),
    sz = Math.sin(pose.yaw);
  const rx = cz * px - sz * py;
  const ry = sz * px + cz * py;
  const ct = Math.cos(pose.tilt),
    st = Math.sin(pose.tilt);
  const Y = ct * ry;
  const Z = st * ry + pose.distance;
  return [pose.focal * (rx / Z) + IMAGE.width / 2, pose.focal * (Y / Z) + IMAGE.height / 2];
}

export const trueQuad = (pose: Pose): Quad =>
  BOARD_QUAD.map((p) => project(pose, p)) as unknown as Quad;

export type FrameSpec = {
  pose: Pose;
  missing?: boolean;
  correspondence?: number;
  /** The tracker reports the grid shifted by this many squares (a periodic-grid slip). */
  slip?: [number, number];
  noisePx?: number;
  motionBlurPx?: number;
  occluded?: readonly number[]; // square indices covered (fully) in this frame
};
export type TrackScenario = { name: string; fps: number; frames: FrameSpec[] };

const lerp = (a: Pose, b: Pose, t: number): Pose =>
  Object.fromEntries(
    Object.keys(a).map((k) => [
      k,
      a[k as keyof Pose] + (b[k as keyof Pose] - a[k as keyof Pose]) * t,
    ]),
  ) as Pose;

/** `n` frames moving from pose `a` to pose `b`. */
export function move(
  a: Pose,
  b: Pose,
  n: number,
  extra: Omit<FrameSpec, "pose"> = {},
): FrameSpec[] {
  return Array.from({ length: n }, (_, i) => ({
    ...extra,
    pose: lerp(a, b, n === 1 ? 1 : i / (n - 1)),
  }));
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What the simulated tracker reports for frame `i`. */
export function measure(s: TrackScenario, i: number, seed = 1): FrameMeasurement {
  const f = s.frames[i]!;
  const r = rng(seed * 100003 + i);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());
  const [sx, sy] = f.slip ?? [0, 0];
  const sigma = f.noisePx ?? 0.5;
  const quad = f.missing
    ? null
    : (BOARD_QUAD.map(([x, y]) => {
        const [u, v] = project(f.pose, [x + sx, y + sy]);
        return [u + sigma * gauss(), v + sigma * gauss()] as Point;
      }) as unknown as Quad);
  const occlusion = f.occluded
    ? Array.from({ length: 225 }, (_, k) => (f.occluded!.includes(k) ? 1 : 0))
    : undefined;
  return {
    frameId: `${s.name}#${String(i).padStart(4, "0")}`,
    at: Math.round((i * 1000) / s.fps),
    image: IMAGE,
    quad,
    correspondence: f.correspondence ?? 0.97,
    ...(f.motionBlurPx !== undefined ? { motionBlurPx: f.motionBlurPx } : {}),
    ...(occlusion ? { occlusion } : {}),
  };
}

// ── scenarios ───────────────────────────────────────────────────────────
const P = BASE_POSE;
const deg = (d: number) => (d * Math.PI) / 180;
const hold = (n: number, extra: Omit<FrameSpec, "pose"> = {}, pose: Pose = P) =>
  move(pose, pose, n, extra);
const persp: Pose = { ...P, tilt: deg(45), distance: 20 };
const clipped: Pose = { ...P, tx: 18, distance: 24 }; // camera looks right: the board's left columns leave the frame

export const TRACK_SCENARIOS: TrackScenario[] = [
  { name: "stable", fps: 30, frames: hold(60) },
  { name: "translation", fps: 30, frames: [...hold(10), ...move(P, { ...P, tx: 9.5, ty: 6 }, 90)] },
  { name: "rotation", fps: 30, frames: [...hold(10), ...move(P, { ...P, yaw: deg(25) }, 90)] },
  { name: "perspective", fps: 30, frames: [...hold(10), ...move(P, persp, 90)] },
  {
    name: "zoom",
    fps: 30,
    frames: [
      ...hold(10),
      ...move(P, { ...P, distance: 15 }, 45),
      ...move({ ...P, distance: 15 }, { ...P, distance: 30 }, 60),
    ],
  },
  {
    name: "clipping",
    fps: 30,
    frames: [...hold(10), ...move(P, clipped, 60), ...hold(20, {}, clipped)],
  },
  {
    name: "extreme-perspective",
    fps: 30,
    frames: [...hold(10), ...move(P, { ...P, tilt: deg(70), distance: 18 }, 80)],
  },
  {
    name: "occlusion",
    fps: 30,
    frames: [...hold(20), ...hold(20, { occluded: [96, 97, 98, 111, 112, 113] }), ...hold(20)],
  },
  {
    name: "motion-blur",
    fps: 30,
    frames: [...hold(20), ...hold(15, { motionBlurPx: 12 }), ...hold(20)],
  },
  {
    name: "loss-recovery",
    fps: 30,
    frames: [...hold(20), ...hold(20, { missing: true }), ...hold(30, { correspondence: 0.95 })],
  },
  // after the loss the tracker re-finds a grid ONE SQUARE off and is unsure of it
  {
    name: "failed-recovery",
    fps: 30,
    frames: [
      ...hold(20),
      ...hold(20, { missing: true }),
      ...hold(40, { slip: [1, 0], correspondence: 0.7 }),
    ],
  },
  // mid-lock, the tracker slips one square along the periodic grid and still claims 0.85
  {
    name: "one-square-slip",
    fps: 30,
    frames: [...hold(30), ...hold(40, { slip: [1, 0], correspondence: 0.85 })],
  },
  {
    name: "sudden-jump",
    fps: 30,
    frames: [...hold(30), ...hold(1, {}, { ...P, tx: 7.5 - 0.7 }), ...hold(30)],
  },
  {
    name: "degrade-and-recover",
    fps: 30,
    frames: [...hold(20), ...hold(15, { correspondence: 0.6 }), ...hold(30)],
  },
];

export const scenario = (name: string) => TRACK_SCENARIOS.find((s) => s.name === name)!;

// ── the oracle recogniser and the canonical check ───────────────────────
export const SIM_CLASSES = CELL_CLASSES.filter((c) => c !== UNKNOWN);
export const ORACLE: BoardObservation["classifier"] = {
  modelVersion: "oracle-tracking",
  classes: SIM_CLASSES,
  topK: 3,
};

/** A physical board: which kind sits on which square (row-major), null = empty. */
export type TruthBoard = readonly (CellClass | null)[];

/** What a perfect recogniser would say, square by square, for crops cut through `quad`,
 *  when the grid is really at `truth`: whatever physically lies under each crop centre. */
export function oracleObservation(
  frameId: string,
  quad: Quad,
  truth: Quad,
  board: TruthBoard,
): BoardObservation {
  const lockH = boardToImage(quad);
  const back = invertHomography(boardToImage(truth));
  const tiles = tileClasses(ORACLE);
  const squares = Array.from({ length: 225 }, (_, i) => {
    const r = Math.floor(i / 15),
      c = i % 15;
    const [x, y] = applyHomography(back, applyHomography(lockH, [c + 0.5, r + 0.5]));
    const tr = Math.floor(y),
      tc = Math.floor(x);
    const kind = tr >= 0 && tr < 15 && tc >= 0 && tc < 15 ? (board[tr * 15 + tc] ?? null) : null;
    return kind === null
      ? { occupancy: 0.01, quality: 1 }
      : {
          occupancy: 0.99,
          identity: tiles.map((k) => (k === kind ? 0.97 : 0.03 / (tiles.length - 1))),
          quality: 1,
        };
  });
  return { frameId, source: "camera", classifier: ORACLE, quad, squares };
}

/** Canonical error of the lock: true square centres → image → the lock's canonical
 *  transform, against where they belong (pixels of the 780-px canonical board). */
export function canonicalError(lock: BoardLock, truth: Quad): { px: number[]; squares: number[] } {
  if (!lock.toCanonical) return { px: [], squares: [] };
  const toImage = boardToImage(truth);
  const { pxPerSquare: C, marginSquares: M } = CROP_CONTRACT;
  const px: number[] = [];
  for (let r = 0; r < 15; r += 1)
    for (let c = 0; c < 15; c += 1) {
      const [u, v] = applyHomography(
        lock.toCanonical,
        applyHomography(toImage, [c + 0.5, r + 0.5]),
      );
      px.push(Math.hypot(u - (c + 0.5 + M) * C, v - (r + 0.5 + M) * C));
    }
  return { px, squares: px.map((p) => p / C) };
}

// ── the loop: camera frames, lock, sparse inference, gated evidence ──────
export type RunOptions = {
  inferenceFps: number;
  latencyMs?: number;
  policy?: LockPolicy;
  /** Skip the gate (a control, to show what the gate prevents). */
  ungated?: boolean;
  seed?: number;
  /** Lock by hand on frame 0 (else the lock must go searching → candidate → locked). */
  manual?: boolean;
};
export type RunResult = {
  locks: BoardLock[];
  dispatched: string[];
  accepted: string[];
  rejected: string[];
  accumulator: EvidenceAccumulator;
  worstAcceptedSquares: number;
  /** Accepted observations in which some square's reading is NOT what lies on that square. */
  poisoned: string[];
};

export function run(s: TrackScenario, board: TruthBoard, o: RunOptions): RunResult {
  const policy = o.policy ?? DEFAULT_LOCK_POLICY;
  const acc = new EvidenceAccumulator();
  const locks: BoardLock[] = [];
  const dispatched: string[] = [];
  const accepted: string[] = [];
  const rejected: string[] = [];
  let lock = INITIAL_LOCK;
  let inFlight: { lock: BoardLock; truth: Quad; readyAt: number } | null = null;
  let lastDispatch = -Infinity;
  let worst = 0;
  const poisoned: string[] = [];
  const complete = (job: NonNullable<typeof inFlight>) => {
    const quad = job.lock.current ?? job.lock.anchor?.quad;
    if (!quad) return;
    const obs = oracleObservation(job.lock.frameId!, quad, job.truth, board);
    const gated = o.ungated ? obs : gateObservation(job.lock, obs);
    if (!gated) {
      rejected.push(job.lock.frameId!);
      return;
    }
    acc.add(gated);
    accepted.push(job.lock.frameId!);
    const tiles = tileClasses(ORACLE);
    const wrongSquare = gated.squares.some((sq, i) => {
      if (!sq) return false;
      const seen =
        sq.occupancy! < 0.5 ? null : tiles[sq.identity!.indexOf(Math.max(...sq.identity!))]!;
      return seen !== (board[i] ?? null);
    });
    if (wrongSquare) poisoned.push(job.lock.frameId!);
    const e = canonicalError(
      { ...job.lock, toCanonical: job.lock.toCanonical ?? null },
      job.truth,
    ).squares;
    worst = Math.max(worst, ...e);
  };
  for (let i = 0; i < s.frames.length; i += 1) {
    const m = measure(s, i, o.seed ?? 1);
    lock = i === 0 && o.manual !== false ? manualLock(m, policy) : lockStep(lock, m, policy);
    locks.push(lock);
    if (inFlight && m.at >= inFlight.readyAt) {
      complete(inFlight);
      inFlight = null;
    }
    const due = m.at - lastDispatch >= 1000 / o.inferenceFps;
    // Ungated control: dispatch whenever the tracker has a quad at all.
    const ready = o.ungated ? Boolean(m.quad) : lock.usableForInference;
    if (!inFlight && due && ready) {
      const snapshot =
        o.ungated && !lock.usableForInference && m.quad
          ? { ...lock, current: m.quad, usableForInference: true }
          : lock;
      inFlight = {
        lock: snapshot,
        truth: trueQuad(s.frames[i]!.pose),
        readyAt: m.at + (o.latencyMs ?? 120),
      };
      lastDispatch = m.at;
      dispatched.push(lock.frameId!);
    }
  }
  if (inFlight) complete(inFlight);
  return {
    locks,
    dispatched,
    accepted,
    rejected,
    accumulator: acc,
    worstAcceptedSquares: worst,
    poisoned,
  };
}
