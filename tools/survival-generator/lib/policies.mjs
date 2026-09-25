// Fast simulated PLAYER policies.
//
// All skill levels share one piece of work per position — the MENU:
//
//   1. the complete legal action set, generated once
//      (every placement, every exchange the gate allows, PASS);
//   2. one cheap equity per action, in points, computed once.
//
// A policy is then only a way of CHOOSING from that menu. Every noisy look is
// `equity + noise · Gumbel(0,1)`, i.e. a softmax with temperature `noise`:
//
//   1. FIND   each legal placement is found independently with probability
//             `notice`; if that finds fewer than `minFound`, more are found at
//             random until `minFound` (or all of them). Searching the board is
//             the skill; nobody scans every square, but nobody holding a legal
//             play on a cramped board finds none.
//   2. PICK   the best-LOOKING found placement (one noisy look each), and the
//             best-looking exchange (every kind-subset the rules allow: choosing
//             what to keep is a rack decision, not a board search).
//   3. DECIDE play that placement, make that exchange, or pass: whichever of
//             the three is worth more by the cheap equity, with no fresh noise.
//             Comparing FAMILIES once each stops the 255 exchange subsets, or a
//             thousand found placements, from winning merely because the maximum
//             of many noisy draws is large. It is noise-free because the first
//             prototype run showed a weak player passing with a found 10-point
//             play in hand about a quarter of the time: skill lives in what you
//             find and how you rank it, not in randomly declining to move.
//
// `notice` models how much of the board a player finds, `noise` how accurately
// they value what they found. Neither is "pick rank N"; repeated simulations
// make genuinely different decisions.
//
// Cheap equity, from the mover's own information only (own rack, the board,
// scores, and the PUBLIC counts: bag size, opponent rack size, and the unseen
// tile multiset a player can count). Never the bag order or the opponent's rack.
//
//   normal play      score + leave(kept tiles)
//                    leave = bot-lab `evaluateLeave` (points-denominated, scaled
//                    by how much of the next rack the kept tiles will be)
//   exchange         leave(kept tiles)            (no points now)
//   pass             leave(whole rack)
//   rack-out live    (opponent rack + bag <= 8, so emptying the rack ENDS the
//                    game) going out = score + 2 × unseen points (the exact
//                    bonus); anything else = score − points still held.
import { env, other } from "./rules.mjs";

export const PLAYER_POLICIES = Object.freeze({
  weak: Object.freeze({ notice: 0.06, minFound: 2, noise: 12 }),
  medium: Object.freeze({ notice: 0.25, minFound: 4, noise: 6 }),
  strong: Object.freeze({ notice: 1, minFound: Infinity, noise: 3 }),
});

/**
 * The policies a candidate is simulated with. `spec` names the choice
 * parameters AND the random stream, so `strong` and `strong-eg` make the very
 * same decisions — and meet the very same Authur replies — until the bag is
 * empty. They differ only in the bag-zero endgame, which is what makes the pair
 * a controlled measurement of the exact endgame.
 *
 *   exactEndgame  once bag == 0, play Authur's exact endgame solver's move. With
 *                 an empty bag the unseen tiles ARE the opponent's rack, which
 *                 any player can count, so this sees nothing a player cannot.
 *
 * `strong` is the fast policy throughout. The exploration of 2026-09-25 found
 * the exact endgame changed 4 of 176 paired outcomes for ~10% of all CPU and
 * added 60 s solver-clock cases, so it is an opt-in analysis arm only.
 */
export const POLICY_VARIANTS = Object.freeze({
  weak: Object.freeze({ spec: "weak", exactEndgame: false }),
  medium: Object.freeze({ spec: "medium", exactEndgame: false }),
  strong: Object.freeze({ spec: "strong", exactEndgame: false }),
  "strong-eg": Object.freeze({ spec: "strong", exactEndgame: true }),
});

export function mulberry32(seed) {
  let n = seed >>> 0;
  return () => {
    n = (n + 0x6d2b79f5) >>> 0;
    let t = n;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

const LEAVE = env.DEFAULT_CONFIG.leave;
const RATIO = env.DEFAULT_CONFIG.idealDigitRatio;

/** The public view that fully determines the menu — its cache key. */
export function menuKey(state) {
  const side = state.activeSide;
  const kindOf = state.manifest.kindOf;
  const board = [];
  state.board.forEach((cell, index) => {
    if (cell) board.push(`${index}${cell.kind}${cell.face}`);
  });
  return JSON.stringify([
    board.join(","),
    state.racks[side].map((id) => kindOf.get(id)).sort().join(","),
    state.racks[other(side)].length,
    state.bag.length,
  ]);
}

/**
 * Build the shared menu for the side to move. `legal` is rules.legalActions().
 * Entries are sorted by action id, so a seeded choice consumes its random
 * stream in the same order every time.
 */
export function buildMenu(state, legal) {
  const side = state.activeSide;
  const manifest = state.manifest;
  const kindOf = manifest.kindOf;
  const rack = state.racks[side];
  const bag = state.bag.length;
  const opponentTiles = state.racks[other(side)].length;
  const rackOutLive = opponentTiles + bag <= 8;
  // Unseen = bag + opponent rack: a multiset any player can count off the board.
  const unseenPoints = env.tilePoints(manifest, [...state.bag, ...state.racks[other(side)]]);
  const leaveMemo = new Map();
  const leaveOf = (keptIds) => {
    const kinds = keptIds.map((id) => kindOf.get(id));
    const key = [...kinds].sort().join(",");
    let value = leaveMemo.get(key);
    if (value === undefined) {
      value = env.evaluateLeave(
        keptIds.map((id, index) => ({ id, kind: kinds[index] })),
        LEAVE,
        RATIO,
        { rackSize: 8, poolCount: bag },
      ).total;
      leaveMemo.set(key, value);
    }
    return value;
  };
  const keptAfter = (usedIds) => {
    const used = new Set(usedIds);
    return rack.filter((id) => !used.has(id));
  };
  const entries = [];
  for (const place of legal.places) {
    const kept = keptAfter(place.action.placements.map((p) => p.tileId));
    let equity;
    if (rackOutLive) {
      equity = kept.length === 0 ? place.score + 2 * unseenPoints : place.score - env.tilePoints(manifest, kept);
    } else {
      equity = place.score + leaveOf(kept);
    }
    entries.push({
      id: place.id,
      family: "place",
      score: place.score,
      tiles: place.action.placements.length,
      equity,
      action: place.action,
    });
  }
  for (const exchange of legal.exchanges) {
    entries.push({
      id: exchange.id,
      family: "exchange",
      score: 0,
      tiles: exchange.action.tileIds.length,
      equity: leaveOf(keptAfter(exchange.action.tileIds)),
      action: exchange.action,
    });
  }
  entries.push({
    id: "pass",
    family: "pass",
    score: 0,
    tiles: 0,
    equity: rackOutLive ? -env.tilePoints(manifest, rack) : leaveOf(rack),
    action: { type: "pass" },
  });
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let bestEquity = -Infinity;
  for (const entry of entries) if (entry.equity > bestEquity) bestEquity = entry.equity;
  return {
    entries,
    bestEquity,
    places: legal.places.length,
    exchanges: legal.exchanges.length,
    rackOutLive,
  };
}

function gumbel(random) {
  const u = Math.min(Math.max(random(), 1e-12), 1 - 1e-12);
  return -Math.log(-Math.log(u));
}

/** The entry that looks best under one noisy look each. */
function noisyBest(entries, noise, random) {
  let best = null;
  let bestKey = -Infinity;
  for (const entry of entries) {
    const key = entry.equity + noise * gumbel(random);
    if (key > bestKey) {
      bestKey = key;
      best = entry;
    }
  }
  return best;
}

/** One decision by a skill policy. Pure given (menu, spec, random). */
export function choose(menu, spec, random) {
  const places = [];
  const exchanges = [];
  let pass = null;
  for (const entry of menu.entries) {
    if (entry.family === "place") places.push(entry);
    else if (entry.family === "exchange") exchanges.push(entry);
    else pass = entry;
  }
  // 1. FIND
  let found = places;
  if (spec.notice < 1) {
    found = [];
    const missed = [];
    for (const entry of places) (random() < spec.notice ? found : missed).push(entry);
    const floor = Math.min(places.length, spec.minFound);
    while (found.length < floor) {
      const index = Math.floor(random() * missed.length);
      found.push(missed[index]);
      missed[index] = missed[missed.length - 1];
      missed.pop();
    }
  }
  // 2. PICK within each family
  const options = [];
  if (found.length > 0) options.push(noisyBest(found, spec.noise, random));
  if (exchanges.length > 0) options.push(noisyBest(exchanges, spec.noise, random));
  options.push(pass);
  // 3. DECIDE between families on their equity. Ties keep the earlier option
  //    (placement, then exchange, then pass).
  let chosen = options[0];
  for (const option of options) if (option.equity > chosen.equity) chosen = option;
  let rank = 1;
  for (const entry of menu.entries) if (entry.equity > chosen.equity) rank += 1;
  return { entry: chosen, found: found.length, rank, loss: menu.bestEquity - chosen.equity };
}

/**
 * A menu is cached by PUBLIC position, so its actions may name other physical
 * copies of the same kinds. Rebind them to the rack actually held (moves are
 * identified by cell, kind and face, never by tile instance).
 */
export function onRack(state, action) {
  const kindOf = state.manifest.kindOf;
  const pool = [...state.racks[state.activeSide]];
  const take = (kind) => {
    const index = pool.findIndex((id) => kindOf.get(id) === kind);
    if (index < 0) throw new Error(`menu action needs a ${kind} the rack does not hold`);
    return pool.splice(index, 1)[0];
  };
  if (action.type === "place") {
    return { type: "place", placements: action.placements.map((p) => ({ ...p, tileId: take(p.kind) })) };
  }
  if (action.type === "exchange") {
    return { type: "exchange", tileIds: action.kinds.map(take), kinds: [...action.kinds] };
  }
  return action;
}
