// Board lock / tracking policy: geometry gating for the future live scanner.
//
// No camera and no model: tools/vision/trackingSimulator.ts moves a pinhole
// camera over the board with known ground truth and scripted tracker faults;
// an oracle recogniser reads whatever TRULY lies under each crop, so a
// mislocked grid produces real wrong-square evidence. The rule under test:
// a wrong square is worse than no square.
import { describe, expect, it } from "vitest";

import {
  assessGeometry,
  DEFAULT_LOCK_POLICY,
  gateObservation,
  INITIAL_LOCK,
  jumpSquares,
  lockStep,
  manualLock,
  type BoardLock,
  type FrameMeasurement,
} from "../src/features/boardVision/boardLock";
import type { Quad } from "../src/features/boardVision/geometry";
import type { CellClass } from "../src/features/boardVision/vocabulary";
import {
  BASE_POSE,
  canonicalError,
  IMAGE,
  measure,
  move,
  oracleObservation,
  run,
  scenario,
  TRACK_SCENARIOS,
  trueQuad,
  type TrackScenario,
  type TruthBoard,
} from "../tools/vision/trackingSimulator";

const BOARD: TruthBoard = (() => {
  const b: (CellClass | null)[] = Array(225).fill(null);
  (["1", "2", "=", "3", "+", "4", "=", "7", "x"] as CellClass[]).forEach(
    (k, j) => (b[7 * 15 + 3 + j] = k),
  );
  (["9", "-", "5", "=", "4"] as CellClass[]).forEach((k, j) => (b[(3 + j) * 15 + 6] = k));
  b[0] = "12";
  b[224] = "?";
  return b;
})();

function trace(s: TrackScenario): BoardLock[] {
  let lock = INITIAL_LOCK;
  return s.frames.map((_, i) => {
    const m = measure(s, i);
    lock = i === 0 ? manualLock(m) : lockStep(lock, m);
    return lock;
  });
}
const m = (quad: Quad | null, at = 0, extra: Partial<FrameMeasurement> = {}): FrameMeasurement => ({
  frameId: `f${at}`,
  at,
  image: IMAGE,
  quad,
  correspondence: 0.97,
  ...extra,
});
const QUAD = trueQuad(BASE_POSE);

/** Evidence equals the truth on every square that has any. */
function readsTruth(r: ReturnType<typeof run>): { wrong: number[]; observed: number } {
  const ev = r.accumulator.evidence().cells;
  const wrong: number[] = [];
  let observed = 0;
  ev.forEach((cell, i) => {
    if (cell.observations === 0) return;
    observed += 1;
    const lead = Object.entries(cell.logProbabilities).sort((a, b) => b[1]! - a[1]!)[0]![0];
    if (lead !== (BOARD[i] ?? "empty")) wrong.push(i);
  });
  return { wrong, observed };
}

describe("geometric safety checks", () => {
  it("accepts a normal board and makes every square eligible", () => {
    const { report, cells } = assessGeometry(QUAD, IMAGE);
    expect(report.ok).toBe(true);
    expect(cells.eligible.every(Boolean)).toBe(true);
    expect(report.checks.medianSquarePx).toBeGreaterThan(40);
  });

  it("refuses crossed and mirrored quads", () => {
    const [tl, tr, br, bl] = QUAD;
    expect(assessGeometry([tl, bl, br, tr], IMAGE).report.reasons[0]).toMatch(/crossed, mirrored/);
    expect(assessGeometry([tl, br, tr, bl], IMAGE).report.ok).toBe(false);
    expect(assessGeometry([tl, bl, br, tr], IMAGE).cells.eligible.some(Boolean)).toBe(false);
  });

  it("refuses a board too small to read, and extreme perspective", () => {
    const tiny: Quad = [
      [600, 300],
      [700, 300],
      [700, 400],
      [600, 400],
    ];
    expect(assessGeometry(tiny, IMAGE).report.reasons.join()).toMatch(/too small/);
    const extreme = trueQuad({ ...BASE_POSE, tilt: (72 * Math.PI) / 180, distance: 18 });
    expect(assessGeometry(extreme, IMAGE).report.ok).toBe(false);
  });

  it("clipping: squares out of frame are ineligible, the rest stay usable", () => {
    const q = trueQuad({ ...BASE_POSE, tx: 18, distance: 24 });
    const { report, cells } = assessGeometry(q, IMAGE);
    expect(report.ok).toBe(true);
    const col = (c: number) => Array.from({ length: 15 }, (_, r) => cells.eligible[r * 15 + c]);
    expect(col(0).some(Boolean)).toBe(false); // the left edge left the frame
    expect(col(14).every(Boolean)).toBe(true);
    expect(cells.reason.filter((r) => r === "clipped").length).toBeGreaterThan(15);
  });

  it("occlusion is masked only when a mask is supplied — geometry never guesses a hand", () => {
    const covered = Array.from({ length: 225 }, (_, i) => (i === 112 ? 0.9 : i === 113 ? 0.1 : 0));
    expect(assessGeometry(QUAD, IMAGE).cells.eligible[112]).toBe(true);
    const { cells } = assessGeometry(QUAD, IMAGE, DEFAULT_LOCK_POLICY, undefined, 0, covered);
    expect([cells.eligible[112], cells.reason[112]]).toEqual([false, "occluded"]);
    expect(cells.eligible[113]).toBe(true);
  });

  it("the jump cap stays below half a square for ANY frame gap (a neighbour square is never reachable)", () => {
    expect(DEFAULT_LOCK_POLICY.jumpCapSquares).toBeLessThan(0.5);
    for (const dt of [16, 33, 100, 500, 5000]) {
      const r = assessGeometry(QUAD, IMAGE, DEFAULT_LOCK_POLICY, { quad: QUAD, at: 0 }, dt).report;
      expect(r.checks.allowedJumpSquares!).toBeLessThan(0.5);
    }
  });

  it("measures a one-square shift as a jump of one square", () => {
    const shifted = trueQuad({ ...BASE_POSE, tx: BASE_POSE.tx - 1 });
    expect(jumpSquares(QUAD, shifted)).toBeCloseTo(1, 1);
  });
});

describe("the lock state machine", () => {
  it("stable lock: every frame LOCKED and usable", () => {
    const t = trace(scenario("stable"));
    expect(t.every((l) => l.state === "locked" && l.usableForInference)).toBe(true);
  });

  it.each(["translation", "rotation", "perspective", "zoom", "clipping", "occlusion"])(
    "%s: stays LOCKED and usable while the phone moves",
    (name) => {
      const t = trace(scenario(name));
      expect(t.filter((l) => l.usableForInference).length).toBe(t.length);
    },
  );

  it("acquires without a manual lock: SEARCHING → CANDIDATE → LOCKED after stable frames", () => {
    const s = scenario("stable");
    let lock = INITIAL_LOCK;
    const states = s.frames.slice(0, 8).map((_, i) => (lock = lockStep(lock, measure(s, i))).state);
    expect(states.slice(0, 5)).toEqual([
      "candidate",
      "candidate",
      "candidate",
      "candidate",
      "locked",
    ]);
    expect(lock.usableForInference).toBe(true);
  });

  it("extreme perspective: gated off, never read", () => {
    const t = trace(scenario("extreme-perspective"));
    const bad = t.filter(
      (l) => (l.geometry?.checks.squareAreaRatio ?? 0) > DEFAULT_LOCK_POLICY.maxSquareAreaRatio,
    );
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.every((l) => !l.usableForInference)).toBe(true);
  });

  it("motion blur: stays LOCKED but inference is gated off", () => {
    const t = trace(scenario("motion-blur"));
    const blurred = t.slice(20, 35);
    expect(
      blurred.every(
        (l) => l.state === "locked" && !l.usableForInference && l.reason === "motion blur",
      ),
    ).toBe(true);
    expect(t.slice(35).every((l) => l.usableForInference)).toBe(true);
  });

  it("sudden jump: the jumped frame is refused, the last believed quad kept, and the lock returns", () => {
    const t = trace(scenario("sudden-jump"));
    expect(t[30]!.usableForInference).toBe(false);
    expect(t[30]!.reason).toMatch(/implausible jump/);
    expect(t[30]!.anchor!.quad).toEqual(t[29]!.anchor!.quad);
    expect(t[t.length - 1]!.state).toBe("locked");
  });

  it("temporary loss: LOCKED → DEGRADED → LOST → RECOVERING → LOCKED, reading nothing in between", () => {
    const t = trace(scenario("loss-recovery"));
    const seq = t.map((l) => l.state).filter((s, i, a) => i === 0 || s !== a[i - 1]);
    expect(seq).toEqual(["locked", "degraded", "lost", "recovering", "locked"]);
    expect(t.filter((l) => l.state !== "locked").every((l) => !l.usableForInference)).toBe(true);
  });

  it("failed recovery: a grid re-found one square off, with weak correspondence, is never locked", () => {
    const t = trace(scenario("failed-recovery"));
    expect(t.slice(20).every((l) => !l.usableForInference)).toBe(true);
    expect(t[t.length - 1]!.state).toBe("lost");
  });

  it("lost too long: back to SEARCHING (the board must be acquired again)", () => {
    const s: TrackScenario = {
      name: "gone",
      fps: 30,
      frames: [
        ...move(BASE_POSE, BASE_POSE, 10),
        ...move(BASE_POSE, BASE_POSE, 160, { missing: true }),
      ],
    };
    const t = trace(s);
    expect(t[t.length - 1]!.state).toBe("searching");
    expect(t[t.length - 1]!.reference).toBeNull();
  });

  it("weak correspondence degrades; strong correspondence brings the lock back", () => {
    const t = trace(scenario("degrade-and-recover"));
    expect(t.slice(20, 35).every((l) => !l.usableForInference)).toBe(true);
    expect(t[t.length - 1]!.usableForInference).toBe(true);
  });
});

describe("wrong square is worse than no square", () => {
  it("a mid-lock one-square slip is refused, and the evidence stays true", () => {
    const t = trace(scenario("one-square-slip"));
    expect(t.slice(30).every((l) => !l.usableForInference)).toBe(true);
    const r = run(scenario("one-square-slip"), BOARD, { inferenceFps: 8 });
    expect(r.accepted.length).toBeGreaterThan(0);
    expect(r.poisoned).toEqual([]);
    expect(readsTruth(r).wrong).toEqual([]);
  });

  it("without the gate the same slip delivers wrong-square observations (the control)", () => {
    const r = run(scenario("one-square-slip"), BOARD, { inferenceFps: 8, ungated: true });
    expect(r.poisoned.length).toBeGreaterThan(0);
    // Fusion alone happened to hide them here (three earlier correct views held every
    // square's slots) — that is not protection: a square seen only after a slip would
    // take the wrong reading. The gate is what keeps them out.
  });

  it("a failed recovery onto the neighbouring square adds no evidence", () => {
    const r = run(scenario("failed-recovery"), BOARD, { inferenceFps: 8 });
    expect(readsTruth(r).wrong).toEqual([]);
    expect(
      run(scenario("failed-recovery"), BOARD, { inferenceFps: 8, ungated: true }).accepted.length,
    ).toBeGreaterThan(r.accepted.length);
  });

  it("every accepted observation, in every scenario, was cut within 0.1 square of the truth", () => {
    for (const s of TRACK_SCENARIOS) {
      const r = run(s, BOARD, { inferenceFps: 8 });
      expect(r.poisoned, s.name).toEqual([]);
      expect(r.worstAcceptedSquares, s.name).toBeLessThan(0.1);
      expect(readsTruth(r).wrong, s.name).toEqual([]);
    }
  });
});

describe("the evidence boundary", () => {
  const lock = manualLock(m(QUAD, 0));
  const obs = oracleObservation("f0", QUAD, QUAD, BOARD);

  it("passes an observation cut through the usable lock of its own frame", () => {
    const g = gateObservation(lock, obs)!;
    expect(g).not.toBeNull();
    expect(g.squares.every((s) => s !== null)).toBe(true);
  });

  it("refuses a different frame's lock, a different quad, and any unusable lock", () => {
    expect(gateObservation({ ...lock, frameId: "f1" }, obs)).toBeNull();
    const moved = QUAD.map(([x, y]) => [x + 3, y]) as unknown as Quad;
    expect(gateObservation(lock, { ...obs, quad: moved })).toBeNull();
    expect(gateObservation({ ...lock, usableForInference: false }, obs)).toBeNull();
    expect(gateObservation(INITIAL_LOCK, obs)).toBeNull();
  });

  it("blanks ineligible squares to NO evidence — never to empty", () => {
    const q = trueQuad({ ...BASE_POSE, tx: 18, distance: 24 });
    const clippedLock = manualLock(m(q, 0));
    const g = gateObservation(clippedLock, oracleObservation("f0", q, q, BOARD))!;
    const left = Array.from({ length: 15 }, (_, r) => g.squares[r * 15]);
    expect(left.every((s) => s === null)).toBe(true);
  });
});

describe("tracking loss does not damage evidence", () => {
  it("evidence from before the loss survives it, and recovered frames keep adding", () => {
    const s = scenario("loss-recovery");
    const r = run(s, BOARD, { inferenceFps: 8 });
    const before = r.accepted.filter((id) => Number(id.split("#")[1]) < 20);
    const during = r.accepted.filter((id) => {
      const n = Number(id.split("#")[1]);
      return n >= 20 && n < 44;
    });
    const after = r.accepted.filter((id) => Number(id.split("#")[1]) >= 44);
    expect(before.length).toBeGreaterThan(0);
    expect(during).toEqual([]);
    expect(after.length).toBeGreaterThan(0);
    expect(readsTruth(r).wrong).toEqual([]);
    expect(readsTruth(r).observed).toBe(225);
  });

  it("LOCKED accepted, DEGRADED / LOST / RECOVERING refused — by the gate itself", () => {
    const t = trace(scenario("loss-recovery"));
    for (const l of t) {
      const obs = l.current ? oracleObservation(l.frameId!, l.current, l.current, BOARD) : null;
      if (l.state === "locked" && l.usableForInference)
        expect(gateObservation(l, obs!)).not.toBeNull();
      else if (obs) expect(gateObservation(l, obs)).toBeNull();
    }
  });
});

describe("camera FPS ≠ inference FPS", () => {
  it("the lock's geometric state is the same whatever the inference rate", () => {
    const s = scenario("loss-recovery");
    const runs = [2, 4, 8].map((fps) => run(s, BOARD, { inferenceFps: fps }));
    const key = (r: ReturnType<typeof run>) =>
      r.locks.map((l) => `${l.state}|${l.usableForInference}|${l.current?.join()}`).join("\n");
    expect(key(runs[1]!)).toBe(key(runs[0]!));
    expect(key(runs[2]!)).toBe(key(runs[0]!));
    expect(runs[0]!.dispatched.length).toBeLessThan(runs[2]!.dispatched.length); // fewer recognitions…
    runs.forEach((r) => expect(readsTruth(r).wrong).toEqual([])); // …never a wrong square
  });

  it("a result arriving after the lock was lost is judged by the lock of ITS frame", () => {
    // inference latency longer than the time to lose the board
    const r = run(scenario("loss-recovery"), BOARD, { inferenceFps: 8, latencyMs: 600 });
    expect(readsTruth(r).wrong).toEqual([]);
    expect(
      r.accepted.every((id) => r.locks.find((l) => l.frameId === id)!.usableForInference),
    ).toBe(true);
  });
});

describe("canonical consistency (780-px canonical board, 50 px per square)", () => {
  it.each([
    "stable",
    "translation",
    "rotation",
    "perspective",
    "zoom",
    "clipping",
    "loss-recovery",
  ])("%s: usable frames map true square centres within 0.1 square", (name) => {
    const s = scenario(name);
    const t = trace(s);
    const errs = t.flatMap((l, i) =>
      l.usableForInference ? canonicalError(l, trueQuad(s.frames[i]!.pose)).squares : [],
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(Math.max(...errs)).toBeLessThan(0.1);
  });
});
