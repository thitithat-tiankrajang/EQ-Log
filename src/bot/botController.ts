// Bridge between EQ-Lab game state and the C++ engine worker.
//
// The engine is the single source of truth for A-Math legality (exact
// rational arithmetic); every bot move is still re-validated by the official
// game validator before it is committed, so an engine bug can never corrupt a
// match.
import {
  displayToken,
  getRack,
  otherSide,
  tileNeedsAssignment,
  type AmathToken,
  type BotDifficulty,
  type GameState,
  type PendingPlacement,
  type TileInstance,
} from "../game";
import { getExchangeRule } from "../gameplay/tilebag";
import { AMATH_TOKENS } from "../constants/tileDefinitions";
import type { BotProgress, BotRequest, BotResponse, WorkerOutbound } from "./types";

// ── TEMP endgame-dispatch instrumentation (remove after debugging) ────────────
// Mirrors the C++ engine's tile accounting: unseen = full distribution minus
// every board + rack tile (guarded against underflow, exactly like parseRequest),
// then endgameEligible = oppRackCount>0 && unseen.total == oppRackCount + bagCount.
const KIND_COUNTS: Record<string, number> = Object.fromEntries(
  Object.entries(AMATH_TOKENS).map(([k, v]) => [k, v.count]),
);
function logBotRequestDiag(req: BotRequest, pendingReturns: number, tilebagLength: number): void {
  const unseen: Record<string, number> = { ...KIND_COUNTS };
  const dec = (k: string) => {
    if ((unseen[k] ?? 0) > 0) unseen[k] -= 1;
  };
  for (const cell of req.board) dec(cell.kind as string);
  for (const t of req.rack) dec(t as string);
  const unseenTotal = Object.values(unseen).reduce((a, b) => a + b, 0);
  const endgameEligible =
    req.oppRackCount > 0 && unseenTotal === req.oppRackCount + req.bagCount;
  // eslint-disable-next-line no-console
  console.log("[BOT-DIAG] request", {
    bagCount: req.bagCount,
    tilebagLength,
    pendingReturns,
    oppRackCount: req.oppRackCount,
    boardTiles: req.board.length,
    myRack: req.rack.length,
    unseenTotal,
    conservationSum: req.board.length + req.rack.length + req.oppRackCount + tilebagLength + pendingReturns,
    endgameEligible,
  });
}

export type BotThinkHandle = {
  promise: Promise<BotResponse>;
  cancel: () => void;
};

let worker: Worker | null = null;
let requestCounter = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./engineWorker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

/** Preload the WASM module so the first bot turn has no startup hiccup. */
export function warmUpBotEngine(): void {
  getWorker();
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2147483647 || 1;
}

/** Count the trailing run of pass/exchange turns (the no-score streak). */
function trailingNoScoreStreak(game: GameState): number {
  let streak = 0;
  for (let i = game.logs.length - 1; i >= 0; i -= 1) {
    const action = game.logs[i].action;
    if (action === "end_game") continue;
    if (action === "pass" || action === "exchange") streak += 1;
    else break;
  }
  return streak;
}

// The engine ignores the `difficulty` string and is steered purely by
// `budgetMs`: less thinking time → shallower search → weaker play. `max` sends
// no cap so the engine falls back to its own (untimed) ceilings — full strength,
// exact endgame solving. The lower tiers trade strength for a snappier reply.
const BOT_THINK_BUDGET_MS: Record<BotDifficulty, number | null> = {
  easy: 200,
  medium: 1000,
  hard: 4000,
  max: null,
};

export function buildBotRequest(game: GameState): BotRequest {
  const botSide = game.botSide ?? "B";
  const board: BotRequest["board"] = [];
  for (let r = 0; r < game.board.length; r += 1) {
    for (let c = 0; c < game.board[r].length; c += 1) {
      const cell = game.board[r][c];
      if (!cell) continue;
      board.push({ r, c, kind: cell.tile.token, token: displayToken(cell.tile) });
    }
  }
  const rack = getRack(game, botSide).map((tile) => tile.token as string);
  const pendingReturns =
    (game.pendingExchangeReturnBySide?.A?.length ?? 0) +
    (game.pendingExchangeReturnBySide?.B?.length ?? 0);
  const difficulty = game.botDifficulty ?? "max";
  const budgetMs = BOT_THINK_BUDGET_MS[difficulty];
  const req: BotRequest = {
    board,
    rack,
    // Pending exchange returns are off-board and out of every rack; from the
    // bot's accounting view they are still part of the unseen "bag" pool.
    bagCount: game.tilebag.length + pendingReturns,
    oppRackCount: getRack(game, otherSide(botSide)).length,
    myScore: game.scores[botSide],
    oppScore: game.scores[otherSide(botSide)],
    noScoreStreak: trailingNoScoreStreak(game),
    exchangeAllowed: getExchangeRule(game).allowed,
    difficulty,
    // Omitted for `max` so the engine uses its own full-strength ceilings.
    ...(budgetMs != null ? { budgetMs } : {}),
    seed: hashSeed(`${game.gameId}:${game.turnNumber}`),
  };
  logBotRequestDiag(req, pendingReturns, game.tilebag.length);  // TEMP
  return req;
}

export function thinkWithBot(
  request: BotRequest,
  onProgress: (progress: BotProgress) => void,
): BotThinkHandle {
  const id = ++requestCounter;
  const w = getWorker();

  let settled = false;
  let cleanup = () => {};
  const promise = new Promise<BotResponse>((resolve, reject) => {
    const onMessage = (event: MessageEvent<WorkerOutbound>) => {
      const msg = event.data;
      if (msg.type === "progress" && msg.id === id) {
        if (!settled) onProgress(msg.progress);
      } else if (msg.type === "result" && msg.id === id) {
        settled = true;
        cleanup();
        // eslint-disable-next-line no-console
        console.log("[BOT-DIAG] response", {
          solver: msg.response.solver,
          endgameSolved: msg.response.endgameSolved,
          type: msg.response.type,
        });  // TEMP
        if (msg.response.error) reject(new Error(msg.response.error));
        else resolve(msg.response);
      } else if (msg.type === "error" && msg.id === id) {
        settled = true;
        cleanup();
        reject(new Error(msg.message));
      }
    };
    cleanup = () => w.removeEventListener("message", onMessage);
    w.addEventListener("message", onMessage);
    w.postMessage({ type: "think", id, request });
  });

  return {
    promise,
    cancel: () => {
      // The engine is synchronous inside the worker; cancelling means killing
      // the worker so a stale result can never reach a newer game state.
      settled = true;
      cleanup();
      if (worker) {
        worker.terminate();
        worker = null;
      }
    },
  };
}

export type MappedBotMove =
  | { kind: "place"; placements: PendingPlacement[] }
  | { kind: "exchange"; outgoingIds: string[] }
  | { kind: "pass" };

/**
 * Map an engine response back onto concrete rack tile instances.
 * Returns null when the response cannot be honored (e.g. a tile is missing) —
 * the caller then falls back to a pass so the match never breaks.
 */
export function mapBotResponse(game: GameState, response: BotResponse): MappedBotMove | null {
  const botSide = game.botSide ?? "B";
  const rack = getRack(game, botSide);

  if (response.type === "place") {
    const used = new Set<string>();
    const placements: PendingPlacement[] = [];
    for (const placement of response.placements) {
      const tile = rack.find(
        (candidate) => !used.has(candidate.id) && candidate.token === (placement.kind as AmathToken),
      );
      if (!tile) return null;
      used.add(tile.id);
      const needsAssignment = tileNeedsAssignment(tile.token);
      const cleanTile: TileInstance = needsAssignment
        ? { ...tile, assignedToken: placement.token }
        : { id: tile.id, token: tile.token };
      placements.push({
        tile: cleanTile,
        row: placement.r,
        col: placement.c,
        assignedToken: needsAssignment ? placement.token : undefined,
      });
    }
    return { kind: "place", placements };
  }

  if (response.type === "exchange") {
    const used = new Set<string>();
    for (const kind of response.exchange) {
      const tile = rack.find(
        (candidate) => !used.has(candidate.id) && candidate.token === (kind as AmathToken),
      );
      if (!tile) return null;
      used.add(tile.id);
    }
    return { kind: "exchange", outgoingIds: Array.from(used) };
  }

  return { kind: "pass" };
}
