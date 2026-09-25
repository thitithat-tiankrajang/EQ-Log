// Small, bounded real-engine Study specification proof run.
// node tools/study-puzzles/proof-run.mjs config.json [milliseconds] [output-dir]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createSet } from "./lib/archive.mjs";
import { configFrom } from "./lib/config.mjs";
import { createEngine, engineVersions } from "./lib/engine.mjs";
import { generateSet } from "./lib/generate.mjs";
import { verifyPuzzle } from "./lib/verify.mjs";

const config = configFrom(JSON.parse(await readFile(resolve(process.argv[2]), "utf8")));
const budgetMs = Number(process.argv[3] ?? 30000);
const out = resolve(process.argv[4] ?? "/tmp/study-spec-proof");
await mkdir(out, { recursive: true });
const id = `spec-proof-${Date.now()}`;
await createSet({ archiveDir: out, id, config, engine: engineVersions() });
const engine = createEngine();
const controller = new AbortController();
const started = performance.now();
const timer = setTimeout(() => controller.abort(), budgetMs);
let firstAcceptedMs = null;
try {
  const manifest = await generateSet({
    dir: join(out, id), engine, signal: controller.signal,
    emit(event) { if (event.type === "accepted" && firstAcceptedMs === null) firstAcceptedMs = performance.now() - started; },
  });
  const proofs = [];
  const verifier = createEngine();
  for (const entry of manifest.puzzles) {
    const puzzle = JSON.parse(await readFile(join(out, id, entry.file), "utf8"));
    proofs.push({
      id: puzzle.id, origin: puzzle.canonical.provenance?.origin ?? "AUTHENTIC_SEEDED",
      rack: puzzle.canonical.position.rack, board: puzzle.canonical.position.board,
      best: puzzle.answer.best, geometry: puzzle.answer.geometry,
      equations: puzzle.answer.equations.map(({ text, tileCount, placedParticipating, reusedBoardTiles, semantics }) => ({ text, tileCount, placedParticipating, reusedBoardTiles, semantics })),
      verification: await verifyPuzzle(puzzle, verifier, config),
    });
  }
  verifier.killAll();
  const report = { directory: join(out, id), budgetMs, elapsedMs: performance.now() - started, firstAcceptedMs,
    status: manifest.status, counters: manifest.counters, config, proofs };
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ directory: report.directory, elapsedMs: report.elapsedMs, firstAcceptedMs, status: report.status, counters: report.counters, proofs: proofs.map(({ id, origin, rack, best, geometry, equations, verification }) => ({ id, origin, rack, best, geometry, equations, verification })) }, null, 2));
} finally {
  clearTimeout(timer);
  engine.killAll();
}
