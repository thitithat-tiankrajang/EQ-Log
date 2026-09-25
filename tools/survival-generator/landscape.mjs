// Midgame Survival — controlled candidate-LANDSCAPE experiment. Research only.
//
//   matrix   bag band x score-gap band, both configurable. Seeded Authur-vs-Authur
//            games are played through the union window and every eligible
//            untouched snapshot is assigned to its cell. Per cell: up to
//            --per-cell candidates, never two from the same source game; a game
//            gives at most --max-per-game candidates, --min-turn-gap plies apart.
//            Sparse or empty cells are reported, never filled by force.
//   screen   weak / medium / strong (the fast policies; no exact endgame, no
//            control arm) x --screen-sims. PROVISIONAL categories only:
//            FLAT_HARD, FLAT_EASY, POSSIBLE_SEPARATION, UNCERTAIN.
//   confirm  a DIVERSE set (--confirm-count) extended to --confirm-sims. The
//            sims below --screen-sims are the screening games themselves.
//            --strong-exact-endgame adds a paired strong-eg arm (default off).
//   guard    prints cells / candidates / games / estimated wall time before the
//            expensive stages, and stops instead of running past
//            --max-total-minutes.
//
// Never writes to the database; never touches the live game.
//
//   node tools/survival-generator/landscape.mjs            (the defaults below)
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { DEFAULT_AUTHUR_DIR, authurIdentity } from "./lib/authur.mjs";
import { validateFilters } from "./lib/rules.mjs";
import { PLAYER_POLICIES } from "./lib/policies.mjs";
import { createPool } from "./lib/pool.mjs";
import { mean, percentile, r1, r3, wilson } from "./lib/stats.mjs";
import {
  DEFAULT_THRESHOLDS,
  SCREEN_RULES,
  confirmedCategory,
  screeningCategory,
  structure,
  summarizePolicy,
} from "./lib/summary.mjs";

const here = import.meta.dirname;

// ── configuration ────────────────────────────────────────────────────────────
const args = {};
for (const token of process.argv.slice(2)) {
  const match = /^--([^=]+)=(.*)$/.exec(token);
  if (match) (args[match[1]] ??= []).push(match[2]);
}
const one = (key, fallback) => args[key]?.at(-1) ?? fallback;
const pair = (text) => text.split(",").map((part) => Number(part.trim()));
const flag = (key, fallback) => (one(key, String(fallback)) === "true");

const bagBands = (args.bag ?? ["10,19", "20,29", "30,39"]).map(pair);
const gapBands = (args.gap ?? ["-20,-1", "-50,-21", "-100,-51", "-200,-101"]).map(pair);
const settings = {
  bagBands,
  gapBands,
  requireEmptyScorelessTail: flag("empty-tail", true),
  perCell: Number(one("per-cell", 3)),
  maxPerGame: Number(one("max-per-game", 2)),
  minTurnGap: Number(one("min-turn-gap", 4)),
  sourceSeed: Number(one("source-seed", 40000)),
  maxSourceGames: Number(one("max-source-games", 42)),
  screenSims: Number(one("screen-sims", 8)),
  confirmSims: Number(one("confirm-sims", 32)),
  confirmCount: Number(one("confirm-count", 8)),
  minConfirm: Number(one("min-confirm", 6)),
  strongExactEndgame: flag("strong-exact-endgame", false),
  workers: Number(one("workers", Math.max(1, os.availableParallelism() - 1))),
  maxTotalMinutes: Number(one("max-total-minutes", 60)),
  repro: Number(one("repro", 2)),
  dryRun: flag("dry-run", false),
  authurDir: one("authur", DEFAULT_AUTHUR_DIR),
};

function validate() {
  const problems = [];
  for (const [min, max] of settings.bagBands) {
    try {
      validateFilters({ bagRemainingRange: [min, max] });
    } catch (error) {
      problems.push(error.message);
    }
  }
  for (const [min, max] of settings.gapBands) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) problems.push(`gap band ${min},${max} is not [min, max]`);
  }
  const overlaps = (bands) =>
    bands.some((a, i) => bands.some((b, j) => i < j && a[0] <= b[1] && b[0] <= a[1]));
  if (overlaps(settings.bagBands)) problems.push("bag bands overlap");
  if (overlaps(settings.gapBands)) problems.push("gap bands overlap");
  for (const key of ["perCell", "maxPerGame", "maxSourceGames", "screenSims", "confirmSims", "workers"]) {
    if (!Number.isInteger(settings[key]) || settings[key] < 1) problems.push(`${key} must be a positive integer`);
  }
  if (settings.confirmSims < settings.screenSims) problems.push("confirm-sims must be >= screen-sims");
  if (!existsSync(resolve(here, ".vendor/authur-rules.mjs"))) problems.push("run build-vendor.mjs first");
  if (problems.length) throw new Error(`Invalid landscape configuration:\n  - ${problems.join("\n  - ")}`);
}
validate();

const POLICIES = ["weak", "medium", "strong"];
const unionFilters = validateFilters({
  bagRemainingRange: [Math.min(...bagBands.map((b) => b[0])), Math.max(...bagBands.map((b) => b[1]))],
  scoreGapRange: [Math.min(...gapBands.map((g) => g[0])), Math.max(...gapBands.map((g) => g[1]))],
  requireEmptyScorelessTail: settings.requireEmptyScorelessTail,
});
const bagLabel = ([lo, hi]) => `${lo}-${hi}`;
// Gaps are signed (player − Authur) internally and REPORTED as deficits.
const deficitLabel = ([lo, hi]) => `${-hi}-${-lo} behind`;
const cellKey = (bi, gi) => `${bi}:${gi}`;
const cellLabel = (bi, gi) => `bag ${bagLabel(bagBands[bi])} × ${deficitLabel(gapBands[gi])}`;
function cellOf(point) {
  const bi = bagBands.findIndex(([lo, hi]) => point.bag >= lo && point.bag <= hi);
  const gi = gapBands.findIndex(([lo, hi]) => point.gap >= lo && point.gap <= hi);
  return bi < 0 || gi < 0 ? null : { bi, gi };
}

const started = performance.now();
const elapsedMin = () => (performance.now() - started) / 60_000;
const log = (...parts) => console.log(`[${elapsedMin().toFixed(1)} min]`, ...parts);

// Rough cost model from the 2026-09-25 exploration (fast policies, this Mac):
// CPU per playout grows with the tiles still to be played. Replaced by measured
// numbers as soon as screening has run.
const priorCpuPerPlayout = (bag) => 1500 + 300 * bag;
const parallelEfficiency = 0.72;
const wallMin = (cpuMs) => cpuMs / (settings.workers * parallelEfficiency) / 60_000;
const REPRO_MIN = 1.5;

// ── 1. sources: authentic snapshots into matrix cells ───────────────────────
const identity = await authurIdentity(settings.authurDir);
const provenance = JSON.parse(await readFile(resolve(here, ".vendor/PROVENANCE.json"), "utf8"));
const pool = await createPool(settings.workers, { authurDir: settings.authurDir });
log(`workers ${settings.workers}; bag bands ${bagBands.map(bagLabel).join(", ")}; deficit bands ${gapBands.map(deficitLabel).join(", ")}`);

const cells = new Map();
for (let bi = 0; bi < bagBands.length; bi += 1) {
  for (let gi = 0; gi < gapBands.length; gi += 1) cells.set(cellKey(bi, gi), { bi, gi, candidates: [], eligibleSeen: 0 });
}
const sourceLog = [];
const candidates = [];
let gamesPlayed = 0;
const sourceStarted = performance.now();
const cellsFull = () => [...cells.values()].every((cell) => cell.candidates.length >= settings.perCell);

function assign(game) {
  const taken = [];
  const byCell = new Map();
  for (const point of game.eligible) {
    const at = cellOf(point);
    if (!at) continue;
    const key = cellKey(at.bi, at.gi);
    cells.get(key).eligibleSeen += 1;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(point);
  }
  // Rarest cells first, so a game with several options feeds the sparse ones.
  const order = [...byCell.keys()].sort((a, b) => {
    const ca = cells.get(a);
    const cb = cells.get(b);
    return ca.candidates.length - cb.candidates.length || cb.gi - ca.gi || ca.bi - cb.bi;
  });
  for (const key of order) {
    const cell = cells.get(key);
    if (taken.length >= settings.maxPerGame || cell.candidates.length >= settings.perCell) continue;
    const [lo, hi] = bagBands[cell.bi];
    const aim = hi - ((cell.candidates.length + 0.5) * (hi - lo)) / settings.perCell;
    const point = byCell
      .get(key)
      .filter((p) => taken.every((t) => Math.abs(t.turn - p.turn) >= settings.minTurnGap))
      .sort((a, b) => Math.abs(a.bag - aim) - Math.abs(b.bag - aim) || b.bag - a.bag)[0];
    if (!point) continue;
    taken.push(point);
    const candidate = {
      id: `s${game.sourceSeed}t${point.turn}`,
      cell: key,
      bagBand: bagLabel(bagBands[cell.bi]),
      deficitBand: deficitLabel(gapBands[cell.gi]),
      sourceSeed: game.sourceSeed,
      snapshotTurn: point.turn,
      levelKey: `survival-v1:${game.sourceSeed}:${point.turn}`,
      facts: {
        bag: point.bag,
        gap: point.gap,
        deficit: -point.gap,
        side: point.side,
        legalPlaces: point.legalPlaces,
        legalExchanges: point.legalExchanges,
        boardTiles: point.boardTiles,
        openness: point.openness,
      },
      snapshot: point.snapshot,
      history: game.history.slice(0, point.historyLength),
    };
    cell.candidates.push(candidate);
    candidates.push(candidate);
  }
  return taken.length;
}

while (!cellsFull() && gamesPlayed < settings.maxSourceGames) {
  const seeds = Array.from(
    { length: Math.min(settings.workers, settings.maxSourceGames - gamesPlayed) },
    (_, i) => settings.sourceSeed + gamesPlayed + i,
  );
  gamesPlayed += seeds.length;
  const games = await Promise.all(seeds.map((seed) => pool.run("source", { sourceSeed: seed, filters: unionFilters }, 3)));
  for (const game of games.sort((a, b) => a.sourceSeed - b.sourceSeed)) {
    const used = assign(game);
    sourceLog.push({
      seed: game.sourceSeed,
      eligiblePoints: game.eligible.length,
      candidatesTaken: used,
      cpuMs: Math.round(game.cpuMs),
      wallMs: Math.round(game.wallMs),
      endedBy: game.endedBy,
      mismatches: game.checks.mismatches.length,
    });
  }
  log(`source games ${gamesPlayed}: ${candidates.length} candidates, ${[...cells.values()].filter((c) => c.candidates.length > 0).length} cells populated`);
}
const sourceWallMs = performance.now() - sourceStarted;

function printMatrix(title, cellText) {
  const header = ["bag \\ deficit", ...gapBands.map(deficitLabel)];
  const rows = bagBands.map((band, bi) => [bagLabel(band), ...gapBands.map((_, gi) => cellText(cells.get(cellKey(bi, gi))))]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  console.log(`\n${title}`);
  for (const row of [header, ...rows]) console.log(row.map((v, i) => String(v).padEnd(widths[i])).join("  "));
}
printMatrix("CANDIDATES PER CELL (authentic snapshots taken / eligible decision points seen)", (c) => `${c.candidates.length}/${c.eligibleSeen}`);

// ── 2. the pre-run estimate and the 60-minute guard ─────────────────────────
const populated = [...cells.values()].filter((c) => c.candidates.length > 0).length;
const screeningGames = candidates.length * POLICIES.length * settings.screenSims;
const confirmPerCandidate = POLICIES.length * (settings.confirmSims - settings.screenSims) +
  (settings.strongExactEndgame ? settings.confirmSims : 0);
const expectedConfirmationGames = Math.min(settings.confirmCount, candidates.length) * confirmPerCandidate;
const screenCpuEstimate = candidates.reduce((s, c) => s + POLICIES.length * settings.screenSims * priorCpuPerPlayout(c.facts.bag), 0);
const meanPrior = mean(candidates.map((c) => priorCpuPerPlayout(c.facts.bag))) ?? 0;
const confirmCpuEstimate = expectedConfirmationGames * meanPrior;
const estimatedTotalMin = elapsedMin() + wallMin(screenCpuEstimate) + wallMin(confirmCpuEstimate) + REPRO_MIN;
const preRun = {
  cellsPopulated: populated,
  cellsTotal: cells.size,
  candidates: candidates.length,
  screeningGames,
  expectedConfirmationGames,
  estimatedMinutes: {
    elapsedSoFar: r1(elapsedMin()),
    screening: r1(wallMin(screenCpuEstimate)),
    confirmation: r1(wallMin(confirmCpuEstimate)),
    total: r1(estimatedTotalMin),
  },
};
console.log("\nPRE-RUN", JSON.stringify(preRun, null, 1));

const outDir = resolve(here, "out");
await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, ".gitignore"), "*\n");
const outFile = resolve(outDir, `landscape-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
async function writeReport(extra) {
  await writeFile(outFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    machine: { cpu: os.cpus()[0]?.model, cores: os.availableParallelism(), node: process.version },
    authur: identity,
    rulesBundles: provenance,
    settings: { ...settings, policies: PLAYER_POLICIES, screenRules: SCREEN_RULES, thresholds: DEFAULT_THRESHOLDS },
    preRun,
    sources: sourceLog,
    ...extra,
  }) + "\n");
  log(`report: ${outFile}`);
}
if (settings.dryRun || estimatedTotalMin > settings.maxTotalMinutes) {
  const reason = settings.dryRun ? "dry run" : `estimate ${r1(estimatedTotalMin)} min > --max-total-minutes=${settings.maxTotalMinutes}`;
  log(`STOPPING before screening: ${reason}`);
  await writeReport({ stoppedBefore: "screening", reason, candidates: candidates.map(({ snapshot, history, ...c }) => c) });
  await pool.close();
  process.exit(0);
}

// ── 3. screening ─────────────────────────────────────────────────────────────
const playouts = new Map(candidates.map((c) => [c.id, []]));
async function simulate(stage, list, policies, fromSim, toSim, priority) {
  const jobs = [];
  for (const c of list) {
    for (let sim = fromSim; sim < toSim; sim += 1) {
      for (const policy of policies) {
        jobs.push(
          pool.run("playout", { snapshot: c.snapshot, levelKey: c.levelKey, policy, sim }, priority)
            .then((p) => playouts.get(c.id).push({ ...p, stage })),
        );
      }
    }
  }
  await Promise.all(jobs);
}
log(`screening ${screeningGames} games`);
const screenStarted = performance.now();
await simulate("screen", candidates, POLICIES, 0, settings.screenSims, 2);
const screenWallMs = performance.now() - screenStarted;
log(`screening done in ${r1(screenWallMs / 60_000)} min`);

function evaluate(c, upToSim, policies) {
  const runs = playouts.get(c.id).filter((p) => p.sim < upToSim && policies.includes(p.policy));
  const profiles = Object.fromEntries(policies.map((policy) => [policy, summarizePolicy(runs.filter((p) => p.policy === policy), policy)]));
  const ladder = POLICIES.map((policy) => profiles[policy]);
  // The same ladder with every timing-affected game removed, intervals recomputed.
  const cleanLadder = ladder.map((p) => {
    const { wins, simulations } = p.excludingTimingAffected;
    return { ...p, wins, simulations, winRate95: wilson(wins, simulations).map(r3) };
  });
  return {
    sims: upToSim,
    simulatedWinProfile: Object.fromEntries(Object.values(profiles).map((p) => [p.policy, p.estimatedWinRate])),
    profiles,
    structure: structure(c.facts, runs),
    timingAffectedGames: runs.filter((p) => p.timingAffected).length,
    cpuMs: Math.round(runs.reduce((s, p) => s + p.cpuMs, 0)),
    verification: {
      placementsChecked: runs.reduce((s, p) => s + p.checks.placements, 0),
      mismatches: runs.reduce((s, p) => s + p.checks.mismatches.length, 0),
    },
    ladder: ladder.map((p) => ({ policy: p.policy, wins: p.wins, ties: p.ties, losses: p.losses, n: p.simulations })),
    cleanLadder: cleanLadder.map((p) => ({ policy: p.policy, wins: p.wins, n: p.simulations })),
    _ladder: ladder,
    _cleanLadder: cleanLadder,
  };
}
for (const c of candidates) {
  c.screen = evaluate(c, settings.screenSims, POLICIES);
  c.screen.category = screeningCategory(c.screen._ladder);
}

// ── 4. confirmation: a diverse, promising set ───────────────────────────────
const reach = candidates.map((c) => c.facts.openness.reachableCells).sort((a, b) => a - b);
const tercileCuts = [percentile(reach, 1 / 3), percentile(reach, 2 / 3)];
const opennessTercile = (c) => {
  const value = c.facts.openness.reachableCells;
  return value < tercileCuts[0] ? "closed" : value < tercileCuts[1] ? "middle" : "open";
};
for (const c of candidates) c.facts.opennessTercile = opennessTercile(c);
const pool0 = candidates.filter(
  (c) => c.screen.category.category === "POSSIBLE_SEPARATION" ||
    (c.screen.category.category === "UNCERTAIN" && c.screen.category.trendZ > 0),
);
const measuredCpu = (c) => mean(playouts.get(c.id).map((p) => p.cpuMs)) ?? priorCpuPerPlayout(c.facts.bag);
const remainingBudgetMin = settings.maxTotalMinutes - elapsedMin() - REPRO_MIN;
const selected = [];
while (selected.length < settings.confirmCount) {
  const has = (key) => new Set(selected.map(key));
  const bags = has((c) => c.bagBand);
  const gaps = has((c) => c.deficitBand);
  const opens = has((c) => c.facts.opennessTercile);
  const scored = pool0
    .filter((c) => !selected.includes(c))
    .map((c) => ({
      c,
      value: c.screen.category.promise +
        (bags.has(c.bagBand) ? 0 : 0.75) +
        (gaps.has(c.deficitBand) ? 0 : 0.75) +
        (opens.has(c.facts.opennessTercile) ? 0 : 0.5),
    }))
    .sort((a, b) => b.value - a.value || (a.c.id < b.c.id ? -1 : 1));
  if (scored.length === 0) break;
  const next = scored[0].c;
  const cost = wallMin(confirmPerCandidate * measuredCpu(next));
  const committed = selected.reduce((s, c) => s + wallMin(confirmPerCandidate * measuredCpu(c)), 0);
  if (committed + cost > remainingBudgetMin) break;
  selected.push(next);
}
const confirmEstimateMin = selected.reduce((s, c) => s + wallMin(confirmPerCandidate * measuredCpu(c)), 0);
log(
  `confirmation: ${selected.length} of ${pool0.length} eligible (${selected.map((c) => c.id).join(", ")}); ` +
    `estimate ${r1(confirmEstimateMin)} min; projected total ${r1(elapsedMin() + confirmEstimateMin + REPRO_MIN)} min`,
);
let confirmWallMs = 0;
let confirmSkipped = null;
if (selected.length < Math.min(settings.minConfirm, pool0.length)) {
  confirmSkipped = `only ${selected.length} confirmations fit the ${settings.maxTotalMinutes}-minute budget (minimum ${settings.minConfirm}); projection reported instead`;
  log(`confirmation SKIPPED: ${confirmSkipped}`);
} else if (selected.length > 0) {
  const confirmStarted = performance.now();
  await simulate("confirm", selected, POLICIES, settings.screenSims, settings.confirmSims, 1);
  if (settings.strongExactEndgame) await simulate("confirm", selected, ["strong-eg"], 0, settings.confirmSims, 1);
  confirmWallMs = performance.now() - confirmStarted;
  for (const c of selected) {
    const policies = [...POLICIES, ...(settings.strongExactEndgame ? ["strong-eg"] : [])];
    c.confirm = evaluate(c, settings.confirmSims, policies);
    c.confirm.category = confirmedCategory(c.confirm._ladder);
    c.confirm.categoryExcludingTimingAffected = confirmedCategory(c.confirm._cleanLadder);
  }
  log(`confirmation done in ${r1(confirmWallMs / 60_000)} min`);
}
const sharedCache = pool.sharedStats();
await pool.close();

// ── 5. determinism: fresh single worker, cold caches ─────────────────────────
const reproTarget = selected.find((c) => c.confirm && c.confirm.timingAffectedGames === 0) ?? candidates[0];
const reproPool = await createPool(1, { authurDir: settings.authurDir });
const repro = [];
for (const policy of POLICIES) {
  for (let sim = 0; sim < settings.repro; sim += 1) {
    const again = await reproPool.run("playout", { snapshot: reproTarget.snapshot, levelKey: reproTarget.levelKey, policy, sim });
    const original = playouts.get(reproTarget.id).find((p) => p.policy === policy && p.sim === sim);
    repro.push({ policy, sim, same: original.actions.map((a) => a.id).join() === again.actions.map((a) => a.id).join(), timingAffected: original.timingAffected });
  }
}
await reproPool.close();

// ── 6. landscape tables ──────────────────────────────────────────────────────
const all = [...playouts.values()].flat();
const cpuOf = (list, key) => list.reduce((s, p) => s + (key ? p.clock[key] : p.cpuMs), 0);
const opponentTurns = all.flatMap((p) => p.authurTurns);
const best = (c) => c.confirm ?? c.screen;
const rate = (profile) => profile.estimatedWinRate;
const summaryRow = (c) => {
  const b = best(c);
  return {
    candidate: c.id,
    cell: `${c.bagBand} | ${c.deficitBand}`,
    bag: c.facts.bag,
    deficit: c.facts.deficit,
    reach: c.facts.openness.reachableCells,
    legal0: c.facts.legalPlaces,
    weak: rate(b.profiles.weak),
    medium: rate(b.profiles.medium),
    strong: rate(b.profiles.strong),
    category: b.category.category,
    stage: c.confirm ? "confirmed" : "screened",
  };
};
printMatrix(
  `SCREENING (N=${settings.screenSims}/policy): POSSIBLE_SEPARATION / screened   [FLAT_HARD, FLAT_EASY, UNCERTAIN]`,
  (cell) => {
    const n = (cat) => cell.candidates.filter((c) => c.screen.category.category === cat).length;
    return cell.candidates.length === 0 ? "—" : `${n("POSSIBLE_SEPARATION")}/${cell.candidates.length} [${n("FLAT_HARD")},${n("FLAT_EASY")},${n("UNCERTAIN")}]`;
  },
);
printMatrix(
  `CONFIRMED (N=${settings.confirmSims}/policy): SKILL_SEPARATING / confirmed`,
  (cell) => {
    const confirmed = cell.candidates.filter((c) => c.confirm);
    return confirmed.length === 0 ? "—" : `${confirmed.filter((c) => c.confirm.category.category === "SKILL_SEPARATING").length}/${confirmed.length}`;
  },
);
console.table(candidates.map(summaryRow));

const report = {
  candidates: candidates.map(({ snapshot, history, screen, confirm, ...c }) => ({
    ...c,
    screen: (({ _ladder, _cleanLadder, ...rest }) => rest)(screen),
    ...(confirm ? { confirm: (({ _ladder, _cleanLadder, ...rest }) => rest)(confirm) } : {}),
    snapshot,
    history,
  })),
  cells: [...cells.values()].map((cell) => ({
    cell: cellLabel(cell.bi, cell.gi),
    eligibleDecisionPointsSeen: cell.eligibleSeen,
    candidates: cell.candidates.map((c) => c.id),
  })),
  confirmation: { selected: selected.map((c) => c.id), eligible: pool0.map((c) => c.id), skipped: confirmSkipped },
  timing: {
    sourceWallMs: Math.round(sourceWallMs),
    screenWallMs: Math.round(screenWallMs),
    confirmWallMs: Math.round(confirmWallMs),
    totalWallMs: Math.round(performance.now() - started),
    sourceGames: gamesPlayed,
    throughput: {
      sourceCandidatesPerHour: r1(candidates.length / (sourceWallMs / 3_600_000)),
      screeningCandidatesPerHour: r1(candidates.length / (screenWallMs / 3_600_000)),
      confirmationCandidatesPerHour: confirmWallMs ? r1(selected.length / (confirmWallMs / 3_600_000)) : null,
    },
  },
  cost: {
    playouts: all.length,
    totalCpuMs: Math.round(cpuOf(all)),
    authurOpponentShare: r3(cpuOf(all, "authur") / cpuOf(all)),
    playerPolicyShare: r3((cpuOf(all, "movegen") + cpuOf(all, "evaluate") + cpuOf(all, "select")) / cpuOf(all)),
    strongExactEndgameShare: r3(cpuOf(all, "solver") / cpuOf(all)),
    screeningCpuPerCandidateMs: Math.round(cpuOf(all.filter((p) => p.stage === "screen")) / candidates.length),
    opponentDecisions: opponentTurns.length,
    opponentDecisionsReused: opponentTurns.filter((t) => t.source !== "computed").length,
    opponentCacheHitRate: r3(opponentTurns.filter((t) => t.source !== "computed").length / opponentTurns.length),
    sharedCache,
    timingAffectedGames: all.filter((p) => p.timingAffected).length,
    wallClockNetFired: opponentTurns.filter((t) => t.netFired).length,
    placementsChecked: all.reduce((s, p) => s + p.checks.placements, 0),
    ruleMismatches: all.reduce((s, p) => s + p.checks.mismatches.length, 0) + sourceLog.reduce((s, g) => s + g.mismatches, 0),
  },
  determinism: { candidate: reproTarget.id, identical: repro.filter((r) => r.same).length, of: repro.length, runs: repro },
  playouts: Object.fromEntries([...playouts.entries()]),
};
console.log(JSON.stringify({ timing: report.timing, cost: { ...report.cost, sharedCache: undefined }, determinism: `${report.determinism.identical}/${report.determinism.of}` }, null, 1));
await writeReport(report);
