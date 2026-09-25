// Authur, exactly as the engine service runs it — made deterministic.
//
// The request shape, `makeState` and the call into `decideStrong` mirror
// `amath-engine/service/authur/runtime.mjs` line for line: Authur is handed only
// what the side to move can see (its own rack, the board, tile COUNTS for the
// opponent and the bag) and builds its own guess of the rest. The generator
// never gives Authur the opponent's rack or the bag order.
//
// Two configurations:
//
//   offline  the production search with the wall-clock safety net switched off
//            (`strategyBudgetMs`). What Authur examines is then decided only by
//            its own count and node budgets, so the same request and seed give
//            the same move on any machine, under any load.
//   live     the production defaults, including the 4.8 s wall-clock net. Used
//            only to MEASURE how far the live opponent drifts from the offline
//            one; never to generate.
//
// One clock the bundle does not let us switch off: the exact bag-0 endgame
// solver's 60 s wall-clock budget. A decision where it fires comes back with
// `endgame.exact === false`; callers must treat that as timing-affected.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const DEFAULT_AUTHUR_DIR = resolve(
  import.meta.dirname,
  "../../../../amath-engine/service/authur",
);

export const AUTHUR_CONFIGS = Object.freeze({
  offline: Object.freeze({ strategyBudgetMs: 1e9 }),
  live: Object.freeze({}),
});

/** FNV-1a, identical to the engine service's `seedFor` in `src/adapter.ts`. */
export function seedFor(key, step) {
  const text = `${key}:${step}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483647 || 1;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function authurIdentity(dir = DEFAULT_AUTHUR_DIR) {
  return {
    dir,
    strong: await sha256(resolve(dir, "strong.mjs")),
    models: {
      "reply-self": await sha256(resolve(dir, "models/reply-self.json")),
      "reply-opponent": await sha256(resolve(dir, "models/reply-opponent.json")),
      "next-turn": await sha256(resolve(dir, "models/next-turn.json")),
    },
  };
}

export async function loadAuthur(dir = DEFAULT_AUTHUR_DIR) {
  const strong = await import(resolve(dir, "strong.mjs"));
  // The bundle fetches its models by URL. Serve them from disk for the duration
  // of the load only, the way runtime.mjs does inside its own process.
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const name = String(url).split("/").pop();
    if (!["reply-self.json", "reply-opponent.json", "next-turn.json"].includes(name)) {
      throw new Error(`Unknown Authur model ${name}`);
    }
    return new Response(await readFile(resolve(dir, "models", name)), { status: 200 });
  };
  let models;
  try {
    models = await strong.loadStrongModels("authur-models");
  } finally {
    globalThis.fetch = previous;
  }

  function makeState(request) {
    const manifest = strong.createManifest();
    const free = new Map();
    for (const tile of manifest.tiles) {
      const copies = free.get(tile.kind) ?? [];
      copies.push(tile.id);
      free.set(tile.kind, copies);
    }
    const take = (kind) => {
      const id = free.get(kind)?.shift();
      if (!id) throw new Error(`Authur tile inventory mismatch: ${kind}`);
      return id;
    };
    const board = Array.from({ length: 225 }, () => null);
    for (const placed of request.board) {
      if (placed.cell < 0 || placed.cell >= 225 || board[placed.cell]) {
        throw new Error("Invalid Authur board cell");
      }
      board[placed.cell] = { ...placed, tileId: take(placed.kind) };
    }
    const ownRack = request.rack.map(take);
    const ownPending = request.ownPending.map(take);
    const unknown = [...free.values()].flat().sort();
    const needed = request.opponentRackCount + request.opponentPendingCount + request.bagCount;
    if (unknown.length !== needed) throw new Error("Authur tile count does not conserve 100 tiles");
    const theirRack = unknown.slice(0, request.opponentRackCount);
    const theirPending = unknown.slice(
      request.opponentRackCount,
      request.opponentRackCount + request.opponentPendingCount,
    );
    const other = request.side === "A" ? "B" : "A";
    return strong.envStateFrom({
      manifest,
      board,
      racks: { [request.side]: ownRack, [other]: theirRack },
      pendingReturn: { [request.side]: ownPending, [other]: theirPending },
      bag: unknown.slice(request.opponentRackCount + request.opponentPendingCount),
      scores: request.scores,
      activeSide: request.side,
      turnNumber: request.turnNumber,
      noScoreTail: request.noScoreTail,
      hasPlacement: request.board.length > 0,
      seed: request.seed,
      rngStep: 0,
    });
  }

  /** One decision. `config` is a key of AUTHUR_CONFIGS. */
  async function decide(request, config = "offline") {
    const needsModels =
      request.bagCount + request.ownPending.length + request.opponentPendingCount > 0;
    const decision = await strong.decideStrong(
      makeState(request),
      request.seed,
      needsModels ? models : null,
      { config: AUTHUR_CONFIGS[config] },
    );
    if (
      decision.cancelled ||
      !decision.trace.generationComplete ||
      decision.trace.spaceMapTruncated
    ) {
      throw new Error("Authur did not finish complete move generation");
    }
    return decision;
  }

  return { decide };
}

/**
 * What the side to move may see, in the engine service's request shape.
 * `state` is a bot-lab EnvState at a decision point (no standing exchange pile).
 */
export function requestFor(state, seedKey) {
  const side = state.activeSide;
  const other = side === "A" ? "B" : "A";
  const kindOf = state.manifest.kindOf;
  const board = [];
  state.board.forEach((cell, index) => {
    if (cell) {
      board.push({ cell: index, kind: cell.kind, face: cell.face, side: cell.side, turn: cell.turn });
    }
  });
  return {
    side,
    seed: seedFor(seedKey, state.turnNumber),
    board,
    rack: state.racks[side].map((id) => kindOf.get(id)),
    ownPending: [],
    opponentRackCount: state.racks[other].length,
    opponentPendingCount: 0,
    bagCount: state.bag.length,
    scores: { A: state.scores.A, B: state.scores.B },
    turnNumber: state.turnNumber,
    noScoreTail: [...state.noScoreTail],
  };
}

/**
 * Authur's action names tiles from ITS OWN reconstructed state. Map it onto the
 * mover's real tiles by kind, so it can be applied to the true state.
 */
export function onRealTiles(state, action) {
  const kindOf = state.manifest.kindOf;
  const pool = [...state.racks[state.activeSide]];
  const take = (kind) => {
    const index = pool.findIndex((id) => kindOf.get(id) === kind);
    if (index < 0) throw new Error(`Authur played a ${kind} the rack does not hold`);
    return pool.splice(index, 1)[0];
  };
  if (action.type === "place") {
    return {
      type: "place",
      placements: action.placements.map((p) => ({
        cell: p.cell,
        tileId: take(p.kind),
        kind: p.kind,
        face: p.face,
      })),
    };
  }
  if (action.type === "exchange") {
    const kinds = [...action.kinds];
    return { type: "exchange", tileIds: kinds.map(take), kinds };
  }
  return { type: "pass" };
}
