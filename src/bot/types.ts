// Protocol types shared between the app, the bot worker, and the C++ engine
// (see amath-engine/src/engine.hpp for the authoritative description).
import type { BotDifficulty } from "../game";
import type { BotReasoningReport } from "./engineApi";

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
  proven?: boolean;   // endgame: value is an exact proven final-score margin
};

export type BotResponse = {
  type: "place" | "exchange" | "pass";
  /**
   * The authoritative revision this move was computed for.
   *
   * Carried all the way to the point of application, because a move is an answer
   * to ONE position: applying it to any other is the most damaging thing this
   * client could do. The server already refuses to compute against a revision it
   * does not hold; this is the matching check on the way back in, so a result
   * that arrives late — after a resync, an undo, a second tab's move — is
   * discarded rather than played.
   */
  revision: number;
  placements: Array<{ r: number; c: number; kind: string; token: string }>;
  exchange: string[];
  score: number;
  /**
   * Evaluation detail is OPTIONAL, and absent on the path the app actually
   * uses today.
   *
   * The move endpoint answers with the move alone — the engine's own read of
   * the position describes the bot's rack, and it is served separately by
   * `fetchBotReasoning` rather than shipped with every turn. These fields are
   * kept optional rather than filled with zeros because a zero here is a
   * NUMBER, and the "why this move" panel would print it as one: a real
   * `equity` of 0.00 and "0 candidates considered" are both claims the engine
   * never made.
   */
  equity?: number;
  solver: "greedy" | "sim" | "endgame";
  endgameSolved: boolean;
  expectedFinalDiff?: number;
  stats: {
    moves?: number;
    nodes: number;
    elapsedMs: number;
    candidates?: number;
    samples: number;
  };
  // Ranked alternatives by value. Never present on the move response; read a
  // page at a time from the reasoning endpoint instead.
  candidates?: BotCandidate[];
  /** Set when the DEVICE computed this move, naming the versions it used. The
   *  application step writes these onto the game as its pin. */
  localEngine?: { engineVersion: string; weightsVersion: string };
  /**
   * The whole ranking, carried in memory, when the DEVICE computed this move.
   *
   * The comment above `candidates` describes the BACKEND path, where the report
   * is read back from the reasoning endpoint. A device-computed move has no
   * server-side search to read back, so the "why this move" panel is served from
   * here instead. Absent on every backend move, which is how the panel knows
   * which of the two sources to use.
   */
  localReasoning?: BotReasoningReport;
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
