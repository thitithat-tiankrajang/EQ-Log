// One generator worker thread. Holds Authur (models loaded once) and caches of
// SAFE deterministic work:
//
//   menus     public position -> legal actions + cheap equities (shared by every
//             player policy that reaches the same position in this worker)
//   decisions Authur request + config -> Authur's move, locally AND through the
//             pool's shared table (lib/pool.mjs). Offline Authur is
//             deterministic, so a repeated request is the same answer.
//
// CPU is measured per THREAD (process.threadCpuUsage), so seven workers running
// side by side do not count each other's time, and time spent waiting for
// another worker's answer is not counted as work.
import { parentPort, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { loadAuthur, onRealTiles, requestFor, seedFor } from "./lib/authur.mjs";
import {
  applySurvival,
  boardOpenness,
  eligibility,
  encodeAction,
  env,
  legalActions,
  other,
  snapshotOf,
  stateFromSnapshot,
} from "./lib/rules.mjs";
import {
  PLAYER_POLICIES,
  POLICY_VARIANTS,
  buildMenu,
  choose,
  menuKey,
  mulberry32,
  onRack,
} from "./lib/policies.mjs";
import { verifyPlacement } from "./lib/verify.mjs";
import { boardOpportunity, lookaheadCandidates, rackOpportunity } from "./lib/opportunity.mjs";
import { initialRecord, turnRecord } from "./lib/sourcelog.mjs";

const authur = await loadAuthur(workerData?.authurDir);
const cpu = () => {
  const usage = process.threadCpuUsage();
  return (usage.user + usage.system) / 1000;
};

// ── shared decision table (see lib/pool.mjs) ─────────────────────────────────
const replies = new Map();
let nextRid = 0;
function askPool(key) {
  return new Promise((resolveReply) => {
    const rid = ++nextRid;
    replies.set(rid, resolveReply);
    parentPort.postMessage({ type: "cache-get", rid, key });
  });
}

const MENU_CACHE_MAX = 64;
const menus = new Map();
const local = new Map();
const counters = { menuHits: 0, menuMisses: 0, localHits: 0, sharedHits: 0, computed: 0 };

async function menuFor(state, clock) {
  const key = menuKey(state);
  const cached = menus.get(key);
  if (cached) {
    counters.menuHits += 1;
    return { menu: cached, cached: true };
  }
  counters.menuMisses += 1;
  let t = cpu();
  const legal = await legalActions(state);
  clock.movegen += cpu() - t;
  t = cpu();
  const menu = buildMenu(state, legal);
  clock.evaluate += cpu() - t;
  menus.set(key, menu);
  if (menus.size > MENU_CACHE_MAX) menus.delete(menus.keys().next().value);
  return { menu, cached: false };
}

/** Authur's decision for the side to move. `source`: local | shared | computed. */
async function authurDecision(state, seedKey, config = "offline") {
  const request = requestFor(state, seedKey);
  const key = `${config}|${JSON.stringify(request)}`;
  const known = local.get(key);
  if (known) {
    counters.localHits += 1;
    return { entry: known, source: "local", request };
  }
  const reply = await askPool(key);
  if (reply.value) {
    counters.sharedHits += 1;
    local.set(key, reply.value);
    return { entry: reply.value, source: "shared", request };
  }
  counters.computed += 1;
  let entry;
  try {
    const c0 = cpu();
    const w0 = performance.now();
    const decision = await authur.decide(request, config);
    entry = {
      action: decision.action,
      id: decision.id,
      score: decision.trace.chosenImmediateScore,
      cpuMs: cpu() - c0,
      wallMs: performance.now() - w0,
      endgame: Boolean(decision.endgame),
      exact: decision.endgame ? decision.endgame.exact === true : null,
      mode: decision.endgame ? decision.endgame.mode : null,
      netFired: decision.trace.safetyNetFired === true,
    };
  } catch (error) {
    if (!reply.private) parentPort.postMessage({ type: "cache-abandon", key });
    throw error;
  }
  // An endgame that ran out of its own 60 s clock is timing-dependent: keep it
  // out of every cache so it cannot masquerade as a determined answer.
  const timingDependent = entry.endgame && entry.exact === false;
  if (!timingDependent) local.set(key, entry);
  if (!reply.private) {
    parentPort.postMessage(
      timingDependent ? { type: "cache-abandon", key } : { type: "cache-put", key, value: entry },
    );
  }
  if (local.size > 20_000) local.delete(local.keys().next().value);
  return { entry, source: "computed", request };
}

function apply(state, action, clock, checks) {
  let t = cpu();
  const result = applySurvival(state, action);
  clock.apply += cpu() - t;
  if (action.type === "place") {
    t = cpu();
    const check = verifyPlacement(state, action, result.scoreGained);
    clock.verify += cpu() - t;
    checks.placements += 1;
    if (!check.ok) checks.mismatches.push({ turn: state.turnNumber, ...check, action: encodeAction(action) });
  }
  return result;
}

const newClock = () => ({
  movegen: 0,
  evaluate: 0,
  select: 0,
  solver: 0,
  authur: 0,
  apply: 0,
  verify: 0,
});

const snapshotFacts = async (state) => {
  const legal = await legalActions(state);
  return {
    bag: state.bag.length,
    gap: state.scores[state.activeSide] - state.scores[other(state.activeSide)],
    side: state.activeSide,
    turn: state.turnNumber,
    legalPlaces: legal.places.length,
    legalExchanges: legal.exchanges.length,
    // Tiles on the board. With both racks full this is 84 - bag, so inside a
    // midgame window it mostly restates the bag count; kept because it is free.
    boardTiles: state.board.filter(Boolean).length,
    openness: boardOpenness(state),
  };
};

/**
 * Authur vs Authur from a fresh seeded deal, through the whole bag window.
 * Returns EVERY eligible decision point (untouched snapshots) so the caller can
 * take at most one per game, plus the source log: the deal and one full record
 * per turn (lib/sourcelog.mjs). A point's log is `history.slice(0, historyLength)`.
 */
async function source({ sourceSeed, filters }) {
  const w0 = performance.now();
  const c0 = cpu();
  const checks = { placements: 0, mismatches: [] };
  let state = env.createEnvState({ seed: sourceSeed });
  const initial = initialRecord(state);
  const history = [];
  const eligible = [];
  const skipped = [];
  let endedBy = "bag below range";
  while (state.bag.length >= filters.bagRemainingRange[0]) {
    const reason = eligibility(state, filters);
    if (reason === null) {
      eligible.push({ snapshot: snapshotOf(state), historyLength: history.length, ...(await snapshotFacts(state)) });
    } else if (state.bag.length <= filters.bagRemainingRange[1]) {
      skipped.push({ turn: state.turnNumber, bag: state.bag.length, reason });
    }
    const { entry, request } = await authurDecision(state, `source:${sourceSeed}`);
    const action = onRealTiles(state, entry.action);
    const result = env.applyAction(state, action);
    if (action.type === "place") {
      const check = verifyPlacement(state, action, result.scoreGained);
      checks.placements += 1;
      if (!check.ok) checks.mismatches.push({ turn: state.turnNumber, ...check });
    }
    if (result.terminal) {
      // Nothing after the last decision point is ever part of a level's log.
      endedBy = result.terminal.reason;
      break;
    }
    history.push(turnRecord(state, action, result, { by: "authur", id: entry.id, seed: request.seed }));
    state = result.state;
  }
  return {
    sourceSeed,
    eligible,
    skipped,
    initial,
    history,
    checks,
    endedBy,
    cpuMs: cpu() - c0,
    wallMs: performance.now() - w0,
  };
}

/** One full playout: a player policy (or the Authur reference) vs Authur, to the end. */
async function playout({ snapshot, levelKey, policy, sim, collectRequests = 0 }) {
  const w0 = performance.now();
  const c0 = cpu();
  const clock = newClock();
  const checks = { placements: 0, mismatches: [] };
  const before = { ...counters };
  let state = stateFromSnapshot(snapshot);
  const player = snapshot.sideToMove;
  const variant = POLICY_VARIANTS[policy] ?? null;
  const spec = variant ? PLAYER_POLICIES[variant.spec] : null;
  const actions = [];
  const playerTurns = [];
  const authurTurns = [];
  const requests = [];
  for (let guard = 0; !state.terminal; guard += 1) {
    if (guard > 200) throw new Error("playout did not terminate");
    const side = state.activeSide;
    let action;
    let id;
    if (side === player && variant && !(variant.exactEndgame && state.bag.length === 0)) {
      const { menu, cached } = await menuFor(state, clock);
      const t = cpu();
      const random = mulberry32(seedFor(`${levelKey}|${variant.spec}|${sim}`, state.turnNumber));
      const pick = choose(menu, spec, random);
      clock.select += cpu() - t;
      action = onRack(state, pick.entry.action);
      id = pick.entry.id;
      playerTurns.push({
        turn: state.turnNumber,
        bag: state.bag.length,
        legalPlaces: menu.places,
        legalExchanges: menu.exchanges,
        forced: menu.places + menu.exchanges === 0,
        found: pick.found,
        rank: pick.rank,
        loss: Math.round(pick.loss * 10) / 10,
        family: pick.entry.family,
        tiles: pick.entry.tiles,
        menuCached: cached,
      });
    } else if (side === player && variant) {
      // STRONG at bag 0: Authur's exact endgame solver plays the player's move.
      // The request carries the player's own view; with the bag empty the
      // unseen tiles are exactly the opponent's rack, which is countable.
      const { menu } = await menuFor(state, clock); // legal counts for diagnostics
      const t = cpu();
      const { entry, source: from } = await authurDecision(state, `${levelKey}|strong-endgame`);
      const spent = cpu() - t;
      clock.solver += spent;
      action = onRealTiles(state, entry.action);
      id = entry.id;
      playerTurns.push({
        turn: state.turnNumber,
        bag: 0,
        legalPlaces: menu.places,
        legalExchanges: menu.exchanges,
        forced: menu.places + menu.exchanges === 0,
        solver: true,
        solverSource: from,
        solverComputeCpuMs: Math.round(entry.cpuMs),
        solverSpentCpuMs: Math.round(spent),
        solverWallMs: Math.round(entry.wallMs),
        exact: entry.exact,
        mode: entry.mode,
        family: action.type,
      });
    } else {
      const seedKey = side === player ? `${levelKey}|reference|${sim}` : `${levelKey}|authur`;
      const t = cpu();
      const { entry, source: from, request } = await authurDecision(state, seedKey);
      const spent = cpu() - t;
      clock.authur += spent;
      if (side !== player && requests.length < collectRequests) requests.push({ request, offlineId: entry.id });
      action = onRealTiles(state, entry.action);
      id = entry.id;
      const record = {
        turn: state.turnNumber,
        bag: state.bag.length,
        source: from,
        computeCpuMs: Math.round(entry.cpuMs),
        spentCpuMs: Math.round(spent),
        endgame: entry.endgame,
        exact: entry.exact,
        mode: entry.mode,
        netFired: entry.netFired,
      };
      if (side === player) playerTurns.push({ ...record, family: action.type, reference: true });
      else authurTurns.push(record);
    }
    const result = apply(state, action, clock, checks);
    actions.push({ side, turn: state.turnNumber, id, score: result.scoreGained, move: encodeAction(action) });
    state = result.state;
  }
  const scores = { ...state.scores };
  const margin = scores[player] - scores[other(player)];
  // A game is timing-affected if ANY Authur decision in it (opponent, the
  // reference player, or Strong's optional exact endgame) came back not exact:
  // the exact solver's own 60 s wall clock ran out, so that move may differ on
  // another machine or under another load.
  const timingAffected =
    authurTurns.some((t) => t.endgame && t.exact === false) ||
    playerTurns.some((t) => (t.solver || t.reference) && (t.exact === false || t.mode === "partial"));
  return {
    policy,
    sim,
    timingAffected,
    outcome: margin > 0 ? "win" : margin < 0 ? "loss" : "tie",
    margin,
    scores,
    end: state.terminal.reason,
    endBag: state.bag.length,
    turns: actions.length,
    actions,
    playerTurns,
    authurTurns,
    requests,
    checks,
    clock,
    cpuMs: cpu() - c0,
    wallMs: performance.now() - w0,
    cache: Object.fromEntries(Object.keys(counters).map((k) => [k, counters[k] - before[k]])),
  };
}

/** Recompute Authur decisions under a given config, uncached, one at a time. */
async function authurBatch({ items, config }) {
  const out = [];
  for (const item of items) {
    const c0 = cpu();
    const w0 = performance.now();
    const decision = await authur.decide(item.request, config);
    out.push({
      offlineId: item.offlineId,
      id: decision.id,
      cpuMs: cpu() - c0,
      wallMs: performance.now() - w0,
      netFired: decision.trace.safetyNetFired === true,
      candidates: decision.candidates.map((c) => ({ id: c.id, q: c.q, tier: c.tier })),
    });
  }
  return out;
}

/**
 * Scoring-opportunity diagnostics for one snapshot. GENERATOR-ONLY research
 * metadata: it reads Authur's rack and the fixed bag, so nothing here may ever
 * reach a player policy.
 *
 *   board / rack / threat   see lib/opportunity.mjs
 *   future (two-turn look-ahead, per first-move candidate m1):
 *     the player plays m1 and refills from the FRONT of the fixed bag; Authur
 *     replies (the real, deterministic level opponent); the player's best
 *     legal next score is then measured
 *       exact  with the draws the fixed bag really gives        (futureOpportunityCompatibility)
 *       blind  with those draws resampled from the tiles the player could not
 *              see (bag + Authur's rack)                        (bag-blind counterpart)
 *     value(m1) = change in (player − Authur) over m1 and the reply + best next score.
 */
async function opportunity({ snapshot, levelKey, firstMoves = 16, blindSamples = 4, lookahead = true }) {
  const w0 = performance.now();
  const c0 = cpu();
  const state = stateFromSnapshot(snapshot);
  const player = snapshot.sideToMove;
  const authurSide = other(player);
  const board = boardOpportunity(state);
  const rack = await rackOpportunity(state, player);
  const simulatorLegal = (await legalActions(state)).places.length;
  if (simulatorLegal !== rack.legal) {
    throw new Error(`diagnostic move list (${rack.legal}) disagrees with the simulator (${simulatorLegal})`);
  }
  const threat = await rackOpportunity(state, authurSide);
  const diff = (s) => s.scores[player] - s.scores[authurSide];
  const d0 = diff(state);
  let future = null;
  let timingAffectedReplies = 0;
  if (lookahead && rack.moves.length > 0) {
    const rows = [];
    for (const { move, source } of lookaheadCandidates(rack.moves, board, firstMoves)) {
      const row = { id: move.id, source, score: move.score, tiles: move.newTileCount, greedy: move.id === rack.bestMove.id };
      const r1 = applySurvival(state, onRack(state, move.move));
      if (r1.terminal) {
        row.terminal = r1.terminal.reason;
        row.exact = row.blind = diff(r1.state) - d0;
        rows.push(row);
        continue;
      }
      const state1 = r1.state;
      const { entry } = await authurDecision(state1, `${levelKey}|authur`);
      if (entry.endgame && entry.exact === false) timingAffectedReplies += 1;
      const r2 = applySurvival(state1, onRealTiles(state1, entry.action));
      const state2 = r2.state;
      const swing = diff(state2) - d0;
      row.reply = r2.scoreGained;
      if (r2.terminal) {
        row.replyTerminal = r2.terminal.reason;
        row.exact = row.blind = swing;
        rows.push(row);
        continue;
      }
      const bestNext = async (s) => (await legalActions(s)).places.reduce((best, p) => Math.max(best, p.score), 0);
      row.exactNext = await bestNext(state2);
      const drawn = r1.drawn;
      const kept = state2.racks[player].filter((id) => !drawn.includes(id));
      const pool = [...state2.bag, ...state2.racks[authurSide], ...drawn];
      let blindTotal = 0;
      for (let k = 0; k < blindSamples; k += 1) {
        const random = mulberry32(seedFor(`${levelKey}|blind|${move.id}`, k));
        const shuffled = [...pool];
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
          const j = Math.floor(random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const taken = shuffled.slice(0, drawn.length);
        const rest = shuffled.slice(drawn.length);
        const authurCount = state2.racks[authurSide].length;
        const sample = env.envStateFrom({
          manifest: state2.manifest,
          board: state2.board,
          racks: { [player]: [...kept, ...taken], [authurSide]: rest.slice(0, authurCount) },
          pendingReturn: { A: [], B: [] },
          bag: rest.slice(authurCount),
          scores: state2.scores,
          activeSide: player,
          turnNumber: state2.turnNumber,
          noScoreTail: state2.noScoreTail,
          hasPlacement: true,
          seed: 1,
          rngStep: 0,
        });
        blindTotal += await bestNext(sample);
      }
      row.blindNext = Math.round((blindTotal / blindSamples) * 10) / 10;
      row.exact = swing + row.exactNext;
      row.blind = swing + row.blindNext;
      rows.push(row);
    }
    const best = (key) => rows.reduce((b, r) => (r[key] > b[key] ? r : b));
    const bestExact = best("exact");
    const bestBlind = best("blind");
    const greedy = rows.find((r) => r.greedy) ?? rows[0];
    future = {
      candidates: rows.length,
      futureOpportunityCompatibility: bestExact.exact,
      bagBlindTwoTurn: bestBlind.blind,
      seedLift: Math.round((bestExact.exact - bestBlind.blind) * 10) / 10,
      greedyExact: greedy.exact,
      greedyBlind: greedy.blind,
      planningGainExact: Math.round((bestExact.exact - greedy.exact) * 10) / 10,
      planningGainBlind: Math.round((bestBlind.blind - greedy.blind) * 10) / 10,
      bestExactPlan: bestExact,
      bestBlindPlan: bestBlind,
      // Authur replies whose exact endgame ran out of its 60 s clock.
      timingAffectedReplies,
      rows,
    };
  }
  const { moves: _playerMoves, ...rackSummary } = rack;
  const { moves: _authurMoves, ...threatSummary } = threat;
  return {
    deficit: -d0,
    bag: state.bag.length,
    board,
    rack: rackSummary,
    threat: threatSummary,
    future,
    cpuMs: cpu() - c0,
    wallMs: performance.now() - w0,
  };
}

/** Starting facts of a stored snapshot: bag, gap, legal moves, board openness. */
async function facts({ snapshot }) {
  return snapshotFacts(stateFromSnapshot(snapshot));
}

const tasks = { source, playout, authurBatch, facts, opportunity };
parentPort.on("message", async (message) => {
  if (message.type === "cache-reply") {
    const resolveReply = replies.get(message.rid);
    replies.delete(message.rid);
    resolveReply(message);
    return;
  }
  try {
    const result = await tasks[message.task](message.payload);
    parentPort.postMessage({ id: message.id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({ id: message.id, ok: false, error: String(error?.stack ?? error) });
  }
});
parentPort.postMessage({ ready: true });
