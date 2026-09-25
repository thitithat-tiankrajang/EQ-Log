// Re-evaluate known, authentic self-play positions with new Study specification
// fields. This is a small deterministic proof set, not a search benchmark.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createSet, commitPuzzle, newSetId, writeManifest } from "./lib/archive.mjs";
import { analyzePlacement, difficultyFeatures, nearBestOf, rackDifficulty } from "./lib/analysis.mjs";
import { configFrom } from "./lib/config.mjs";
import { createEngine, engineVersions, studyRequestFor } from "./lib/engine.mjs";
import { bestPlayRejections } from "./lib/filters.mjs";
import { legalPlacementCount } from "./lib/mobility.mjs";
import { replayStudyLog } from "./lib/provenance.mjs";
import { buildPuzzle, moveKey, summaryOf } from "./lib/record.mjs";
import { verifyPuzzle } from "./lib/verify.mjs";

const base = new URL("./archive/", import.meta.url);
const cases = [
  ["extend-head", "set-20260925-162548-bf22e1/puzzles/pz-dffc797f4637.json", { bestPlay: { moveTypes: ["EXTEND"] }, geometry: { extend: { shapes: ["HEAD_ONLY"] } } }],
  ["extend-tail", "set-20260925-162548-bf22e1/puzzles/pz-c18751051f22.json", { bestPlay: { moveTypes: ["EXTEND"] }, geometry: { extend: { shapes: ["TAIL_ONLY"] } } }],
  ["extend-both", "set-20260925-162548-bf22e1/puzzles/pz-11ed112ab1ee.json", { bestPlay: { moveTypes: ["EXTEND"] }, geometry: { extend: { shapes: ["BOTH"] } } }],
  ["low-mobility", "set-20260925-162241-4e8948/puzzles/pz-2179b38156a7.json", { mobility: { legalPlacements: { min: 1, max: 5 } } }],
  ["fractional-cross", "set-20260925-163949-243f4e/puzzles/pz-9ef59ee363c4.json", { bestPlay: { moveTypes: ["CROSS"] }, equation: { properties: ["MUL_DIV_ONLY", "FRACTION_RESULT", "NEGATIVE_RESULT"], scope: "MAIN" } }],
];

const out = resolve(process.argv[2] ?? "/tmp/study-spec-known-proofs");
await mkdir(out, { recursive: true });
const engine = createEngine();
const report = [];
try {
  for (const [name, archived, constraints] of cases) {
    const old = JSON.parse(await readFile(new URL(archived, base), "utf8"));
    const sourceSet = JSON.parse(await readFile(new URL(`${archived.split("/")[0]}/set.json`, base), "utf8"));
    const config = configFrom({
      seed: sourceSet.config.seed, target: 1, label: `Specification proof: ${name}`,
      search: { strategy: "AUTHENTIC_ONLY" }, position: { boardTiles: { min: 1, max: 100 } },
      bestPlay: { excludeTrivialZero: false, ...constraints.bestPlay },
      ...Object.fromEntries(Object.entries(constraints).filter(([key]) => key !== "bestPlay")),
    });
    const position = old.canonical.position;
    const { request, studyPosition } = studyRequestFor({
      board: position.board, rack: position.rack,
      scoreSelf: position.scores.self, scoreOpponent: position.scores.opponent,
    });
    const result = await engine.analyze(request);
    const best = result.candidates[0];
    if (best?.type !== "place" || moveKey(best.placements.map((tile) => ({ ...tile, face: tile.token }))) !== moveKey(old.answer.best.placements))
      throw new Error(`${name}: current Stage 5B rank 1 differs from archived proof`);
    const analysis = analyzePlacement(position.board, best.placements.map((tile) => ({ ...tile, face: tile.token })));
    const nearBest = nearBestOf(result.candidates);
    const reasons = bestPlayRejections(config, { analysis, nearBest, rackIndex: rackDifficulty(position.rack).index, rack: position.rack });
    let mobility = null;
    if (constraints.mobility) {
      mobility = await legalPlacementCount(replayStudyLog(old.canonical.source.log, "seed"));
      if (!mobility.exact || mobility.count < 1 || mobility.count > 5) reasons.push("mobility.legalPlacements");
    }
    if (reasons.length) throw new Error(`${name}: ${reasons.join(", ")}`);
    const cli = await engine.validate(request, { type: "place", placements: best.placements });
    if (!analysis.valid || analysis.score !== best.score || !cli.valid || cli.score !== best.score)
      throw new Error(`${name}: scorer disagreement`);
    const id = newSetId();
    const manifest = await createSet({ archiveDir: out, id, config, engine: engineVersions() });
    const puzzle = buildPuzzle({
      setId: id, gameIndex: old.canonical.source.game, sourceSeed: old.canonical.source.seed,
      log: old.canonical.source.log, position, studyPosition, request, result, best, analysis, nearBest,
      checks: { stage5b: best.score, eqlab: analysis.score, amathCli: cli.score },
      features: {
        ...difficultyFeatures({ position, candidates: result.candidates, legalMoves: result.stats?.moves ?? null, analysis, nearBest }),
        ...(mobility ? { legalPlacementCount: mobility.count, legalPlacementCountExact: true } : {}),
      },
      provenance: old.canonical.provenance ?? { origin: "AUTHENTIC_SEEDED" },
    });
    puzzle.index = 0;
    await commitPuzzle(join(out, id), manifest, puzzle, summaryOf(puzzle));
    manifest.status = "complete";
    manifest.finishedAt = new Date().toISOString();
    manifest.counters.matched = 1;
    await writeManifest(join(out, id), manifest);
    const verification = await verifyPuzzle(puzzle, engine, config);
    report.push({ name, config, directory: join(out, id), puzzle: puzzle.id,
      rack: position.rack, board: position.board, best: puzzle.answer.best,
      geometry: puzzle.answer.geometry, equations: puzzle.answer.equations.map(({ text, tileCount, placedParticipating, reusedBoardTiles, semantics }) => ({ text, tileCount, placedParticipating, reusedBoardTiles, semantics })),
      legalPlacementCount: mobility?.count ?? null, verification });
    if (!verification.ok) throw new Error(`${name}: fresh verification failed`);
  }
} finally {
  engine.killAll();
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify(report.map(({ name, directory, puzzle, rack, best, geometry, equations, legalPlacementCount, verification }) => ({ name, directory, puzzle, rack, best, geometry, equations, legalPlacementCount, verified: verification.ok })), null, 2));
