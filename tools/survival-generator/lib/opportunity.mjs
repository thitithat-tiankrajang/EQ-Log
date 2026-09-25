// Scoring Opportunity Map — EXPERIMENTAL, read-only research diagnostics.
//
// Level-generator metadata only. Nothing here is visible to, or used by, a
// simulated player; the player policies never import this module.
//
// Three views, kept apart on purpose:
//
//   BOARD      what the board offers, from the Space Map and the premium layout.
//              Rack-independent and public.
//   RACK       what a given rack can actually do now: the complete legal move
//              list for that side, with each move's real score and complexity.
//              For the player it is their own rack (public to them); for Authur
//              it is Authur's rack (hidden from the player — generator-only).
//   FUTURE     the two-turn look-ahead (worker.mjs: `opportunity`), which uses
//              Authur's real reply and the fixed bag. Generator-only.
//
// No dimension is collapsed into one score here.
import * as diag from "../.vendor/authur-rules-diag.mjs";

const EQ_PREMIUM = new Set(["ex2", "ex3"]);
const TILE_PREMIUM = new Set(["px2", "px3", "px3star"]);
const SIZE = 15;

const round1 = (value) => (value == null ? null : Math.round(value * 10) / 10);

/** Per premium square: can a continuation reach it, how cheaply, with how many kinds. */
export function boardOpportunity(state) {
  const map = diag.buildFromBoard(state.board, state.rules);
  const premium = [];
  for (let cell = 0; cell < SIZE * SIZE; cell += 1) {
    if (state.board[cell]) continue;
    const slot = diag.slotAt(cell);
    if (!EQ_PREMIUM.has(slot) && !TILE_PREMIUM.has(slot)) continue;
    const mask = map.directionsAt(cell);
    let minCost = null;
    const kinds = new Set();
    const modes = new Set();
    for (const direction of mask.directions()) {
      const constraint = map.constraintsAt(cell, direction);
      if (constraint.minCost != null) minCost = minCost == null ? constraint.minCost : Math.min(minCost, constraint.minCost);
      for (const kind of constraint.allowed.kinds) kinds.add(kind);
      for (const mode of mask.modesOf(direction)) modes.add(mode);
    }
    premium.push({
      cell,
      slot,
      reachable: map.isReachable(cell),
      minCost,
      kinds: kinds.size,
      modes: [...modes],
      paths: map.pathCountAt(cell),
    });
  }
  const eq = premium.filter((p) => EQ_PREMIUM.has(p.slot));
  const eqReach = eq.filter((p) => p.reachable);
  const cheap = (list, cost) => list.filter((p) => p.reachable && p.minCost != null && p.minCost <= cost);
  const ex3 = eq.filter((p) => p.slot === "ex3");
  const tile = premium.filter((p) => TILE_PREMIUM.has(p.slot));
  const stats = map.stats();
  return {
    generic: {
      reachableCells: stats.reachableCells,
      anchors: stats.anchors,
      candidates: stats.candidates,
      blockedCells: stats.blockedCells,
    },
    equationPremium: {
      open: eq.length,
      reachable: eqReach.length,
      reachableWithin2: cheap(eq, 2).length,
      ex3Open: ex3.length,
      ex3Reachable: ex3.filter((p) => p.reachable).length,
      ex3Within2: cheap(ex3, 2).length,
      nearestEx3Cost: ex3.filter((p) => p.minCost != null).reduce((m, p) => Math.min(m, p.minCost), Infinity),
      // Multiplier-weighted access: ex3 counts 3, ex2 counts 2.
      weightedReachableWithin2: cheap(eq, 2).reduce((s, p) => s + (p.slot === "ex3" ? 3 : 2), 0),
      meanKindsAtReachable: round1(eqReach.length ? eqReach.reduce((s, p) => s + p.kinds, 0) / eqReach.length : 0),
    },
    tilePremium: {
      open: tile.length,
      reachable: tile.filter((p) => p.reachable).length,
      reachableWithin2: cheap(tile, 2).length,
    },
    premiumCells: premium,
  };
}

const coversEqPremium = (move) => move.newCells.some((cell) => EQ_PREMIUM.has(diag.slotAt(cell)));
const usesMultiplier = (move) =>
  (move.mainRun?.multiplier ?? 1) >= 2 || move.crossRuns.some((run) => run.multiplier >= 2);

/** What one side's rack can do on this board right now — real legal moves, real scores. */
export async function rackOpportunity(state, side) {
  const result = await diag.generateMovesIncremental(diag.envPosition(state, side));
  if (result.cancelled || result.stats.spaceMapTruncated) throw new Error("move generation incomplete");
  const moves = result.moves;
  const scores = moves.map((m) => m.score).sort((a, b) => b - a);
  const bestOf = (list) => list.reduce((best, m) => (m.score > best ? m.score : best), 0);
  const best = moves.reduce((b, m) => (!b || m.score > b.score || (m.score === b.score && m.id < b.id) ? m : b), null);
  const multiplier = moves.filter(usesMultiplier);
  const simple = moves.filter((m) => m.newTileCount <= 3);
  const shortEquation = moves.filter((m) => m.equationLength > 0 && m.equationLength <= 5);
  const highCells = new Set();
  for (const m of moves) if (m.score >= 50) for (const cell of m.newCells) if (EQ_PREMIUM.has(diag.slotAt(cell))) highCells.add(cell);
  return {
    legal: moves.length,
    best: best?.score ?? 0,
    top5Mean: round1(scores.slice(0, 5).reduce((s, v) => s + v, 0) / Math.max(1, Math.min(5, scores.length))),
    atLeast: { 50: scores.filter((s) => s >= 50).length, 80: scores.filter((s) => s >= 80).length, 120: scores.filter((s) => s >= 120).length },
    multiplierMoves: { count: multiplier.length, best: bestOf(multiplier) },
    coversEquationPremium: { count: moves.filter(coversEqPremium).length, best: bestOf(moves.filter(coversEqPremium)) },
    // Type-A signal: big points WITHOUT a long or many-tile construction.
    simple: { bestWithin3Tiles: bestOf(simple), within3TilesAtLeast50: simple.filter((m) => m.score >= 50).length },
    shortEquation: { best: bestOf(shortEquation) },
    bingo: { count: moves.filter((m) => m.newTileCount >= 8).length, best: bestOf(moves.filter((m) => m.newTileCount >= 8)) },
    bestMove: best && {
      id: best.id,
      score: best.score,
      newTileCount: best.newTileCount,
      equationLength: best.equationLength,
      equalsCount: best.equalsCount,
      usesMultiplier: usesMultiplier(best),
      modes: best.modes,
      text: best.mainRun?.text ?? null,
    },
    distinctEqPremiumCellsInMovesOver50: highCells.size,
    moves,
  };
}

/**
 * First-move candidates for the look-ahead: the highest-scoring moves, plus
 * "setup" moves — moves that do not cover an equation premium themselves but
 * put a tile within two cells of one the Space Map currently rates as hard to
 * reach (cost > 2 or unreachable). Only CANDIDATE generation is heuristic; each
 * candidate is then evaluated with real legal moves and Authur's real reply.
 */
export function lookaheadCandidates(moves, board, count) {
  const byScore = [...moves].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  const top = byScore.slice(0, Math.ceil(count * 0.6));
  const hard = board.premiumCells.filter((p) => EQ_PREMIUM.has(p.slot) && (!p.reachable || p.minCost == null || p.minCost > 2));
  const distance = (a, b) => Math.max(Math.abs((a % SIZE) - (b % SIZE)), Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE)));
  const setup = moves
    .filter((m) => !top.includes(m) && !coversEqPremium(m))
    .map((m) => ({ m, d: Math.min(Infinity, ...m.newCells.flatMap((c) => hard.map((p) => distance(c, p.cell)))) }))
    .filter((x) => x.d <= 2)
    .sort((a, b) => a.d - b.d || b.m.score - a.m.score || (a.m.id < b.m.id ? -1 : 1))
    .slice(0, count - top.length)
    .map((x) => x.m);
  return [...top.map((m) => ({ move: m, source: "score" })), ...setup.map((m) => ({ move: m, source: "setup" }))];
}

export { EQ_PREMIUM };
