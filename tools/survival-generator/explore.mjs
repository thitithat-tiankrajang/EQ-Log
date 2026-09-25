// Midgame Survival — small multi-candidate EXPLORATION (not level generation).
//
//   per bag band   seeded Authur-vs-Authur games; at most ONE untouched snapshot
//                  per game, spread across the band's bag counts
//   Stage A        screening: weak / medium / strong (+ strong-eg control)
//                  x --screen-sims, vs deterministic Authur
//   Stage B        confirmation of the most informative few (+ --confirm-include),
//                  extended to --confirm-sims. Sims below --screen-sims are the
//                  SAME games as screening (same seeds), so they are reused.
//   report         out/explore-<stamp>.json + a compact table
//
// Never writes to the database; never touches the live game.
//
//   node tools/survival-generator/explore.mjs --bag=10,20 --bag=20,30 --bag=30,40 \
//     --gap=-200,-1 --candidates=3 --screen-sims=8 --confirm-sims=32 --confirm=3
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { DEFAULT_AUTHUR_DIR, authurIdentity } from "./lib/authur.mjs";
import { validateFilters } from "./lib/rules.mjs";
import { PLAYER_POLICIES } from "./lib/policies.mjs";
import { createPool } from "./lib/pool.mjs";
import { mean, r1, r3 } from "./lib/stats.mjs";
import { DEFAULT_THRESHOLDS, classify, structure, summarizePolicy } from "./lib/summary.mjs";

const here = import.meta.dirname;

// ── configuration ────────────────────────────────────────────────────────────
const args = {};
for (const token of process.argv.slice(2)) {
  const match = /^--([^=]+)=(.*)$/.exec(token);
  if (!match) continue;
  (args[match[1]] ??= []).push(match[2]);
}
const one = (key, fallback) => args[key]?.at(-1) ?? fallback;
const pair = (text) => text.split(",").map((part) => Number(part.trim()));
const gapArg = one("gap", "-200,-1");
const bands = (args.bag ?? ["20,30"]).map((text) =>
  validateFilters({
    bagRemainingRange: pair(text),
    scoreGapRange: gapArg === "any" ? null : pair(gapArg),
    requireEmptyScorelessTail: one("empty-tail", "true") !== "false",
  }),
);
const settings = {
  candidatesPerBand: Number(one("candidates", 3)),
  screenSims: Number(one("screen-sims", 8)),
  confirmSims: Number(one("confirm-sims", 32)),
  confirmCount: Number(one("confirm", 3)),
  confirmInclude: (one("confirm-include", "") || "").split(",").filter(Boolean),
  screenReference: Number(one("screen-reference", 0)),
  confirmReference: Number(one("confirm-reference", 2)),
  control: one("control", "true") !== "false",
  workers: Number(one("workers", Math.max(1, os.availableParallelism() - 1))),
  sourceSeed: Number(one("source-seed", 30000)),
  sourceGamesPerBand: Number(one("source-games", 12)),
  includeSnapshot: one("include-snapshot", null),
  maxScreenMinutes: Number(one("max-screen-minutes", 40)),
  maxConfirmMinutes: Number(one("max-confirm-minutes", 40)),
  repro: Number(one("repro", 2)),
  authurDir: one("authur", DEFAULT_AUTHUR_DIR),
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    ...(args["flat-hard"] ? { flatHardMax: Number(one("flat-hard")) } : {}),
    ...(args["flat-easy"] ? { flatEasyMin: Number(one("flat-easy")) } : {}),
    ...(args.separation ? { separationMin: Number(one("separation")) } : {}),
  },
};
const problems = [];
for (const key of ["candidatesPerBand", "screenSims", "confirmSims", "workers", "sourceGamesPerBand"]) {
  if (!Number.isInteger(settings[key]) || settings[key] < 1) problems.push(`${key} must be a positive integer`);
}
if (settings.confirmSims < settings.screenSims) problems.push("confirm-sims must be >= screen-sims");
if (problems.length) throw new Error(problems.join("\n"));
if (!existsSync(resolve(here, ".vendor/authur-rules.mjs"))) {
  throw new Error("Run `node tools/survival-generator/build-vendor.mjs` first.");
}
const POLICIES = ["weak", "medium", "strong", ...(settings.control ? ["strong-eg"] : [])];
const started = performance.now();
const minutes = (ms) => Math.round(ms / 6000) / 10;
const log = (...parts) => console.log(`[${minutes(performance.now() - started)} min]`, ...parts);

// ── 1. sources: one untouched snapshot per Authur-vs-Authur game ─────────────
const identity = await authurIdentity(settings.authurDir);
const provenance = JSON.parse(await readFile(resolve(here, ".vendor/PROVENANCE.json"), "utf8"));
const pool = await createPool(settings.workers, { authurDir: settings.authurDir });
log(`workers ${settings.workers}; bands ${bands.map((b) => b.bagRemainingRange.join("-")).join(", ")}; gap ${gapArg}`);

const candidates = [];
const sourceLog = [];
const sourceStarted = performance.now();
const bandState = bands.map((filters, index) => ({ filters, index, next: 0, chosen: [] }));
const target = (band, slot) => {
  // Stratify by bag count: slot j of n aims at the j-th of n equal slices, top first.
  const [lo, hi] = band.filters.bagRemainingRange;
  return hi - ((slot + 0.5) * (hi - lo)) / settings.candidatesPerBand;
};
while (true) {
  const wave = [];
  for (const band of bandState) {
    const want = settings.candidatesPerBand - band.chosen.length;
    for (let i = 0; i < want && band.next < settings.sourceGamesPerBand && wave.length < settings.workers * 2; i += 1) {
      wave.push({ band, seed: settings.sourceSeed + band.index * 1000 + band.next });
      band.next += 1;
    }
  }
  if (wave.length === 0) break;
  const games = await Promise.all(wave.map((w) => pool.run("source", { sourceSeed: w.seed, filters: w.band.filters }, 3)));
  wave.forEach((w, i) => (w.game = games[i]));
  // Deterministic assignment: seeds in order, one snapshot per game.
  for (const w of [...wave].sort((a, b) => a.seed - b.seed)) {
    const { band, game } = w;
    sourceLog.push({
      band: band.filters.bagRemainingRange.join("-"),
      seed: game.sourceSeed,
      eligiblePoints: game.eligible.length,
      endedBy: game.endedBy,
      cpuMs: Math.round(game.cpuMs),
      mismatches: game.checks.mismatches.length,
    });
    if (band.chosen.length >= settings.candidatesPerBand || game.eligible.length === 0) continue;
    const aim = target(band, band.chosen.length);
    const point = [...game.eligible].sort((a, b) => Math.abs(a.bag - aim) - Math.abs(b.bag - aim) || b.bag - a.bag)[0];
    const candidate = {
      id: `s${game.sourceSeed}t${point.turn}`,
      band: band.filters.bagRemainingRange.join("-"),
      sourceSeed: game.sourceSeed,
      snapshotTurn: point.turn,
      levelKey: `survival-v1:${game.sourceSeed}:${point.turn}`,
      eligiblePointsInGame: game.eligible.length,
      facts: { bag: point.bag, gap: point.gap, side: point.side, legalPlaces: point.legalPlaces, legalExchanges: point.legalExchanges, openness: point.openness },
      snapshot: point.snapshot,
      history: game.history.slice(0, point.historyLength),
    };
    band.chosen.push(candidate);
    candidates.push(candidate);
  }
}
if (settings.includeSnapshot) {
  // An earlier report's snapshot, re-evaluated with exactly the same seeds.
  const earlier = JSON.parse(await readFile(resolve(settings.includeSnapshot), "utf8"));
  const [, seed, turn] = earlier.source.levelKey.split(":");
  const facts = await pool.run("facts", { snapshot: earlier.snapshot }, 3);
  candidates.push({
    id: `s${seed}t${turn}`,
    band: "included",
    sourceSeed: Number(seed),
    snapshotTurn: Number(turn),
    levelKey: earlier.source.levelKey,
    eligiblePointsInGame: null,
    facts,
    snapshot: earlier.snapshot,
    history: earlier.source.history,
    earlierPlayouts: earlier.playouts,
  });
}
const sourceWallMs = performance.now() - sourceStarted;
log(`sources: ${sourceLog.length} games → ${candidates.length} candidates`);
for (const c of candidates) log(`  ${c.id} band ${c.band} bag ${c.facts.bag} gap ${c.facts.gap} legal ${c.facts.legalPlaces}`);

// ── 2. Stage A: screening ────────────────────────────────────────────────────
const playouts = new Map(candidates.map((c) => [c.id, []]));
async function simulate(stage, list, fromSim, toSim, referenceFrom, referenceTo, priority) {
  const jobs = [];
  for (const c of list) {
    for (let sim = referenceFrom; sim < referenceTo; sim += 1) {
      jobs.push(pool.run("playout", { snapshot: c.snapshot, levelKey: c.levelKey, policy: "authur", sim }, priority + 1)
        .then((p) => playouts.get(c.id).push({ ...p, stage })));
    }
    for (let sim = fromSim; sim < toSim; sim += 1) {
      for (const policy of POLICIES) {
        jobs.push(pool.run("playout", { snapshot: c.snapshot, levelKey: c.levelKey, policy, sim }, priority)
          .then((p) => playouts.get(c.id).push({ ...p, stage })));
      }
    }
  }
  await Promise.all(jobs);
}
const screenJobs = candidates.length * (settings.screenSims * POLICIES.length + settings.screenReference);
const screenEstimateMin = (screenJobs * 9_000) / (settings.workers * 0.8) / 60_000;
log(`Stage A: ${screenJobs} playouts, rough estimate ${r1(screenEstimateMin)} min`);
if (screenEstimateMin > settings.maxScreenMinutes) {
  throw new Error(`Screening estimate ${r1(screenEstimateMin)} min exceeds --max-screen-minutes=${settings.maxScreenMinutes}; stopping before launch.`);
}
const screenStarted = performance.now();
await simulate("screen", candidates, 0, settings.screenSims, 0, settings.screenReference, 2);
const screenWallMs = performance.now() - screenStarted;
log(`Stage A done in ${minutes(screenWallMs)} min`);

function evaluate(c, upToSim, referenceCount) {
  const runs = playouts.get(c.id).filter((p) => (p.policy === "authur" ? p.sim < referenceCount : p.sim < upToSim));
  const profiles = [...POLICIES, ...(referenceCount > 0 ? ["authur"] : [])]
    .map((policy) => summarizePolicy(runs.filter((p) => p.policy === policy), policy))
    .filter((p) => p.simulations > 0);
  const byPolicy = Object.fromEntries(profiles.map((p) => [p.policy, p]));
  const paired = settings.control
    ? (() => {
        const withSolver = new Map(runs.filter((p) => p.policy === "strong-eg").map((p) => [p.sim, p]));
        const pairs = runs.filter((p) => p.policy === "strong").map((p) => [withSolver.get(p.sim), p]).filter(([a]) => a);
        const score = (p) => (p.outcome === "win" ? 1 : p.outcome === "tie" ? 0.5 : 0);
        return {
          pairs: pairs.length,
          reachedBagZero: pairs.filter(([a]) => a.playerTurns.some((t) => t.solver)).length,
          outcomeImproved: pairs.filter(([a, b]) => score(a) > score(b)).length,
          outcomeWorsened: pairs.filter(([a, b]) => score(a) < score(b)).length,
          meanMarginGain: r1(mean(pairs.map(([a, b]) => a.margin - b.margin))),
        };
      })()
    : null;
  return {
    sims: upToSim,
    referenceSims: referenceCount,
    simulatedWinProfile: Object.fromEntries(profiles.map((p) => [p.policy, p.estimatedWinRate])),
    profiles: byPolicy,
    shape: classify(profiles, settings.thresholds),
    structure: structure(c.facts, runs),
    exactEndgameControl: paired,
    cpuMs: Math.round(runs.reduce((s, p) => s + p.cpuMs, 0)),
    verification: {
      placementsChecked: runs.reduce((s, p) => s + p.checks.placements, 0),
      mismatches: runs.reduce((s, p) => s + p.checks.mismatches.length, 0),
    },
  };
}
for (const c of candidates) c.screen = evaluate(c, settings.screenSims, settings.screenReference);

// ── 3. Stage B: confirmation ─────────────────────────────────────────────────
const informativeness = (c) => {
  const w = c.screen.simulatedWinProfile;
  const avg = (w.weak + w.medium + w.strong) / 3;
  return (w.strong - w.weak) + 0.25 * (1 - Math.abs(2 * avg - 1));
};
const ranked = candidates.filter((c) => !settings.confirmInclude.includes(c.id)).sort((a, b) => informativeness(b) - informativeness(a));
const toConfirm = [
  ...ranked.slice(0, settings.confirmCount),
  ...candidates.filter((c) => settings.confirmInclude.includes(c.id)),
];
const cpuPerSim = (c) => mean(playouts.get(c.id).filter((p) => p.policy !== "authur").map((p) => p.cpuMs)) ?? 9_000;
const confirmCpuMs = toConfirm.reduce(
  (s, c) => s + cpuPerSim(c) * POLICIES.length * (settings.confirmSims - settings.screenSims) + cpuPerSim(c) * 3 * settings.confirmReference,
  0,
);
const confirmEstimateMin = confirmCpuMs / (settings.workers * 0.8) / 60_000;
log(`Stage B: ${toConfirm.map((c) => c.id).join(", ")} — estimate ${r1(confirmEstimateMin)} min`);
let confirmWallMs = 0;
let confirmSkipped = null;
if (confirmEstimateMin > settings.maxConfirmMinutes) {
  confirmSkipped = `estimate ${r1(confirmEstimateMin)} min exceeds --max-confirm-minutes=${settings.maxConfirmMinutes}`;
  log(`Stage B SKIPPED: ${confirmSkipped}`);
} else if (toConfirm.length > 0) {
  const confirmStarted = performance.now();
  await simulate("confirm", toConfirm, settings.screenSims, settings.confirmSims, settings.screenReference, settings.confirmReference, 1);
  confirmWallMs = performance.now() - confirmStarted;
  for (const c of toConfirm) c.confirm = evaluate(c, settings.confirmSims, Math.max(settings.screenReference, settings.confirmReference));
  log(`Stage B done in ${minutes(confirmWallMs)} min`);
}
const sharedCache = pool.sharedStats();
await pool.close();

// ── 4. determinism checks ────────────────────────────────────────────────────
// (a) fresh single worker, cold caches, sequential, vs the parallel results.
const reproPool = await createPool(1, { authurDir: settings.authurDir });
const reproCandidate = toConfirm[0] ?? candidates[0];
const repro = [];
for (const policy of ["weak", "medium", "strong"]) {
  for (let sim = 0; sim < settings.repro; sim += 1) {
    const again = await reproPool.run("playout", { snapshot: reproCandidate.snapshot, levelKey: reproCandidate.levelKey, policy, sim });
    const original = playouts.get(reproCandidate.id).find((p) => p.policy === policy && p.sim === sim);
    repro.push({ candidate: reproCandidate.id, policy, sim, same: original.actions.map((a) => a.id).join() === again.actions.map((a) => a.id).join() });
  }
}
await reproPool.close();
// (b) an included earlier report: same seeds must give the same games. Its old
// "strong" had no exact endgame, which is exactly today's "strong".
const crossRun = [];
for (const c of candidates.filter((x) => x.earlierPlayouts)) {
  for (const p of playouts.get(c.id)) {
    const oldPolicy = p.policy === "strong-eg" ? null : p.policy;
    if (!oldPolicy) continue;
    const old = c.earlierPlayouts.find((q) => q.policy === oldPolicy && q.sim === p.sim);
    if (old) crossRun.push({ candidate: c.id, policy: p.policy, sim: p.sim, same: old.actions.map((a) => a.id).join() === p.actions.map((a) => a.id).join() });
  }
}

// ── 5. report ────────────────────────────────────────────────────────────────
const all = [...playouts.values()].flat();
const totalCpu = all.reduce((s, p) => s + p.cpuMs, 0);
const authurCpu = all.reduce((s, p) => s + p.clock.authur, 0);
const solverCpu = all.reduce((s, p) => s + p.clock.solver, 0);
const playerCpu = all.reduce((s, p) => s + p.clock.movegen + p.clock.evaluate + p.clock.select, 0);
const opponentTurns = all.flatMap((p) => p.authurTurns);
const report = {
  generatedAt: new Date().toISOString(),
  machine: { cpu: os.cpus()[0]?.model, cores: os.availableParallelism(), node: process.version },
  authur: identity,
  rulesBundles: provenance,
  settings: { ...settings, bands: bands.map((b) => b.bagRemainingRange), gap: gapArg, policies: PLAYER_POLICIES },
  timing: {
    sourceWallMs: Math.round(sourceWallMs),
    screenWallMs: Math.round(screenWallMs),
    confirmWallMs: Math.round(confirmWallMs),
    confirmSkipped,
    totalWallMs: Math.round(performance.now() - started),
    screeningCandidatesPerHour: r1((candidates.length / (sourceWallMs + screenWallMs)) * 3_600_000),
  },
  cost: {
    playouts: all.length,
    totalCpuMs: Math.round(totalCpu),
    authurOpponentShare: r3(authurCpu / totalCpu),
    strongEndgameSolverShare: r3(solverCpu / totalCpu),
    playerPolicyShare: r3(playerCpu / totalCpu),
    opponentDecisions: opponentTurns.length,
    opponentDecisionsComputed: opponentTurns.filter((t) => t.source === "computed").length,
    opponentDecisionsReused: {
      local: opponentTurns.filter((t) => t.source === "local").length,
      shared: opponentTurns.filter((t) => t.source === "shared").length,
    },
    opponentTimingFlags: {
      wallClockNetFired: opponentTurns.filter((t) => t.netFired).length,
      endgameNotExact: opponentTurns.filter((t) => t.endgame && t.exact === false).length,
    },
    sharedCache,
  },
  determinism: {
    freshWorker: { identical: repro.filter((r) => r.same).length, of: repro.length, runs: repro },
    crossRun: { identical: crossRun.filter((r) => r.same).length, of: crossRun.length },
  },
  sources: sourceLog,
  candidates: candidates.map(({ earlierPlayouts, ...c }) => c),
  playouts: Object.fromEntries([...playouts.entries()].map(([id, list]) => [id, list])),
};
const outDir = resolve(here, "out");
await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, ".gitignore"), "*\n");
const outFile = resolve(outDir, `explore-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await writeFile(outFile, JSON.stringify(report) + "\n");

const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const rowOf = (c, stage, result) => ({
  candidate: c.id,
  stage,
  bag: c.facts.bag,
  gap: c.facts.gap,
  legal0: c.facts.legalPlaces,
  weak: pct(result.simulatedWinProfile.weak),
  medium: pct(result.simulatedWinProfile.medium),
  strong: pct(result.simulatedWinProfile.strong),
  "strong-eg": pct(result.simulatedWinProfile["strong-eg"]),
  forced: pct(result.structure.forcedPassRate),
  "rack-out/scoreless": `${pct(result.structure.rackOutEndingRate)}/${pct(result.structure.scorelessEndingRate)}`,
  sims: result.sims,
  cpuMin: r1(result.cpuMs / 60_000),
  shape: `${result.shape.provisional} | ${result.shape.judged}`,
});
console.table(candidates.flatMap((c) => [rowOf(c, "screen", c.screen), ...(c.confirm ? [rowOf(c, "confirm", c.confirm)] : [])]));
console.log(JSON.stringify({ timing: report.timing, cost: report.cost, determinism: { freshWorker: report.determinism.freshWorker.identical + "/" + report.determinism.freshWorker.of, crossRun: report.determinism.crossRun.identical + "/" + report.determinism.crossRun.of } }, null, 1));
log(`report: ${outFile}`);
