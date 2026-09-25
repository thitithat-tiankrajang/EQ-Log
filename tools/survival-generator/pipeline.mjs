// OFFLINE Candidate Pipeline v1 — Midgame Survival research generator.
//
//   1 source      seeded Authur-vs-Authur games from a FIXED list of seeds.
//                 Every eligible decision point is kept as an untouched snapshot.
//   2 cheap       features for every snapshot (lib/evaluation.mjs). The
//                 PROVISIONAL prefilters reject only the extremes; each
//                 rejection is recorded with all its reasons in run-stats.json.
//   3 rank        cheap rank (firepower − w·deficit) → the fixed top
//                 --lookahead-count, at most --lookahead-per-game per game.
//   4 look-ahead  two-turn opportunity analysis (exact and bag-blind swing,
//                 seed lift, planning gain) → opportunity rank → the fixed top
//                 --simulate-count, at most --simulate-per-game per game.
//                 Ranking orders the expensive work; it never says a position
//                 is survivable.
//   5 route       TACTICAL / UNCERTAIN / STRATEGIC from the bag-blind planning
//                 gain (lib/routing.mjs). A research routing, not ground truth.
//   6 evaluate    TACTICAL   weak / medium / strong screen at --screen-sims;
//                            promising → --confirm-sims.
//                 STRATEGIC  weak / medium floor at --floor-sims, plus exactly
//                            --reference-attempts Authur-reference games;
//                            >= --min-clean-reference clean → confirmed, else
//                            TIMING_LIMITED. Nothing is ever re-run.
//                 UNCERTAIN  both.
//   7 output      manifest.json (written BEFORE any work), one Candidate JSON
//                 per evaluated snapshot — with the source game's replayable
//                 log, replay-verified before it is written — run-stats.json,
//                 and the raw games in research/playouts.jsonl.
//
// No wall-clock guard anywhere: every count comes from the configuration, so a
// rerun examines exactly the same snapshots in the same order.
//
// Never touches the database, live Survival or the admin UI.
//
//   node tools/survival-generator/pipeline.mjs --label=smoke --source-games=7
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { AUTHUR_CONFIGS, DEFAULT_AUTHUR_DIR } from "./lib/authur.mjs";
import { BAG_RULE, other, validateFilters } from "./lib/rules.mjs";
import { PLAYER_POLICIES } from "./lib/policies.mjs";
import { createPool } from "./lib/pool.mjs";
import { mean, percentile, r1, r3 } from "./lib/stats.mjs";
import { DEFAULT_THRESHOLDS, SCREEN_RULES, structure } from "./lib/summary.mjs";
import { DEFAULT_ROUTING, pipelineStatus, route, validateRouting } from "./lib/routing.mjs";
import { OPPORTUNITY_VERSION, PIPELINE_VERSION, ROUTING_VERSION, captureProvenance } from "./lib/provenance.mjs";
import { buildCandidate, canonicalJson, contentHash, positionHash } from "./lib/candidate.mjs";
import { buildSourceLog } from "./lib/sourcelog.mjs";
import {
  DEFAULT_CHEAP_RANK,
  DEFAULT_PREFILTER,
  EVALUATION_VERSION,
  FLOOR,
  LADDER,
  PROMOTION_RULE,
  RANK_KEYS,
  actionsHash,
  cheapFeatures,
  gameRecord,
  isPromising,
  opportunityMetrics,
  prefilterReasons,
  screen,
  selectTop,
  strategicEvaluation,
  tacticalEvaluation,
} from "./lib/evaluation.mjs";

const here = import.meta.dirname;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// ── configuration ────────────────────────────────────────────────────────────
const OPTIONS = {
  label: "run",
  "source-seed": "70000",
  "source-games": "7",
  bag: "10,39",
  gap: "-10000,-1",
  "empty-tail": "true",
  "prefilter-legal-below": String(DEFAULT_PREFILTER.rejectLegalBelow),
  "prefilter-deficit-at-least": String(DEFAULT_PREFILTER.rejectDeficitAtLeast),
  "cheap-deficit-weight": String(DEFAULT_CHEAP_RANK.deficitWeight),
  "lookahead-count": "6",
  "lookahead-per-game": "2",
  "min-turn-gap": "4",
  "first-moves": "16",
  "blind-samples": "4",
  "rank-by": "exactSwingMinusDeficit",
  "simulate-count": "4",
  "simulate-per-game": "1",
  "tactical-max": String(DEFAULT_ROUTING.tacticalMax),
  "strategic-min": String(DEFAULT_ROUTING.strategicMin),
  "screen-sims": "8",
  "confirm-sims": "32",
  "confirm-max": "all",
  "floor-sims": "8",
  "reference-attempts": "10",
  "min-clean-reference": "8",
  repro: "true",
  "dry-run": "false",
  workers: String(Math.max(1, os.availableParallelism() - 1)),
  authur: DEFAULT_AUTHUR_DIR,
};
const args = { ...OPTIONS };
for (const token of process.argv.slice(2)) {
  const match = /^--([^=]+)=(.*)$/.exec(token);
  if (!match || !(match[1] in OPTIONS)) {
    throw new Error(`unknown argument ${token}\noptions: ${Object.keys(OPTIONS).map((k) => `--${k}`).join(" ")}`);
  }
  args[match[1]] = match[2];
}
const problems = [];
const int = (key, min = 0) => {
  const n = Number(args[key]);
  if (!Number.isInteger(n) || n < min) problems.push(`--${key} must be a whole number >= ${min}`);
  return n;
};
const num = (key) => {
  const n = Number(args[key]);
  if (!Number.isFinite(n)) problems.push(`--${key} must be a number`);
  return n;
};
const optional = (key) => (args[key] === "off" ? null : num(key));
const pair = (key) => {
  const parts = args[key].split(",").map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isInteger(n))) problems.push(`--${key} must be min,max`);
  return parts;
};
const bool = (key) => {
  if (!["true", "false"].includes(args[key])) problems.push(`--${key} must be true or false`);
  return args[key] === "true";
};

let filters = null;
try {
  filters = validateFilters({
    bagRemainingRange: pair("bag"),
    scoreGapRange: pair("gap"),
    requireEmptyScorelessTail: bool("empty-tail"),
  });
  if (filters.scoreGapRange[1] >= 0) problems.push("--gap must end below 0: a Survival player starts behind");
} catch (error) {
  problems.push(error.message);
}

const SEED_SCHEMES = Object.freeze({
  seedFor: "FNV-1a over `${key}:${step}`, mod 2147483647 — the engine service's src/adapter.ts",
  sourceDeal: "env.createEnvState({ seed: sourceSeed })",
  sourceAuthur: "seedFor(`source:${sourceSeed}`, turnNumber), both sides",
  levelKey: "survival-v1:${sourceSeed}:${snapshotTurn}",
  opponent: "seedFor(`${levelKey}|authur`, turnNumber)",
  policy: "mulberry32(seedFor(`${levelKey}|${policy}|${sim}`, turnNumber))",
  reference: "seedFor(`${levelKey}|reference|${sim}`, turnNumber)",
  blindSample: "mulberry32(seedFor(`${levelKey}|blind|${moveId}`, sample))",
});

const firstSeed = int("source-seed");
const sourceGames = int("source-games", 1);
const minTurnGap = int("min-turn-gap");
// Everything that decides WHICH snapshots are examined and HOW. Its hash
// identifies runs that must give the same candidates.
const config = {
  pipeline: PIPELINE_VERSION,
  source: { firstSeed, games: sourceGames, seeds: [firstSeed, firstSeed + sourceGames - 1], filters },
  prefilter: {
    ...DEFAULT_PREFILTER,
    rejectLegalBelow: optional("prefilter-legal-below"),
    rejectDeficitAtLeast: optional("prefilter-deficit-at-least"),
  },
  cheapRank: { ...DEFAULT_CHEAP_RANK, deficitWeight: num("cheap-deficit-weight") },
  lookahead: {
    version: OPPORTUNITY_VERSION,
    count: int("lookahead-count", 1),
    perGame: int("lookahead-per-game", 1),
    minTurnGap,
    firstMoves: int("first-moves", 1),
    blindSamples: int("blind-samples", 1),
  },
  opportunityRank: { key: args["rank-by"], count: int("simulate-count", 1), perGame: int("simulate-per-game", 1), minTurnGap },
  routing: {
    version: ROUTING_VERSION,
    signal: "planningGainBlind",
    thresholds: { tacticalMax: num("tactical-max"), strategicMin: num("strategic-min") },
  },
  tactical: {
    policies: LADDER,
    screenSims: int("screen-sims", 1),
    confirmSims: int("confirm-sims", 1),
    confirmMax: args["confirm-max"] === "all" ? null : int("confirm-max"),
    promotionRule: PROMOTION_RULE,
    screenRules: SCREEN_RULES,
    confirmThresholds: DEFAULT_THRESHOLDS,
  },
  strategic: {
    floorPolicies: FLOOR,
    floorSims: int("floor-sims", 1),
    referenceAttempts: int("reference-attempts", 1),
    minCleanReference: int("min-clean-reference", 1),
  },
  evaluation: EVALUATION_VERSION,
  policies: PLAYER_POLICIES,
  authur: { config: "offline", settings: AUTHUR_CONFIGS.offline },
  seedSchemes: SEED_SCHEMES,
  repro: bool("repro"),
};
if (!RANK_KEYS.includes(config.opportunityRank.key)) problems.push(`--rank-by must be one of ${RANK_KEYS.join(", ")}`);
try {
  validateRouting(config.routing.thresholds);
} catch (error) {
  problems.push(error.message);
}
if (config.tactical.confirmSims < config.tactical.screenSims) problems.push("--confirm-sims must be >= --screen-sims");
if (config.strategic.minCleanReference > config.strategic.referenceAttempts) {
  problems.push("--min-clean-reference cannot exceed --reference-attempts");
}
if (!existsSync(resolve(here, ".vendor/authur-rules-diag.mjs"))) problems.push("run build-vendor.mjs and build-diag.mjs first");
const workers = int("workers", 1);
const dryRun = bool("dry-run");
if (!/^[a-z0-9-]+$/i.test(args.label)) problems.push("--label must be letters, digits and dashes");
if (problems.length) throw new Error(`Invalid pipeline configuration:\n  - ${problems.join("\n  - ")}`);

const { tactical: T, strategic: S } = config;

// ── manifest: before any expensive work ─────────────────────────────────────
const configHash = sha256(canonicalJson(config));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runId = `${args.label}-${stamp}-${configHash.slice(0, 8)}`;
const runDir = resolve(here, "out/pipeline", runId);
await mkdir(resolve(runDir, "candidates"), { recursive: true });
await mkdir(resolve(runDir, "research"), { recursive: true });
const provenance = await captureProvenance({ config, workers, authurDir: args.authur });
const manifestText = `${JSON.stringify({ runId, createdAt: new Date().toISOString(), label: args.label, dryRun, configHash, provenance }, null, 1)}\n`;
await writeFile(resolve(runDir, "manifest.json"), manifestText);
const manifestSha256 = sha256(manifestText);

const started = performance.now();
const log = (...parts) => console.log(`[${((performance.now() - started) / 60_000).toFixed(1)} min]`, ...parts);
log(`run ${runId}`);
log(`manifest written (config ${configHash.slice(0, 12)}, generator ${provenance.generatorCode.sha256.slice(0, 12)}, eqlab ${provenance.git.eqlab.commit?.slice(0, 8)}${provenance.git.eqlab.dirty ? " dirty" : ""})`);

// ── workers, per-stage CPU, errors ──────────────────────────────────────────
const pool = await createPool(workers, { authurDir: args.authur });
const cpuByStage = {};
const wallByPhase = {};
const errors = [];
async function job(stage, task, payload, priority, context) {
  try {
    const result = await pool.run(task, payload, priority);
    cpuByStage[stage] = (cpuByStage[stage] ?? 0) + (result.cpuMs ?? 0);
    return result;
  } catch (error) {
    errors.push({ stage, task, ...context, error: String(error?.message ?? error).split("\n").slice(0, 8).join("\n") });
    return null;
  }
}
async function phase(name, work) {
  const t0 = performance.now();
  log(`▶ ${name}`);
  const out = await work();
  wallByPhase[name] = Math.round(performance.now() - t0);
  return out;
}
const progress = (label, total) => {
  let done = 0;
  const step = Math.max(1, Math.round(total / 10));
  return () => {
    done += 1;
    if (done % step === 0 || done === total) log(`${label} ${done}/${total}`);
  };
};

// ── 1. source games → untouched snapshots ───────────────────────────────────
const games = await phase("source", async () => {
  const seeds = Array.from({ length: sourceGames }, (_, i) => firstSeed + i);
  const tick = progress("source games", seeds.length);
  const results = await Promise.all(
    seeds.map((seed) => job("source", "source", { sourceSeed: seed, filters }, 3, { sourceSeed: seed }).then((g) => (tick(), g))),
  );
  return results.filter(Boolean).sort((a, b) => a.sourceSeed - b.sourceSeed);
});

const skippedByReason = {};
const classify = (reason) =>
  reason.startsWith("score gap") ? "side to move not behind" : reason.startsWith("scoreless streak") ? "scoreless streak not empty" : reason;
const points = [];
const duplicates = [];
const seenPositions = new Map();
for (const game of games) {
  for (const skip of game.skipped) skippedByReason[classify(skip.reason)] = (skippedByReason[classify(skip.reason)] ?? 0) + 1;
  for (const e of game.eligible) {
    const id = `s${game.sourceSeed}t${e.turn}`;
    const hash = positionHash(e.snapshot);
    if (seenPositions.has(hash)) {
      duplicates.push({ id, duplicateOf: seenPositions.get(hash) });
      continue;
    }
    seenPositions.set(hash, id);
    points.push({
      id,
      sourceSeed: game.sourceSeed,
      turn: e.turn,
      levelKey: `survival-v1:${game.sourceSeed}:${e.turn}`,
      snapshot: e.snapshot,
      initial: game.initial,
      history: game.history.slice(0, e.historyLength),
      facts: {
        bag: e.bag,
        gap: e.gap,
        side: e.side,
        turn: e.turn,
        legalPlaces: e.legalPlaces,
        legalExchanges: e.legalExchanges,
        boardTiles: e.boardTiles,
        openness: e.openness,
      },
      positionHash: hash,
    });
  }
}
log(`${games.length} games → ${points.length} eligible snapshots (${duplicates.length} duplicate positions)`);

// ── 2. cheap features + provisional prefilters ──────────────────────────────
await phase("cheap", async () => {
  const tick = progress("cheap features", points.length);
  const results = await Promise.all(
    points.map((p) =>
      job("cheap", "opportunity", { snapshot: p.snapshot, levelKey: p.levelKey, lookahead: false }, 3, { id: p.id }).then((r) => (tick(), r)),
    ),
  );
  points.forEach((p, i) => {
    const cheap = results[i];
    if (!cheap) {
      p.rejections = ["cheap features failed (worker error)"];
      return;
    }
    const { cpuMs: _c, wallMs: _w, future: _f, ...diagnostics } = cheap;
    p.diagnostics = diagnostics;
    p.features = cheapFeatures(p.facts, cheap, config.cheapRank.deficitWeight);
    p.rejections = prefilterReasons(p.features, config.prefilter);
  });
});
const passed = points.filter((p) => p.rejections.length === 0);
const rejected = points.filter((p) => p.rejections.length > 0);
const rejectedByReason = {};
for (const p of rejected) {
  for (const reason of p.rejections) {
    const key = reason.replace(/ \d+ (<|>=) /, " $1 ");
    rejectedByReason[key] = (rejectedByReason[key] ?? 0) + 1;
  }
}
log(`prefilter: ${passed.length} pass, ${rejected.length} rejected ${JSON.stringify(rejectedByReason)}`);

// ── 3. cheap rank → look-ahead set ──────────────────────────────────────────
const cheapSelection = selectTop(passed, {
  count: config.lookahead.count,
  perGame: config.lookahead.perGame,
  minTurnGap,
  score: (p) => p.features.cheapRankScore,
});
const byId = new Map(points.map((p) => [p.id, p]));
for (const d of cheapSelection.decisions) byId.get(d.id).cheapSelection = d;

// ── 4. two-turn opportunity analysis → opportunity rank ─────────────────────
await phase("lookahead", async () => {
  const list = cheapSelection.taken;
  const tick = progress("look-ahead", list.length);
  const results = await Promise.all(
    list.map((p) =>
      job(
        "lookahead",
        "opportunity",
        { snapshot: p.snapshot, levelKey: p.levelKey, firstMoves: config.lookahead.firstMoves, blindSamples: config.lookahead.blindSamples },
        3,
        { id: p.id },
      ).then((r) => (tick(), r)),
    ),
  );
  list.forEach((p, i) => {
    p.lookahead = results[i]?.future ?? null;
    p.opportunity = opportunityMetrics(results[i]);
  });
});
const looked = cheapSelection.taken;
const opportunitySelection = selectTop(looked, {
  count: config.opportunityRank.count,
  perGame: config.opportunityRank.perGame,
  minTurnGap,
  score: (p) => p.opportunity?.[config.opportunityRank.key],
});
for (const d of opportunitySelection.decisions) byId.get(d.id).opportunitySelection = d;
const candidates = opportunitySelection.taken;

// ── 5. routing ──────────────────────────────────────────────────────────────
for (const c of candidates) {
  c.routing = {
    ...route(c.opportunity?.planningGainBlind ?? null, config.routing.thresholds),
    signal: config.routing.signal,
    thresholds: config.routing.thresholds,
    routingVersion: ROUTING_VERSION,
    pipelineVersion: PIPELINE_VERSION,
    note: "research routing from provisional thresholds; not ground truth about the position",
  };
}
const routeCount = (name) => candidates.filter((c) => c.routing.route === name).length;
log(`routes: TACTICAL ${routeCount("TACTICAL")}, UNCERTAIN ${routeCount("UNCERTAIN")}, STRATEGIC ${routeCount("STRATEGIC")}`);

// Informational only — never used to choose or drop anything.
const priorPlayoutMs = (bag) => 1500 + 300 * bag; // landscape 2026-09-25, fast policies
const priorReferenceMs = 35_000; // opportunity study 2026-09-25
const tacticalList = candidates.filter((c) => c.routing.route !== "STRATEGIC");
const strategicList = candidates.filter((c) => c.routing.route !== "TACTICAL");
const plannedCpu =
  tacticalList.reduce((s, c) => s + LADDER.length * T.screenSims * priorPlayoutMs(c.facts.bag), 0) +
  candidates
    .filter((c) => c.routing.route === "STRATEGIC")
    .reduce((s, c) => s + FLOOR.length * S.floorSims * priorPlayoutMs(c.facts.bag), 0) +
  strategicList.length * S.referenceAttempts * priorReferenceMs;
log(
  `evaluation plan: ${candidates.length} candidates; first wave ≈ ${r1(plannedCpu / 3_600_000)} CPU-h ` +
    `(+ confirmation of promising tactical candidates: ${LADDER.length * (T.confirmSims - T.screenSims)} games each)`,
);

// ── 6. evaluation ───────────────────────────────────────────────────────────
const playouts = new Map(candidates.map((c) => [c.id, []]));
const hasGame = (c, policy, sim) => playouts.get(c.id).some((p) => p.policy === policy && p.sim === sim);
function runGames(list) {
  const tick = progress("games", list.length);
  return Promise.all(
    list.map(([c, policy, sim, stage, priority]) =>
      job(stage, "playout", { snapshot: c.snapshot, levelKey: c.levelKey, policy, sim }, priority, { id: c.id, policy, sim }).then((p) => {
        if (p) playouts.get(c.id).push({ ...p, stage });
        tick();
      }),
    ),
  );
}
let promoted = [];
if (!dryRun && candidates.length > 0) {
  await phase("evaluate-first-wave", async () => {
    const wave = [];
    for (const c of candidates) {
      const planned = new Set();
      const add = (policy, sim, stage, priority) => {
        if (planned.has(`${policy}:${sim}`)) return;
        planned.add(`${policy}:${sim}`);
        wave.push([c, policy, sim, stage, priority]);
      };
      // Reference games are the longest: queue them first so they do not trail.
      if (c.routing.route !== "TACTICAL") for (let sim = 0; sim < S.referenceAttempts; sim += 1) add("authur", sim, "reference", 2);
      if (c.routing.route !== "STRATEGIC") {
        for (let sim = 0; sim < T.screenSims; sim += 1) for (const policy of LADDER) add(policy, sim, "screen", 1);
      }
      if (c.routing.route !== "TACTICAL") {
        for (let sim = 0; sim < S.floorSims; sim += 1) for (const policy of FLOOR) add(policy, sim, "floor", 1);
      }
    }
    log(`first wave: ${wave.length} games`);
    await runGames(wave);
  });
  const promising = tacticalList
    .map((c) => ({ c, category: screen(playouts.get(c.id), T.screenSims).category }))
    .filter((x) => isPromising(x.category))
    .sort((a, b) => b.category.promise - a.category.promise || (a.c.id < b.c.id ? -1 : 1));
  promoted = (T.confirmMax == null ? promising : promising.slice(0, T.confirmMax)).map((x) => x.c);
  for (const x of promising) x.c.promising = true;
  if (promoted.length > 0) {
    await phase("evaluate-confirmation", async () => {
      const wave = [];
      for (const c of promoted) {
        for (let sim = T.screenSims; sim < T.confirmSims; sim += 1) {
          for (const policy of LADDER) if (!hasGame(c, policy, sim)) wave.push([c, policy, sim, "confirm", 1]);
        }
      }
      log(`confirmation: ${promoted.length} of ${promising.length} promising (${wave.length} games)`);
      await runGames(wave);
    });
  }
}
const promotedIds = new Set(promoted.map((c) => c.id));
const sharedCache = pool.sharedStats();
await pool.close();

// ── 7. candidate JSON ───────────────────────────────────────────────────────
const CAVEATS = [
  "simulatedWinProfile: fast weak/medium/strong policies against deterministic offline Authur; not a human win probability (observedHumanWinRate is separate and does not exist yet)",
  "Authur-as-player is a planning / upper reference, not an estimate of any human's chance",
  "route is a provisional research routing from planning-gain thresholds, not ground truth",
  "timing-affected games stay in the raw counts and are excluded from every confirmation",
  "production prerequisite: Authur's exact endgame stops on a 60 s wall clock; live play needs a node-bounded deterministic endgame to replay these results exactly",
];
const compactProvenance = {
  runId,
  configHash,
  manifestSha256,
  versions: { ...provenance.versions, evaluation: EVALUATION_VERSION },
  generatorCodeSha256: provenance.generatorCode.sha256,
  git: {
    eqlab: provenance.git.eqlab,
    generatorTracked: provenance.git.generatorTracked,
    botLab: provenance.git.botLab,
    engine: provenance.git.engine,
  },
  rules: {
    bagRule: BAG_RULE,
    bundleSha256: provenance.bundles.rules.sha256,
    bundleCodeSha256: provenance.bundles.rules.codeSha256,
    diagnosticsSha256: provenance.bundles.rulesDiagnostics.sha256,
    diagnosticsCodeSha256: provenance.bundles.rulesDiagnostics.codeSha256,
    validatorSha256: provenance.bundles.eqlabValidator.sha256,
    validatorCodeSha256: provenance.bundles.eqlabValidator.codeSha256,
  },
  authur: {
    strongSha256: provenance.bundles.authur.strong,
    models: provenance.bundles.authur.models,
    config: config.authur,
  },
  runtime: { node: provenance.runtime.node, platform: provenance.runtime.platform },
  seedSchemes: SEED_SCHEMES,
};
const summaries = [];
const statusCount = {};
if (!dryRun) {
  await phase("output", async () => {
    const lines = [];
    for (const c of candidates) {
      const runs = playouts.get(c.id).sort((a, b) =>
        a.stage === b.stage ? (a.policy === b.policy ? a.sim - b.sim : a.policy < b.policy ? -1 : 1) : a.stage < b.stage ? -1 : 1,
      );
      const player = c.snapshot.sideToMove;
      const authur = other(player);
      const tactical = c.routing.route !== "STRATEGIC"
        ? {
            ...tacticalEvaluation(runs, { screenSims: T.screenSims, confirmSims: T.confirmSims }, promotedIds.has(c.id)),
            promising: Boolean(c.promising),
            ...(c.promising && !promotedIds.has(c.id) ? { reason: `promising, but beyond --confirm-max=${T.confirmMax}` } : {}),
          }
        : null;
      const strategic = c.routing.route !== "TACTICAL"
        ? strategicEvaluation(runs, { referenceAttempts: S.referenceAttempts, minCleanReference: S.minCleanReference })
        : null;
      const status = pipelineStatus(c.routing.route, tactical?.outcome ?? null, strategic?.outcome ?? null);
      statusCount[status] = (statusCount[status] ?? 0) + 1;
      const stageCpu = {};
      for (const p of runs) stageCpu[p.stage] = Math.round((stageCpu[p.stage] ?? 0) + p.cpuMs);
      const timing = {
        games: runs.length,
        timingAffectedGames: runs.filter((p) => p.timingAffected).length,
        affected: runs.filter((p) => p.timingAffected).map((p) => ({ stage: p.stage, policy: p.policy, sim: p.sim })),
        lookaheadTimingAffectedReplies: c.opportunity?.timingAffectedReplies ?? 0,
      };
      // Never lose a finished evaluation to an output error: keep the raw
      // material and the error, and carry on with the other candidates.
      let candidate = null;
      try {
        candidate = buildCandidate({
          snapshot: c.snapshot,
          levelKey: c.levelKey,
          sourceLog: buildSourceLog({ sourceSeed: c.sourceSeed, initial: c.initial, turns: c.history, snapshot: c.snapshot }),
          status,
          publicFacts: {
            deficit: c.features.deficit,
            bagRemaining: c.snapshot.bag.length,
            turnNumber: c.snapshot.turnNumber,
            scores: { player: c.snapshot.scores[player], authur: c.snapshot.scores[authur] },
            difficulty: { tier: null, label: null, calibrationVersion: null },
          },
          provenance: {
            ...compactProvenance,
            // The source game's log itself is in gameplay.sourceLog; buildCandidate adds its hash here.
            source: { sourceSeed: c.sourceSeed, snapshotTurn: c.turn, levelKey: c.levelKey },
          },
          admin: {
            features: { ...c.features, boardTiles: c.facts.boardTiles, openness: c.facts.openness },
            diagnostics: { board: c.diagnostics.board, playerRack: c.diagnostics.rack, authurRack: c.diagnostics.threat },
            opportunity: {
              version: OPPORTUNITY_VERSION,
              firstMoves: config.lookahead.firstMoves,
              blindSamples: config.lookahead.blindSamples,
              metrics: c.opportunity,
              bestExactPlan: c.lookahead?.bestExactPlan ?? null,
              bestBlindPlan: c.lookahead?.bestBlindPlan ?? null,
              rows: c.lookahead?.rows ?? [],
            },
            selection: {
              prefilter: { passed: true, version: config.prefilter.version, provisional: true },
              cheapRank: c.cheapSelection.rank,
              cheapRankScore: c.features.cheapRankScore,
              cheapRankFormula: config.cheapRank.formula,
              opportunityRank: c.opportunitySelection.rank,
              opportunityRankKey: config.opportunityRank.key,
              opportunityRankScore: c.opportunitySelection.score,
            },
            routing: c.routing,
            tactical,
            strategic,
            structure: structure(c.facts, runs),
            timing,
            games: runs.map((p) => gameRecord(p, c.levelKey, player)),
            verification: {
              placementsChecked: runs.reduce((s, p) => s + p.checks.placements, 0),
              ruleMismatches: runs.reduce((s, p) => s + p.checks.mismatches.length, 0),
            },
            confidence: {
              status,
              tacticalOutcome: tactical?.outcome ?? null,
              tacticalReason: tactical?.reason ?? null,
              strategicOutcome: strategic?.outcome ?? null,
              strategicReason: strategic?.reason ?? null,
              caveats: CAVEATS,
            },
            cpuMsByStage: stageCpu,
          },
        });
      } catch (error) {
        errors.push({ stage: "output", id: c.id, error: String(error?.message ?? error).split("\n").slice(0, 8).join("\n") });
        await writeFile(
          resolve(runDir, "research", `unbuilt-${c.id}.json`),
          `${JSON.stringify({ id: c.id, levelKey: c.levelKey, status, snapshot: c.snapshot, initial: c.initial, history: c.history, routing: c.routing, tactical, strategic })}\n`,
        );
      }
      const candidateId = candidate?.candidateId ?? `unbuilt-${c.id}`;
      if (candidate) await writeFile(resolve(runDir, "candidates", `${candidateId}.json`), `${JSON.stringify(candidate, null, 1)}\n`);
      for (const p of runs) {
        lines.push(JSON.stringify({
          candidateId,
          levelKey: c.levelKey,
          stage: p.stage,
          policy: p.policy,
          sim: p.sim,
          outcome: p.outcome,
          margin: p.margin,
          end: p.end,
          timingAffected: p.timingAffected,
          actionsSha256: actionsHash(p),
          actions: p.actions,
        }));
      }
      const rate = (profile) => (profile ? profile.estimatedWinRate : null);
      const ladder = tactical?.confirmation?.profiles ?? tactical?.screening.profiles;
      summaries.push({
        candidateId,
        id: c.id,
        bag: c.facts.bag,
        deficit: c.features.deficit,
        firepower: c.features.firepower,
        exactMinusDeficit: c.opportunity?.exactSwingMinusDeficit ?? null,
        blindMinusDeficit: c.opportunity?.bagBlindSwingMinusDeficit ?? null,
        seedLift: c.opportunity?.seedLift ?? null,
        planningGainBlind: c.routing.planningGainBlind,
        route: c.routing.route,
        weak: rate(ladder?.weak ?? strategic?.floor.weak),
        medium: rate(ladder?.medium ?? strategic?.floor.medium),
        strong: rate(ladder?.strong),
        tacticalN: tactical ? (tactical.confirmation ? T.confirmSims : T.screenSims) : null,
        tacticalCategory: tactical ? (tactical.confirmation?.category.category ?? `screen:${tactical.screening.category.category}`) : null,
        reference: strategic
          ? `${strategic.reference.excludingTimingAffected.wins}/${strategic.cleanReferenceGames} clean of ${strategic.referenceCompleted} (${strategic.distinctReferenceGames.all} distinct)`
          : null,
        strategicCategory: strategic?.category ?? null,
        timingAffected: timing.timingAffectedGames,
        status,
      });
    }
    await writeFile(resolve(runDir, "research/playouts.jsonl"), lines.length ? `${lines.join("\n")}\n` : "");
  });
}

// ── 8. reproducibility: a fresh single worker with cold caches ──────────────
let repro = null;
if (config.repro && !dryRun && candidates.length > 0) {
  repro = await phase("repro", async () => {
    const target = candidates[0];
    const again = await createPool(1, { authurDir: args.authur });
    const t0 = performance.now();
    const checks = [];
    let cpuMs = 0;
    const timed = async (task, payload) => {
      const result = await again.run(task, payload);
      cpuMs += result.cpuMs;
      return result;
    };
    try {
      const game = await timed("source", { sourceSeed: target.sourceSeed, filters });
      const original = games.find((g) => g.sourceSeed === target.sourceSeed);
      const point = game.eligible.find((e) => e.turn === target.turn);
      checks.push({
        check: "source game: same deal and every turn record identical",
        same: canonicalJson({ i: game.initial, h: game.history }) === canonicalJson({ i: original.initial, h: original.history }),
      });
      checks.push({
        check: "snapshot content hash",
        same: point != null && contentHash(point.snapshot, target.levelKey) === contentHash(target.snapshot, target.levelKey),
      });
      const deep = await timed("opportunity", {
        snapshot: target.snapshot,
        levelKey: target.levelKey,
        firstMoves: config.lookahead.firstMoves,
        blindSamples: config.lookahead.blindSamples,
      });
      checks.push({ check: "two-turn analysis", same: canonicalJson(opportunityMetrics(deep)) === canonicalJson(target.opportunity) });
      // Sim 0 of every policy that was played, from the first candidate that played it.
      for (const policy of [...LADDER, "authur"]) {
        const owner = candidates.find((c) => playouts.get(c.id).some((p) => p.policy === policy && p.sim === 0));
        if (!owner) continue;
        const original0 = playouts.get(owner.id).find((p) => p.policy === policy && p.sim === 0);
        const replay = await timed("playout", { snapshot: owner.snapshot, levelKey: owner.levelKey, policy, sim: 0 });
        checks.push({
          check: `${policy} game sim 0 on ${owner.id}`,
          same: actionsHash(replay) === actionsHash(original0),
          timingAffected: original0.timingAffected || replay.timingAffected,
        });
      }
    } finally {
      await again.close();
    }
    return { candidate: target.id, identical: checks.filter((c) => c.same).length, of: checks.length, checks, cpuMs: Math.round(cpuMs), wallMs: Math.round(performance.now() - t0) };
  });
}

// ── 9. run statistics ───────────────────────────────────────────────────────
const allRuns = [...playouts.values()].flat();
const cpuStat = (values) =>
  values.length === 0
    ? null
    : { n: values.length, mean: Math.round(mean(values)), p50: Math.round(percentile(values, 0.5)), p95: Math.round(percentile(values, 0.95)), max: Math.round(Math.max(...values)) };
const perCandidate = (list, stage) =>
  cpuStat(list.map((c) => playouts.get(c.id).filter((p) => p.stage === stage).reduce((s, p) => s + p.cpuMs, 0)).filter((v) => v > 0));
const totalCpu = Object.values(cpuByStage).reduce((s, v) => s + v, 0);
const totalWall = Object.entries(wallByPhase).filter(([k]) => k !== "repro").reduce((s, [, v]) => s + v, 0);
const stats = {
  runId,
  configHash,
  manifestSha256,
  dryRun,
  funnel: {
    sourceGames: { planned: sourceGames, completed: games.length },
    eligibleSnapshots: points.length,
    duplicatePositions: duplicates.length,
    skippedInsideBagWindow: skippedByReason,
    prefilter: { version: config.prefilter.version, provisional: true, passed: passed.length, rejected: rejected.length, rejectedByReason },
    lookahead: { selected: cheapSelection.taken.length, completed: looked.filter((p) => p.opportunity).length },
    simulated: candidates.length,
    routes: { TACTICAL: routeCount("TACTICAL"), UNCERTAIN: routeCount("UNCERTAIN"), STRATEGIC: routeCount("STRATEGIC") },
    promising: candidates.filter((c) => c.promising).length,
    confirmed: promoted.length,
    statuses: statusCount,
  },
  candidates: summaries,
  // Every snapshot the prefilter rejected, with the features that decided it.
  rejected: rejected.map((p) => ({ id: p.id, sourceSeed: p.sourceSeed, turn: p.turn, features: p.features ?? null, reasons: p.rejections })),
  eligible: passed.map((p) => ({
    id: p.id,
    bag: p.facts.bag,
    deficit: p.features.deficit,
    legal: p.features.legalPlacements,
    best: p.features.bestImmediateScore,
    threat: p.features.authurImmediateThreat,
    firepower: p.features.firepower,
    cheapRankScore: p.features.cheapRankScore,
    cheapRank: p.cheapSelection.rank,
    lookahead: p.cheapSelection.taken,
    notTakenBecause: p.cheapSelection.reason,
  })),
  lookahead: looked.map((p) => ({ id: p.id, ...p.opportunity, opportunityRank: p.opportunitySelection.rank, simulated: p.opportunitySelection.taken, notTakenBecause: p.opportunitySelection.reason })),
  duplicates,
  cost: {
    cpuMsByStage: Object.fromEntries(Object.entries(cpuByStage).map(([k, v]) => [k, Math.round(v)])),
    wallMsByPhase: wallByPhase,
    totalCpuMs: Math.round(totalCpu),
    totalWallMsExcludingRepro: totalWall,
    parallelEfficiency: totalWall ? r3(totalCpu / (totalWall * workers)) : null,
    workers,
    unit: {
      sourceGameCpuMs: cpuStat(games.map((g) => g.cpuMs)),
      eligiblePerGame: r1(points.length / Math.max(1, games.length)),
      prefilterPassRate: r3(passed.length / Math.max(1, points.length)),
      cheapCpuMsPerSnapshot: r1((cpuByStage.cheap ?? 0) / Math.max(1, points.length)),
      lookaheadCpuMsPerSnapshot: r1((cpuByStage.lookahead ?? 0) / Math.max(1, looked.length)),
      playoutCpuMs: Object.fromEntries(
        [...LADDER, "authur"].map((policy) => [policy, cpuStat(allRuns.filter((p) => p.policy === policy).map((p) => p.cpuMs))]),
      ),
      referenceWallMs: cpuStat(allRuns.filter((p) => p.policy === "authur").map((p) => p.wallMs)),
      perCandidateCpuMs: {
        screen: perCandidate(tacticalList, "screen"),
        confirm: perCandidate(promoted, "confirm"),
        floor: perCandidate(candidates.filter((c) => c.routing.route === "STRATEGIC"), "floor"),
        reference: perCandidate(strategicList, "reference"),
      },
    },
    sharedCache,
    authurShareOfPlayoutCpu: r3(allRuns.reduce((s, p) => s + p.clock.authur, 0) / Math.max(1, allRuns.reduce((s, p) => s + p.cpuMs, 0))),
  },
  timing: {
    games: allRuns.length,
    timingAffected: allRuns.filter((p) => p.timingAffected).length,
    byPolicy: Object.fromEntries(
      [...LADDER, "authur"].map((policy) => {
        const list = allRuns.filter((p) => p.policy === policy);
        return [policy, { games: list.length, timingAffected: list.filter((p) => p.timingAffected).length }];
      }),
    ),
    wallClockNetFired: allRuns.flatMap((p) => p.authurTurns).filter((t) => t.netFired).length,
  },
  verification: {
    placementsChecked: allRuns.reduce((s, p) => s + p.checks.placements, 0) + games.reduce((s, g) => s + g.checks.placements, 0),
    ruleMismatches: allRuns.reduce((s, p) => s + p.checks.mismatches.length, 0) + games.reduce((s, g) => s + g.checks.mismatches.length, 0),
  },
  repro,
  errors,
};
await writeFile(resolve(runDir, "run-stats.json"), `${JSON.stringify(stats, null, 1)}\n`);
await appendFile(resolve(here, "out/pipeline/runs.log"), `${new Date().toISOString()} ${runId} ${JSON.stringify(stats.funnel.statuses)}\n`);

console.log("\nFUNNEL", JSON.stringify(stats.funnel, null, 1));
if (summaries.length) console.table(summaries.map(({ candidateId, ...row }) => row));
console.log("CPU by stage (s):", Object.fromEntries(Object.entries(stats.cost.cpuMsByStage).map(([k, v]) => [k, r1(v / 1000)])));
console.log("wall by phase (s):", Object.fromEntries(Object.entries(wallByPhase).map(([k, v]) => [k, r1(v / 1000)])));
console.log(`timing-affected games: ${stats.timing.timingAffected}/${stats.timing.games}; rule mismatches: ${stats.verification.ruleMismatches}; errors: ${errors.length}`);
if (repro) console.log(`repro: ${repro.identical}/${repro.of} identical`, repro.checks.filter((c) => !c.same));
log(`done → ${runDir}`);
