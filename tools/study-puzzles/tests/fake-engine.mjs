// A stand-in for Stage 5B and amath_cli with the same request and result shapes,
// for tests that must not need the engine: it plays the highest-scoring legal
// placement from the rules environment's own move generator. Deterministic.
//
//   createEngine()                          what generator/run.mjs --engine= loads
//   createFakeEngine({ delayMs, failAll })  the knobs tests turn
import { analyzePlacement, displayFace } from "../lib/analysis.mjs";
import { env } from "../lib/provenance.mjs";

const CHOICE_KINDS = new Set(["?", "+/-", "x//"]);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Stopped extends Error {
  constructor() {
    super("stopped");
    this.stopped = true;
  }
}

/** The position a request describes, hidden tiles filled in manifest order (as the runtime does). */
function stateFromRequest(request) {
  const manifest = env.createManifest();
  const free = new Map();
  for (const tile of manifest.tiles) {
    if (!free.has(tile.kind)) free.set(tile.kind, []);
    free.get(tile.kind).push(tile.id);
  }
  const take = (kind) => {
    const id = free.get(kind)?.shift();
    if (!id) throw new Error(`tile inventory exceeded: ${kind}`);
    return id;
  };
  const board = Array(225).fill(null);
  for (const cell of request.board) {
    board[cell.r * 15 + cell.c] = {
      tileId: take(cell.kind),
      kind: cell.kind,
      face: CHOICE_KINDS.has(cell.kind) ? cell.token : displayFace(cell.kind, cell.token),
      side: "B",
      turn: 1,
    };
  }
  const rack = request.rack.map(take);
  const unseen = [...free.values()].flat();
  return env.envStateFrom({
    manifest,
    board,
    racks: { A: rack, B: unseen.slice(0, request.oppRackCount) },
    bag: unseen.slice(request.oppRackCount),
    scores: { A: request.myScore, B: request.oppScore },
    activeSide: "A",
    turnNumber: 1,
    noScoreTail: [],
    hasPlacement: request.board.length > 0,
    seed: request.seed,
  });
}

export function createFakeEngine({ delayMs = 0, failAll = false } = {}) {
  let stopped = false;
  let active = 0;
  return {
    async analyze(request) {
      if (stopped) throw new Stopped();
      active += 1;
      try {
        if (delayMs > 0) await pause(delayMs);
        if (stopped) throw new Stopped();
        if (failAll) throw new Error("fake engine failure");
        const roots = await env.completeRootActions(stateFromRequest(request));
        const places = [...roots.places].sort((a, b) => b.score - a.score).slice(0, 50);
        const candidates = places.map((place, index) => ({
          type: "place",
          placements: place.action.placements.map((p) => ({
            r: Math.floor(p.cell / 15),
            c: p.cell % 15,
            kind: p.kind,
            token: p.face,
          })),
          exchange: [],
          score: place.score,
          // One point apart per rank, so every position has a clear best.
          value: place.score - index,
          chosen: index === 0,
          deep: false,
          components: [{ name: "immediate-score", points: place.score }],
        }));
        if (candidates.length === 0) {
          candidates.push({
            type: "pass",
            placements: [],
            exchange: [],
            score: 0,
            value: 0,
            chosen: true,
            deep: false,
            components: [],
          });
        }
        return {
          solver: "fake-greedy",
          candidates,
          stats: { moves: roots.places.length, elapsedMs: 0 },
        };
      } finally {
        active -= 1;
      }
    },
    async validate(request, move) {
      if (stopped) throw new Stopped();
      const verdict = analyzePlacement(
        request.board.map(({ r, c, kind, token }) => ({ r, c, kind, face: token })),
        move.placements.map(({ r, c, kind, token }) => ({ r, c, kind, face: token })),
      );
      return { mode: "validate", valid: verdict.valid, score: verdict.valid ? verdict.score : 0 };
    },
    get active() {
      return active;
    },
    killAll() {
      stopped = true;
    },
  };
}

export const createEngine = () => createFakeEngine();
