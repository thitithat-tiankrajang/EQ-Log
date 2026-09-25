// Scoring-opportunity STUDY — research only, three separate stages:
//
//   --stage=known    diagnostics for every candidate of an earlier landscape
//                    report (known outcomes), to see which measures separate
//                    FLAT_HARD from SKILL_SEPARATING.
//   --stage=search   how often authentic Authur-vs-Authur games reach large
//                    deficits (natural frequency), cheap diagnostics for every
//                    such snapshot, and the two-turn look-ahead for the most
//                    promising few per deficit band.
//   --stage=policy   weak / medium / strong (+ Authur on the player's side) on
//                    chosen large-deficit snapshots: is any of them recoverable,
//                    and can the fast policies tell?
//
// Never edits a position, never writes to the database, never touches live play.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { validateFilters } from "./lib/rules.mjs";
import { createPool } from "./lib/pool.mjs";
import { r1, r3 } from "./lib/stats.mjs";
import { summarizePolicy, trendZ } from "./lib/summary.mjs";

const here = import.meta.dirname;
const args = {};
for (const token of process.argv.slice(2)) {
  const match = /^--([^=]+)=(.*)$/.exec(token);
  if (match) (args[match[1]] ??= []).push(match[2]);
}
const one = (key, fallback) => args[key]?.at(-1) ?? fallback;
const pair = (text) => text.split(",").map(Number);
const stage = one("stage", "known");
const workers = Number(one("workers", Math.max(1, os.availableParallelism() - 1)));
const firstMoves = Number(one("first-moves", 16));
const blindSamples = Number(one("blind-samples", 4));
const maxMinutes = Number(one("max-minutes", 30));
const started = performance.now();
const log = (...parts) => console.log(`[${((performance.now() - started) / 60_000).toFixed(1)} min]`, ...parts);
const outDir = resolve(here, "out");
await mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const pool = await createPool(workers);
const guard = (label, cpuMs) => {
  const minutes = cpuMs / (workers * 0.72) / 60_000;
  log(`${label}: estimate ${r1(minutes)} min`);
  if (minutes > maxMinutes) throw new Error(`${label} estimate ${r1(minutes)} min exceeds --max-minutes=${maxMinutes}; stopping`);
};
const strip = ({ premiumCells, ...rest }) => rest;
const compact = (o) => ({ ...o, board: strip(o.board) });

// ── known: earlier landscape candidates with known outcomes ─────────────────
if (stage === "known") {
  const landscape = JSON.parse(await readFile(resolve(one("landscape")), "utf8"));
  const list = landscape.candidates;
  guard(`diagnostics for ${list.length} known candidates`, list.length * 45_000);
  const results = await Promise.all(list.map((c) =>
    pool.run("opportunity", { snapshot: c.snapshot, levelKey: c.levelKey, firstMoves, blindSamples })));
  const rows = list.map((c, i) => {
    const best = c.confirm ?? c.screen;
    const rate = (p) => best.profiles[p].estimatedWinRate;
    return {
      id: c.id,
      bag: c.facts.bag,
      deficit: c.facts.deficit,
      legal0: c.facts.legalPlaces,
      class: c.confirm ? c.confirm.category.category : `screen:${c.screen.category.category}`,
      weak: rate("weak"),
      medium: rate("medium"),
      strong: rate("strong"),
      opportunity: compact(results[i]),
    };
  });
  const file = resolve(outDir, `opportunity-known-${stamp}.json`);
  await writeFile(file, JSON.stringify({ stage, firstMoves, blindSamples, rows }) + "\n");
  log(`report: ${file}`);
}

// ── search: natural frequency of large deficits, and their opportunity ───────
if (stage === "search") {
  const games = Number(one("games", 56));
  const sourceSeed = Number(one("source-seed", 51000));
  const [bagLo, bagHi] = pair(one("bag", "10,49"));
  const bands = [[100, 199], [200, 299], [300, 399], [400, 10_000]];
  const perBand = Number(one("per-band", 6));
  const filters = validateFilters({ bagRemainingRange: [bagLo, bagHi], scoreGapRange: [-10_000, -100] });
  guard(`${games} source games`, games * 56_000);
  const sources = [];
  for (let done = 0; done < games; done += workers) {
    const seeds = Array.from({ length: Math.min(workers, games - done) }, (_, i) => sourceSeed + done + i);
    sources.push(...(await Promise.all(seeds.map((seed) => pool.run("source", { sourceSeed: seed, filters })))));
    log(`source games ${sources.length}/${games}`);
  }
  const points = sources.flatMap((g) => g.eligible.map((p) => ({
    id: `s${g.sourceSeed}t${p.turn}`,
    sourceSeed: g.sourceSeed,
    turn: p.turn,
    bag: p.bag,
    deficit: -p.gap,
    band: bands.findIndex(([lo, hi]) => -p.gap >= lo && -p.gap <= hi),
    levelKey: `survival-v1:${g.sourceSeed}:${p.turn}`,
    snapshot: p.snapshot,
    legal0: p.legalPlaces,
  })));
  log(`${points.length} snapshots trailing by 100+`);
  guard(`cheap diagnostics for ${points.length} snapshots`, points.length * 2_000);
  const cheap = await Promise.all(points.map((p) =>
    pool.run("opportunity", { snapshot: p.snapshot, levelKey: p.levelKey, lookahead: false })));
  points.forEach((p, i) => (p.opportunity = compact(cheap[i])));
  // The most promising per band for the (expensive) look-ahead: immediate
  // firepower advantage = player's best move now − Authur's best move now.
  const advantage = (p) => p.opportunity.rack.best - p.opportunity.threat.best;
  const chosen = [];
  for (let band = 0; band < bands.length; band += 1) {
    const seen = new Set();
    for (const p of points.filter((x) => x.band === band).sort((a, b) => advantage(b) - advantage(a) || (a.id < b.id ? -1 : 1))) {
      if (seen.has(p.sourceSeed) || seen.size >= perBand) continue;
      seen.add(p.sourceSeed);
      chosen.push(p);
    }
  }
  guard(`look-ahead for ${chosen.length} snapshots`, chosen.length * 45_000);
  const deep = await Promise.all(chosen.map((p) =>
    pool.run("opportunity", { snapshot: p.snapshot, levelKey: p.levelKey, firstMoves, blindSamples })));
  chosen.forEach((p, i) => (p.lookahead = compact(deep[i]).future));
  const file = resolve(outDir, `opportunity-search-${stamp}.json`);
  await writeFile(file, JSON.stringify({
    stage,
    games,
    sourceSeed,
    bag: [bagLo, bagHi],
    bands,
    sources: sources.map((g) => ({ seed: g.sourceSeed, eligible: g.eligible.length, cpuMs: Math.round(g.cpuMs) })),
    points,
  }) + "\n");
  log(`report: ${file}`);
}

// ── policy: can anybody recover, and do the policies separate? ───────────────
if (stage === "policy") {
  const source = JSON.parse(await readFile(resolve(one("from")), "utf8"));
  // Either a search report (points) or a landscape report (candidates).
  const available = source.points ?? source.candidates.map((c) => ({
    id: c.id,
    bag: c.facts.bag,
    deficit: c.facts.deficit,
    levelKey: c.levelKey,
    snapshot: c.snapshot,
    lookahead: null,
  }));
  const ids = one("ids").split(",");
  const sims = Number(one("sims", 8));
  const reference = Number(one("reference", 4));
  const list = ids.map((id) => {
    const p = available.find((x) => x.id === id);
    if (!p) throw new Error(`no snapshot ${id}`);
    return p;
  });
  guard(`policy test on ${list.length} snapshots`, list.length * (3 * sims * 12_000 + reference * 35_000));
  const byLevel = new Map(
    await Promise.all(list.map(async (p) => {
      const jobs = [];
      for (let sim = 0; sim < reference; sim += 1) jobs.push(pool.run("playout", { snapshot: p.snapshot, levelKey: p.levelKey, policy: "authur", sim }, 2));
      for (let sim = 0; sim < sims; sim += 1) {
        for (const policy of ["weak", "medium", "strong"]) jobs.push(pool.run("playout", { snapshot: p.snapshot, levelKey: p.levelKey, policy, sim }, 1));
      }
      return [p.levelKey, await Promise.all(jobs)];
    })),
  );
  const report = list.map((p) => {
    const runs = byLevel.get(p.levelKey);
    const profiles = Object.fromEntries(
      ["weak", "medium", "strong", "authur"]
        .map((policy) => [policy, runs.filter((x) => x.policy === policy)])
        .filter(([, list]) => list.length > 0)
        .map(([policy, list]) => [policy, summarizePolicy(list, policy)]),
    );
    return {
      id: p.id,
      bag: p.bag,
      deficit: p.deficit,
      lookahead: p.lookahead ? {
        futureOpportunityCompatibility: p.lookahead.futureOpportunityCompatibility,
        bagBlindTwoTurn: p.lookahead.bagBlindTwoTurn,
        seedLift: p.lookahead.seedLift,
        planningGainBlind: p.lookahead.planningGainBlind,
      } : null,
      profile: Object.fromEntries(Object.entries(profiles).map(([k, v]) => [k, { wins: v.wins, ties: v.ties, losses: v.losses, n: v.simulations, rate: v.estimatedWinRate, margin: v.margin.mean, timingAffected: v.timingAffectedGames }])),
      trendZ: profiles.weak
        ? r3(trendZ(["weak", "medium", "strong"].map((k) => profiles[k].wins), ["weak", "medium", "strong"].map((k) => profiles[k].simulations)))
        : null,
      cpuMs: Math.round(runs.reduce((s, x) => s + x.cpuMs, 0)),
    };
  });
  const file = resolve(outDir, `opportunity-policy-${stamp}.json`);
  await writeFile(file, JSON.stringify({ stage, sims, reference, report }) + "\n");
  console.table(report.map((x) => ({
    id: x.id,
    bag: x.bag,
    deficit: x.deficit,
    weak: x.profile.weak?.rate,
    medium: x.profile.medium?.rate,
    strong: x.profile.strong?.rate,
    authur: x.profile.authur ? `${x.profile.authur.wins}/${x.profile.authur.n}` : "-",
    marginW: x.profile.weak?.margin,
    marginS: x.profile.strong?.margin,
    marginA: x.profile.authur?.margin,
  })));
  log(`report: ${file}`);
}

await pool.close();
