// Protocol between the app, the Super worker and the C++ engine.
//
// The engine's side of this is described in amath-engine/src/engine.hpp; these
// are the shapes as they cross `postMessage`, which is a different boundary
// with a different failure mode: a message that does not match is not a type
// error at build time, it is a bot that never moves.
import type { BotCandidate, BotProgress } from "./types";

/**
 * One position, as the engine takes it.
 *
 * The same document the backend's `adapter.ts` builds — field for field,
 * deliberately. When the Super search runs on the device, the CLIENT is the
 * adapter, and any disagreement between the two shows up as the bot playing
 * differently depending on where it thought. `superRequest.ts` is the one place
 * this is constructed and it carries the comparison in its comments.
 */
export type SuperEngineRequest = {
  board: Array<{ r: number; c: number; kind: string; token: string }>;
  rack: string[];
  bagCount: number;
  oppRackCount: number;
  myScore: number;
  oppScore: number;
  noScoreStreak: number;
  exchangeAllowed: boolean;
  difficulty: string;
  solver?: "static" | "sim";
  budgetMs?: number;
  /** Take every wall-clock ceiling off the search. What makes `super` `super`. */
  unlimited?: boolean;
  /**
   * Opponent-rack samples to run, replacing the engine's full schedule.
   *
   * This is the device-aware budget, and it bounds WORK rather than TIME on
   * purpose: the same position then runs the same search on a fast laptop and a
   * slow one, so the move is reproducible and only the wall clock differs. A
   * wall-clock budget would stop the sampler at whichever sample the machine
   * happened to reach and make the bot's choice depend on how busy the device
   * was that second.
   */
  sampleCap?: number;
  topN?: number;
  seed: number;
  /** Tuning, served and versioned by the backend. Absent means the engine's
   *  compiled defaults. */
  weights?: Record<string, unknown>;
};

export type SuperEngineResponse = {
  type: "place" | "exchange" | "pass";
  placements: Array<{ r: number; c: number; kind: string; token: string }>;
  exchange: string[];
  score: number;
  equity: number;
  solver: "greedy" | "sim" | "endgame";
  endgameSolved: boolean;
  expectedFinalDiff?: number;
  stats: {
    moves: number;
    nodes: number;
    elapsedMs: number;
    candidates: number;
    samples: number;
    genCalls?: number;
    /**
     * How many weight overrides the engine actually applied.
     *
     * Read rather than ignored: it is the difference between "the weights
     * version this game is pinned to was used" and "the engine quietly ran its
     * compiled defaults". A retune that silently applies nothing looks exactly
     * like a retune that does not help.
     */
    weightsApplied?: number;
  };
  candidates?: BotCandidate[];
  error?: string;
};

/** The device benchmark's answer. Fixed work, measured time. */
export type CalibrationResult = {
  mode: "calibrate";
  benchmark: string;
  nodes: number;
  elapsedMs: number;
  nodesPerSec: number;
  moves: number;
  /** True when the node cap bound, which is the condition under which every
   *  device did the SAME work and the throughput is comparable. */
  capBound: boolean;
};

export type SuperWorkerInbound =
  | { type: "initialize" }
  | { type: "calibrate"; id: number }
  | { type: "think"; id: number; request: SuperEngineRequest };

export type SuperWorkerOutbound =
  | { type: "ready"; initMs: number }
  | { type: "progress"; id: number; progress: BotProgress }
  | { type: "calibration"; id: number; result: CalibrationResult }
  | { type: "result"; id: number; response: SuperEngineResponse; wallMs: number }
  | { type: "error"; id: number; message: string };
