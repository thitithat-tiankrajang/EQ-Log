// One seeded self-play game: Stage 5B chooses every move on both sides, asked
// exactly as Study's analysis endpoint asks (DESIGN.md §2). That single call per
// turn is both the source game's move and the puzzle analysis of that position,
// so the move played at a puzzle's turn IS the engine's answer — which is why it
// only ever lives in the admin record.
import { ANALYSIS_LEVEL, studyRequestFor } from "./engine.mjs";
import { buildStudyLog, env, initialRecord, positionOf, turnRecord } from "./provenance.mjs";

/** A Stage 5B candidate as an action on this state's own tiles (bound by kind). */
export function bindAction(state, candidate) {
  const pool = [...state.racks[state.activeSide]];
  const take = (kind) => {
    const index = pool.findIndex((id) => state.manifest.kindOf.get(id) === kind);
    if (index < 0) throw new Error(`the mover holds no ${kind}`);
    return pool.splice(index, 1)[0];
  };
  if (candidate.type === "place") {
    return {
      type: "place",
      placements: candidate.placements.map((placement) => ({
        cell: placement.r * 15 + placement.c,
        kind: placement.kind,
        face: placement.token,
        tileId: take(placement.kind),
      })),
    };
  }
  if (candidate.type === "exchange") {
    return {
      type: "exchange",
      kinds: [...candidate.exchange],
      tileIds: candidate.exchange.map(take),
    };
  }
  return { type: "pass" };
}

/**
 * Plays the game `seed` deals, until it ends, `shouldStop()` or `maxTurns`.
 *
 * `onPosition` is awaited at every position, before its move is played, with
 * the position, the Study request, the engine's result and its chosen action,
 * and `sourceLog()` — the replayable log up to this position, built only if asked.
 * Engine errors propagate; the caller decides what an abandoned game means.
 */
export async function playGame({
  seed,
  engine,
  onPosition,
  onSourcePosition,
  shouldStop = () => false,
  maxTurns = 120,
}) {
  let state = env.createEnvState({ seed });
  const initial = initialRecord(state);
  const turns = [];
  let positions = 0;
  while (!state.terminal && positions < maxTurns) {
    if (shouldStop()) return { reason: "stopped", positions };
    const here = state;
    const position = positionOf(here);
    const { request, studyPosition } = studyRequestFor({
      board: position.board,
      rack: position.rack,
      scoreSelf: position.scores.self,
      scoreOpponent: position.scores.opponent,
    });
    const before = structuredClone(turns);
    const sourceLog = () =>
      buildStudyLog({ sourceSeed: seed, initial, turns: before, state: here });
    let analysis;
    const analyzeSource = () => (analysis ??= engine.analyze(request));
    // The optional search sees a deep copy, never the state's live arrays/RNG.
    // The memoised authentic analysis is also used for normal continuation.
    await onSourcePosition?.({
      state: structuredClone(here),
      position,
      studyPosition,
      request,
      sourceLog,
      analyzeSource,
    });
    if (shouldStop()) return { reason: "stopped", positions };
    const result = await analyzeSource();
    positions += 1;
    const best = result.candidates?.find((candidate) => candidate.chosen) ?? result.candidates?.[0];
    if (!best) throw new Error("Stage 5B returned no action");
    await onPosition?.({
      state: here,
      position,
      studyPosition,
      request,
      result,
      best,
      sourceLog,
    });
    if (shouldStop()) return { reason: "stopped", positions };
    const action = bindAction(here, best);
    const outcome = env.applyAction(here, action);
    if (outcome.terminal) return { reason: "finished", positions, terminal: outcome.terminal };
    turns.push(
      turnRecord(here, action, outcome, {
        policy: ANALYSIS_LEVEL,
        seed: request.seed,
        value: best.value,
      }),
    );
    state = outcome.state;
  }
  return { reason: state.terminal ? "finished" : "turn-cap", positions };
}
