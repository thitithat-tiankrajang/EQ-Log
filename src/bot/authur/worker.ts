import type { BotMoveResult, EngineProgress } from "../engineApi";
import type { AuthurRequest } from "./request";
import {
  createManifest,
  decideStrong,
  envStateFrom,
  loadStrongModels,
  type AuthurDecision,
  type AuthurProgress,
} from "./strong.mjs";

type Outbound =
  | { type: "progress"; progress: EngineProgress }
  | { type: "result"; result: BotMoveResult }
  | { type: "error"; message: string };

const send = (message: Outbound) => self.postMessage(message);
let modelsPromise: ReturnType<typeof loadStrongModels> | null = null;

export function makeState(request: AuthurRequest) {
  const manifest = createManifest();
  const free = new Map<string, string[]>();
  for (const tile of manifest.tiles) {
    const copies = free.get(tile.kind) ?? [];
    copies.push(tile.id);
    free.set(tile.kind, copies);
  }
  const take = (kind: string): string => {
    const id = free.get(kind)?.shift();
    if (!id) throw new Error(`Authur tile inventory mismatch: ${kind}`);
    return id;
  };
  const board: Array<{
    tileId: string; kind: string; face: string; side: "A" | "B"; turn: number;
  } | null> = Array.from({ length: 225 }, () => null);
  for (const placed of request.board) {
    if (placed.cell < 0 || placed.cell >= 225 || board[placed.cell]) {
      throw new Error("Invalid Authur board cell");
    }
    board[placed.cell] = { ...placed, tileId: take(placed.kind) };
  }
  const ownRack = request.rack.map(take);
  const ownPending = request.ownPending.map(take);
  // The real opponent tiles never arrive in this worker. Allocate anonymous
  // manifest copies by count, then let STRONG shuffle the unseen pool itself.
  const unknown = [...free.values()].flat().sort();
  const needed = request.opponentRackCount + request.opponentPendingCount + request.bagCount;
  if (unknown.length !== needed) throw new Error("Authur tile count does not conserve 100 tiles");
  const theirRack = unknown.slice(0, request.opponentRackCount);
  const theirPending = unknown.slice(
    request.opponentRackCount,
    request.opponentRackCount + request.opponentPendingCount,
  );
  const bag = unknown.slice(request.opponentRackCount + request.opponentPendingCount);
  const other = request.side === "A" ? "B" : "A";
  return envStateFrom({
    manifest,
    board,
    racks: { [request.side]: ownRack, [other]: theirRack } as Record<"A" | "B", string[]>,
    pendingReturn: {
      [request.side]: ownPending,
      [other]: theirPending,
    } as Record<"A" | "B", string[]>,
    bag,
    scores: request.scores,
    activeSide: request.side,
    turnNumber: request.turnNumber,
    noScoreTail: request.noScoreTail,
    hasPlacement: request.board.length > 0,
    seed: request.seed,
    rngStep: 0,
  });
}

function progressOf(value: AuthurProgress): EngineProgress {
  return {
    phase: value.phase.startsWith("endgame") ? "endgame" : value.phase === "generating" ? "movegen" : "sim",
    percent: value.fraction == null ? 0 : Math.max(0, Math.min(100, value.fraction * 100)),
    elapsedMs: value.generationMs + value.strategyMs,
    etaMs: 0,
    detail: `Authur · ${value.phase} · ${value.legalPlace} moves`,
  };
}

function moveOf(action: AuthurDecision["action"]): BotMoveResult["move"] {
  if (action.type === "place") {
    return {
      type: "place",
      placements: action.placements.map((p) => ({
        r: Math.floor(p.cell / 15), c: p.cell % 15, kind: p.kind, token: p.face,
      })),
      exchange: [],
      score: 0,
    };
  }
  return {
    type: action.type,
    placements: [],
    exchange: action.type === "exchange" ? [...action.kinds] : [],
    score: 0,
  };
}

export function resultOf(request: AuthurRequest, decision: AuthurDecision): BotMoveResult {
  if (decision.cancelled || !decision.trace.generationComplete || decision.trace.spaceMapTruncated) {
    throw new Error("Authur did not finish complete move generation");
  }
  const move = moveOf(decision.action);
  move.score = decision.trace.chosenImmediateScore;
  const endgameSolved = decision.endgame?.exact === true;
  const candidates = decision.candidates.map((candidate) => {
    const candidateMove = moveOf(candidate.action);
    return {
      type: candidateMove.type,
      placements: candidateMove.placements,
      exchange: candidateMove.exchange,
      score: candidate.immediateScore,
      scoreComp: candidate.immediateScore,
      leave: candidate.meanNext,
      potential: 0,
      oppReply: candidate.meanReply,
      mean: candidate.q,
      stddev: 0,
      value: candidate.adjusted,
      chosen: candidate.chosen,
      tier: candidate.tier,
      ...(endgameSolved ? { proven: true } : {}),
    };
  });
  return {
    gameId: request.roomId,
    revision: request.revision,
    side: request.side,
    move,
    solver: "strong",
    endgameSolved,
    stats: {
      elapsedMs: decision.trace.totalMs,
      nodes: decision.trace.generationNodes + decision.trace.tier3Nodes,
      samples: decision.trace.evaluations,
    },
    localReasoning: {
      gameId: request.roomId,
      revision: request.revision,
      side: request.side,
      difficulty: "STRONG",
      solver: "strong",
      endgameSolved,
      ...(endgameSolved ? { expectedFinalDiff: decision.endgame!.selectedOptimalMargin } : {}),
      score: move.score,
      equity: decision.candidates.find((candidate) => candidate.chosen)?.q ?? 0,
      stats: {
        moves: decision.trace.legalPlace + decision.trace.legalExchange + 1,
        nodes: decision.trace.generationNodes + decision.trace.tier3Nodes,
        elapsedMs: decision.trace.totalMs,
        candidates: candidates.length,
        samples: decision.trace.evaluations,
      },
      candidates,
    },
  };
}

self.onmessage = (event: MessageEvent<{ type: "think"; request: AuthurRequest }>) => {
  if (event.data.type !== "think") return;
  const request = event.data.request;
  void (async () => {
    try {
      const state = makeState(request);
      if (request.bagCount + request.ownPending.length + request.opponentPendingCount > 0) {
        modelsPromise ??= loadStrongModels(`${import.meta.env.BASE_URL}models/strong`);
      }
      const models = modelsPromise ? await modelsPromise : null;
      const decision = await decideStrong(state, request.seed, models, {
        onProgress: (progress) => send({ type: "progress", progress: progressOf(progress) }),
      });
      send({ type: "result", result: resultOf(request, decision) });
    } catch (error) {
      send({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  })();
};
