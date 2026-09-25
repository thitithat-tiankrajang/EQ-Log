// Offline Survival PLAYTEST — the game, server-side. A disposable local tool.
//
// A level is a candidate-v2 JSON from the first generator run; it is the only
// source of truth. An attempt is one human game from that level's takeover:
//
//   position  the exact snapshot — board, both racks, the fixed bag in order,
//             scores, side to move, turn, scoreless streak
//   rules     eqlab-compat with the Survival fixed bag (`applySurvival`: draws
//             from the front, an exchanged pile to the back in kind order,
//             never reshuffled), ending on a real rack-out or six scoreless turns
//   opponent  the generator's own opponent: Authur, offline config, seeds from
//             `${levelKey}|authur` and the turn number — the same request the
//             generator made for every simulated game (worker.mjs `playout`)
//
// Everything in this module holds hidden information. What the browser may see
// is built ONLY by `publicLevel` and `publicAttempt`, and every response is
// checked by `assertPlayerSafe` before it leaves the server.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { AUTHUR_CONFIGS, onRealTiles, requestFor } from "../../lib/authur.mjs";
import { canonicalJson, sha256 } from "../../lib/canonical.mjs";
import { playerView, validateCandidate, verifyReplay } from "../../lib/candidate.mjs";
import { BAG_RULE, KIND_ORDER, applySurvival, env, stateFromSnapshot } from "../../lib/rules.mjs";
import { publicHash, stateHash } from "../../lib/sourcelog.mjs";
import { verifyPlacement } from "../../lib/verify.mjs";
import { TOKENS } from "../../.vendor/authur-rules-diag.mjs";

const here = import.meta.dirname;
const EQLAB_ROOT = resolve(here, "../../../..");
export const FIRST_RUN = resolve(here, "../../out/pipeline/first-2026-09-24T21-43-13-191Z-84d7890e");
export const OUT_DIR = resolve(here, "../../out/playtest");
/** The four confirmed SKILL_SEPARATING levels of the first run, by deficit. */
export const LEVEL_IDS = Object.freeze([
  "cand-c2a8bafb8cb4b5ff",
  "cand-ec4bb469b515ffca",
  "cand-b6827f9f7bc252f4",
  "cand-c26e7b0ea6f7091a",
]);
export const ATTEMPT_SCHEMA = "survival-attempt-v1";

const SIZE = 15;
const RANK = new Map(KIND_ORDER.map((kind, index) => [kind, index]));
const sortKinds = (kinds) => [...kinds].sort((a, b) => RANK.get(a) - RANK.get(b));
const kindsOf = (state, ids) => ids.map((id) => state.manifest.kindOf.get(id));
/** The faces a player may choose for a choice tile or a blank (EQ-Lab's own option lists). */
const CHOICE_FACES = Object.freeze({
  "+/-": ["+", "-"],
  "x//": ["×", "÷"],
  "?": ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "+", "-", "×", "÷", "="],
});

export class PlaytestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ── levels ───────────────────────────────────────────────────────────────────
/** Load, validate and replay-verify every level. Throws if any fails. */
export function loadLevels({ runDir = FIRST_RUN, ids = LEVEL_IDS } = {}) {
  const levels = new Map();
  ids.forEach((id, index) => {
    const candidate = JSON.parse(readFileSync(resolve(runDir, "candidates", `${id}.json`), "utf8"));
    validateCandidate(candidate);
    const { snapshot, levelKey, sourceLog } = candidate.gameplay;
    // From the authentic seed AND from the log alone, to exactly this snapshot.
    verifyReplay(sourceLog, snapshot, levelKey);
    const takeoverHash = stateHash(stateFromSnapshot(snapshot));
    if (takeoverHash !== sourceLog.takeover.stateHash) throw new Error(`${id}: the takeover state does not rebuild`);
    levels.set(id, { id, number: index + 1, candidate, takeoverHash });
  });
  return levels;
}

// ── attempts ─────────────────────────────────────────────────────────────────
export function createAttempt(level, { now = Date.now() } = {}) {
  const { snapshot, roles, levelKey } = level.candidate.gameplay;
  const state = stateFromSnapshot(snapshot);
  const startHash = stateHash(state);
  if (startHash !== level.takeoverHash) throw new Error(`${level.id}: the takeover state does not rebuild`);
  return {
    id: `att-${new Date(now).toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 6)}`,
    level,
    human: roles.player,
    authur: roles.authur,
    levelKey,
    opponentSeedKey: `${levelKey}|authur`,
    state,
    startHash,
    turns: [],
    rejected: [],
    startedAt: new Date(now).toISOString(),
    lastChangeAt: now,
    finishedAt: null,
    result: null,
  };
}

export function statusOf(attempt) {
  if (attempt.state.terminal) return "finished";
  return attempt.state.activeSide === attempt.human ? "your-turn" : "authur-to-move";
}

/** The whole position after a move, hidden tiles included — also for a finished game. */
function hashAfter(state) {
  const standing = state.pendingReturn.A.length + state.pendingReturn.B.length > 0;
  if (!state.terminal && !standing) return { state: stateHash(state), public: publicHash(state) };
  const board = [];
  state.board.forEach((cell, index) => {
    if (cell) board.push([index, cell.kind, cell.face, cell.side, cell.turn]);
  });
  const common = {
    board,
    scores: { ...state.scores },
    sideToMove: state.activeSide,
    turnNumber: state.turnNumber,
    noScoreTail: [...state.noScoreTail],
    hasPlacement: state.hasPlacement,
    terminal: state.terminal && { reason: state.terminal.reason, bonusSide: state.terminal.bonusSide ?? null, bonusPoints: state.terminal.bonusPoints },
  };
  return {
    state: sha256(canonicalJson({
      hash: "survival-state-hash-v1+final",
      ...common,
      racks: { A: sortKinds(kindsOf(state, state.racks.A)), B: sortKinds(kindsOf(state, state.racks.B)) },
      pending: { A: sortKinds(kindsOf(state, state.pendingReturn.A)), B: sortKinds(kindsOf(state, state.pendingReturn.B)) },
      bag: kindsOf(state, state.bag),
    })),
    public: sha256(canonicalJson({
      hash: "survival-public-hash-v1+final",
      ...common,
      rackCounts: { A: state.racks.A.length, B: state.racks.B.length },
      bagCount: state.bag.length,
    })),
  };
}

function exactAction(action) {
  if (action.type === "place") {
    return { type: "place", placements: action.placements.map(({ cell, kind, face, tileId }) => ({ cell, kind, face, tileId })) };
  }
  if (action.type === "exchange") return { type: "exchange", kinds: [...action.kinds], tileIds: [...action.tileIds] };
  return { type: "pass" };
}

/** Apply one move under the Survival rules; record everything about it. Illegal → throws, nothing changes. */
function step(attempt, action, meta, now) {
  const before = attempt.state;
  const result = applySurvival(before, action);
  const check = action.type === "place" ? verifyPlacement(before, action, result.scoreGained) : null;
  const side = before.activeSide;
  const after = result.state;
  const hashes = hashAfter(after);
  const record = {
    index: attempt.turns.length,
    turn: before.turnNumber,
    side,
    actor: side === attempt.human ? "human" : "authur",
    type: action.type,
    action: exactAction(action),
    ...(meta.decision ? { decision: meta.decision } : {}),
    ...(meta.thinkMs !== undefined ? { thinkMs: meta.thinkMs } : {}),
    rackBefore: sortKinds(kindsOf(before, before.racks[side])),
    scoreGained: result.scoreGained,
    scoresBefore: { A: before.scores.A, B: before.scores.B },
    scoresAfter: { A: after.scores.A, B: after.scores.B },
    drawn: kindsOf(before, result.drawn),
    // An exchanged pile, which the Survival rule puts at the BACK of the bag in kind order.
    returned: kindsOf(before, result.returned),
    bagCountBefore: before.bag.length,
    bagCountAfter: after.bag.length,
    noScoreTailAfter: [...after.noScoreTail],
    terminal: result.terminal
      ? { reason: result.terminal.reason, bonusSide: result.terminal.bonusSide ?? null, bonusPoints: result.terminal.bonusPoints, description: result.terminal.description }
      : null,
    stateHashAfter: hashes.state,
    publicHashAfter: hashes.public,
    // EQ-Lab's own validateMove on the same placement: legality and score must agree.
    eqlab: check ? { valid: check.valid, score: check.eqlabScore, agrees: check.ok } : null,
  };
  attempt.turns.push(record);
  attempt.state = after;
  attempt.lastChangeAt = now;
  if (result.terminal) finish(attempt, now);
  return record;
}

function finish(attempt, now) {
  const { scores, terminal } = attempt.state;
  const human = scores[attempt.human];
  const authur = scores[attempt.authur];
  attempt.finishedAt = new Date(now).toISOString();
  attempt.result = {
    winner: human > authur ? "human" : human < authur ? "authur" : "tie",
    scores: { human, authur },
    margin: human - authur,
    endReason: terminal.reason,
    bonus: terminal.bonusSide ? { to: terminal.bonusSide === attempt.human ? "human" : "authur", points: terminal.bonusPoints } : null,
    description: terminal.description,
    turns: attempt.turns.length,
    humanTurns: attempt.turns.filter((t) => t.actor === "human").length,
    authurTurns: attempt.turns.filter((t) => t.actor === "authur").length,
    authurTimingAffected: attempt.turns.filter((t) => t.decision?.timingAffected).length,
    rejectedSubmissions: attempt.rejected.length,
  };
}

// ── the human ────────────────────────────────────────────────────────────────
function requireHumanTurn(attempt) {
  if (attempt.state.terminal) throw new PlaytestError("the game is over", 409);
  if (attempt.state.activeSide !== attempt.human) throw new PlaytestError("it is Authur's turn", 409);
}

/** A browser request → an engine action on the human's own tiles. */
function actionFromRequest(state, move) {
  const rack = state.racks[state.activeSide];
  const kindOf = (id) => state.manifest.kindOf.get(id);
  const ownTiles = (ids) => {
    if (!Array.isArray(ids) || ids.length === 0) throw new PlaytestError("choose at least one tile");
    if (new Set(ids).size !== ids.length) throw new PlaytestError("a tile was chosen twice");
    for (const id of ids) if (!rack.includes(id)) throw new PlaytestError("that tile is not on your rack");
    return ids;
  };
  if (move?.type === "place") {
    const placements = Array.isArray(move.placements) ? move.placements : [];
    const ids = ownTiles(placements.map((p) => p.tileId));
    return {
      type: "place",
      placements: placements.map((p, i) => {
        const kind = kindOf(ids[i]);
        if (!Number.isInteger(p.cell) || p.cell < 0 || p.cell >= SIZE * SIZE) throw new PlaytestError("a tile is off the board");
        const choices = CHOICE_FACES[kind];
        if (choices && !choices.includes(p.face)) throw new PlaytestError(`choose a value for ${TOKENS[kind].face}`);
        return { cell: p.cell, tileId: ids[i], kind, face: choices ? p.face : TOKENS[kind].face };
      }),
    };
  }
  if (move?.type === "exchange") {
    const ids = ownTiles(move.tileIds);
    if (!env.exchangeAllowed(state)) throw new PlaytestError("exchange is not allowed: too few tiles left in the bag");
    return { type: "exchange", tileIds: ids, kinds: ids.map(kindOf) };
  }
  if (move?.type === "pass") return { type: "pass" };
  throw new PlaytestError("unknown move");
}

/** The human's move. An illegal one is refused, recorded, and changes nothing. */
export function humanMove(attempt, move, { now = Date.now() } = {}) {
  requireHumanTurn(attempt);
  try {
    return step(attempt, actionFromRequest(attempt.state, move), { thinkMs: now - attempt.lastChangeAt }, now);
  } catch (error) {
    const message = error instanceof PlaytestError
      ? error.message
      : error?.name === "IllegalActionError"
        ? `illegal move: ${error.message}${error.codes?.length ? ` (${error.codes.join(", ")})` : ""}`
        : null;
    if (message === null) throw error;
    attempt.rejected.push({ at: new Date(now).toISOString(), turn: attempt.state.turnNumber, request: move, reason: message });
    throw new PlaytestError(message);
  }
}

// ── Authur ───────────────────────────────────────────────────────────────────
/** Authur's request: what the side to move can see, seeded exactly as the generator seeded its opponent. */
export function authurRequest(attempt) {
  if (attempt.state.terminal || attempt.state.activeSide !== attempt.authur) throw new PlaytestError("it is not Authur's turn", 409);
  return requestFor(attempt.state, attempt.opponentSeedKey);
}

/** Apply the decision Authur returned for `request` (which must be for the current state). */
export function applyAuthur(attempt, request, decision, { now = Date.now() } = {}) {
  if (canonicalJson(request) !== canonicalJson(authurRequest(attempt))) throw new Error("Authur answered a different position");
  const action = onRealTiles(attempt.state, decision.action);
  return step(attempt, action, {
    decision: {
      id: decision.id,
      seed: request.seed,
      cpuMs: decision.cpuMs,
      wallMs: decision.wallMs,
      endgame: decision.endgame,
      // The exact endgame's own 60 s clock ran out: kept, flagged, never rejected.
      timingAffected: Boolean(decision.endgame && decision.endgame.exact === false),
      netFired: decision.netFired,
    },
  }, now);
}

// ── the attempt file (server-side, complete) ─────────────────────────────────
export function attemptDocument(attempt) {
  const { candidate } = attempt.level;
  return {
    schema: ATTEMPT_SCHEMA,
    tool: "survival-playtest (offline, disposable)",
    attemptId: attempt.id,
    levelId: candidate.candidateId,
    contentHash: candidate.contentHash,
    runId: candidate.provenance.runId,
    roles: { human: attempt.human, authur: attempt.authur },
    rules: { rules: candidate.gameplay.snapshot.rules, bag: BAG_RULE },
    opponent: {
      engine: "authur",
      config: "offline",
      settings: AUTHUR_CONFIGS.offline,
      seedKey: attempt.opponentSeedKey,
      strongSha256: candidate.provenance.authur?.strongSha256 ?? null,
      models: candidate.provenance.authur?.models ?? null,
    },
    status: attempt.result ? "finished" : "in-progress",
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    start: { snapshot: candidate.gameplay.snapshot, stateHash: attempt.startHash },
    turns: attempt.turns,
    rejected: attempt.rejected,
    result: attempt.result,
  };
}

export async function saveAttempt(attempt, outDir = OUT_DIR) {
  const file = resolve(outDir, "attempts", attempt.level.id, `${attempt.id}.json`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(attemptDocument(attempt), null, 1)}\n`);
  attempt.file = file;
  return file;
}

/** Re-play an attempt document from its start snapshot; every record must be what the engine does. */
export function replayAttempt(doc) {
  let state = stateFromSnapshot(doc.start.snapshot);
  if (stateHash(state) !== doc.start.stateHash) throw new Error("attempt replay: the start state differs");
  for (const t of doc.turns) {
    const at = `attempt replay, turn ${t.turn}`;
    if (state.turnNumber !== t.turn || state.activeSide !== t.side) throw new Error(`${at}: out of order`);
    const bag = kindsOf(state, state.bag);
    const result = applySurvival(state, t.action);
    if (result.scoreGained !== t.scoreGained) throw new Error(`${at}: scored ${result.scoreGained}, the log says ${t.scoreGained}`);
    const drawn = kindsOf(state, result.drawn);
    if (canonicalJson(drawn) !== canonicalJson(t.drawn)) throw new Error(`${at}: different draws`);
    if (canonicalJson(drawn) !== canonicalJson(bag.slice(0, drawn.length))) throw new Error(`${at}: a draw not from the front`);
    if (!result.terminal) {
      const expected = [...bag.slice(drawn.length), ...sortKinds(kindsOf(state, result.returned))];
      if (canonicalJson(kindsOf(result.state, result.state.bag)) !== canonicalJson(expected)) throw new Error(`${at}: the fixed-bag rule was broken`);
    }
    if (hashAfter(result.state).state !== t.stateHashAfter) throw new Error(`${at}: state hash differs`);
    if (canonicalJson(result.state.scores) !== canonicalJson(t.scoresAfter)) throw new Error(`${at}: totals differ`);
    state = result.state;
  }
  return state;
}

// ── what the browser may see ─────────────────────────────────────────────────
export function publicLevel(level) {
  const facts = level.candidate.public;
  return {
    id: level.id,
    number: level.number,
    deficit: facts.deficit,
    bagRemaining: facts.bagRemaining,
    turnNumber: facts.turnNumber,
    scores: { player: facts.scores.player, authur: facts.scores.authur },
  };
}

/**
 * The player's OWN rack around one of their turns — theirs to see, exactly as
 * ranked shows a player their own side's racks. Objects rather than a bare
 * list of kinds, so no run of kinds in a response can ever be mistaken for (or
 * match) a hidden sequence.
 */
function ownRacks(t) {
  const before = [...t.rackBefore];
  const after = [...before];
  const spent = t.type === "place" ? t.action.placements.map((p) => p.kind) : t.type === "exchange" ? t.action.kinds : [];
  for (const kind of spent) after.splice(after.indexOf(kind), 1);
  after.push(...t.drawn);
  const tiles = (kinds) => kinds.map((kind) => ({ kind }));
  return {
    yourRackBefore: tiles(before),
    yourRackAfter: tiles(after),
    ...(t.type === "exchange" ? { yourExchanged: tiles(t.action.kinds) } : {}),
  };
}

function publicTurn(attempt, t) {
  const role = (scores) => ({ player: scores[attempt.human], authur: scores[attempt.authur] });
  return {
    turn: t.turn,
    seat: t.actor === "human" ? "player" : "authur",
    playedBy: t.actor,
    type: t.type,
    ...(t.type === "place" ? { placements: t.action.placements.map(({ cell, kind, face }) => ({ cell, kind, face })) } : {}),
    ...(t.type === "exchange" ? { tilesExchanged: t.action.kinds.length } : {}),
    ...(t.actor === "human" ? ownRacks(t) : {}),
    scoreGained: t.scoreGained,
    scoresAfter: role(t.scoresAfter),
    tilesDrawn: t.drawn.length,
    bagCountAfter: t.bagCountAfter,
    scorelessStreakAfter: t.noScoreTailAfter.length,
    ...(t.terminal ? { ended: publicEnding(attempt, t.terminal) } : {}),
  };
}

function publicEnding(attempt, terminal) {
  return {
    reason: terminal.reason,
    bonusTo: terminal.bonusSide ? (terminal.bonusSide === attempt.human ? "player" : "authur") : null,
    bonusPoints: terminal.bonusPoints,
  };
}

export function publicAttempt(attempt) {
  const { state, level } = attempt;
  const seat = (side) => (side === attempt.human ? "player" : "authur");
  const board = [];
  state.board.forEach((cell, index) => {
    if (cell) board.push({ cell: index, kind: cell.kind, face: cell.face, owner: seat(cell.side), turn: cell.turn });
  });
  const status = statusOf(attempt);
  return {
    attemptId: attempt.id,
    level: publicLevel(level),
    status,
    seats: { player: attempt.human, authur: attempt.authur },
    turnNumber: state.turnNumber,
    board,
    rack: state.racks[attempt.human].map((id) => ({ id, kind: state.manifest.kindOf.get(id) })),
    authurRackCount: state.racks[attempt.authur].length,
    bagCount: state.bag.length,
    scores: { player: state.scores[attempt.human], authur: state.scores[attempt.authur] },
    scorelessStreak: state.noScoreTail.length,
    exchangeAllowed: status === "your-turn" && env.exchangeAllowed(state),
    sourceLog: playerView(level.candidate).sourceLog,
    log: attempt.turns.map((t) => publicTurn(attempt, t)),
    result: attempt.result
      ? {
          outcome: attempt.result.winner === "human" ? "win" : attempt.result.winner === "authur" ? "loss" : "tie",
          scores: { player: attempt.result.scores.human, authur: attempt.result.scores.authur },
          margin: attempt.result.margin,
          ...publicEnding(attempt, state.terminal),
          turns: attempt.result.turns,
          yourTurns: attempt.result.humanTurns,
          authurTurns: attempt.result.authurTurns,
          savedAs: attempt.file ? relative(EQLAB_ROOT, attempt.file) : null,
        }
      : null,
  };
}

// ── the leak guard ───────────────────────────────────────────────────────────
const FORBIDDEN_KEYS = new Set([
  "bag", "bagAfter", "racks", "rackBefore", "drawn", "returned", "pending", "pendingReturn",
  "levelKey", "seed", "seedKey", "sourceSeed", "opponentSeedKey", "stateHash", "stateHashAfter",
  "decision", "admin", "provenance", "gameplay", "snapshot", "contentHash", "tileIds", "authurRack",
  "opportunity", "routing", "tactical", "strategic", "games", "profiles", "bestExactPlan", "bestBlindPlan",
]);

/**
 * Throws if a payload bound for the browser holds a hidden-information field,
 * or — given the attempt — Authur's rack or the bag's order anywhere in it.
 */
export function assertPlayerSafe(payload, attempt = null) {
  const walk = (value, path) => {
    if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}[${i}]`));
    else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key)) throw new Error(`player payload leaks "${key}" at ${path}`);
        walk(item, `${path}.${key}`);
      }
    }
  };
  walk(payload, "$");
  if (attempt) {
    const text = JSON.stringify(payload);
    const { state } = attempt;
    const hidden = [
      kindsOf(state, state.bag),
      kindsOf(state, state.racks[attempt.authur]),
      sortKinds(kindsOf(state, state.racks[attempt.authur])),
    ].filter((kinds) => kinds.length >= 3);
    for (const kinds of hidden) {
      if (text.includes(JSON.stringify(kinds).slice(1, -1))) throw new Error("player payload holds a hidden tile sequence");
    }
    for (const secret of [attempt.levelKey, attempt.level.candidate.gameplay.sourceLog.takeover.stateHash]) {
      if (text.includes(secret)) throw new Error("player payload holds a hidden value");
    }
  }
  return payload;
}
