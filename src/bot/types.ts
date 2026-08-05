// Protocol types shared between the app, the bot worker, and the C++ engine
// (see amath-engine/src/engine.hpp for the authoritative description).
import type { BotDifficulty } from "../game";

export type BotRequest = {
  board: Array<{ r: number; c: number; kind: string; token: string }>;
  rack: string[];
  bagCount: number;
  oppRackCount: number;
  myScore: number;
  oppScore: number;
  noScoreStreak: number;
  exchangeAllowed: boolean;
  difficulty: BotDifficulty;
  budgetMs?: number;
  seed: number;
};

// One evaluated alternative the engine weighed, with its full value breakdown.
// value = mean − λ·stddev is the risk-adjusted number the engine ranks by;
// mean ≈ scoreComp + leave + potential − oppReply (the residual on exchange
// candidates is the tempo cost and the lead/trail bias).
export type BotCandidate = {
  type: "place" | "exchange" | "pass";
  placements: Array<{ r: number; c: number; kind: string; token: string }>;
  exchange: string[];
  score: number;      // immediate board score of this move
  scoreComp: number;  // score component fed into the value
  leave: number;      // avg value of the rack left behind
  potential: number;  // avg discounted best-score the leftover rack could make next turn
  oppReply: number;   // avg value of the opponent's best reply (subtracted)
  mean: number;       // avg net value across the sampled opponent racks
  stddev: number;     // spread across samples (risk)
  value: number;      // risk-adjusted rank key: mean − λ·stddev
  chosen: boolean;    // true for the move the engine actually played
};

export type BotResponse = {
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
  };
  // Ranked alternatives (top ~16 by value), present only on the "sim" path.
  candidates?: BotCandidate[];
  error?: string;
};

export type BotProgress = {
  phase: "movegen" | "sim" | "endgame";
  percent: number;
  elapsedMs: number;
  etaMs: number;
  bestScore: number;
  detail: string;
};

export type WorkerInbound = { type: "think"; id: number; request: BotRequest };
export type WorkerOutbound =
  | { type: "ready" }
  | { type: "progress"; id: number; progress: BotProgress }
  | { type: "result"; id: number; response: BotResponse }
  | { type: "error"; id: number; message: string };
