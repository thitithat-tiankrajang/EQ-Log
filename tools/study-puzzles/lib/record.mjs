// One puzzle as it is kept, and the only things ever derived from it for a
// player (DESIGN.md §3, §8):
//
//   A canonical source & position   puzzle.canonical   server / admin
//   B player projection             playerProjection   built from an allow-list
//   C answer & analysis             puzzle.answer      admin
//   D attempt                       attemptRecord      written by play, read by admin
import { canonicalJson, sha256 } from "../../survival-generator/lib/canonical.mjs";
import { analyzePlacement } from "./analysis.mjs";
import { ANALYSIS_LEVEL, TOP_N } from "./engine.mjs";

export const PUZZLE_SCHEMA = "eqlab-study-puzzle-v2";
export const PLAYER_FORMAT = "study-puzzle-player-v1";
export const ATTEMPT_SCHEMA = "study-puzzle-attempt-v1";

const cellOf = ({ r, c, kind, face }) => ({ r, c, kind, face });
const byCell = (a, b) => a.r - b.r || a.c - b.c;

/** The public position's identity: what a player is shown, nothing else. */
export function positionHash(position) {
  return sha256(
    canonicalJson({
      board: [...position.board].sort(byCell).map(cellOf),
      rack: [...position.rack].sort(),
      scores: position.scores,
      turnNumber: position.turnNumber,
      bagCount: position.bagCount,
      oppRackCount: position.oppRackCount,
    }),
  );
}

export function buildPuzzle({
  setId,
  gameIndex,
  sourceSeed,
  log,
  position,
  studyPosition,
  request,
  result,
  best,
  analysis,
  nearBest,
  checks,
  features,
  provenance = { origin: "AUTHENTIC_SEEDED" },
}) {
  const hash = positionHash(position);
  const puzzle = {
    schema: PUZZLE_SCHEMA,
    id: `pz-${hash.slice(0, 12)}`,
    setId,
    index: null,
    hashes: { position: hash, puzzle: null },
    canonical: {
      provenance,
      source: {
        game: gameIndex,
        seed: sourceSeed,
        policy: { engine: ANALYSIS_LEVEL, request: "study-endpoint-equivalent", topN: TOP_N },
        log,
      },
      position,
      studyRequest: studyPosition,
    },
    answer: {
      engine: {
        solver: result.solver,
        request,
        legalMoves: result.stats?.moves ?? null,
        elapsedMs: result.stats?.elapsedMs ?? null,
        candidates: result.candidates.map((candidate, index) => ({
          rank: index + 1,
          type: candidate.type,
          placements: (candidate.placements ?? []).map((p) => ({
            r: p.r,
            c: p.c,
            kind: p.kind,
            face: p.token,
          })),
          exchange: candidate.exchange ?? [],
          score: candidate.score,
          value: candidate.value,
          deep: candidate.deep,
          components: candidate.components ?? [],
        })),
      },
      best: {
        placements: best.placements.map((p) => ({ r: p.r, c: p.c, kind: p.kind, face: p.token })),
        score: best.score,
        value: best.value,
        components: best.components ?? [],
      },
      nearBest,
      equations: analysis.equations,
      bingoBonus: analysis.bingoBonus,
      moveTypes: analysis.moveTypes,
      primaryType: analysis.primaryType,
      moveFacts: analysis.moveFacts,
      geometry: analysis.geometry,
      composition: analysis.composition,
      placedKinds: analysis.placedKinds,
      patterns: analysis.patterns,
      content: analysis.content,
      checks,
    },
    features,
  };
  puzzle.hashes.puzzle = sha256(
    canonicalJson({ canonical: puzzle.canonical, answer: puzzle.answer }),
  );
  return puzzle;
}

/** The set manifest's line for a puzzle. Admin-only: it describes the answer. */
export function summaryOf(puzzle) {
  return {
    id: puzzle.id,
    file: `puzzles/${puzzle.id}.json`,
    game: puzzle.canonical.source.game,
    turn: puzzle.canonical.position.turnNumber,
    score: puzzle.answer.best.score,
    tilesPlaced: puzzle.answer.composition.total,
    moveTypes: puzzle.answer.moveTypes,
    primaryType: puzzle.answer.primaryType,
    hooks: puzzle.answer.moveFacts.hooks.map((hook) => hook.subtype),
    equations: puzzle.answer.moveFacts.equationCount,
    pattern: puzzle.answer.patterns.main,
    origin: puzzle.canonical.provenance?.origin ?? "AUTHENTIC_SEEDED",
  };
}

// ── B. what a player may receive ─────────────────────────────────────────────
const FORBIDDEN_KEYS = new Set([
  "provenance",
  "origin",
  "originalRack",
  "constructedRack",
  "remainingUnseen",
  "candidateSeed",
  "sourcePositionHash",
  "sourceStateHash",
  "answer",
  "best",
  "nearBest",
  "candidates",
  "equations",
  "pattern",
  "patterns",
  "moveType",
  "moveTypes",
  "primaryType",
  "hookSubtype",
  "moveFacts",
  "geometry",
  "semantics",
  "legalPlacementCount",
  "placedKinds",
  "composition",
  "content",
  "features",
  "value",
  "components",
  "checks",
  "hidden",
  "bag",
  "opponentRack",
  "seed",
  "sourceSeed",
  "stateHash",
  "log",
  "source",
  "config",
  "request",
  "studyRequest",
  "grade",
]);

/** Throws if anything answer-shaped or hidden is anywhere in `value`; returns it otherwise. */
export function assertPlayerSafe(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPlayerSafe(item, `${path}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error(`player projection would expose ${path}.${key}`);
      assertPlayerSafe(item, `${path}.${key}`);
    }
  }
  return value;
}

/** The puzzle as a player sees it: the position, and that one placement is due. */
export function playerProjection(puzzle) {
  const position = puzzle.canonical.position;
  return assertPlayerSafe({
    format: PLAYER_FORMAT,
    setId: puzzle.setId,
    puzzleId: puzzle.id,
    positionHash: puzzle.hashes.position,
    position: {
      board: position.board.map(cellOf),
      rack: [...position.rack],
      scores: { self: position.scores.self, opponent: position.scores.opponent },
      turnNumber: position.turnNumber,
      bagCount: position.bagCount,
      oppRackCount: position.oppRackCount,
      unseen: { ...position.unseen },
    },
    rules: { move: "place" },
  });
}

// ── D. a submission ──────────────────────────────────────────────────────────
/** Is `placements` a legal move for this puzzle's player? Their own move only. */
export function judgeSubmission(puzzle, placements) {
  const position = puzzle.canonical.position;
  const errors = [];
  if (!Array.isArray(placements) || placements.length === 0) {
    return { valid: false, score: 0, equations: [], errors: ["Place at least one tile."] };
  }
  const rack = [...position.rack];
  const cells = [];
  for (const placement of placements) {
    const { r, c, kind, face } = placement ?? {};
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r > 14 || c < 0 || c > 14) {
      errors.push("A tile is outside the board.");
      continue;
    }
    const index = rack.indexOf(kind);
    if (index < 0) {
      errors.push(`The rack holds no ${kind}.`);
      continue;
    }
    rack.splice(index, 1);
    cells.push({ r, c, kind, face: typeof face === "string" ? face : kind });
  }
  if (errors.length > 0) return { valid: false, score: 0, equations: [], errors };
  const verdict = analyzePlacement(position.board, cells);
  if (!verdict.valid)
    return { valid: false, score: 0, equations: [], errors: verdict.errors, cells };
  return {
    valid: true,
    score: verdict.score,
    equations: verdict.equations.map((equation) => ({
      text: equation.text,
      score: equation.score,
    })),
    errors: [],
    cells,
  };
}

export function attemptRecord({ puzzle, id, submittedAt, by, judged }) {
  return {
    schema: ATTEMPT_SCHEMA,
    id,
    setId: puzzle.setId,
    puzzleId: puzzle.id,
    positionHash: puzzle.hashes.position,
    puzzleHash: puzzle.hashes.puzzle,
    by,
    submittedAt,
    move: { placements: judged.cells ?? [] },
    validation: {
      valid: judged.valid,
      score: judged.score,
      equations: judged.equations,
      errors: judged.errors,
    },
  };
}

// A plain tile has one face; only a blank or a two-faced tile's face says anything.
const CHOICE_KINDS = new Set(["?", "+/-", "x//"]);
export const moveKey = (placements) =>
  [...placements]
    .sort(byCell)
    .map((p) => `${p.r},${p.c},${p.kind},${CHOICE_KINDS.has(p.kind) ? p.face : ""}`)
    .join("|");

/** Admin only: how an attempt compares with the engine's answer. Never stored. */
export function gradeAttempt(puzzle, attempt) {
  if (!attempt.validation.valid) return { comparable: false };
  const key = moveKey(attempt.move.placements);
  const rank = puzzle.answer.engine.candidates.findIndex(
    (candidate) => candidate.type === "place" && moveKey(candidate.placements) === key,
  );
  return {
    comparable: true,
    sameAsBest: moveKey(puzzle.answer.best.placements) === key,
    withinNearBest: puzzle.answer.nearBest.some((near) => moveKey(near.placements) === key),
    engineRank: rank >= 0 ? rank + 1 : null,
    scoreRatio:
      puzzle.answer.best.score > 0 ? attempt.validation.score / puzzle.answer.best.score : null,
  };
}
