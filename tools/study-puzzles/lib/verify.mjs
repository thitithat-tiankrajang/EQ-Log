import { isDeepStrictEqual } from "node:util";
import { canonicalJson, sha256 } from "../../survival-generator/lib/canonical.mjs";
import { stateHash } from "../../survival-generator/lib/sourcelog.mjs";
import { constructBranch, BRANCH_VERSION } from "./branch.mjs";
import { positionOf, replayStudyLog } from "./provenance.mjs";
import { judgeSubmission, moveKey, positionHash } from "./record.mjs";
import { studyRequestFor } from "./engine.mjs";
import { analyzePlacement } from "./analysis.mjs";
import { rackDifficulty } from "./analysis.mjs";
import { bestPlayRejections, within } from "./filters.mjs";
import { legalPlacementCount } from "./mobility.mjs";
import { configFrom } from "./config.mjs";

export function verifyProvenance(puzzle) {
  const provenance = puzzle.canonical.provenance ?? { origin: "AUTHENTIC_SEEDED" };
  const { log } = puzzle.canonical.source;
  const modes = {},
    checks = {};
  const check = (name, ok, error) => {
    checks[name] = {
      ok: (checks[name]?.ok ?? true) && Boolean(ok),
      ...(!ok && error ? { error } : {}),
    };
    if (!ok) throw new Error(error ?? name);
  };
  for (const mode of ["seed", "log"]) {
    try {
      const source = replayStudyLog(log, mode);
      check("sourceReplay", true);
      check(
        "sourceState",
        puzzle.canonical.source.seed === log.sourceSeed,
        "source seed differs from log",
      );
      let expected = positionOf(source);
      if (provenance.origin === "CONFIG_GUIDED_RACK") {
        check(
          "sourceState",
          provenance.version === BRANCH_VERSION &&
            provenance.sourceTurn === source.turnNumber &&
            provenance.sourcePositionHash === positionHash(expected) &&
            provenance.sourceStateHash === stateHash(source) &&
            isDeepStrictEqual(provenance.originalRack, expected.rack),
          "source state/provenance differs from replay",
        );
        const branch = constructBranch(source, provenance.constructedRack, provenance);
        expected = positionOf(branch.state);
        check(
          "rackLegal",
          isDeepStrictEqual(expected.rack, puzzle.canonical.position.rack),
          "constructed rack differs",
        );
        check(
          "tileConservation",
          isDeepStrictEqual(expected, puzzle.canonical.position) &&
            isDeepStrictEqual(expected.unseen, provenance.remainingUnseen),
          "constructed allocation differs or loses tiles",
        );
        check(
          "positionHash",
          positionHash(expected) === provenance.puzzlePositionHash,
          "constructed position hash differs",
        );
      } else {
        check(
          "sourceState",
          provenance.origin === "AUTHENTIC_SEEDED" &&
            isDeepStrictEqual(expected, puzzle.canonical.position),
          "authentic puzzle differs from exact replay",
        );
        check("rackLegal", true);
        check("tileConservation", true);
      }
      check(
        "positionHash",
        positionHash(expected) === puzzle.hashes.position,
        "stored position hash differs",
      );
      modes[mode] = { ok: true, turns: log.turns.length };
    } catch (error) {
      modes[mode] = { ok: false, error: error.message };
    }
  }
  for (const name of [
    "sourceReplay",
    "sourceState",
    "rackLegal",
    "tileConservation",
    "positionHash",
  ])
    checks[name] ??= { ok: false };
  return { ok: modes.seed.ok && modes.log.ok, origin: provenance.origin, modes, checks };
}

/** Fresh, independent checks. Stored score agreement alone is not verification. */
export async function verifyPuzzle(puzzle, engine, archivedConfig = null) {
  const verification = verifyProvenance(puzzle);
  const { checks } = verification;
  checks.puzzleHash = {
    ok:
      sha256(canonicalJson({ canonical: puzzle.canonical, answer: puzzle.answer })) ===
      puzzle.hashes.puzzle,
  };
  if (!verification.ok || !checks.puzzleHash.ok) return { ...verification, ok: false };
  const own = judgeSubmission(puzzle, puzzle.answer.best.placements);
  checks.eqlab = { ok: own.valid && own.score === puzzle.answer.best.score, score: own.score };
  const derived = analyzePlacement(puzzle.canonical.position.board, puzzle.answer.best.placements);
  const storedExtend = puzzle.answer.geometry?.extend;
  const derivedExtend = derived.geometry?.extend;
  const geometryMatches = puzzle.answer.geometry === undefined ||
    (storedExtend === null ? derivedExtend === null :
      storedExtend && derivedExtend && Object.entries(storedExtend).every(([key, value]) => isDeepStrictEqual(value, derivedExtend[key])));
  checks.analysis = {
    ok: derived.valid &&
      geometryMatches &&
      (puzzle.answer.placedKinds === undefined || isDeepStrictEqual(derived.placedKinds, puzzle.answer.placedKinds)) &&
      puzzle.answer.equations.every((equation, index) =>
        equation.tileCount === undefined ||
        (equation.tileCount === derived.equations[index]?.tileCount &&
          equation.reusedBoardTiles === derived.equations[index]?.reusedBoardTiles &&
          equation.placedParticipating === derived.equations[index]?.placedParticipating &&
          isDeepStrictEqual(equation.semantics, derived.equations[index]?.semantics))),
  };
  if (archivedConfig) {
    try {
      const config = configFrom(archivedConfig);
      const rejects = bestPlayRejections(config, {
        analysis: derived,
        nearBest: puzzle.answer.nearBest,
        rackIndex: rackDifficulty(puzzle.canonical.position.rack).index,
        rack: puzzle.canonical.position.rack,
      });
      const mobilityRange = config.mobility.legalPlacements;
      if (mobilityRange.min !== null || mobilityRange.max !== null) {
        const source = replayStudyLog(puzzle.canonical.source.log, "seed");
        const state = puzzle.canonical.provenance?.origin === "CONFIG_GUIDED_RACK"
          ? constructBranch(source, puzzle.canonical.provenance.constructedRack, puzzle.canonical.provenance).state
          : source;
        const measured = await legalPlacementCount(state);
        if (!measured.exact || !within(measured.count, mobilityRange) ||
          puzzle.features.legalPlacementCount !== measured.count || puzzle.features.legalPlacementCountExact !== true)
          rejects.push("mobility.legalPlacements");
      }
      checks.specification = { ok: rejects.length === 0, reasons: rejects };
    } catch (error) {
      checks.specification = { ok: false, error: error.message };
    }
  }
  const p = puzzle.canonical.position;
  const { request } = studyRequestFor({
    board: p.board,
    rack: p.rack,
    scoreSelf: p.scores.self,
    scoreOpponent: p.scores.opponent,
  });
  try {
    const result = await engine.analyze(request);
    const best = result.candidates?.[0];
    checks.stage5b = {
      ok:
        best?.type === "place" &&
        best.score === puzzle.answer.best.score &&
        moveKey(best.placements.map((t) => ({ ...t, face: t.token }))) ===
          moveKey(puzzle.answer.best.placements),
      score: best?.score,
    };
    const cli = await engine.validate(request, {
      type: "place",
      placements: puzzle.answer.best.placements.map((t) => ({ ...t, token: t.face })),
    });
    checks.amathCli = { ok: cli.valid && cli.score === puzzle.answer.best.score, score: cli.score };
  } catch (error) {
    checks.stage5b ??= { ok: false, error: error.message };
    checks.amathCli ??= { ok: false, error: error.message };
  }
  return { ...verification, ok: Object.values(checks).every((check) => check.ok) };
}
