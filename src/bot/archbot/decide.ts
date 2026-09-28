// ── One ArchBot decision ─────────────────────────────────────────────────────
//
// This is `run()` from the production Stage 5B service entry (engine-algo
// 7aafbfc, service/stage5b/entry.ts), statement for statement, minus the Node
// parts: the model arrives as an argument instead of being read from disk, and
// the request and answer are values instead of stdin and stdout. Everything the
// decision depends on — how the position is rebuilt, the seed, the configuration
// (`deepTop: 64`) — is unchanged, because the parity corpus
// (tests/archbot-parity.test.ts) holds this file to the production runtime's
// exact output. Do not "improve" it: a change here is a change of bot.
import {
  DEFAULT_BOT_CONFIG,
  createManifest,
  decide,
  decisionRandom,
  enumerateActions,
  envStateFrom,
  type CoreCandidate,
  type ValueHead,
} from "./core/stage5b-core.mjs";

/**
 * A position as Stage 5B is asked about it — the service's engine request.
 *
 * Only what the side on move may know: its own rack, and the opponent's rack
 * and the bag as COUNTS. The runtime plays as "A".
 */
export type ArchBotRequest = {
  board: Array<{
    r: number;
    c: number;
    kind: string;
    token: string;
    by?: "A" | "B";
    placedTurn?: number;
  }>;
  rack: string[];
  bagCount: number;
  oppRackCount: number;
  myScore: number;
  oppScore: number;
  noScoreStreak: number;
  exchangeAllowed: boolean;
  seed: number;
  topN?: number;
  turnNumber?: number;
};

export type ArchBotMove = {
  type: "place" | "exchange" | "pass";
  placements: Array<{ r: number; c: number; kind: string; token: string }>;
  exchange: string[];
  score: number;
};

export type ArchBotCandidate = ArchBotMove & {
  value: number;
  chosen: boolean;
  scoreComp: number;
  leave: number;
  potential: number;
  oppReply: number;
  mean: number;
  stddev: number;
  deep: boolean;
  components: Array<{ name: string; points: number }>;
};

/** The production runtime's answer, field for field. */
export type ArchBotDecision = ArchBotMove & {
  equity: number;
  solver: "stage5b";
  endgameSolved: false;
  candidates: ArchBotCandidate[];
  stats: {
    moves: number;
    nodes: number;
    /** Wall time inside the core. The only field that is not deterministic. */
    elapsedMs: number;
    candidates: number;
    samples: number;
    depth: number;
  };
};

type CoreBoardCell = {
  tileId: string;
  kind: string;
  face: string;
  side: "A" | "B";
  turn: number;
} | null;

export function decideArchBot(request: ArchBotRequest, value: ValueHead): ArchBotDecision {
  const manifest = createManifest();
  const available = new Map<string, string[]>();
  for (const tile of manifest.tiles) {
    const copies = available.get(tile.kind) ?? [];
    copies.push(tile.id);
    available.set(tile.kind, copies);
  }
  const take = (kind: string) => {
    const id = available.get(kind)?.shift();
    if (!id) throw new Error(`tile inventory exceeded: ${kind}`);
    return id;
  };
  const board = Array.from({ length: 225 }, () => null) as CoreBoardCell[];
  for (const cell of request.board) {
    const index = cell.r * 15 + cell.c;
    if (index < 0 || index >= 225 || board[index]) throw new Error("invalid board cell");
    board[index] = {
      tileId: take(cell.kind),
      kind: cell.kind,
      face: cell.token === "x" ? "×" : cell.token === "/" ? "÷" : cell.token,
      side: cell.by ?? "A",
      turn: cell.placedTurn ?? 1,
    };
  }
  const rack = request.rack.map(take);
  const unseen = manifest.tiles
    .map((tile) => tile.id)
    .filter((id) => available.get(manifest.kindOf.get(id)!)?.includes(id));
  if (unseen.length !== request.bagCount + request.oppRackCount) {
    throw new Error("unseen tile count does not match position");
  }
  // Not the opponent's rack: the first unseen tiles in manifest order, standing
  // in for a rack the bot cannot see — exactly as the production entry does it.
  const opponentRack = unseen.slice(0, request.oppRackCount);
  const bag = unseen.slice(request.oppRackCount);
  const noScoreTail = Array.from({ length: Math.min(6, request.noScoreStreak) }, (_, i) =>
    i % 2 === request.noScoreStreak % 2 ? ("A" as const) : ("B" as const),
  );
  const state = envStateFrom({
    manifest,
    board,
    racks: { A: rack, B: opponentRack },
    bag,
    scores: { A: request.myScore, B: request.oppScore },
    activeSide: "A",
    turnNumber: request.turnNumber ?? 1,
    noScoreTail,
    hasPlacement: request.board.length > 0,
    seed: request.seed,
  });
  const enumerated = enumerateActions(state);
  const actionSet = request.exchangeAllowed ? enumerated : { ...enumerated, exchange: [] };
  if (actionSet.truncated) throw new Error("Stage 5B move generation was incomplete");
  const context = {
    state,
    legal: [...actionSet.place, ...actionSet.exchange, ...(actionSet.pass ? [actionSet.pass] : [])],
    actionSet,
    side: "A" as const,
    ply: 0,
    turnNumber: state.turnNumber,
    random: decisionRandom(request.seed, "A", 0),
    history: [],
  };
  const config = {
    ...DEFAULT_BOT_CONFIG,
    budget: {
      ...DEFAULT_BOT_CONFIG.budget,
      deepTop: 64,
      keepCandidates: Math.max(24, request.topN ?? 24),
    },
  };
  const decision = decide(context, { value, config });
  const toMove = (candidate: CoreCandidate): ArchBotMove => ({
    type: candidate.family,
    placements:
      candidate.action.type === "place"
        ? candidate.action.placements.map((p) => ({
            r: Math.floor(p.cell / 15),
            c: p.cell % 15,
            kind: p.kind,
            token: p.face,
          }))
        : [],
    exchange: candidate.action.type === "exchange" ? [...candidate.action.kinds] : [],
    score: candidate.immediateScore,
  });
  const candidates = decision.candidates.slice(0, request.topN ?? 24).map((candidate) => ({
    ...toMove(candidate),
    value: candidate.value,
    chosen: candidate.id === decision.chosen?.id,
    scoreComp: candidate.immediateScore,
    leave: 0,
    potential: 0,
    oppReply: 0,
    mean: candidate.value,
    stddev: 0,
    deep: candidate.deep,
    components: candidate.components.map(({ name, points }) => ({ name, points })),
  }));
  const chosen = candidates.find((candidate) => candidate.chosen) ?? candidates[0];
  if (!chosen) throw new Error("Stage 5B reported no legal action");
  return {
    ...toMove(decision.chosen ?? decision.candidates[0]!),
    equity: chosen.value,
    solver: "stage5b",
    endgameSolved: false,
    candidates,
    stats: {
      moves: decision.trace.legal.place + decision.trace.legal.exchange + decision.trace.legal.pass,
      nodes: decision.trace.generator.nodes,
      elapsedMs: decision.trace.timings.totalMs,
      candidates:
        decision.trace.legal.place + decision.trace.legal.exchange + decision.trace.legal.pass,
      samples: 0,
      depth: 64,
    },
  };
}
