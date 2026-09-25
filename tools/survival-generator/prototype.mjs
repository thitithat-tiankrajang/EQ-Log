// Midgame Survival — correctness-first prototype for ONE candidate.
//
//   seeded Authur vs Authur  ->  first eligible untouched snapshot
//     -> weak / medium / strong player policies vs deterministic Authur (full game)
//     -> optional Authur-reference player (expensive; a few runs only)
//     -> simulatedWinProfile + speed report + determinism checks
//
// Writes a JSON report under tools/survival-generator/out/ and prints a summary.
// It never touches the database.
//
//   node tools/survival-generator/build-vendor.mjs      (once)
//   node tools/survival-generator/prototype.mjs --bag=20,30 --gap=-150,-1 --sims=24
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { AUTHUR_CONFIGS, DEFAULT_AUTHUR_DIR, authurIdentity } from "./lib/authur.mjs";
import { KIND_ORDER, MAX_BAG, validateFilters } from "./lib/rules.mjs";
import { PLAYER_POLICIES } from "./lib/policies.mjs";
import { createPool } from "./lib/pool.mjs";
import { summarizePolicy } from "./lib/summary.mjs";
import { mean, percentile, r1, r3 } from "./lib/stats.mjs";

const here = import.meta.dirname;

// ── configuration ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(token);
    if (match) args[match[1]] = match[2];
  }
  return args;
}
const args = parseArgs(process.argv.slice(2));
const pair = (text) => text.split(",").map((part) => Number(part.trim()));
const filters = validateFilters({
  bagRemainingRange: pair(args.bag ?? "20,30"),
  scoreGapRange: args.gap === "any" ? null : pair(args.gap ?? "-150,-1"),
  requireEmptyScorelessTail: args["empty-tail"] !== "false",
});
const settings = {
  sims: Number(args.sims ?? 24),
  referenceSims: Number(args.reference ?? 3),
  workers: Number(args.workers ?? Math.max(1, os.availableParallelism() - 1)),
  sourceSeed: Number(args["source-seed"] ?? 7100),
  maxSourceGames: Number(args["max-source-games"] ?? 28),
  reproSims: Number(args.repro ?? 2),
  driftSamples: Number(args.drift ?? 16),
  authurDir: args.authur ?? DEFAULT_AUTHUR_DIR,
};
if (!existsSync(resolve(here, ".vendor/authur-rules.mjs"))) {
  throw new Error("Run `node tools/survival-generator/build-vendor.mjs` first.");
}

// ── 1. level source: Authur vs Authur ────────────────────────────────────────
const started = performance.now();
const identity = await authurIdentity(settings.authurDir);
const provenance = JSON.parse(await readFile(resolve(here, ".vendor/PROVENANCE.json"), "utf8"));
console.log(`Authur: ${settings.authurDir}\n  strong.mjs sha256 ${identity.strong.slice(0, 16)}…`);
console.log(`filters: ${JSON.stringify(filters)}  workers: ${settings.workers}`);

let pool = await createPool(settings.workers, { authurDir: settings.authurDir });
const sourceGames = [];
let found = null;
for (let batch = 0; !found && sourceGames.length < settings.maxSourceGames; batch += 1) {
  const seeds = Array.from(
    { length: Math.min(settings.workers, settings.maxSourceGames - sourceGames.length) },
    (_, index) => settings.sourceSeed + sourceGames.length + index,
  );
  const results = (await Promise.all(seeds.map((seed) => pool.run("source", { sourceSeed: seed, filters })))).map(
    // The prototype keeps its original rule: the FIRST eligible point of a game.
    (game) => {
      const first = game.eligible[0];
      return first
        ? { ...game, snapshot: first.snapshot, snapshotTurn: first.turn, history: game.history.slice(0, first.historyLength) }
        : { ...game, snapshot: null };
    },
  );
  sourceGames.push(...results);
  // Deterministic choice: the LOWEST seed that produced an eligible snapshot.
  found = results.filter((r) => r.snapshot).sort((a, b) => a.sourceSeed - b.sourceSeed)[0] ?? null;
  console.log(
    `source games ${seeds[0]}–${seeds.at(-1)}: ` +
      results.map((r) => `${r.sourceSeed}:${r.snapshot ? `eligible@t${r.snapshotTurn}` : r.endedBy}`).join("  "),
  );
}
if (!found) throw new Error(`No eligible snapshot in ${sourceGames.length} Authur-vs-Authur games`);
const sourceStageMs = performance.now() - started;

// The evaluation reads the snapshot back from JSON: the stored form must suffice.
const snapshot = JSON.parse(JSON.stringify(found.snapshot));
const levelKey = `survival-v1:${found.sourceSeed}:${found.snapshotTurn}`;
const player = snapshot.sideToMove;
const opponent = player === "A" ? "B" : "A";

// ── 2. simulated player policies vs Authur ───────────────────────────────────
const evalStarted = performance.now();
const jobs = [];
for (let sim = 0; sim < settings.referenceSims; sim += 1) {
  // Longest jobs first, so they do not form the tail.
  jobs.push(pool.run("playout", { snapshot, levelKey, policy: "authur", sim }, 2));
}
for (let sim = 0; sim < settings.sims; sim += 1) {
  for (const policy of Object.keys(PLAYER_POLICIES)) {
    jobs.push(
      pool.run("playout", { snapshot, levelKey, policy, sim, collectRequests: sim < 3 ? 2 : 0 }, 1),
    );
  }
}
const playouts = await Promise.all(jobs);
const evalWallMs = performance.now() - evalStarted;
await pool.close();

// ── 3. reproducibility: a fresh single worker, cold caches, sequential ───────
const reproStarted = performance.now();
pool = await createPool(1, { authurDir: settings.authurDir });
const reproTargets = [
  ...Object.keys(PLAYER_POLICIES).flatMap((policy) =>
    Array.from({ length: settings.reproSims }, (_, sim) => ({ policy, sim })),
  ),
  ...(settings.referenceSims > 0 ? [{ policy: "authur", sim: 0 }] : []),
];
const repro = [];
for (const target of reproTargets) {
  const again = await pool.run("playout", { snapshot, levelKey, ...target });
  const original = playouts.find((p) => p.policy === target.policy && p.sim === target.sim);
  const same =
    original.actions.map((a) => a.id).join(" ") === again.actions.map((a) => a.id).join(" ") &&
    original.scores.A === again.scores.A &&
    original.scores.B === again.scores.B;
  repro.push({ ...target, same, turns: again.turns, outcome: again.outcome });
}
const reproWallMs = performance.now() - reproStarted;

// ── 4. offline vs live Authur on the same positions (one quiet worker) ───────
const driftStarted = performance.now();
const samples = playouts.flatMap((p) => p.requests).slice(0, settings.driftSamples);
const offlineAgain = await pool.run("authurBatch", { items: samples, config: "offline" });
const live = await pool.run("authurBatch", { items: samples, config: "live" });
await pool.close();
const driftWallMs = performance.now() - driftStarted;
const drift = samples.map((sample, index) => {
  const off = offlineAgain[index];
  const on = live[index];
  const qOf = (id) => off.candidates.find((c) => c.id === id)?.q ?? null;
  return {
    offlineStable: off.id === sample.offlineId,
    agree: on.id === off.id,
    liveNetFired: on.netFired,
    offlineCpuMs: off.cpuMs,
    liveCpuMs: on.cpuMs,
    // Points of Authur's OWN offline evaluation lost by the live choice, when
    // the live move is among the candidates the offline search scored.
    qLoss: on.id === off.id ? 0 : qOf(on.id) == null ? null : qOf(off.id) - qOf(on.id),
  };
});

// ── 5. aggregate ─────────────────────────────────────────────────────────────
function profileOf(policy) {
  const summary = summarizePolicy(playouts.filter((p) => p.policy === policy), policy);
  return {
    ...summary,
    definition: policy === "authur" ? "full Authur (offline config) on the player side" : PLAYER_POLICIES[policy],
  };
}
const policies = [...Object.keys(PLAYER_POLICIES), ...(settings.referenceSims > 0 ? ["authur"] : [])];
const profiles = policies.map(profileOf);
const allAuthur = playouts.flatMap((p) => p.authurTurns);
const computed = allAuthur.filter((t) => t.source === "computed");
const midgame = computed.filter((t) => !t.endgame).map((t) => t.computeCpuMs);
const endgame = computed.filter((t) => t.endgame).map((t) => t.computeCpuMs);
const playerTurns = playouts.flatMap((p) => p.playerTurns).filter((t) => !t.reference && !t.solver);
const buckets = new Map();
for (const turn of playerTurns) {
  const bucket = Math.floor(turn.bag / 5) * 5;
  const list = buckets.get(bucket) ?? [];
  list.push(turn);
  buckets.set(bucket, list);
}
const legalByBag = [...buckets.entries()]
  .sort((a, b) => b[0] - a[0])
  .map(([bucket, turns]) => ({
    bag: bucket === 0 ? "0-4" : `${bucket}-${bucket + 4}`,
    decisions: turns.length,
    places: { min: Math.min(...turns.map((t) => t.legalPlaces)), p50: percentile(turns.map((t) => t.legalPlaces), 0.5), max: Math.max(...turns.map((t) => t.legalPlaces)) },
    exchangeAllowed: r3(turns.filter((t) => t.legalExchanges > 0).length / turns.length),
  }));
const root = playouts.find((p) => p.policy !== "authur").playerTurns[0];
const totalPlayoutCpu = playouts.reduce((s, p) => s + p.cpuMs, 0);
const totalAuthurCpu = playouts.reduce((s, p) => s + p.clock.authur, 0);
const totalPlayerCpu = playouts.reduce((s, p) => s + p.clock.movegen + p.clock.evaluate + p.clock.select, 0);
const verification = {
  placementsChecked: playouts.reduce((s, p) => s + p.checks.placements, 0) + found.checks.placements,
  mismatches: [...found.checks.mismatches, ...playouts.flatMap((p) => p.checks.mismatches)],
};

const report = {
  generatedAt: new Date().toISOString(),
  machine: { cpu: os.cpus()[0]?.model, cores: os.availableParallelism(), node: process.version },
  authur: { ...identity, configs: AUTHUR_CONFIGS },
  rulesBundles: provenance,
  filters,
  settings,
  source: {
    sourceSeed: found.sourceSeed,
    snapshotTurn: found.snapshotTurn,
    levelKey,
    gamesTried: sourceGames.map((g) => ({ seed: g.sourceSeed, eligible: Boolean(g.snapshot), endedBy: g.endedBy ?? null, skippedInRange: g.skipped.length })),
    history: found.history,
    stageWallMs: Math.round(sourceStageMs),
  },
  snapshot,
  simulatedWinProfile: Object.fromEntries(profiles.map((p) => [p.policy, p.estimatedWinRate])),
  profiles,
  authurOpponent: {
    decisionsTotal: allAuthur.length,
    decisionsComputed: computed.length,
    cacheHits: allAuthur.length - computed.length,
    midgameCpuMs: { count: midgame.length, p50: percentile(midgame, 0.5), p95: percentile(midgame, 0.95), max: midgame.length ? Math.max(...midgame) : null },
    endgameCpuMs: { count: endgame.length, p50: percentile(endgame, 0.5), p95: percentile(endgame, 0.95), max: endgame.length ? Math.max(...endgame) : null },
    endgameNotExact: computed.filter((t) => t.endgame && t.exact === false).length,
    wallClockNetFired: computed.filter((t) => t.netFired).length,
    perGameComputeCpuMs: {
      mean: Math.round(mean(playouts.map((p) => p.authurTurns.reduce((s, t) => s + t.computeCpuMs, 0)))),
      p95: percentile(playouts.map((p) => p.authurTurns.reduce((s, t) => s + t.computeCpuMs, 0)), 0.95),
    },
  },
  cost: {
    playouts: playouts.length,
    totalPlayoutCpuMs: Math.round(totalPlayoutCpu),
    authurCpuShare: r3(totalAuthurCpu / totalPlayoutCpu),
    playerPolicyCpuShare: r3(totalPlayerCpu / totalPlayoutCpu),
    evaluationWallMs: Math.round(evalWallMs),
    parallelism: r1(totalPlayoutCpu / evalWallMs),
  },
  legalMoves: { root: { bag: root.bag, places: root.legalPlaces, exchanges: root.legalExchanges }, byBag: legalByBag },
  verification: { ...verification, mismatchCount: verification.mismatches.length },
  reproducibility: { runs: repro, identical: repro.filter((r) => r.same).length, of: repro.length, wallMs: Math.round(reproWallMs) },
  liveVsOffline: {
    samples: drift.length,
    offlineStable: drift.filter((d) => d.offlineStable).length,
    agree: drift.filter((d) => d.agree).length,
    liveNetFired: drift.filter((d) => d.liveNetFired).length,
    offlineCpuMs: { p50: percentile(drift.map((d) => d.offlineCpuMs), 0.5), max: Math.max(...drift.map((d) => d.offlineCpuMs)) },
    liveCpuMs: { p50: percentile(drift.map((d) => d.liveCpuMs), 0.5), max: Math.max(...drift.map((d) => d.liveCpuMs)) },
    disagreements: drift.filter((d) => !d.agree).map((d) => ({ qLoss: d.qLoss == null ? null : r1(d.qLoss) })),
    wallMs: Math.round(driftWallMs),
  },
  playouts: playouts.map(({ requests, ...rest }) => rest),
  totalWallMs: Math.round(performance.now() - started),
};

const outDir = resolve(here, "out");
await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, ".gitignore"), "*\n");
const outFile = resolve(outDir, `prototype-${found.sourceSeed}-t${found.snapshotTurn}.json`);
await writeFile(outFile, JSON.stringify(report, null, 2) + "\n");

// ── summary ──────────────────────────────────────────────────────────────────
const face = (kind) => (kind === "x" ? "×" : kind === "/" ? "÷" : kind);
const grid = Array.from({ length: 15 }, () => Array(15).fill(" ."));
for (const tile of snapshot.board) {
  const text = tile.face.length > 2 ? tile.face.slice(0, 2) : tile.face;
  grid[Math.floor(tile.cell / 15)][tile.cell % 15] = text.padStart(2, " ");
}
console.log(`\nsnapshot ${levelKey}  (bag ${snapshot.bag.length}, turn ${snapshot.turnNumber}, player = side ${player})`);
console.log(grid.map((row) => row.join(" ")).join("\n"));
console.log(`score player ${snapshot.scores[player]} – Authur ${snapshot.scores[opponent]}  (gap ${snapshot.scores[player] - snapshot.scores[opponent]})`);
console.log(`player rack: ${snapshot.racks[player].map(face).join(" ")}`);
console.log(`Authur rack: ${snapshot.racks[opponent].map(face).join(" ")}`);
console.log(`bag (front→back): ${snapshot.bag.map(face).join(" ")}`);
console.table(profiles.map((p) => ({ policy: p.policy, sims: p.simulations, W: p.wins, T: p.ties, L: p.losses, winRate: p.estimatedWinRate, "95%": p.winRate95.join("–"), cpuMs: p.cpuMsPerPlayout.mean, wallMs: p.wallMsPerPlayout.mean, authurShare: p.cpuShare.authurOpponent })));
console.log(JSON.stringify({ authurOpponent: report.authurOpponent, cost: report.cost, legalMoves: report.legalMoves, verification: { placementsChecked: verification.placementsChecked, mismatches: verification.mismatches.length }, reproducibility: { identical: report.reproducibility.identical, of: report.reproducibility.of }, liveVsOffline: report.liveVsOffline }, null, 1));
console.log(`\nreport: ${outFile}\ntotal ${(report.totalWallMs / 1000).toFixed(0)} s (MAX_BAG ${MAX_BAG}, ${KIND_ORDER.length} kinds)`);
