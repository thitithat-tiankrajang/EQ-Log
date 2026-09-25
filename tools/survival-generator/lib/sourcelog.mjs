// The SOURCE GAME LOG: the Authur-vs-Authur game a Survival level is cut from,
// from the authentic deal up to the takeover, one record per turn.
//
// SERVER-ONLY. Records carry hidden information: the mover's rack, the tiles
// drawn, an exchanged pile, the bag. A player-facing timeline must be built
// with `playerSourceLog`, never by copying records.
//
//   initial   the authentic deal of `env.createEnvState({ seed: sourceSeed })`:
//             both racks, the ordered bag, and its state hash.
//   turns     per turn: the exact action (cells, kinds, faces and tile ids; an
//             exchange's tiles in the order they were handed back, which the
//             reshuffle depends on), the mover's rack before it (sorted), the
//             score gained, both totals before and after, the tiles drawn in
//             order, the scoreless streak, and the state hash after the move. An exchange also records the pile it returned and
//             the bag it left: the SOURCE game runs eqlab-compat, where an
//             exchanged pile rejoins the bag after the draw and the bag is
//             reshuffled. The Survival fixed-bag rule starts at the takeover.
//   takeover  the turn and side the player takes over and the state hash,
//             which equals the hash of the level's snapshot.
//
// State hash (`survival-state-hash-v1`): sha256 of the canonical JSON of the
// whole position BY KIND — board cells (cell, kind, face, side, turn), both
// racks as sorted multisets, the bag in order, scores, side to move, turn,
// scoreless streak, hasPlacement. No tile ids and no RNG state, so any
// implementation of the rules can compute it. The public hash
// (`survival-public-hash-v1`) is the same position with racks and bag reduced
// to counts: a client can check its own replay of the public timeline with it.
import { canonicalJson, sha256 } from "./canonical.mjs";
import { BAG_RULE, KIND_ORDER, env } from "./rules.mjs";

export const SOURCE_LOG_FORMAT = "survival-source-log-v1";
export const STATE_HASH = "survival-state-hash-v1";
export const PUBLIC_HASH = "survival-public-hash-v1";
export const SOURCE_RULES =
  "eqlab-compat: every draw from the front of the bag; an exchanged pile rejoins the bag after the draw and the bag is reshuffled";

const RANK = new Map(KIND_ORDER.map((kind, index) => [kind, index]));
const sortKinds = (kinds) => [...kinds].sort((a, b) => RANK.get(a) - RANK.get(b));
const kindsOf = (state, ids) => ids.map((id) => state.manifest.kindOf.get(id));
const otherSide = (side) => (side === "A" ? "B" : "A");
const same = (a, b) => canonicalJson(a) === canonicalJson(b);

// ── hashes ───────────────────────────────────────────────────────────────────
/** The whole position by kind, from an env state or a Survival snapshot. */
function position(source) {
  if (source.format === "survival-snapshot-v1") return source;
  if (source.terminal) throw new Error("state hash: the game is over");
  if (source.pendingReturn.A.length + source.pendingReturn.B.length > 0) {
    throw new Error("state hash: an exchange pile is standing");
  }
  const board = [];
  source.board.forEach((cell, index) => {
    if (cell) board.push({ cell: index, kind: cell.kind, face: cell.face, side: cell.side, turn: cell.turn });
  });
  return {
    board,
    racks: { A: kindsOf(source, source.racks.A), B: kindsOf(source, source.racks.B) },
    bag: kindsOf(source, source.bag),
    scores: source.scores,
    sideToMove: source.activeSide,
    turnNumber: source.turnNumber,
    noScoreTail: source.noScoreTail,
    hasPlacement: source.hasPlacement,
  };
}

const boardRows = (board) =>
  [...board].sort((a, b) => a.cell - b.cell).map((t) => [t.cell, t.kind, t.face, t.side, t.turn]);
const common = (p) => ({
  board: boardRows(p.board),
  scores: { A: p.scores.A, B: p.scores.B },
  sideToMove: p.sideToMove,
  turnNumber: p.turnNumber,
  noScoreTail: [...p.noScoreTail],
  hasPlacement: p.hasPlacement,
});

/** Hash of the whole position, hidden tiles included. Server-side verification only. */
export function stateHash(source) {
  const p = position(source);
  return sha256(canonicalJson({
    hash: STATE_HASH,
    ...common(p),
    racks: { A: sortKinds(p.racks.A), B: sortKinds(p.racks.B) },
    bag: [...p.bag],
  }));
}

/** Hash of what anyone at the table sees: racks and bag only as counts. */
export function publicHash(source) {
  const p = position(source);
  return sha256(canonicalJson({
    hash: PUBLIC_HASH,
    ...common(p),
    rackCounts: { A: p.racks.A.length, B: p.racks.B.length },
    bagCount: p.bag.length,
  }));
}

// ── recording (worker.mjs `source`) ──────────────────────────────────────────
/** The deal, recorded before the first move. */
export function initialRecord(state) {
  if (state.turnNumber !== 1 || state.hasPlacement) throw new Error("source log: the initial record must be the deal");
  return {
    rules: state.rules.id,
    racks: { A: kindsOf(state, state.racks.A), B: kindsOf(state, state.racks.B) },
    bag: kindsOf(state, state.bag),
    scores: { A: state.scores.A, B: state.scores.B },
    sideToMove: state.activeSide,
    turnNumber: state.turnNumber,
    noScoreTail: [...state.noScoreTail],
    hasPlacement: state.hasPlacement,
    stateHash: stateHash(state),
    publicHash: publicHash(state),
  };
}

function exactAction(action) {
  if (action.type === "place") {
    return { type: "place", placements: action.placements.map(({ cell, kind, face, tileId }) => ({ cell, kind, face, tileId })) };
  }
  if (action.type === "exchange") return { type: "exchange", kinds: [...action.kinds], tileIds: [...action.tileIds] };
  return { type: "pass" };
}

/** One source turn, from the state before it and the engine's result. */
export function turnRecord(before, action, result, decision) {
  if (result.terminal) throw new Error("source log: the source game ended before the takeover");
  const side = before.activeSide;
  const after = result.state;
  const record = {
    turn: before.turnNumber,
    side,
    type: action.type,
    action: exactAction(action),
    decision,
    // Sorted: rack order means nothing in the rules, and which physical copy
    // of a kind was played is not part of the game.
    rackBefore: sortKinds(kindsOf(before, before.racks[side])),
    scoreGained: result.scoreGained,
    scoresBefore: { A: before.scores.A, B: before.scores.B },
    scoresAfter: { A: after.scores.A, B: after.scores.B },
    drawn: kindsOf(before, result.drawn),
    bagCountBefore: before.bag.length,
    bagCountAfter: after.bag.length,
    noScoreTailAfter: [...after.noScoreTail],
    stateHashAfter: stateHash(after),
    publicHashAfter: publicHash(after),
  };
  if (result.returned.length > 0) {
    record.returned = kindsOf(before, result.returned);
    record.bagAfter = kindsOf(after, after.bag);
  }
  return record;
}

/** The log for a takeover at `snapshot`: the deal plus every turn before it. */
export function buildSourceLog({ sourceSeed, initial, turns, snapshot }) {
  const log = {
    format: SOURCE_LOG_FORMAT,
    stateHash: STATE_HASH,
    publicHash: PUBLIC_HASH,
    sourceRules: SOURCE_RULES,
    fromTakeover: BAG_RULE,
    sourceSeed,
    initial,
    turns,
    takeover: {
      turn: snapshot.turnNumber,
      sideToMove: snapshot.sideToMove,
      stateHash: stateHash(snapshot),
      publicHash: publicHash(snapshot),
    },
  };
  const problems = sourceLogProblems(log, snapshot);
  if (problems.length) throw new Error(`invalid source log:\n  - ${problems.join("\n  - ")}`);
  return log;
}

// ── checking ─────────────────────────────────────────────────────────────────
/** Structural checks without the rules engine: turn order, score and bag arithmetic, the hash chain. */
export function sourceLogProblems(log, snapshot) {
  if (log?.format !== SOURCE_LOG_FORMAT) return [`source log format ${log?.format}`];
  const problems = [];
  if (log.stateHash !== STATE_HASH || log.publicHash !== PUBLIC_HASH) problems.push("unknown hash versions");
  const { initial } = log;
  let turn = initial.turnNumber;
  let side = initial.sideToMove;
  let scores = initial.scores;
  let bagCount = initial.bag.length;
  let hash = initial.stateHash;
  log.turns.forEach((t, i) => {
    const at = `record ${i} (turn ${t.turn})`;
    if (t.turn !== turn || t.side !== side) problems.push(`${at}: expected turn ${turn}, side ${side}`);
    if (t.type !== t.action?.type) problems.push(`${at}: type ${t.type}, action ${t.action?.type}`);
    if (!same(t.scoresBefore, scores)) problems.push(`${at}: totals before do not continue the previous totals`);
    if (!same(t.scoresAfter, { ...t.scoresBefore, [t.side]: t.scoresBefore[t.side] + t.scoreGained })) {
      problems.push(`${at}: totals after are not totals before + score gained`);
    }
    if (t.type !== "place" && t.scoreGained !== 0) problems.push(`${at}: a ${t.type} cannot score`);
    const returned = t.returned?.length ?? 0;
    if (t.bagCountBefore !== bagCount) problems.push(`${at}: bag count does not continue`);
    if (t.bagCountAfter !== t.bagCountBefore - t.drawn.length + returned) problems.push(`${at}: bag count does not add up`);
    if (t.type === "exchange" && (returned !== t.action.kinds.length || t.bagAfter?.length !== t.bagCountAfter)) {
      problems.push(`${at}: an exchange must record the pile it returned and the bag it left`);
    }
    if (t.type !== "exchange" && (t.returned || t.bagAfter)) problems.push(`${at}: only an exchange returns tiles`);
    turn += 1;
    side = otherSide(side);
    scores = t.scoresAfter;
    bagCount = t.bagCountAfter;
    hash = t.stateHashAfter;
  });
  const { takeover } = log;
  if (takeover.turn !== turn || takeover.sideToMove !== side) {
    problems.push(`takeover at turn ${takeover.turn}, side ${takeover.sideToMove}; the log ends before turn ${turn}, side ${side}`);
  }
  if (takeover.stateHash !== hash) problems.push("the last state hash in the log is not the takeover's");
  if (snapshot) {
    if (stateHash(snapshot) !== takeover.stateHash) problems.push("the takeover state hash is not the snapshot's");
    if (publicHash(snapshot) !== takeover.publicHash) problems.push("the takeover public hash is not the snapshot's");
    if (!same({ A: snapshot.scores.A, B: snapshot.scores.B }, scores)) problems.push("the log's last totals are not the snapshot's scores");
    if (snapshot.bag.length !== bagCount) problems.push("the log's last bag count is not the snapshot's");
  }
  return problems;
}

/** A playable env state from the logged deal, tile ids assigned by kind. */
function dealFromLog(initial) {
  const manifest = env.createManifest();
  const free = new Map();
  for (const tile of manifest.tiles) {
    if (!free.has(tile.kind)) free.set(tile.kind, []);
    free.get(tile.kind).push(tile.id);
  }
  const take = (kind) => {
    const id = free.get(kind)?.shift();
    if (!id) throw new Error(`source log replay: the deal holds more ${kind} tiles than exist`);
    return id;
  };
  return env.envStateFrom({
    manifest,
    racks: { A: initial.racks.A.map(take), B: initial.racks.B.map(take) },
    bag: initial.bag.map(take),
    scores: { ...initial.scores },
    activeSide: initial.sideToMove,
    turnNumber: initial.turnNumber,
    noScoreTail: [...initial.noScoreTail],
    hasPlacement: initial.hasPlacement,
  });
}

/** The logged action on this state's own tiles: by kind, first match in rack order. */
function bindByKind(state, action, fail) {
  const pool = [...state.racks[state.activeSide]];
  const take = (kind) => {
    const index = pool.findIndex((id) => state.manifest.kindOf.get(id) === kind);
    if (index < 0) fail(`the mover holds no ${kind}`);
    return pool.splice(index, 1)[0];
  };
  if (action.type === "place") {
    return { type: "place", placements: action.placements.map(({ cell, kind, face }) => ({ cell, kind, face, tileId: take(kind) })) };
  }
  if (action.type === "exchange") return { type: "exchange", kinds: [...action.kinds], tileIds: action.kinds.map(take) };
  return { type: "pass" };
}

/** Put `ids` into the logged kind order. */
function arrange(state, ids, kinds, fail) {
  const byKind = new Map();
  for (const id of ids) {
    const kind = state.manifest.kindOf.get(id);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(id);
  }
  return kinds.map((kind) => byKind.get(kind)?.shift() ?? fail(`the logged bag holds a ${kind} that is not there`));
}

/** An action without tile ids: what "log" mode compares, since it binds tiles by kind. */
const withoutIds = (record) => {
  const { action } = record;
  if (action.type === "place") return { ...record, action: { ...action, placements: action.placements.map(({ tileId: _, ...p }) => p) } };
  if (action.type === "exchange") return { ...record, action: { type: "exchange", kinds: action.kinds } };
  return record;
};

/**
 * Replays a source log through the rules engine. Every record is rebuilt from
 * what the engine actually does and must equal the logged one field for field
 * (only `decision`, Authur's own metadata, is taken as logged). Throws at the
 * first disagreement.
 *
 *   mode "seed"  from the authentic deal, env.createEnvState({ seed }), with the
 *                logged tile ids and the engine's own exchange reshuffle —
 *                proves the log is the game this seed produced.
 *   mode "log"   from the logged deal, tiles bound by kind, every post-exchange
 *                bag taken from the log — needs no RNG and no tile ids, so any
 *                implementation of the rules can replay the log on its own.
 *
 * Returns the state at the takeover.
 */
export function replaySourceLog(log, { mode = "seed" } = {}) {
  const fail = (message) => {
    throw new Error(`source log replay (${mode}): ${message}`);
  };
  let state = mode === "seed" ? env.createEnvState({ seed: log.sourceSeed }) : dealFromLog(log.initial);
  if (!same(initialRecord(state), log.initial)) {
    fail(mode === "seed" ? "the logged deal is not the deal this seed produces" : "the logged deal does not match its own hashes");
  }
  const comparable = mode === "seed" ? (record) => record : withoutIds;
  log.turns.forEach((t, i) => {
    const at = `record ${i} (turn ${t.turn})`;
    const failAt = (message) => fail(`${at}: ${message}`);
    if (state.turnNumber !== t.turn || state.activeSide !== t.side) {
      failAt(`the replay is at turn ${state.turnNumber}, side ${state.activeSide}`);
    }
    const action = mode === "seed" ? exactAction(t.action) : bindByKind(state, t.action, failAt);
    const bagBefore = kindsOf(state, state.bag);
    let result;
    try {
      result = env.applyAction(state, action);
    } catch (error) {
      failAt(`the engine refuses the logged ${t.type}: ${error.message}`);
    }
    if (result.terminal) failAt("the game ended");
    if (result.scoreGained !== t.scoreGained) failAt(`scored ${result.scoreGained}, the log says ${t.scoreGained}`);
    const drawn = kindsOf(state, result.drawn);
    if (!same(drawn, bagBefore.slice(0, drawn.length))) failAt("the draw did not come from the front of the bag");
    let next = result.state;
    if (result.returned.length > 0 && mode === "log") {
      const rest = [...bagBefore.slice(drawn.length), ...kindsOf(state, result.returned)];
      if (!same(sortKinds(rest), sortKinds(t.bagAfter ?? []))) failAt("the logged bag is not the rest of the bag plus the returned pile");
      next = { ...next, bag: arrange(next, next.bag, t.bagAfter, failAt) };
    }
    const rebuilt = comparable(turnRecord(state, action, { ...result, state: next }, t.decision));
    const logged = comparable(t);
    const differs = [...new Set([...Object.keys(rebuilt), ...Object.keys(logged)])].filter((key) => !same(rebuilt[key], logged[key]));
    if (differs.length) failAt(`the log differs from the engine in: ${differs.join(", ")}`);
    state = next;
  });
  if (stateHash(state) !== log.takeover.stateHash) fail("the replay does not reach the takeover state");
  if (publicHash(state) !== log.takeover.publicHash) fail("the replay does not reach the takeover's public state");
  return state;
}

// ── the player's view ────────────────────────────────────────────────────────
/**
 * The source game as a player may see it: every move that is on the board,
 * counts instead of tiles, and the running totals. Built only from public
 * fields, so it cannot depend on a rack, a draw, an exchanged pile, the bag,
 * a seed or a state hash. Exchanged tiles are shown as a count for BOTH seats:
 * the human did not play the source turns of their own seat either.
 */
export function playerSourceLog(log, roles) {
  const seat = (side) => (side === roles.player ? "player" : "authur");
  const byRole = (scores) => ({ player: scores[roles.player], authur: scores[roles.authur] });
  return {
    format: `${SOURCE_LOG_FORMAT}/player`,
    publicHash: PUBLIC_HASH,
    seats: { player: roles.player, authur: roles.authur },
    start: {
      turn: log.initial.turnNumber,
      seat: seat(log.initial.sideToMove),
      scores: byRole(log.initial.scores),
      rackCounts: { player: log.initial.racks[roles.player].length, authur: log.initial.racks[roles.authur].length },
      bagCount: log.initial.bag.length,
      publicHash: log.initial.publicHash,
    },
    turns: log.turns.map((t) => ({
      turn: t.turn,
      seat: seat(t.side),
      playedBy: "authur",
      type: t.type,
      ...(t.type === "place" ? { placements: t.action.placements.map(({ cell, kind, face }) => ({ cell, kind, face })) } : {}),
      ...(t.type === "exchange" ? { tilesExchanged: t.action.kinds.length } : {}),
      scoreGained: t.scoreGained,
      scoresAfter: byRole(t.scoresAfter),
      tilesDrawn: t.drawn.length,
      bagCountAfter: t.bagCountAfter,
      scorelessStreakAfter: t.noScoreTailAfter.length,
      publicHashAfter: t.publicHashAfter,
    })),
    takeover: { turn: log.takeover.turn, seat: seat(log.takeover.sideToMove), publicHash: log.takeover.publicHash },
  };
}
