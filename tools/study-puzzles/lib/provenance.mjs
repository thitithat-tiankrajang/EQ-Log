// The source game behind a Study puzzle, recorded so it can be REPLAYED, not
// only read (DESIGN.md §3 A).
//
// The rules engine and the per-turn records are the Survival generator's,
// imported read-only: `lib/rules.mjs` (the bot-lab environment under
// eqlab-compat rules, vendored with its provenance) and `lib/sourcelog.mjs`
// (the deal, one exact record per turn, state and public hashes, replay from the
// seed and from the log alone). A Study log is those records in a Study
// envelope: it ends at the PUZZLE point instead of a Survival takeover, and no
// game continues after it, so it carries no post-takeover bag rule.
import { KIND_ORDER, env } from "../../survival-generator/lib/rules.mjs";
import {
  PUBLIC_HASH,
  SOURCE_LOG_FORMAT,
  SOURCE_RULES,
  STATE_HASH,
  initialRecord,
  publicHash,
  replaySourceLog,
  sourceLogProblems,
  stateHash,
  turnRecord,
} from "../../survival-generator/lib/sourcelog.mjs";

export const STUDY_LOG_FORMAT = "study-source-log-v1";
export { env, initialRecord, turnRecord };

const RANK = new Map(KIND_ORDER.map((kind, index) => [kind, index]));
export const sortKinds = (kinds) => [...kinds].sort((a, b) => RANK.get(a) - RANK.get(b));
const kindsOf = (state, ids) => ids.map((id) => state.manifest.kindOf.get(id));
const other = (side) => (side === "A" ? "B" : "A");

/** Survival's checks read a `takeover`; a Study log's end point is its `puzzle`. */
const asSurvivalLog = (log) => ({ ...log, format: SOURCE_LOG_FORMAT, takeover: log.puzzle });

/** Structural problems (turn order, totals, bag arithmetic, hash chain), none if it holds. */
export function studyLogProblems(log, state) {
  if (log?.format !== STUDY_LOG_FORMAT) return [`source log format ${log?.format}`];
  return sourceLogProblems(asSurvivalLog(log), state);
}

/** The deal plus every turn before `state`, checked before it is returned. */
export function buildStudyLog({ sourceSeed, initial, turns, state }) {
  const log = {
    format: STUDY_LOG_FORMAT,
    stateHash: STATE_HASH,
    publicHash: PUBLIC_HASH,
    sourceRules: SOURCE_RULES,
    sourceSeed,
    initial,
    turns,
    puzzle: {
      turn: state.turnNumber,
      sideToMove: state.activeSide,
      stateHash: stateHash(state),
      publicHash: publicHash(state),
    },
  };
  const problems = studyLogProblems(log, state);
  if (problems.length > 0) throw new Error(`invalid source log:\n  - ${problems.join("\n  - ")}`);
  return log;
}

/**
 * Replays a Study log through the rules engine and returns the state at the
 * puzzle point. `mode: "seed"` proves it is the game this seed deals; `"log"`
 * needs no RNG and no tile ids, so any rules implementation can check it.
 * Throws at the first disagreement.
 */
export function replayStudyLog(log, mode = "seed") {
  if (log?.format !== STUDY_LOG_FORMAT) throw new Error(`source log format ${log?.format}`);
  return replaySourceLog(asSurvivalLog(log), { mode });
}

/** The position at `state` as a puzzle keeps it: public part, and the hidden part apart. */
export function positionOf(state) {
  const side = state.activeSide;
  const opponent = other(side);
  const board = [];
  state.board.forEach((cell, index) => {
    if (cell) {
      board.push({
        r: Math.floor(index / 15),
        c: index % 15,
        kind: cell.kind,
        face: cell.face,
        side: cell.side,
        turn: cell.turn,
      });
    }
  });
  const rack = sortKinds(kindsOf(state, state.racks[side]));
  const opponentRack = sortKinds(kindsOf(state, state.racks[opponent]));
  const bag = kindsOf(state, state.bag);
  // Everything the player cannot see, as one multiset: what Study shows as unseen.
  const unseen = {};
  for (const kind of sortKinds([...opponentRack, ...bag])) unseen[kind] = (unseen[kind] ?? 0) + 1;
  return {
    sideToMove: side,
    turnNumber: state.turnNumber,
    board,
    rack,
    scores: { self: state.scores[side], opponent: state.scores[opponent] },
    bagCount: bag.length,
    oppRackCount: opponentRack.length,
    noScoreStreak: state.noScoreTail.length,
    unseen,
    hidden: { opponentRack, bag },
  };
}
