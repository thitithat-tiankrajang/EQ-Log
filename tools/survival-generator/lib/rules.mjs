// The game the Survival generator simulates: EQ-Lab's rules, with the one
// Survival-specific change to the bag.
//
// Rules come from the bot-lab environment (`eqlab-compat`), the canonical turn
// order Authur was built on: score, terminal check on the pre-refill state,
// refill from the FRONT of the bag, and only then does an exchanged pile rejoin
// the bag. `verify.mjs` cross-checks every placement against EQ-Lab's own
// `validateMove`.
//
// SURVIVAL BAG RULE (`survival-fixed-v1`): the bag is an ordered queue fixed by
// the level. Draws come from the front, and an exchanged pile is appended to the
// BACK — as EQ-Lab's canonical reducer does (`settleDraw`) — in canonical kind
// order, so that the same exchange, however the tiles were picked, leaves the
// same bag. The remaining bag is never reshuffled. (The environment would
// reshuffle on an exchange; that one step is overridden here.)
import * as env from "../.vendor/authur-rules.mjs";

export const MAX_BAG = 100 - 2 * 8;
export const BAG_RULE = "survival-fixed-v1";

/** Canonical tile-kind order: EQ-Lab's tile manifest / the engine service's TOKEN_ORDER. */
export const KIND_ORDER = [
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
  "+", "-", "x", "/", "+/-", "x//", "=", "?",
];
const KIND_RANK = new Map(KIND_ORDER.map((kind, index) => [kind, index]));

export const other = (side) => (side === "A" ? "B" : "A");

function integer(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(`${name} must be a whole number (got ${value})`);
  return number;
}

/** Validate and normalise the candidate filters. Throws with every problem at once. */
export function validateFilters(input) {
  const problems = [];
  const range = input.bagRemainingRange;
  let bagRemainingRange = null;
  if (!Array.isArray(range) || range.length !== 2) {
    problems.push("bagRemainingRange must be [min, max]");
  } else {
    try {
      const min = integer(range[0], "bagRemainingRange min");
      const max = integer(range[1], "bagRemainingRange max");
      if (min < 0) problems.push(`bagRemainingRange min ${min} < 0`);
      if (max > MAX_BAG) problems.push(`bagRemainingRange max ${max} > ${MAX_BAG} (the bag never holds more)`);
      if (min > max) problems.push(`bagRemainingRange min ${min} > max ${max}`);
      bagRemainingRange = [min, max];
    } catch (error) {
      problems.push(error.message);
    }
  }
  let scoreGapRange = null;
  if (input.scoreGapRange != null) {
    const [low, high] = input.scoreGapRange;
    try {
      scoreGapRange = [integer(low, "scoreGapRange min"), integer(high, "scoreGapRange max")];
      if (scoreGapRange[0] > scoreGapRange[1]) problems.push("scoreGapRange min > max");
    } catch (error) {
      problems.push(error.message);
    }
  }
  if (problems.length > 0) throw new Error(`Invalid generator filters:\n  - ${problems.join("\n  - ")}`);
  return {
    bagRemainingRange,
    // Player score minus Authur score at the snapshot, inclusive. null = any.
    scoreGapRange,
    // A live room starts with an empty event log, so the engine service would
    // see an empty scoreless-turn streak. Until live rooms can carry a streak,
    // only snapshots whose streak is empty replay exactly in production.
    requireEmptyScorelessTail: input.requireEmptyScorelessTail !== false,
  };
}

/** Is this decision point an eligible Survival snapshot? Returns the reason if not. */
export function eligibility(state, filters) {
  const bag = state.bag.length;
  const [min, max] = filters.bagRemainingRange;
  if (bag < min || bag > max) return `bag ${bag} outside [${min}, ${max}]`;
  if (state.pendingReturn.A.length + state.pendingReturn.B.length > 0) return "exchange pile standing";
  if (filters.requireEmptyScorelessTail && state.noScoreTail.length > 0) {
    return `scoreless streak ${state.noScoreTail.length}`;
  }
  const side = state.activeSide;
  const gap = state.scores[side] - state.scores[other(side)];
  if (filters.scoreGapRange && (gap < filters.scoreGapRange[0] || gap > filters.scoreGapRange[1])) {
    return `score gap ${gap} outside [${filters.scoreGapRange[0]}, ${filters.scoreGapRange[1]}]`;
  }
  return null;
}

const kindsOf = (state, ids) => ids.map((id) => state.manifest.kindOf.get(id));

/** Everything needed to continue this exact game. Tile identities are by kind. */
export function snapshotOf(state) {
  if (state.terminal) throw new Error("cannot snapshot a finished game");
  if (state.pendingReturn.A.length + state.pendingReturn.B.length > 0) {
    throw new Error("cannot snapshot with an exchange pile standing");
  }
  const board = [];
  state.board.forEach((cell, index) => {
    if (cell) board.push({ cell: index, kind: cell.kind, face: cell.face, side: cell.side, turn: cell.turn });
  });
  return {
    format: "survival-snapshot-v1",
    rules: state.rules.id,
    bagRule: BAG_RULE,
    board,
    racks: { A: kindsOf(state, state.racks.A), B: kindsOf(state, state.racks.B) },
    // Front of the bag first: bag[0] is the next tile drawn.
    bag: kindsOf(state, state.bag),
    scores: { A: state.scores.A, B: state.scores.B },
    sideToMove: state.activeSide,
    turnNumber: state.turnNumber,
    noScoreTail: [...state.noScoreTail],
    hasPlacement: state.hasPlacement,
  };
}

/** Rebuild a playable state from a snapshot (after any JSON round trip). */
export function stateFromSnapshot(snapshot) {
  if (snapshot.format !== "survival-snapshot-v1") throw new Error(`unknown snapshot format ${snapshot.format}`);
  if (snapshot.bagRule !== BAG_RULE) throw new Error(`unknown bag rule ${snapshot.bagRule}`);
  const manifest = env.createManifest();
  const free = new Map();
  for (const tile of manifest.tiles) {
    const copies = free.get(tile.kind) ?? [];
    copies.push(tile.id);
    free.set(tile.kind, copies);
  }
  const take = (kind) => {
    const id = free.get(kind)?.shift();
    if (!id) throw new Error(`snapshot holds more ${kind} tiles than exist`);
    return id;
  };
  const board = Array.from({ length: 225 }, () => null);
  for (const placed of snapshot.board) {
    board[placed.cell] = {
      tileId: take(placed.kind),
      kind: placed.kind,
      face: placed.face,
      side: placed.side,
      turn: placed.turn,
    };
  }
  const state = env.envStateFrom({
    manifest,
    board,
    racks: { A: snapshot.racks.A.map(take), B: snapshot.racks.B.map(take) },
    pendingReturn: { A: [], B: [] },
    bag: snapshot.bag.map(take),
    scores: { ...snapshot.scores },
    activeSide: snapshot.sideToMove,
    turnNumber: snapshot.turnNumber,
    noScoreTail: [...snapshot.noScoreTail],
    hasPlacement: snapshot.hasPlacement,
    seed: 1,
    rngStep: 0,
  });
  if (state.rules.id !== snapshot.rules) throw new Error(`rules ${state.rules.id} != snapshot ${snapshot.rules}`);
  return state;
}

/** One turn under Survival rules. Same result shape as env.applyAction. */
export function applySurvival(state, action) {
  const result = env.applyAction(state, action);
  if (result.terminal || result.returned.length === 0) return result;
  const afterDraw = state.bag.slice(result.drawn.length);
  const kindOf = state.manifest.kindOf;
  const returned = [...result.returned].sort(
    (a, b) =>
      KIND_RANK.get(kindOf.get(a)) - KIND_RANK.get(kindOf.get(b)) || (a < b ? -1 : a > b ? 1 : 0),
  );
  return { ...result, state: { ...result.state, bag: [...afterDraw, ...returned] } };
}

/**
 * Board openness, from the move generator's own space map: which empty cells
 * any continuation of at most a rack's worth of tiles could reach, from the
 * board alone (no rack, so it is the same for both players).
 */
export function boardOpenness(state) {
  const stats = env.buildFromBoard(state.board, state.rules).stats();
  return {
    reachableCells: stats.reachableCells,
    anchors: stats.anchors,
    blockedCells: stats.blockedCells,
    candidates: stats.candidates,
    truncated: stats.truncated,
  };
}

/** Compact, instance-free record of an action (the shape Survival replays store). */
export function encodeAction(action) {
  if (action.type === "place") {
    return {
      type: "place",
      placements: action.placements.map((p) => ({ cell: p.cell, kind: p.kind, face: p.face })),
    };
  }
  if (action.type === "exchange") return { type: "exchange", kinds: [...action.kinds] };
  return { type: "pass" };
}

/** The complete legal action set for the side to move: placements, exchanges, PASS. */
export async function legalActions(state) {
  // The same complete generator Authur's own search starts from: no node
  // budget, no truncation. Exchanges are every kind-multiset the gate allows.
  const root = await env.completeRootActions(state);
  if (!root.complete || root.truncated) throw new Error("legal move generation did not complete");
  return { places: root.places, exchanges: root.exchanges, exchangeAllowed: env.exchangeAllowed(state) };
}

export { env };
