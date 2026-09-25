// Small, bounded real-engine comparison. Run before/after with the same seed.
// node tools/study-puzzles/benchmark.mjs AUTHENTIC_ONLY|GUIDED [milliseconds] [output-directory]
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createSet } from "./lib/archive.mjs";
import { configFrom } from "./lib/config.mjs";
import { createEngine, engineVersions } from "./lib/engine.mjs";
import { generateSet } from "./lib/generate.mjs";

const strategy = process.argv[2] ?? "AUTHENTIC_ONLY";
const budgetMs = Number(process.argv[3] ?? 60_000);
const out = resolve(process.argv[4] ?? `/tmp/study-benchmark-${strategy.toLowerCase()}`);
const config = configFrom({
  seed: 1926514385,
  target: 1,
  maxPerGame: 1,
  parallelGames: 2,
  search: { strategy, rackBudget: 24 },
  bestPlay: {
    moveTypes: ["CROSS"],
    score: { min: 60, max: 120 },
    tiles: { min: 8 },
    equations: { min: 1, max: 1 },
    composition: { digit: { min: 7 }, choice: { min: 1 } },
    excludeTrivialZero: true,
  },
});
await mkdir(out, { recursive: true });
const id = `benchmark-${strategy.toLowerCase().replaceAll("_", "-")}-${Date.now()}`;
const versions = engineVersions();
const generatorHash = createHash("sha256")
  .update(readFileSync(new URL("./lib/generate.mjs", import.meta.url)))
  .digest("hex");
await createSet({ archiveDir: out, id, config, engine: { ...versions, generatorHash } });
const real = createEngine();
let calls = 0,
  completedCalls = 0,
  callMs = 0,
  firstAcceptedMs = null;
const requests = [];
const engine = {
  ...real,
  async analyze(request) {
    calls++;
    if (requests.length < 12) requests.push(request);
    const start = performance.now();
    try {
      const result = await real.analyze(request);
      completedCalls++;
      return result;
    } finally {
      callMs += performance.now() - start;
    }
  },
};
const controller = new AbortController();
const started = performance.now();
const timer = setTimeout(() => controller.abort(), budgetMs);
const manifest = await generateSet({
  dir: join(out, id),
  engine,
  signal: controller.signal,
  emit(event) {
    if (event.type === "accepted" && firstAcceptedMs === null)
      firstAcceptedMs = performance.now() - started;
  },
});
clearTimeout(timer);
const report = {
  strategy,
  budgetMs,
  config,
  versions,
  generatorHash,
  directory: join(out, id),
  elapsedMs: performance.now() - started,
  firstAcceptedMs,
  calls,
  completedCalls,
  callMs,
  counters: manifest.counters,
  puzzles: manifest.puzzles,
  status: manifest.status,
};
await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
await writeFile(join(out, "sample-requests.json"), JSON.stringify(requests, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
