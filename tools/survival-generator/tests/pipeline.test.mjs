// Focused tests for the offline candidate pipeline.
//   node --test tools/survival-generator/tests/pipeline.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND_ORDER,
  applySurvival,
  env,
  legalActions,
  snapshotOf,
  stateFromSnapshot,
} from "../lib/rules.mjs";
import { rackOpportunity } from "../lib/opportunity.mjs";
import { DEFAULT_ROUTING, pipelineStatus, route, validateRouting } from "../lib/routing.mjs";
import {
  PUBLIC_KEYS,
  buildCandidate,
  canonicalJson,
  contentHash,
  playerView,
  positionHash,
  validateCandidate,
} from "../lib/candidate.mjs";
import {
  buildSourceLog,
  initialRecord,
  playerSourceLog,
  replaySourceLog,
  sourceLogProblems,
  stateHash,
  turnRecord,
} from "../lib/sourcelog.mjs";
import {
  DEFAULT_PREFILTER,
  cheapFeatures,
  isPromising,
  prefilterReasons,
  screen,
  selectTop,
  strategicEvaluation,
  tacticalEvaluation,
} from "../lib/evaluation.mjs";

// ── helpers: authentic-enough positions from the real rules, no Authur needed ─
const kindOf = (state, id) => state.manifest.kindOf.get(id);
/** Best-scoring placement; with none, swap the whole rack (as a player would); else pass. */
async function greedy(state) {
  const { places, exchanges } = await legalActions(state);
  if (places.length > 0) {
    return places.reduce((b, p) => (p.score > b.score || (p.score === b.score && p.id < b.id) ? p : b)).action;
  }
  if (exchanges.length > 0) {
    return exchanges.reduce((b, e) => (e.action.tileIds.length > b.action.tileIds.length ? e : b)).action;
  }
  return { type: "pass" };
}
/** Play until at least `placements` placements are on the board — a real position, never an empty one. */
async function midgame(seed, placements) {
  let state = env.createEnvState({ seed });
  let placed = 0;
  for (let ply = 0; placed < placements && !state.terminal; ply += 1) {
    if (ply > 80) throw new Error(`seed ${seed}: no midgame after 80 plies`);
    const action = await greedy(state);
    if (action.type === "place") placed += 1;
    state = env.applyAction(state, action).state;
  }
  if (state.board.every((cell) => cell === null)) throw new Error(`seed ${seed}: empty board`);
  return state;
}
/**
 * A recorded source game: from the authentic deal of `seed`, greedy moves (an
 * exchange forced at each ply in `exchangeAt`), recorded exactly as the
 * worker's `source` task records Authur's, until `placements` placements.
 */
async function recordedGame(seed, placements, { exchangeAt = [] } = {}) {
  let state = env.createEnvState({ seed });
  const initial = initialRecord(state);
  const turns = [];
  let placed = 0;
  for (let ply = 0; placed < placements; ply += 1) {
    if (ply > 80) throw new Error(`seed ${seed}: no midgame after 80 plies`);
    let action = await greedy(state);
    if (exchangeAt.includes(ply)) {
      const { exchanges } = await legalActions(state);
      // An exchange of several different kinds, so that its order matters.
      const mixed = exchanges.filter((e) => new Set(e.action.kinds).size >= 3);
      if (mixed.length > 0) action = mixed[Math.floor(mixed.length / 2)].action;
    }
    const result = env.applyAction(state, action);
    if (result.terminal) throw new Error(`seed ${seed}: the source game ended`);
    turns.push(turnRecord(state, action, result, { by: "test-greedy" }));
    if (action.type === "place") placed += 1;
    state = result.state;
  }
  const snapshot = JSON.parse(JSON.stringify(snapshotOf(state)));
  return { state, snapshot, log: buildSourceLog({ sourceSeed: seed, initial, turns, snapshot }) };
}
const kinds = (state, ids) => ids.map((id) => kindOf(state, id));
const view = (state) => ({
  board: state.board.map((c) => (c ? `${c.kind}:${c.face}:${c.side}` : null)),
  racks: { A: kinds(state, state.racks.A).sort(), B: kinds(state, state.racks.B).sort() },
  bag: kinds(state, state.bag),
  scores: { ...state.scores },
  side: state.activeSide,
  turn: state.turnNumber,
  tail: [...state.noScoreTail],
  terminal: state.terminal?.reason ?? null,
});
/** Rebind an action's tiles to another state's copies of the same kinds. */
function rebind(state, action) {
  const pool = [...state.racks[state.activeSide]];
  const take = (kind) => pool.splice(pool.findIndex((id) => kindOf(state, id) === kind), 1)[0];
  if (action.type === "place") return { type: "place", placements: action.placements.map((p) => ({ ...p, tileId: take(p.kind) })) };
  if (action.type === "exchange") return { type: "exchange", tileIds: action.kinds.map(take), kinds: [...action.kinds] };
  return action;
}

// ── routing ──────────────────────────────────────────────────────────────────
test("routing: thresholds are inclusive at both ends and the raw value is kept", () => {
  const t = { tacticalMax: 20, strategicMin: 60 };
  assert.equal(route(0, t).route, "TACTICAL");
  assert.equal(route(20, t).route, "TACTICAL");
  assert.equal(route(20.1, t).route, "UNCERTAIN");
  assert.equal(route(59.9, t).route, "UNCERTAIN");
  assert.equal(route(60, t).route, "STRATEGIC");
  assert.equal(route(104.8, t).planningGainBlind, 104.8);
  assert.match(route(45, t).reason, /tacticalMax 20 < planningGainBlind 45 < strategicMin 60/);
  assert.equal(route(null, t).route, "UNCERTAIN");
  assert.equal(route(Number.NaN, t).route, "UNCERTAIN");
  assert.throws(() => validateRouting({ tacticalMax: 60, strategicMin: 60 }));
  assert.equal(route(10).route, "TACTICAL", "defaults apply");
  assert.deepEqual(Object.keys(DEFAULT_ROUTING).sort(), ["strategicMin", "tacticalMax"]);
});

test("status: research statuses follow what each evaluation reached", () => {
  assert.equal(pipelineStatus("TACTICAL", "confirmed", null), "TACTICAL_CONFIRMED");
  assert.equal(pipelineStatus("TACTICAL", "screened", null), "SCREENED");
  assert.equal(pipelineStatus("STRATEGIC", null, "confirmed"), "STRATEGIC_CONFIRMED");
  assert.equal(pipelineStatus("STRATEGIC", null, "timing_limited"), "TIMING_LIMITED");
  assert.equal(pipelineStatus("UNCERTAIN", "confirmed", "confirmed"), "BOTH_CONFIRMED");
  assert.equal(pipelineStatus("UNCERTAIN", "confirmed", "timing_limited"), "TACTICAL_CONFIRMED");
  assert.equal(pipelineStatus("UNCERTAIN", "screened", "confirmed"), "STRATEGIC_CONFIRMED");
  assert.equal(pipelineStatus("UNCERTAIN", "screened", "timing_limited"), "TIMING_LIMITED");
  assert.equal(pipelineStatus("TACTICAL", null, null), "UNCONFIRMED");
});

// ── snapshots and the fixed bag ──────────────────────────────────────────────
test("snapshot: round trip conserves all 100 tiles and refuses an impossible one", async () => {
  const state = await midgame(71001, 8);
  const snapshot = JSON.parse(JSON.stringify(snapshotOf(state)));
  const rebuilt = stateFromSnapshot(snapshot);
  assert.deepEqual(view(rebuilt), view(state));
  const counted = new Map();
  for (const tile of snapshot.board) counted.set(tile.kind, (counted.get(tile.kind) ?? 0) + 1);
  for (const kind of [...snapshot.racks.A, ...snapshot.racks.B, ...snapshot.bag]) counted.set(kind, (counted.get(kind) ?? 0) + 1);
  const manifest = new Map();
  for (const tile of env.createManifest().tiles) manifest.set(tile.kind, (manifest.get(tile.kind) ?? 0) + 1);
  assert.deepEqual([...counted.entries()].sort(), [...manifest.entries()].sort());
  const tampered = { ...snapshot, bag: [...snapshot.bag, snapshot.bag[0]] };
  assert.throws(() => stateFromSnapshot(tampered));
});

test("fixed bag: draws come from the front, exchanges go to the back in kind order, never reshuffled", async () => {
  const original = await midgame(71002, 6);
  const snapshot = JSON.parse(JSON.stringify(snapshotOf(original)));
  let a = original;
  let b = stateFromSnapshot(snapshot);
  let exchangesChecked = 0;
  let placementsChecked = 0;
  for (let step = 0; step < 8 && !a.terminal; step += 1) {
    let action = await greedy(a);
    if (step === 2) {
      const exchanges = (await legalActions(a)).exchanges;
      if (exchanges.length > 0) action = exchanges[Math.floor(exchanges.length / 2)].action;
    }
    const bagBefore = kinds(a, a.bag);
    const ra = applySurvival(a, action);
    const rb = applySurvival(b, rebind(b, action));
    assert.deepEqual(view(rb.state), view(ra.state), `continuation diverged at step ${step}`);
    if (!ra.terminal) {
      const after = kinds(ra.state, ra.state.bag);
      const drawn = ra.drawn.length;
      const returned = kinds(a, ra.returned).sort((x, y) => KIND_ORDER.indexOf(x) - KIND_ORDER.indexOf(y));
      assert.deepEqual(after, [...bagBefore.slice(drawn), ...returned], `bag rule broken at step ${step} (${action.type})`);
      if (action.type === "exchange") exchangesChecked += 1;
      if (action.type === "place") placementsChecked += 1;
    }
    a = ra.state;
    b = rb.state;
  }
  assert.ok(exchangesChecked >= 1, "the exchange rule must actually be exercised");
  assert.ok(placementsChecked >= 3, "the draw rule must actually be exercised");
});

test("diagnostics: the opportunity move list is exactly the simulator's", async () => {
  for (const [seed, plies] of [[71003, 4], [71004, 9], [71005, 14]]) {
    const state = await midgame(seed, plies);
    const simulator = await legalActions(state);
    const diagnostic = await rackOpportunity(state, state.activeSide);
    assert.equal(diagnostic.legal, simulator.places.length, `seed ${seed}`);
    assert.deepEqual(diagnostic.moves.map((m) => m.id).sort(), simulator.places.map((p) => p.id).sort());
    assert.equal(diagnostic.best, simulator.places.reduce((m, p) => Math.max(m, p.score), 0));
  }
});

// ── candidate JSON ───────────────────────────────────────────────────────────
async function sampleCandidate() {
  const { snapshot, log } = await recordedGame(71006, 10, { exchangeAt: [2] });
  const levelKey = `survival-v1:71006:${snapshot.turnNumber}`;
  return buildCandidate({
    snapshot,
    levelKey,
    sourceLog: log,
    status: "TACTICAL_CONFIRMED",
    publicFacts: { deficit: 42, bagRemaining: snapshot.bag.length, turnNumber: snapshot.turnNumber, scores: { player: 100, authur: 142 }, difficulty: { tier: null, label: null, calibrationVersion: null } },
    provenance: { runId: "test", source: { sourceSeed: 71006, snapshotTurn: snapshot.turnNumber, levelKey } },
    admin: { routing: { route: "TACTICAL" } },
  });
}

test("content hash: same content → same hash; key order and rack order do not matter; bag order does", async () => {
  const candidate = await sampleCandidate();
  const { snapshot, levelKey } = candidate.gameplay;
  const reordered = JSON.parse(canonicalJson(snapshot));
  const shuffledRacks = { ...snapshot, racks: { A: [...snapshot.racks.A].reverse(), B: [...snapshot.racks.B].reverse() } };
  assert.equal(contentHash(reordered, levelKey), candidate.contentHash);
  assert.equal(contentHash(shuffledRacks, levelKey), candidate.contentHash);
  assert.notEqual(contentHash({ ...snapshot, bag: [...snapshot.bag].reverse() }, levelKey), candidate.contentHash);
  assert.notEqual(contentHash(snapshot, "survival-v1:1:1"), candidate.contentHash);
  // Position hash: turn stamps ignored, transposition equivalent, mirror not.
  const restamped = { ...snapshot, board: snapshot.board.map((t) => ({ ...t, turn: 0 })) };
  assert.equal(positionHash(restamped), candidate.positionHash);
  const transpose = (cell) => (cell % 15) * 15 + Math.floor(cell / 15);
  assert.equal(positionHash({ ...snapshot, board: snapshot.board.map((t) => ({ ...t, cell: transpose(t.cell) })) }), candidate.positionHash);
  const mirror = (cell) => Math.floor(cell / 15) * 15 + (14 - (cell % 15));
  assert.notEqual(positionHash({ ...snapshot, board: snapshot.board.map((t) => ({ ...t, cell: mirror(t.cell) })) }), candidate.positionHash);
});

test("separation: public and player view carry no hidden information", async () => {
  const candidate = await sampleCandidate();
  assert.equal(validateCandidate(candidate), true);
  const { snapshot, roles } = candidate.gameplay;
  const pv = playerView(candidate);
  const text = JSON.stringify(pv);
  assert.ok(!("bag" in pv) && !("authurRack" in pv) && !("admin" in pv) && !("provenance" in pv));
  assert.equal(pv.bagCount, snapshot.bag.length);
  assert.equal(pv.authurRackCount, snapshot.racks[roles.authur].length);
  assert.ok(!text.includes(candidate.gameplay.levelKey), "level key (source seed) must not reach the player");
  assert.deepEqual(Object.keys(candidate.public).filter((k) => k !== "visibility").sort(), [...PUBLIC_KEYS].sort());
  assert.throws(() => validateCandidate({ ...candidate, public: { ...candidate.public, bag: snapshot.bag } }));
  assert.throws(() => validateCandidate({ ...candidate, public: { ...candidate.public, winningLine: [] } }));
  assert.throws(() => validateCandidate({ ...candidate, gameplay: { ...candidate.gameplay, snapshot: { ...snapshot, bag: [...snapshot.bag].reverse() } } }));
});

test("candidate: provenance carries the content hash, and a snapshot that loses a tile is refused", async () => {
  const candidate = await sampleCandidate();
  assert.equal(candidate.provenance.contentHash, candidate.contentHash);
  const { snapshot, levelKey } = candidate.gameplay;
  const short = { ...snapshot, bag: snapshot.bag.slice(1) };
  // Even with every hash recomputed to match, conservation fails.
  const forged = {
    ...candidate,
    contentHash: contentHash(short, levelKey),
    provenance: { ...candidate.provenance, contentHash: contentHash(short, levelKey) },
    gameplay: { ...candidate.gameplay, snapshot: short },
  };
  assert.throws(() => validateCandidate(forged), /tile .*: \d+ in the snapshot/);
});

// ── cheap features, prefilter, selection ─────────────────────────────────────
test("prefilter: provisional, configurable, and every failed reason is kept", () => {
  const features = cheapFeatures({ gap: -320, bag: 20, legalPlaces: 30, legalExchanges: 5 }, { rack: { best: 90 }, threat: { best: 40 } }, 0.5);
  assert.equal(features.deficit, 320);
  assert.equal(features.firepower, 50);
  assert.equal(features.cheapRankScore, 50 - 160);
  assert.equal(DEFAULT_PREFILTER.provisional, true);
  assert.deepEqual(prefilterReasons(features), [
    "PROVISIONAL legal placements 30 < 50",
    "PROVISIONAL deficit 320 >= 300",
  ]);
  assert.deepEqual(prefilterReasons({ ...features, deficit: 299, legalPlacements: 50 }), []);
  assert.deepEqual(prefilterReasons(features, { ...DEFAULT_PREFILTER, rejectLegalBelow: null }), ["PROVISIONAL deficit 320 >= 300"]);
  assert.deepEqual(prefilterReasons(features, { ...DEFAULT_PREFILTER, rejectLegalBelow: null, rejectDeficitAtLeast: null }), []);
});

test("selection: fixed count, per-game cap, turn gap, deterministic ties, a reason for every miss", () => {
  const items = [
    { id: "s1t9", sourceSeed: 1, turn: 9, v: 50 },
    { id: "s1t11", sourceSeed: 1, turn: 11, v: 49 },
    { id: "s1t15", sourceSeed: 1, turn: 15, v: 48 },
    { id: "s2t8", sourceSeed: 2, turn: 8, v: 48 },
    { id: "s3t7", sourceSeed: 3, turn: 7, v: null },
    { id: "s4t7", sourceSeed: 4, turn: 7, v: 10 },
  ];
  const run = () => selectTop(items, { count: 3, perGame: 2, minTurnGap: 4, score: (x) => x.v });
  const { taken, decisions } = run();
  assert.deepEqual(taken.map((x) => x.id), ["s1t9", "s1t15", "s2t8"]);
  const why = Object.fromEntries(decisions.map((d) => [d.id, d.reason]));
  assert.match(why.s1t11, /within 4 plies/);
  assert.match(why.s4t7, /outside the top 3/);
  assert.deepEqual(decisions.map((d) => d.rank), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(run(), { taken, decisions }, "same input, same selection");
  const capped = selectTop(items, { count: 5, perGame: 1, minTurnGap: 0, score: (x) => x.v });
  assert.deepEqual(capped.taken.map((x) => x.id), ["s1t9", "s2t8", "s4t7"]);
  assert.equal(capped.decisions.find((d) => d.id === "s3t7").reason, "no ranking value");
});

// ── evaluation outcomes ──────────────────────────────────────────────────────
const clock = { movegen: 0, evaluate: 0, select: 0, solver: 0, authur: 0, apply: 0, verify: 0 };
function game(policy, sim, outcome, { timingAffected = false, moves = `${policy}${sim}` } = {}) {
  return {
    policy,
    sim,
    outcome,
    margin: outcome === "win" ? 10 : outcome === "tie" ? 0 : -10,
    scores: { A: 0, B: 0 },
    end: "rack_out",
    endBag: 0,
    turns: 20,
    timingAffected,
    actions: [{ side: "A", turn: 1, id: moves }],
    playerTurns: [],
    authurTurns: [],
    checks: { placements: 0, mismatches: [] },
    clock,
    cpuMs: 1000,
    wallMs: 1000,
  };
}
/** `wins[policy]` wins in the first sims, losses after. */
const ladderGames = (wins, sims, options = () => ({})) =>
  Object.entries(wins).flatMap(([policy, w]) =>
    Array.from({ length: sims }, (_, sim) => game(policy, sim, sim < w ? "win" : "loss", options(policy, sim))),
  );

test("tactical: screened → promoted → confirmed only with a definite, timing-robust category", () => {
  const separating = ladderGames({ weak: 1, medium: 4, strong: 8 }, 8);
  const s = screen(separating, 8);
  assert.equal(s.category.category, "POSSIBLE_SEPARATION");
  assert.ok(isPromising(s.category));
  const flat = screen(ladderGames({ weak: 0, medium: 0, strong: 1 }, 8), 8);
  assert.equal(flat.category.category, "FLAT_HARD");
  assert.ok(!isPromising(flat.category));

  const notPromoted = tacticalEvaluation(separating, { screenSims: 8, confirmSims: 32 }, false);
  assert.equal(notPromoted.outcome, "screened");
  assert.equal(pipelineStatus("TACTICAL", notPromoted.outcome, null), "SCREENED");

  const full = ladderGames({ weak: 3, medium: 16, strong: 30 }, 32);
  const confirmed = tacticalEvaluation(full, { screenSims: 8, confirmSims: 32 }, true);
  assert.equal(confirmed.confirmation.category.category, "SKILL_SEPARATING");
  assert.equal(confirmed.outcome, "confirmed");
  assert.equal(pipelineStatus("TACTICAL", confirmed.outcome, null), "TACTICAL_CONFIRMED");

  // Some timing-affected games that do not change the call: still confirmed.
  const robust = ladderGames({ weak: 3, medium: 16, strong: 30 }, 32, (policy, sim) => ({ timingAffected: policy === "strong" && sim < 24 }));
  assert.equal(tacticalEvaluation(robust, { screenSims: 8, confirmSims: 32 }, true).outcome, "confirmed");
  // Every one of strong's wins came from a timing-affected game: the call rests on them.
  const fragile = ladderGames({ weak: 3, medium: 16, strong: 30 }, 32, (policy, sim) => ({ timingAffected: policy === "strong" && sim < 30 }));
  const shaky = tacticalEvaluation(fragile, { screenSims: 8, confirmSims: 32 }, true);
  assert.equal(shaky.outcome, "unconfirmed");
  assert.match(shaky.reason, /without the 30 timing-affected games/);

  const noCall = tacticalEvaluation(ladderGames({ weak: 10, medium: 13, strong: 15 }, 32), { screenSims: 8, confirmSims: 32 }, true);
  assert.equal(noCall.confirmation.category.category, "UNCERTAIN");
  assert.equal(noCall.outcome, "unconfirmed");

  const missing = tacticalEvaluation(separating.slice(1), { screenSims: 8, confirmSims: 32 }, false);
  assert.equal(missing.outcome, "unconfirmed");
});

test("strategic: a fixed number of attempts; timing-affected games never count towards the clean N", () => {
  const floor = ladderGames({ weak: 0, medium: 1 }, 8);
  const reference = (affected, wins = 10) =>
    Array.from({ length: 10 }, (_, sim) => game("authur", sim, sim < wins ? "win" : "loss", { timingAffected: sim < affected, moves: `r${sim}` }));
  const cfg = { referenceAttempts: 10, minCleanReference: 8 };

  const limited = strategicEvaluation([...floor, ...reference(3)], cfg);
  assert.equal(limited.cleanReferenceGames, 7);
  assert.equal(limited.outcome, "timing_limited");
  assert.equal(limited.category, null);
  assert.equal(pipelineStatus("STRATEGIC", null, limited.outcome), "TIMING_LIMITED");

  const clean = strategicEvaluation([...floor, ...reference(1)], cfg);
  assert.equal(clean.cleanReferenceGames, 9);
  assert.equal(clean.outcome, "confirmed");
  assert.equal(clean.category, "REFERENCE_ABOVE_FLOOR");
  assert.equal(clean.reference.wins, 10, "raw counts keep the timing-affected game");
  assert.equal(clean.reference.excludingTimingAffected.wins, 9);
  assert.equal(pipelineStatus("STRATEGIC", null, clean.outcome), "STRATEGIC_CONFIRMED");
  assert.equal(pipelineStatus("UNCERTAIN", "confirmed", clean.outcome), "BOTH_CONFIRMED");

  const hopeless = strategicEvaluation([...floor, ...reference(0, 0)], cfg);
  assert.equal(hopeless.category, "REFERENCE_CANNOT_WIN");

  // Ten seeds that all produce the very same game are ONE distinct game.
  const same = Array.from({ length: 10 }, (_, sim) => game("authur", sim, "win", { moves: "identical" }));
  assert.equal(strategicEvaluation([...floor, ...same], cfg).distinctReferenceGames.all, 1);

  assert.equal(strategicEvaluation([...floor, ...reference(0).slice(2)], cfg).outcome, "unconfirmed", "missing attempts are not re-run");
});

// ── source game log: replay readiness ────────────────────────────────────────
test("source log: replays from the authentic deal to exactly the takeover snapshot (seed and log modes)", async () => {
  for (const [seed, placements, exchangeAt] of [[71101, 8, [1, 3]], [71102, 12, [2]], [71103, 5, []]]) {
    const { snapshot, log } = await recordedGame(seed, placements, { exchangeAt });
    const stored = JSON.parse(JSON.stringify(log));
    if (exchangeAt.length) assert.ok(stored.turns.some((t) => t.type === "exchange"), `seed ${seed}: an exchange is exercised`);
    assert.equal(stored.initial.stateHash, stateHash(env.createEnvState({ seed })), "the log starts from the authentic deal");
    // From the seed: the very same game, tile for tile.
    assert.deepEqual(snapshotOf(replaySourceLog(stored, { mode: "seed" })), snapshot, `seed ${seed}`);
    // From the log alone (no RNG, no tile ids): the same position.
    assert.equal(contentHash(snapshotOf(replaySourceLog(stored, { mode: "log" })), "k"), contentHash(snapshot, "k"), `seed ${seed} (log)`);
    assert.equal(stored.takeover.stateHash, stateHash(snapshot));
    assert.equal(stored.turns.at(-1).stateHashAfter, stored.takeover.stateHash);
    assert.equal(stored.takeover.turn, snapshot.turnNumber);
    assert.equal(stored.takeover.sideToMove, snapshot.sideToMove);
  }
});

test("source log: the state after every move is checked — any edit to the log is caught", async () => {
  const { log } = await recordedGame(71104, 9, { exchangeAt: [1, 4] });
  const exchange = log.turns.findIndex((t) => t.type === "exchange" && new Set(t.action.kinds).size >= 3);
  const place = log.turns.findIndex(
    (t) => t.type === "place" && canonicalJson([...t.drawn].reverse()) !== canonicalJson(t.drawn),
  );
  assert.ok(exchange >= 0 && place >= 0, "the fixture needs a mixed exchange and a mixed draw");
  const edited = (change) => {
    const copy = structuredClone(log);
    change(copy);
    return copy;
  };
  const turn = (i, change) => edited((copy) => change(copy.turns[i]));
  const cases = {
    "score gained": turn(place, (t) => { t.scoreGained += 1; }),
    "totals after": turn(place, (t) => { t.scoresAfter[t.side] += 1; }),
    "a placed tile's cell": turn(place, (t) => { t.action.placements[0].cell = (t.action.placements[0].cell + 16) % 225; }),
    "tiles drawn": turn(place, (t) => { t.drawn.reverse(); }),
    "rack before": turn(place, (t) => { t.rackBefore = t.rackBefore.slice(1); }),
    "exchange order": turn(exchange, (t) => { t.action.kinds.reverse(); t.action.tileIds.reverse(); }),
    "bag after an exchange": turn(exchange, (t) => { t.bagAfter.reverse(); }),
    "state hash": turn(place, (t) => { t.stateHashAfter = "0".repeat(64); }),
    "scoreless streak": turn(exchange, (t) => { t.noScoreTailAfter = []; }),
    "the deal": edited((copy) => { copy.initial.bag.reverse(); }),
  };
  for (const [name, bad] of Object.entries(cases)) {
    for (const mode of ["seed", "log"]) {
      assert.throws(() => replaySourceLog(bad, { mode }), /source log replay/, `${name} (${mode}) must be caught`);
    }
  }
  for (const mode of ["seed", "log"]) assert.doesNotThrow(() => replaySourceLog(log, { mode }));
});

test("source log: score progression — every total follows from the previous total and the score gained", async () => {
  const { snapshot, log } = await recordedGame(71105, 12, { exchangeAt: [3] });
  let totals = { A: 0, B: 0 };
  for (const t of log.turns) {
    assert.deepEqual(t.scoresBefore, totals, `turn ${t.turn}`);
    assert.deepEqual(t.scoresAfter, { ...totals, [t.side]: totals[t.side] + t.scoreGained }, `turn ${t.turn}`);
    if (t.type !== "place") assert.equal(t.scoreGained, 0, `turn ${t.turn}: a ${t.type} scores nothing`);
    totals = t.scoresAfter;
  }
  assert.ok(log.turns.filter((t) => t.scoreGained > 0).length >= 10);
  assert.deepEqual(totals, snapshot.scores, "the log ends on the snapshot's scores");
  const bad = structuredClone(log);
  const i = bad.turns.findIndex((t) => t.type === "place");
  bad.turns[i].scoresAfter[bad.turns[i].side] += 5;
  assert.ok(sourceLogProblems(bad, snapshot).some((p) => /totals/.test(p)), "caught even without the rules engine");
});

test("source log: bag order — draws from the front, source exchanges reshuffle, the level's fixed bag starts at the takeover", async () => {
  const { snapshot, log } = await recordedGame(71106, 10, { exchangeAt: [1, 5] });
  // The bag rebuilt from the log alone: the dealt bag, draws off the front, the logged bag after each exchange.
  let bag = [...log.initial.bag];
  let reshuffled = 0;
  for (const t of log.turns) {
    assert.deepEqual(t.drawn, bag.slice(0, t.drawn.length), `turn ${t.turn}: draws come from the front`);
    bag = bag.slice(t.drawn.length);
    if (t.type === "exchange") {
      const appended = [...bag, ...t.returned];
      assert.deepEqual([...t.bagAfter].sort(), [...appended].sort(), `turn ${t.turn}: the exchanged pile rejoins the bag`);
      if (canonicalJson(t.bagAfter) !== canonicalJson(appended)) reshuffled += 1;
      bag = t.bagAfter;
    }
    assert.equal(bag.length, t.bagCountAfter, `turn ${t.turn}`);
  }
  assert.ok(reshuffled >= 1, "the source game's exchange reshuffle is exercised");
  assert.deepEqual(bag, snapshot.bag, "the level's fixed bag is exactly the source game's bag at the takeover");
  // From the takeover on: the Survival rule — an exchange goes to the back in kind order, no reshuffle.
  const state = stateFromSnapshot(snapshot);
  const { exchanges } = await legalActions(state);
  assert.ok(exchanges.length > 0);
  const r = applySurvival(state, exchanges[Math.floor(exchanges.length / 2)].action);
  const returned = kinds(state, r.returned).sort((x, y) => KIND_ORDER.indexOf(x) - KIND_ORDER.indexOf(y));
  assert.deepEqual(kinds(r.state, r.state.bag), [...snapshot.bag.slice(r.drawn.length), ...returned]);
});

test("player history: public facts only — no rack, draw, exchanged tile, bag, seed, hidden hash or analysis", async () => {
  const candidate = await sampleCandidate();
  const { sourceLog, roles, snapshot } = candidate.gameplay;
  const view = playerView(candidate).sourceLog;
  // Only whitelisted fields.
  const TURN_KEYS = ["turn", "seat", "playedBy", "type", "placements", "tilesExchanged", "scoreGained", "scoresAfter", "tilesDrawn", "bagCountAfter", "scorelessStreakAfter", "publicHashAfter"];
  assert.deepEqual(Object.keys(view).sort(), ["format", "publicHash", "seats", "start", "takeover", "turns"]);
  for (const t of view.turns) {
    for (const key of Object.keys(t)) assert.ok(TURN_KEYS.includes(key), `turn ${t.turn}: unexpected field ${key}`);
    for (const p of t.placements ?? []) assert.deepEqual(Object.keys(p).sort(), ["cell", "face", "kind"]);
  }
  // Every tile it shows is on the takeover board, where the player sees it anyway.
  const board = new Set(snapshot.board.map((b) => `${b.cell}:${b.kind}:${b.face}`));
  for (const t of view.turns) for (const p of t.placements ?? []) assert.ok(board.has(`${p.cell}:${p.kind}:${p.face}`));
  // It cannot depend on hidden information: rewrite every hidden field → the same projection.
  const hidden = structuredClone(sourceLog);
  hidden.sourceSeed = 1;
  hidden.initial.racks = { A: [...hidden.initial.racks.A].reverse(), B: [...hidden.initial.racks.B].reverse() };
  hidden.initial.bag = [...hidden.initial.bag].reverse();
  hidden.initial.stateHash = "x";
  hidden.takeover.stateHash = "x";
  for (const t of hidden.turns) {
    t.rackBefore = [];
    t.drawn = t.drawn.map(() => "?");
    t.decision = { by: "someone else" };
    t.stateHashAfter = "x";
    if (t.type === "exchange") Object.assign(t, { returned: [], bagAfter: [], action: { type: "exchange", kinds: t.action.kinds.map(() => "0"), tileIds: [] } });
    if (t.type === "place") t.action.placements = t.action.placements.map((p) => ({ ...p, tileId: "hidden" }));
  }
  assert.deepEqual(playerSourceLog(hidden, roles), view);
  // None of the hidden fields or generator sections appear anywhere in the player's payload.
  const text = JSON.stringify(playerView(candidate));
  for (const key of ["sourceSeed", "levelKey", "rackBefore", "drawn", "returned", "bag", "bagAfter", "stateHash", "stateHashAfter", "tileId", "tileIds", "decision", "racks", "authurRack", "admin", "provenance", "opportunity", "routing", "tactical", "strategic", "games"]) {
    assert.ok(!text.includes(`"${key}"`), `the player view has a "${key}" field`);
  }
  for (const secret of [candidate.gameplay.levelKey, sourceLog.initial.stateHash, ...sourceLog.turns.map((t) => t.stateHashAfter)]) {
    assert.ok(!text.includes(secret), "the player view holds a hidden value");
  }
  // Exchanges only as counts; nothing at or after the takeover.
  const exchanges = view.turns.filter((t) => t.type === "exchange");
  assert.ok(exchanges.length > 0 && exchanges.every((t) => Number.isInteger(t.tilesExchanged) && !("placements" in t)));
  assert.ok(view.turns.every((t) => t.turn < view.takeover.turn));
  assert.equal(view.takeover.seat, "player");
  assert.equal(view.turns.length, sourceLog.turns.length);
});

test("candidate v2: carries a replay-verified source log; a log that does not replay cannot become a candidate", async () => {
  const candidate = await sampleCandidate();
  assert.equal(candidate.schema, "survival-candidate-v2");
  assert.equal(candidate.provenance.source.sourceLogTurns, candidate.gameplay.sourceLog.turns.length);
  assert.equal(validateCandidate(JSON.parse(JSON.stringify(candidate))), true);
  const edited = structuredClone(candidate);
  edited.gameplay.sourceLog.turns[0].scoreGained += 1;
  assert.throws(() => validateCandidate(edited), /sourceLogSha256/);
  const { snapshot, log } = await recordedGame(71107, 6, { exchangeAt: [1] });
  const broken = structuredClone(log);
  broken.turns[broken.turns.findIndex((t) => t.type === "place")].rackBefore = [];
  const facts = { deficit: 1, bagRemaining: snapshot.bag.length, turnNumber: snapshot.turnNumber, scores: { player: 0, authur: 1 }, difficulty: { tier: null, label: null, calibrationVersion: null } };
  const build = (sourceLog) =>
    buildCandidate({ snapshot, levelKey: "k", sourceLog, status: "SCREENED", publicFacts: facts, provenance: { source: { sourceSeed: 71107 } }, admin: {} });
  assert.throws(() => build(broken), /source log replay/);
  assert.doesNotThrow(() => build(log));
});
