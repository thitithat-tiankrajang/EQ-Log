// Turning playouts into the numbers a candidate is judged by. Raw counts are
// always kept next to every rate.
import { differenceInterval, mean, percentile, r1, r3, wilson } from "./stats.mjs";

export const SHAPES = ["FLAT-HARD", "FLAT-EASY", "SKILL-SEPARATING", "NON-SEPARATING", "NOISY/UNCERTAIN"];

export const DEFAULT_THRESHOLDS = Object.freeze({
  // Point-estimate cut-offs, used for the PROVISIONAL shape after screening.
  flatHardMax: 0.1,
  flatEasyMin: 0.9,
  separationMin: 0.2,
  // Interval cut-offs, used for the JUDGED shape (95% Wilson / Newcombe).
  flatHardUpperMax: 0.25,
  flatEasyLowerMin: 0.75,
});

const isCheapTurn = (turn) => !turn.reference && !turn.solver;

/** Everything about one policy on one candidate. */
export function summarizePolicy(runs, policy) {
  const n = runs.length;
  const wins = runs.filter((p) => p.outcome === "win").length;
  const ties = runs.filter((p) => p.outcome === "tie").length;
  const losses = n - wins - ties;
  const [lo, hi] = wilson(wins, n);
  const sum = (key) => runs.reduce((s, p) => s + (p.clock[key] ?? 0), 0);
  const totalCpu = runs.reduce((s, p) => s + p.cpuMs, 0) || 1;
  const playerCpu = sum("movegen") + sum("evaluate") + sum("select");
  const turns = runs.flatMap((p) => p.playerTurns).filter((t) => !t.reference);
  const cheap = turns.filter(isCheapTurn);
  const choices = cheap.filter((t) => !t.forced);
  const menusBuilt = cheap.filter((t) => !t.menuCached).length;
  const solverTurns = turns.filter((t) => t.solver);
  const solverComputed = solverTurns.filter((t) => t.solverSource === "computed");
  const solverCpu = solverComputed.map((t) => t.solverComputeCpuMs);
  const endings = {};
  for (const p of runs) endings[p.end] = (endings[p.end] ?? 0) + 1;
  const clean = runs.filter((p) => !p.timingAffected);
  const cleanWins = clean.filter((p) => p.outcome === "win").length;
  const cleanTies = clean.filter((p) => p.outcome === "tie").length;
  return {
    policy,
    simulations: n,
    wins,
    ties,
    losses,
    estimatedWinRate: r3(n ? wins / n : null),
    winRate95: [r3(lo), r3(hi)],
    timingAffectedGames: n - clean.length,
    // The same numbers with every timing-affected game left out: the only ones
    // that can be certified as deterministic.
    excludingTimingAffected: {
      simulations: clean.length,
      wins: cleanWins,
      ties: cleanTies,
      losses: clean.length - cleanWins - cleanTies,
      estimatedWinRate: r3(clean.length ? cleanWins / clean.length : null),
    },
    margin: { mean: r1(mean(runs.map((p) => p.margin))), p50: percentile(runs.map((p) => p.margin), 0.5) },
    gameLength: r1(mean(runs.map((p) => p.turns))),
    endBag: r1(mean(runs.map((p) => p.endBag))),
    endings,
    cpuMsPerPlayout: {
      mean: Math.round(totalCpu / Math.max(1, n)),
      p50: Math.round(percentile(runs.map((p) => p.cpuMs), 0.5) ?? 0),
      p95: Math.round(percentile(runs.map((p) => p.cpuMs), 0.95) ?? 0),
    },
    wallMsPerPlayout: {
      mean: Math.round(mean(runs.map((p) => p.wallMs)) ?? 0),
      p95: Math.round(percentile(runs.map((p) => p.wallMs), 0.95) ?? 0),
    },
    cpuShare: {
      authurOpponent: r3(sum("authur") / totalCpu),
      playerPolicy: r3(playerCpu / totalCpu),
      strongEndgameSolver: r3(sum("solver") / totalCpu),
      applyAndVerify: r3((sum("apply") + sum("verify")) / totalCpu),
    },
    // Cheap-policy decisions only. A forced pass (nothing else legal) says
    // nothing about skill, so it is counted but kept out of the quality numbers.
    playerDecisions: cheap.length === 0 ? null : {
      turns: cheap.length,
      realChoices: choices.length,
      forcedPasses: cheap.length - choices.length,
      forcedPassRate: r3((cheap.length - choices.length) / cheap.length),
      meanLegalPlacements: r1(mean(cheap.map((t) => t.legalPlaces))),
      meanEquityLoss: r1(mean(choices.map((t) => t.loss))),
      pickedBest: r3(choices.length ? choices.filter((t) => t.rank === 1).length / choices.length : null),
      rankP50: percentile(choices.map((t) => t.rank), 0.5),
      meanFound: r1(mean(choices.map((t) => t.found))),
      families: Object.fromEntries(["place", "exchange", "pass"].map((f) => [f, choices.filter((t) => t.family === f).length])),
      menuCacheHitRate: r3(1 - menusBuilt / cheap.length),
      cpuMsPerMenuBuilt: {
        movegen: r1(sum("movegen") / Math.max(1, menusBuilt)),
        evaluate: r1(sum("evaluate") / Math.max(1, menusBuilt)),
      },
      cpuMsPerSelection: r3(sum("select") / Math.max(1, cheap.length)),
    },
    exactEndgame: solverTurns.length === 0 ? null : {
      invocations: solverTurns.length,
      computed: solverComputed.length,
      reused: solverTurns.length - solverComputed.length,
      computeCpuMs: {
        total: Math.round(solverCpu.reduce((s, v) => s + v, 0)),
        p50: percentile(solverCpu, 0.5),
        p95: percentile(solverCpu, 0.95),
        max: solverCpu.length ? Math.max(...solverCpu) : null,
      },
      // exact === false is the solver's own report that its 60 s clock ran out.
      timingLimitHits: solverTurns.filter((t) => t.exact === false || t.mode === "partial").length,
      slowestWallMs: solverComputed.length ? Math.max(...solverComputed.map((t) => t.solverWallMs)) : null,
    },
  };
}

/** Why a candidate is hard: board and ending structure across every simulated player turn. */
export function structure(facts, playouts) {
  const players = playouts.filter((p) => p.policy !== "authur");
  const turns = players.flatMap((p) => p.playerTurns).filter((t) => !t.reference);
  const legal = turns.map((t) => t.legalPlaces);
  const endings = {};
  for (const p of players) endings[p.end] = (endings[p.end] ?? 0) + 1;
  return {
    startBag: facts.bag,
    startGap: facts.gap,
    startLegalPlacements: facts.legalPlaces,
    startLegalExchanges: facts.legalExchanges,
    openness: facts.openness,
    playerTurns: turns.length,
    meanLegalPlacements: r1(mean(legal)),
    medianLegalPlacements: percentile(legal, 0.5),
    zeroPlacementTurnRate: r3(turns.filter((t) => t.legalPlaces === 0).length / Math.max(1, turns.length)),
    forcedPasses: turns.filter((t) => t.forced).length,
    forcedPassRate: r3(turns.filter((t) => t.forced).length / Math.max(1, turns.length)),
    rackOutEndingRate: r3((endings.rack_out ?? 0) / Math.max(1, players.length)),
    scorelessEndingRate: r3((endings.no_score_streak ?? 0) / Math.max(1, players.length)),
    endings,
    meanBagAtEnd: r1(mean(players.map((p) => p.endBag))),
    zeroPlacementRateWhileBagNonEmpty: r3(
      turns.filter((t) => t.bag > 0 && t.legalPlaces === 0).length / Math.max(1, turns.filter((t) => t.bag > 0).length),
    ),
    zeroPlacementRateAfterBagEmpty: r3(
      turns.filter((t) => t.bag === 0 && t.legalPlaces === 0).length / Math.max(1, turns.filter((t) => t.bag === 0).length),
    ),
    meanGameLength: r1(mean(players.map((p) => p.turns))),
    timingAffectedGames: playouts.filter((p) => p.timingAffected).length,
  };
}

/**
 * Cochran–Armitage test for an INCREASING trend in win rate over ordered groups
 * (weak, medium, strong). It uses all three groups at once, so one pair out of
 * order by a game or two does not by itself erase evidence of a trend. Returns
 * z; 0 when every game was won or every game was lost (no information).
 */
export function trendZ(wins, trials, scores = [0, 1, 2]) {
  const total = trials.reduce((sum, n) => sum + n, 0);
  const p = wins.reduce((sum, x) => sum + x, 0) / total;
  if (!(p > 0 && p < 1)) return 0;
  let statistic = 0;
  let sumNT = 0;
  let sumNT2 = 0;
  wins.forEach((x, i) => {
    statistic += scores[i] * (x - trials[i] * p);
    sumNT += trials[i] * scores[i];
    sumNT2 += trials[i] * scores[i] ** 2;
  });
  const variance = p * (1 - p) * (sumNT2 - (sumNT * sumNT) / total);
  return variance > 0 ? statistic / Math.sqrt(variance) : 0;
}

export const SCREEN_RULES = Object.freeze({
  // FLAT_HARD: this many wins or fewer across weak + medium + strong together.
  flatHardMaxWins: 1,
  // FLAT_EASY: this many non-wins or fewer across the three together.
  flatEasyMaxNonWins: 1,
  // POSSIBLE_SEPARATION: one-sided 10% evidence of an increasing trend.
  trendZMin: 1.2816,
});

/**
 * PROVISIONAL screening category from a small N. Never a confirmation.
 * `promise` ranks candidates for confirmation: trend evidence plus a preference
 * for win rates away from 0% and 100%.
 */
export function screeningCategory(ladder, rules = SCREEN_RULES) {
  const wins = ladder.map((p) => p.wins);
  const trials = ladder.map((p) => p.simulations);
  const totalWins = wins.reduce((a, b) => a + b, 0);
  const totalTrials = trials.reduce((a, b) => a + b, 0);
  const z = trendZ(wins, trials);
  let category = "UNCERTAIN";
  if (totalWins <= rules.flatHardMaxWins) category = "FLAT_HARD";
  else if (totalTrials - totalWins <= rules.flatEasyMaxNonWins) category = "FLAT_EASY";
  else if (z >= rules.trendZMin) category = "POSSIBLE_SEPARATION";
  const mean = totalWins / totalTrials;
  const nonExtreme = 1 - Math.abs(2 * mean - 1);
  return {
    category,
    trendZ: r3(z),
    strongMinusWeak: r3(wins[2] / trials[2] - wins[0] / trials[0]),
    promise: r3(Math.max(-3, Math.min(3, z)) + nonExtreme),
  };
}

/** CONFIRMED category, from 95% intervals (Wilson per policy, Newcombe for strong − weak). */
export function confirmedCategory(ladder, thresholds = DEFAULT_THRESHOLDS) {
  const [weak, , strong] = ladder;
  const gap = strong.wins / strong.simulations - weak.wins / weak.simulations;
  const [lo, hi] = differenceInterval(strong.wins, strong.simulations, weak.wins, weak.simulations);
  let category = "UNCERTAIN";
  if (ladder.every((p) => p.winRate95[1] <= thresholds.flatHardUpperMax)) category = "FLAT_HARD";
  else if (ladder.every((p) => p.winRate95[0] >= thresholds.flatEasyLowerMin)) category = "FLAT_EASY";
  else if (lo > 0 && gap >= thresholds.separationMin) category = "SKILL_SEPARATING";
  else if (hi < thresholds.separationMin && lo > -thresholds.separationMin) category = "NON_SEPARATING";
  return {
    category,
    trendZ: r3(trendZ(ladder.map((p) => p.wins), ladder.map((p) => p.simulations))),
    strongMinusWeak: r3(gap),
    strongMinusWeak95: [r3(lo), r3(hi)],
  };
}

/**
 * Shape of the weak→strong profile.
 *
 * provisional  point estimates only — the coarse screening signal.
 * judged       uses the 95% intervals; returns NOISY/UNCERTAIN whenever the
 *              data cannot support a call.
 */
export function classify(profiles, thresholds = DEFAULT_THRESHOLDS) {
  const byPolicy = Object.fromEntries(profiles.map((p) => [p.policy, p]));
  const ladder = ["weak", "medium", "strong"].map((name) => byPolicy[name]).filter(Boolean);
  const rates = ladder.map((p) => p.wins / p.simulations);
  const weak = byPolicy.weak;
  const strong = byPolicy.strong;
  const gap = strong.wins / strong.simulations - weak.wins / weak.simulations;

  let provisional = "NON-SEPARATING";
  if (Math.max(...rates) <= thresholds.flatHardMax) provisional = "FLAT-HARD";
  else if (Math.min(...rates) >= thresholds.flatEasyMin) provisional = "FLAT-EASY";
  else if (gap >= thresholds.separationMin) provisional = "SKILL-SEPARATING";

  const [diffLo, diffHi] = differenceInterval(strong.wins, strong.simulations, weak.wins, weak.simulations);
  let judged = "NOISY/UNCERTAIN";
  if (ladder.every((p) => p.winRate95[1] <= thresholds.flatHardUpperMax)) judged = "FLAT-HARD";
  else if (ladder.every((p) => p.winRate95[0] >= thresholds.flatEasyLowerMin)) judged = "FLAT-EASY";
  else if (diffLo > 0 && gap >= thresholds.separationMin) judged = "SKILL-SEPARATING";
  else if (diffHi < thresholds.separationMin && diffLo > -thresholds.separationMin) judged = "NON-SEPARATING";

  return {
    provisional,
    judged,
    strongMinusWeak: r3(gap),
    strongMinusWeak95: [r3(diffLo), r3(diffHi)],
  };
}
