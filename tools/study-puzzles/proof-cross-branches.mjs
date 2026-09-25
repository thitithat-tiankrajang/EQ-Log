// Bounded proof search over already archived authentic self-play boards whose
// geometry can host CROSS: four new cells, seven in the main equation, three
// reused. Every proposed rack is an isolated, conserved branch; Stage 5B's
// unrestricted rank 1 remains decisive. No search-learning state is kept.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createSet, commitPuzzle, newSetId, writeManifest } from "./lib/archive.mjs";
import { analyzePlacement, difficultyFeatures, nearBestOf, rackDifficulty } from "./lib/analysis.mjs";
import { constructBranch } from "./lib/branch.mjs";
import { configFrom } from "./lib/config.mjs";
import { createEngine, engineVersions, studyRequestFor } from "./lib/engine.mjs";
import { geometryFeasibility, legalRackFeasibility } from "./lib/feasibility.mjs";
import { bestPlayRejections } from "./lib/filters.mjs";
import { positionOf, replayStudyLog } from "./lib/provenance.mjs";
import { candidateRacks } from "./lib/racks.mjs";
import { buildPuzzle, summaryOf } from "./lib/record.mjs";
import { verifyPuzzle } from "./lib/verify.mjs";

const archive = new URL("./archive/", import.meta.url);
const sourceFiles = [
  "set-20260925-162241-4e8948/puzzles/pz-2179b38156a7.json",
  "set-20260925-162548-bf22e1/puzzles/pz-c7b5224dea66.json",
  "set-20260925-162548-bf22e1/puzzles/pz-c18751051f22.json",
  "set-20260925-162241-4e8948/puzzles/pz-994c2a221ed3.json",
  "set-20260925-162241-4e8948/puzzles/pz-b5187ccce451.json",
  "set-20260925-165839-c9032b/puzzles/pz-7475a90fbb20.json",
  "set-20260925-162548-bf22e1/puzzles/pz-a4e2dbb43210.json",
  "set-20260925-162241-4e8948/puzzles/pz-32ab900740a3.json",
  "set-20260925-162435-d5663b/puzzles/pz-a18848186a27.json",
  "set-20260925-165839-c9032b/puzzles/pz-b697638f5344.json",
  "set-20260925-162241-4e8948/puzzles/pz-534a6fd564e4.json",
];
const config = configFrom({
  seed: 1, target: 1, label: "CROSS 4/7/3 proof",
  search: { strategy: "GUIDED", rackBudget: 64 },
  rack: { groups: { blank: { max: 0 }, choice: { max: 0 } } },
  position: { boardTiles: { min: 1, max: 100 } }, answer: { maxNear: 12 },
  bestPlay: { moveTypes: ["CROSS"], tiles: { min: 4, max: 4 }, excludeTrivialZero: false },
  equation: { scope: "MAIN", tiles: { min: 7, max: 7 }, reusedBoardTiles: { min: 3, max: 3 }, placedParticipating: { min: 4, max: 4 } },
});
const budgetMs = Number(process.argv[2] ?? 60000);
const out = resolve(process.argv[3] ?? "/tmp/study-spec-cross-branches");
await mkdir(out, { recursive: true });
const id = newSetId();
const manifest = await createSet({ archiveDir: out, id, config, engine: engineVersions() });
const engine = createEngine();
const controller = new AbortController();
controller.signal.addEventListener("abort", () => engine.killAll(), { once: true });
const timer = setTimeout(() => controller.abort(), budgetMs);
const started = performance.now();
const counters = { positions: 0, racks: 0, cheapPruned: 0, stage5b: 0, rank1Mismatch: 0 };
let proof = null;
try {
  for (const file of sourceFiles) {
    if (controller.signal.aborted) break;
    const old = JSON.parse(await readFile(new URL(file, archive), "utf8"));
    const state = replayStudyLog(old.canonical.source.log, "seed");
    const position = positionOf(state);
    if (geometryFeasibility(position, config).reasons.length) continue;
    counters.positions++;
    for (const candidate of candidateRacks(state, config, { budget: config.search.rackBudget })) {
      if (controller.signal.aborted) break;
      counters.racks++;
      const branch = constructBranch(state, candidate.rack, candidate);
      const feasible = await legalRackFeasibility(branch.state, config, { signal: controller.signal });
      if (feasible.possible === false) { counters.cheapPruned++; continue; }
      if (controller.signal.aborted) break;
      const branchPosition = positionOf(branch.state);
      const { request, studyPosition } = studyRequestFor({ board: branchPosition.board, rack: branchPosition.rack,
        scoreSelf: branchPosition.scores.self, scoreOpponent: branchPosition.scores.opponent });
      counters.stage5b++;
      let result;
      try { result = await engine.analyze(request); }
      catch (error) { if (controller.signal.aborted) break; throw error; }
      const best = result.candidates[0];
      if (best?.type !== "place") { counters.rank1Mismatch++; continue; }
      const analysis = analyzePlacement(branchPosition.board, best.placements.map((tile) => ({ ...tile, face: tile.token })));
      const nearBest = nearBestOf(result.candidates);
      if (!analysis.valid || bestPlayRejections(config, { analysis, nearBest, rackIndex: rackDifficulty(branchPosition.rack).index, rack: branchPosition.rack }).length) {
        counters.rank1Mismatch++; continue;
      }
      const cli = await engine.validate(request, { type: "place", placements: best.placements });
      if (!cli.valid || cli.score !== best.score || analysis.score !== best.score) throw new Error("scorer disagreement");
      const puzzle = buildPuzzle({ setId: id, gameIndex: old.canonical.source.game, sourceSeed: old.canonical.source.seed,
        log: old.canonical.source.log, position: branchPosition, studyPosition, request, result, best, analysis, nearBest,
        checks: { stage5b: best.score, eqlab: analysis.score, amathCli: cli.score },
        features: difficultyFeatures({ position: branchPosition, candidates: result.candidates, legalMoves: result.stats?.moves ?? null, analysis, nearBest }),
        provenance: branch.provenance });
      puzzle.index = 0;
      await commitPuzzle(join(out, id), manifest, puzzle, summaryOf(puzzle));
      const verification = await verifyPuzzle(puzzle, engine, config);
      if (!verification.ok) throw new Error("fresh proof verification failed");
      proof = { source: file, puzzle: puzzle.id, rack: branchPosition.rack, board: branchPosition.board, best: puzzle.answer.best,
        geometry: puzzle.answer.geometry, equations: puzzle.answer.equations, provenance: puzzle.canonical.provenance, verification };
      break;
    }
    if (proof) break;
  }
} finally {
  clearTimeout(timer);
  engine.killAll();
  manifest.status = proof ? "complete" : "stopped";
  manifest.finishedAt = new Date().toISOString();
  manifest.counters.matched = proof ? 1 : 0;
  await writeManifest(join(out, id), manifest);
  const report = { directory: join(out, id), budgetMs, elapsedMs: performance.now() - started, counters, proof };
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ directory: report.directory, elapsedMs: report.elapsedMs, counters, proof: proof ? { id: proof.puzzle, rack: proof.rack, best: proof.best, verification: proof.verification.ok } : null }, null, 2));
}
