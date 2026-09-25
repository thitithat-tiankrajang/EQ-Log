// The live scanner's rules, without a camera or a model.
import { describe, expect, it } from "vitest";

import type { Quad } from "../src/features/boardVision/geometry";
import {
  CANDIDATE_STABLE_FRAMES,
  INITIAL_SCAN,
  LOST_FRAMES,
  MIN_RECOGNITION_GAP_MS,
  RELOCATE_TIMEOUT_MS,
  scanStep,
  type ScanEffect,
  type ScanEvent,
  type ScanState,
} from "../src/features/boardVision/scanner";

const BOARD: Quad = [
  [100, 100],
  [700, 110],
  [720, 700],
  [90, 690],
];
const NUDGED: Quad = BOARD.map(([x, y]) => [x + 3, y - 2]) as unknown as Quad;
const ELSEWHERE: Quad = BOARD.map(([x, y]) => [x + 400, y + 300]) as unknown as Quad;

function run(events: ScanEvent[], from: ScanState = INITIAL_SCAN) {
  let state = from;
  const effects: ScanEffect[] = [];
  for (const e of events) {
    const out = scanStep(state, e);
    state = out.state;
    effects.push(...out.effects);
  }
  return { state, effects };
}

let clock = 0;
const frame = (quad: Quad | null, quality = 0.9, at?: number): ScanEvent => {
  clock = at ?? clock + 33;
  return { type: "frame", frameId: `f${clock}`, at: clock, quad, quality };
};
const steady = (quad: Quad, n = CANDIDATE_STABLE_FRAMES) =>
  Array.from({ length: n }, () => frame(quad));
const locked = () =>
  run([{ type: "start" }, { type: "cameraReady" }, ...steady(BOARD), { type: "confirmBoard" }]);
const kinds = (effects: ScanEffect[]) => effects.map((e) => e.type);

describe("finding the board", () => {
  it("opens the camera, searches, and proposes a candidate", () => {
    const { state, effects } = run([
      { type: "start" },
      { type: "cameraReady" },
      frame(null),
      frame(BOARD),
    ]);
    expect(effects[0]).toEqual({ type: "openCamera" });
    expect(kinds(effects)).toContain("detectBoard");
    expect(state.phase.name).toBe("candidate");
  });

  it("recognises nothing before the person confirms the board", () => {
    const { effects } = run([{ type: "start" }, { type: "cameraReady" }, ...steady(BOARD, 20)]);
    expect(kinds(effects)).not.toContain("recognize");
  });

  it("only accepts a confirmation once the candidate has held still", () => {
    const early = run([
      { type: "start" },
      { type: "cameraReady" },
      frame(BOARD),
      { type: "confirmBoard" },
    ]);
    expect(early.state.phase.name).toBe("candidate");
    expect(locked().state.phase.name).toBe("tracking");
  });

  it("treats small wobble as the same candidate, and a jump as a new one", () => {
    const wobble = run([{ type: "start" }, { type: "cameraReady" }, frame(BOARD), frame(NUDGED)]);
    expect(wobble.state.phase).toMatchObject({ name: "candidate", stableFrames: 2 });
    const jump = run([{ type: "start" }, { type: "cameraReady" }, frame(BOARD), frame(ELSEWHERE)]);
    expect(jump.state.phase).toMatchObject({ name: "candidate", stableFrames: 1 });
  });

  it("does not propose a rejected board again, but does propose a different one", () => {
    const rejected = run([
      { type: "start" },
      { type: "cameraReady" },
      ...steady(BOARD),
      { type: "rejectBoard" },
    ]);
    expect(rejected.state.phase.name).toBe("searching");
    expect(run([frame(NUDGED)], rejected.state).state.phase.name).toBe("searching");
    expect(run([frame(ELSEWHERE)], rejected.state).state.phase.name).toBe("candidate");
  });
});

describe("collecting evidence", () => {
  it("asks for recognition at most one frame at a time, and not faster than the gap", () => {
    const { state } = locked();
    const t0 = 10_000;
    const a = run([frame(BOARD, 0.9, t0)], state);
    expect(kinds(a.effects)).toContain("recognize");
    const busy = run([frame(BOARD, 0.9, t0 + MIN_RECOGNITION_GAP_MS * 3)], a.state);
    expect(kinds(busy.effects)).not.toContain("recognize"); // one already in flight
    const done = run([{ type: "recognitionDone", frameId: `f${t0}` }], busy.state);
    expect(done.state.observations).toBe(1);
    const tooSoon = run([frame(BOARD, 0.9, t0 + MIN_RECOGNITION_GAP_MS / 2)], done.state);
    expect(kinds(tooSoon.effects)).not.toContain("recognize");
    const later = run([frame(BOARD, 0.9, t0 + MIN_RECOGNITION_GAP_MS + 1)], done.state);
    expect(kinds(later.effects)).toContain("recognize");
  });

  it("does not spend recognition on poor frames", () => {
    const { state } = locked();
    const { effects } = run([frame(BOARD, 0.2, 50_000)], state);
    expect(kinds(effects)).toEqual(["trackBoard"]);
  });

  it("keeps its evidence while relocating a lost board, and resumes on the same board", () => {
    const { state } = locked();
    const withEvidence = run(
      [frame(BOARD, 0.9, 60_000), { type: "recognitionDone", frameId: "f60000" }],
      state,
    ).state;
    const lost = run(
      Array.from({ length: LOST_FRAMES }, () => frame(null)),
      withEvidence,
    );
    expect(lost.state.phase.name).toBe("relocating");
    expect(lost.state.observations).toBe(1);
    const back = run([frame(NUDGED)], lost.state);
    expect(back.state.phase.name).toBe("tracking");
    expect(back.state.observations).toBe(1);
  });

  it("falls back to searching — evidence kept, confirmation required again — if the board stays lost", () => {
    const { state } = locked();
    const lost = run(
      Array.from({ length: LOST_FRAMES }, () => frame(null)),
      state,
    ).state;
    const since = (lost.phase as { since: number }).since;
    const gone = run([frame(ELSEWHERE, 0.9, since + RELOCATE_TIMEOUT_MS)], lost);
    expect(gone.state.phase.name).toBe("searching");
    expect(gone.state.confirmed).toBe(true);
  });
});

describe("finishing, and letting go of the camera", () => {
  it("will not finish with nothing seen, then reconstructs, verifies and imports", () => {
    const { state } = locked();
    expect(run([{ type: "finish" }], state).state.phase.name).toBe("tracking");
    const seen = run(
      [frame(BOARD, 0.9, 90_000), { type: "recognitionDone", frameId: "f90000" }],
      state,
    ).state;
    const { state: end, effects } = run(
      [{ type: "finish" }, { type: "reconstructed" }, { type: "verified" }],
      seen,
    );
    expect(end.phase.name).toBe("done");
    expect(kinds(effects)).toEqual([
      "releaseCamera",
      "reconstruct",
      "showVerification",
      "importToStudy",
    ]);
  });

  it.each([
    ["cancel while searching", [{ type: "start" }, { type: "cameraReady" }, { type: "cancel" }]],
    [
      "cancel while tracking",
      [
        { type: "start" },
        { type: "cameraReady" },
        ...steady(BOARD),
        { type: "confirmBoard" },
        { type: "cancel" },
      ],
    ],
    [
      "camera failure mid-scan",
      [{ type: "start" }, { type: "cameraReady" }, { type: "cameraFailed", reason: "revoked" }],
    ],
    [
      "cancel twice",
      [{ type: "start" }, { type: "cameraReady" }, { type: "cancel" }, { type: "cancel" }],
    ],
  ] as [string, ScanEvent[]][])("releases the camera exactly once: %s", (_name, events) => {
    const { state, effects } = run(events);
    expect(effects.filter((e) => e.type === "releaseCamera")).toHaveLength(1);
    expect(state.cameraOpen).toBe(false);
  });

  it("releases a camera cancelled while it is still being opened", () => {
    // getUserMedia may resolve AFTER the cancel; the host must stop that stream.
    const { effects } = run([{ type: "start" }, { type: "cancel" }]);
    expect(kinds(effects)).toEqual(["openCamera", "releaseCamera"]);
  });

  it("does not release a camera it never requested", () => {
    const { effects } = run([{ type: "cancel" }]);
    expect(kinds(effects)).toEqual([]);
  });
});
