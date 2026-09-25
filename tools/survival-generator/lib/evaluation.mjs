// Research outcomes for the candidate pipeline — pure functions, no simulation.
// Raw counts always travel next to every rate.
//
//   features    cheap, per snapshot: deficit, bag, legal moves, best immediate
//               score, Authur's immediate threat, firepower.
//   prefilter   PROVISIONAL research filters for the extremes only. A rejected
//               snapshot is recorded with every reason, never dropped silently.
//   ranking     orders snapshots for the expensive stages. It never says a
//               position is survivable.
//   tactical    weak / medium / strong screening at a small N, then the full N
//               for promising candidates only.
//   strategic   weak / medium as a human-scale FLOOR, plus Authur playing the
//               player's side as a planning / UPPER reference — never an
//               estimate of a human's chance.
//
// Timing: a game in which any Authur decision came back from the exact
// endgame's own 60 s wall clock (not exact) is timing-affected. It is flagged,
// kept in the raw counts, and never counted towards a confirmation.
import { createHash } from "node:crypto";
import { POLICY_VARIANTS } from "./policies.mjs";
import { differenceInterval, r1, r3, wilson } from "./stats.mjs";
import { confirmedCategory, screeningCategory, summarizePolicy } from "./summary.mjs";

export const EVALUATION_VERSION = "evaluation-v1";
export const LADDER = Object.freeze(["weak", "medium", "strong"]);
export const FLOOR = Object.freeze(["weak", "medium"]);

// ── features and the provisional prefilter ───────────────────────────────────
export const DEFAULT_PREFILTER = Object.freeze({
  version: "prefilter-provisional-v1",
  provisional: true,
  // Landscape 2026-09-25: all 3 snapshots with < 50 starting legal placements were FLAT_HARD.
  rejectLegalBelow: 50,
  // Opportunity search 2026-09-25: no recovery seen from 300+ behind; the best
  // two-turn swing still left the player 150+ behind.
  rejectDeficitAtLeast: 300,
});

export const DEFAULT_CHEAP_RANK = Object.freeze({
  formula: "firepower - deficitWeight * deficit",
  // Best of three forms on the 36 landscape candidates (Spearman 0.64 with the
  // mean weak/medium/strong win rate); a ranking weight, not a model.
  deficitWeight: 0.5,
});

/** Cheap features of one snapshot: its source facts plus `opportunity` without look-ahead. */
export function cheapFeatures(facts, cheap, deficitWeight = DEFAULT_CHEAP_RANK.deficitWeight) {
  const deficit = -facts.gap;
  const firepower = cheap.rack.best - cheap.threat.best;
  return {
    deficit,
    bagRemaining: facts.bag,
    legalPlacements: facts.legalPlaces,
    legalExchanges: facts.legalExchanges,
    bestImmediateScore: cheap.rack.best,
    // Authur's best score on this board with Authur's REAL rack: hidden from the player.
    authurImmediateThreat: cheap.threat.best,
    firepower,
    cheapRankScore: r1(firepower - deficitWeight * deficit),
  };
}

/** Every provisional prefilter a snapshot fails (empty = passes). */
export function prefilterReasons(features, prefilter = DEFAULT_PREFILTER) {
  const reasons = [];
  if (prefilter.rejectLegalBelow != null && features.legalPlacements < prefilter.rejectLegalBelow) {
    reasons.push(`PROVISIONAL legal placements ${features.legalPlacements} < ${prefilter.rejectLegalBelow}`);
  }
  if (prefilter.rejectDeficitAtLeast != null && features.deficit >= prefilter.rejectDeficitAtLeast) {
    reasons.push(`PROVISIONAL deficit ${features.deficit} >= ${prefilter.rejectDeficitAtLeast}`);
  }
  return reasons;
}

// ── opportunity ranking ──────────────────────────────────────────────────────
export const RANK_KEYS = Object.freeze(["exactSwingMinusDeficit", "bagBlindSwingMinusDeficit", "meanSwingMinusDeficit"]);

/**
 * The two-turn look-ahead as ranking metrics. "Swing" is the change in
 * (player − Authur) over the player's move, Authur's real reply and the
 * player's best next score; "exact" draws from the fixed bag, "bag-blind"
 * resamples those draws from the tiles the player cannot see.
 */
export function opportunityMetrics(result) {
  const f = result?.future;
  if (!f) return null;
  return {
    exactTwoTurnSwing: f.futureOpportunityCompatibility,
    bagBlindTwoTurnSwing: f.bagBlindTwoTurn,
    exactSwingMinusDeficit: r1(f.futureOpportunityCompatibility - result.deficit),
    bagBlindSwingMinusDeficit: r1(f.bagBlindTwoTurn - result.deficit),
    meanSwingMinusDeficit: r1((f.futureOpportunityCompatibility + f.bagBlindTwoTurn) / 2 - result.deficit),
    seedLift: f.seedLift,
    planningGainBlind: f.planningGainBlind,
    planningGainExact: f.planningGainExact,
    greedyExact: f.greedyExact,
    greedyBlind: f.greedyBlind,
    firstMovesExamined: f.candidates,
    timingAffectedReplies: f.timingAffectedReplies ?? 0,
  };
}

/**
 * The fixed top `count` by `score` (higher first, ties by id), at most
 * `perGame` from one source game and never two within `minTurnGap` plies of
 * each other. Every item gets its rank and, if not taken, why.
 */
export function selectTop(items, { count, perGame, minTurnGap, score }) {
  const value = (item) => {
    const v = score(item);
    return v == null || Number.isNaN(v) ? -Infinity : v;
  };
  const order = [...items].sort((a, b) => value(b) - value(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byGame = new Map();
  const taken = [];
  const decisions = order.map((item, index) => {
    const decision = { id: item.id, rank: index + 1, score: value(item) === -Infinity ? null : value(item), taken: false, reason: null };
    const same = byGame.get(item.sourceSeed) ?? [];
    if (taken.length >= count) decision.reason = `outside the top ${count}`;
    else if (value(item) === -Infinity) decision.reason = "no ranking value";
    else if (same.length >= perGame) decision.reason = `already ${perGame} from source game ${item.sourceSeed}`;
    else if (same.some((t) => Math.abs(t.turn - item.turn) < minTurnGap)) decision.reason = `within ${minTurnGap} plies of a taken snapshot`;
    else {
      decision.taken = true;
      same.push(item);
      byGame.set(item.sourceSeed, same);
      taken.push(item);
    }
    return decision;
  });
  return { taken, decisions };
}

// ── games ────────────────────────────────────────────────────────────────────
export function seedKeyOf(levelKey, policy, sim) {
  if (policy === "authur") return `${levelKey}|reference|${sim}`;
  return `${levelKey}|${POLICY_VARIANTS[policy].spec}|${sim}`;
}

/** Identity of a game's move sequence: equal hashes = the very same game. */
export const actionsHash = (playout) =>
  createHash("sha256").update(playout.actions.map((a) => `${a.side}${a.turn}:${a.id}`).join("|")).digest("hex");

/** One simulated game, as stored: seeds and results, never the moves. */
export function gameRecord(playout, levelKey, player) {
  const authur = player === "A" ? "B" : "A";
  return {
    stage: playout.stage,
    policy: playout.policy,
    sim: playout.sim,
    seedKey: seedKeyOf(levelKey, playout.policy, playout.sim),
    outcome: playout.outcome,
    margin: playout.margin,
    scores: { player: playout.scores[player], authur: playout.scores[authur] },
    end: playout.end,
    endBag: playout.endBag,
    turns: playout.turns,
    timingAffected: playout.timingAffected,
    actionsSha256: actionsHash(playout),
    cpuMs: Math.round(playout.cpuMs),
  };
}

// ── tactical ─────────────────────────────────────────────────────────────────
export const PROMOTION_RULE = "screening POSSIBLE_SEPARATION, or UNCERTAIN with trendZ > 0";

export function isPromising(category) {
  return category.category === "POSSIBLE_SEPARATION" || (category.category === "UNCERTAIN" && category.trendZ > 0);
}

function ladderOf(runs, sims) {
  const profiles = Object.fromEntries(
    LADDER.map((policy) => [policy, summarizePolicy(runs.filter((p) => p.policy === policy && p.sim < sims), policy)]),
  );
  const ladder = LADDER.map((policy) => profiles[policy]);
  const cleanLadder = ladder.map((p) => {
    const { wins, simulations } = p.excludingTimingAffected;
    return { ...p, wins, simulations, winRate95: wilson(wins, simulations).map(r3) };
  });
  const complete = ladder.every((p) => p.simulations === sims);
  return { profiles, ladder, cleanLadder, complete };
}

/** Screening category after the small N. */
export function screen(runs, screenSims) {
  const { profiles, ladder, complete } = ladderOf(runs, screenSims);
  return { sims: screenSims, complete, profiles, category: screeningCategory(ladder) };
}

/**
 * Tactical outcome. `confirmed` means the full-N data support a definite
 * category (not UNCERTAIN) that stays the same with every timing-affected game
 * removed — a statement about the measurement, not about the level's quality.
 */
export function tacticalEvaluation(runs, { screenSims, confirmSims }, promoted) {
  const screening = screen(runs, screenSims);
  const result = { screening, promotionRule: PROMOTION_RULE, promoted, confirmation: null };
  if (!screening.complete) {
    return { ...result, outcome: "unconfirmed", reason: "screening games missing (worker errors)" };
  }
  if (!promoted) {
    return {
      ...result,
      outcome: "screened",
      reason: `screening ${screening.category.category} (trendZ ${screening.category.trendZ}) at N=${screenSims}: not promoted`,
    };
  }
  const full = ladderOf(runs, confirmSims);
  const category = confirmedCategory(full.ladder);
  const clean = full.cleanLadder.some((p) => p.simulations === 0)
    ? { category: "UNCERTAIN" }
    : confirmedCategory(full.cleanLadder);
  const timingAffectedGames = full.ladder.reduce((s, p) => s + p.timingAffectedGames, 0);
  const confirmation = {
    sims: confirmSims,
    complete: full.complete,
    profiles: full.profiles,
    category,
    categoryExcludingTimingAffected: clean,
    timingAffectedGames,
  };
  let outcome = "confirmed";
  let reason = `${category.category} at N=${confirmSims}, unchanged without the ${timingAffectedGames} timing-affected games`;
  if (!full.complete) {
    outcome = "unconfirmed";
    reason = "confirmation games missing (worker errors)";
  } else if (category.category === "UNCERTAIN") {
    outcome = "unconfirmed";
    reason = `N=${confirmSims} intervals support no definite category`;
  } else if (clean.category !== category.category) {
    outcome = "unconfirmed";
    reason = `category ${category.category} becomes ${clean.category} without the ${timingAffectedGames} timing-affected games`;
  }
  return { ...result, confirmation, outcome, reason };
}

// ── strategic ────────────────────────────────────────────────────────────────
/**
 * Strategic outcome from a FIXED number of reference attempts: `confirmed` once
 * at least `minCleanReference` of them are clean, otherwise `timing_limited`.
 * Attempts are never added because some came back timing-affected.
 */
export function strategicEvaluation(runs, { referenceAttempts, minCleanReference }) {
  const floor = Object.fromEntries(
    FLOOR.map((policy) => [policy, summarizePolicy(runs.filter((p) => p.policy === policy), policy)]),
  );
  const refRuns = runs.filter((p) => p.policy === "authur" && p.sim < referenceAttempts);
  const reference = summarizePolicy(refRuns, "authur");
  const cleanRuns = refRuns.filter((p) => !p.timingAffected);
  const clean = reference.excludingTimingAffected;
  const distinct = {
    all: new Set(refRuns.map(actionsHash)).size,
    clean: new Set(cleanRuns.map(actionsHash)).size,
  };
  const base = {
    floor,
    reference,
    referenceAttempts,
    referenceCompleted: refRuns.length,
    minCleanReference,
    cleanReferenceGames: clean.simulations,
    // Different seeds can still give the same game; this many were different.
    distinctReferenceGames: distinct,
    role: "Authur on the player's side: a planning / upper reference, not a human win probability",
  };
  if (refRuns.length < referenceAttempts) {
    return { ...base, outcome: "unconfirmed", category: null, reason: "reference games missing (worker errors)" };
  }
  if (clean.simulations < minCleanReference) {
    return {
      ...base,
      outcome: "timing_limited",
      category: null,
      reason: `${clean.simulations} clean reference games of ${referenceAttempts} attempts (< ${minCleanReference}); ${refRuns.length - clean.simulations} hit the 60 s endgame clock`,
    };
  }
  const medium = floor.medium;
  const [lo, hi] = differenceInterval(clean.wins, clean.simulations, medium.wins, medium.simulations);
  const gap = clean.wins / clean.simulations - medium.wins / medium.simulations;
  let category = "UNCERTAIN";
  if (clean.wins === 0) category = "REFERENCE_CANNOT_WIN";
  else if (lo > 0) category = "REFERENCE_ABOVE_FLOOR";
  else if (clean.wins === clean.simulations && FLOOR.every((p) => floor[p].wins === floor[p].simulations)) category = "FLAT_EASY";
  return {
    ...base,
    outcome: "confirmed",
    category,
    referenceCleanWinRate95: wilson(clean.wins, clean.simulations).map(r3),
    referenceMinusMedium: r3(gap),
    referenceMinusMedium95: [r3(lo), r3(hi)],
    reason: `${clean.simulations} clean reference games (>= ${minCleanReference}): ${clean.wins}W ${clean.ties}T ${clean.losses}L`,
  };
}
