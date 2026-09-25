// ── The live scanner, as a state machine ─────────────────────────────────────
//
//   idle → starting → searching ⇄ candidate ─confirm→ tracking ⇄ relocating
//                                   ↑ reject                │ finish
//                                   └────────────────────── ▼
//                                          reconstructing → verifying → done
//   (any state) ─cancel→ cancelled        (camera trouble) → failed
//
// Pure: `scanStep(state, event)` returns the next state and the EFFECTS the
// host must perform (open or release the camera, run the cheap board detector
// or tracker on a frame, run the expensive recogniser on a frame, reconstruct,
// show verification, import). Nothing here touches a camera, a model or a
// worker, so every rule below is testable without any of them.
//
// Rules this machine holds:
//   • nothing is recognised before a person has confirmed "this is the board";
//   • the recogniser is asked only while tracking, at most one frame at a
//     time, no more often than MIN_RECOGNITION_GAP_MS, and only for frames
//     good enough to be worth it — camera fps is not recognition fps;
//   • losing the board does not throw evidence away: the scanner tries to
//     relocate the SAME board first, and only falls back to searching (and a
//     fresh "is this the board?") after RELOCATE_TIMEOUT_MS;
//   • a board the person rejected is not immediately proposed again;
//   • every way out after the camera was requested releases it, exactly once
//     — including a cancel while the request is still pending.
//
// Evidence itself lives in an `EvidenceAccumulator` owned by the host; this
// machine only counts what was added.

import { BOARD_SIZE } from "../../constants/gameRules";
import type { Quad } from "./geometry";

export const CANDIDATE_STABLE_FRAMES = 5;
export const LOST_FRAMES = 8;
export const RELOCATE_TIMEOUT_MS = 4000;
export const MIN_RECOGNITION_GAP_MS = 400;
export const MIN_RECOGNITION_QUALITY = 0.5;
/** Corner movement, as a fraction of a square, that still counts as "the same quad". */
const STABLE_TOLERANCE_SQUARES = 0.35;

export type ScanPhase =
  | { name: "idle" }
  | { name: "starting" }
  | { name: "searching" }
  | { name: "candidate"; quad: Quad; stableFrames: number }
  | { name: "tracking"; quad: Quad; lostFrames: number }
  | { name: "relocating"; lastQuad: Quad; since: number }
  | { name: "reconstructing" }
  | { name: "verifying" }
  | { name: "done" }
  | { name: "cancelled" }
  | { name: "failed"; reason: string };

export type ScanState = {
  phase: ScanPhase;
  /** Held from the moment the camera is REQUESTED: a request still pending
   *  when the scan is cancelled must be released when (if) it resolves, or a
   *  live camera would be left running with nobody to stop it. */
  cameraOpen: boolean;
  /** Boards the person said were not the board. */
  rejected: readonly Quad[];
  /** Whether a board has been confirmed in this scan (evidence belongs to it). */
  confirmed: boolean;
  recognitionInFlight: boolean;
  lastRecognitionAt: number | null;
  observations: number;
};

export type ScanEvent =
  | { type: "start" }
  | { type: "cameraReady" }
  | { type: "cameraFailed"; reason: string }
  /** A frame, after the CHEAP per-frame work: board quad (detected or
   *  tracked; null if none) and an overall quality 0–1. */
  | { type: "frame"; frameId: string; at: number; quad: Quad | null; quality: number }
  | { type: "confirmBoard" }
  | { type: "rejectBoard" }
  | { type: "recognitionDone"; frameId: string }
  | { type: "recognitionFailed"; frameId: string }
  | { type: "finish" }
  | { type: "reconstructed" }
  | { type: "verified" }
  | { type: "cancel" };

export type ScanEffect =
  | { type: "openCamera" }
  | { type: "releaseCamera" }
  | { type: "detectBoard" }
  | { type: "trackBoard"; quad: Quad }
  | { type: "recognize"; frameId: string; quad: Quad }
  | { type: "reconstruct" }
  | { type: "showVerification" }
  | { type: "importToStudy" };

export const INITIAL_SCAN: ScanState = {
  phase: { name: "idle" },
  cameraOpen: false,
  rejected: [],
  confirmed: false,
  recognitionInFlight: false,
  lastRecognitionAt: null,
  observations: 0,
};

/** Mean corner movement between two quads, in squares of the first. */
export function quadDistance(a: Quad, b: Quad): number {
  let side = 0;
  let moved = 0;
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = a[i]!;
    const [nx, ny] = a[(i + 1) % 4]!;
    side += Math.hypot(nx - x, ny - y);
    moved += Math.hypot(b[i]![0] - x, b[i]![1] - y);
  }
  return moved / 4 / (side / 4 / BOARD_SIZE);
}

const same = (a: Quad, b: Quad) => quadDistance(a, b) <= STABLE_TOLERANCE_SQUARES;

export function scanStep(
  state: ScanState,
  event: ScanEvent,
): { state: ScanState; effects: ScanEffect[] } {
  const phase = state.phase;
  const to = (next: ScanPhase, patch: Partial<ScanState> = {}, effects: ScanEffect[] = []) => ({
    state: { ...state, ...patch, phase: next },
    effects,
  });
  const stay = (effects: ScanEffect[] = []) => ({ state, effects });
  const release = (): ScanEffect[] => (state.cameraOpen ? [{ type: "releaseCamera" }] : []);

  if (event.type === "cancel") {
    if (phase.name === "done" || phase.name === "cancelled") return stay();
    return to({ name: "cancelled" }, { cameraOpen: false, recognitionInFlight: false }, release());
  }
  if (event.type === "cameraFailed") {
    return to({ name: "failed", reason: event.reason }, { cameraOpen: false }, release());
  }

  switch (phase.name) {
    case "idle":
      return event.type === "start"
        ? to({ name: "starting" }, { cameraOpen: true }, [{ type: "openCamera" }])
        : stay();

    case "starting":
      return event.type === "cameraReady" ? to({ name: "searching" }) : stay();

    case "searching":
      if (event.type !== "frame") return stay();
      if (event.quad && !state.rejected.some((q) => same(q, event.quad!))) {
        return to({ name: "candidate", quad: event.quad, stableFrames: 1 });
      }
      return stay([{ type: "detectBoard" }]);

    case "candidate":
      if (event.type === "confirmBoard") {
        if (phase.stableFrames < CANDIDATE_STABLE_FRAMES) return stay();
        return to({ name: "tracking", quad: phase.quad, lostFrames: 0 }, { confirmed: true });
      }
      if (event.type === "rejectBoard") {
        return to({ name: "searching" }, { rejected: [...state.rejected, phase.quad] });
      }
      if (event.type !== "frame") return stay();
      if (!event.quad) return to({ name: "searching" }, {}, [{ type: "detectBoard" }]);
      return to({
        name: "candidate",
        quad: event.quad,
        stableFrames: same(phase.quad, event.quad) ? phase.stableFrames + 1 : 1,
      });

    case "tracking": {
      if (event.type === "recognitionDone") {
        return to(phase, { recognitionInFlight: false, observations: state.observations + 1 });
      }
      if (event.type === "recognitionFailed") return to(phase, { recognitionInFlight: false });
      if (event.type === "finish") {
        return state.observations > 0
          ? to({ name: "reconstructing" }, { cameraOpen: false }, [
              ...release(),
              { type: "reconstruct" },
            ])
          : stay();
      }
      if (event.type !== "frame") return stay();
      if (!event.quad) {
        const lost = phase.lostFrames + 1;
        return lost >= LOST_FRAMES
          ? to({ name: "relocating", lastQuad: phase.quad, since: event.at }, {}, [
              { type: "detectBoard" },
            ])
          : to({ ...phase, lostFrames: lost }, {}, [{ type: "trackBoard", quad: phase.quad }]);
      }
      const effects: ScanEffect[] = [{ type: "trackBoard", quad: event.quad }];
      const due =
        state.lastRecognitionAt === null ||
        event.at - state.lastRecognitionAt >= MIN_RECOGNITION_GAP_MS;
      if (!state.recognitionInFlight && due && event.quality >= MIN_RECOGNITION_QUALITY) {
        effects.push({ type: "recognize", frameId: event.frameId, quad: event.quad });
        return to(
          { name: "tracking", quad: event.quad, lostFrames: 0 },
          { recognitionInFlight: true, lastRecognitionAt: event.at },
          effects,
        );
      }
      return to({ name: "tracking", quad: event.quad, lostFrames: 0 }, {}, effects);
    }

    case "relocating":
      if (event.type === "recognitionDone")
        return to(phase, { recognitionInFlight: false, observations: state.observations + 1 });
      if (event.type === "recognitionFailed") return to(phase, { recognitionInFlight: false });
      if (event.type === "finish" && state.observations > 0) {
        return to({ name: "reconstructing" }, { cameraOpen: false }, [
          ...release(),
          { type: "reconstruct" },
        ]);
      }
      if (event.type !== "frame") return stay();
      if (event.quad && same(phase.lastQuad, event.quad)) {
        return to({ name: "tracking", quad: event.quad, lostFrames: 0 }, {}, [
          { type: "trackBoard", quad: event.quad },
        ]);
      }
      if (event.at - phase.since >= RELOCATE_TIMEOUT_MS) {
        // Evidence is kept; a board found from here must be confirmed again.
        return to({ name: "searching" }, {}, [{ type: "detectBoard" }]);
      }
      return stay([{ type: "detectBoard" }]);

    case "reconstructing":
      return event.type === "reconstructed"
        ? to({ name: "verifying" }, {}, [{ type: "showVerification" }])
        : stay();

    case "verifying":
      return event.type === "verified"
        ? to({ name: "done" }, {}, [{ type: "importToStudy" }])
        : stay();

    default:
      return stay();
  }
}
