// Routing and pipeline status — pure functions, no simulation.
//
// The route is a RESEARCH decision about which evaluation a candidate needs,
// not ground truth about the position:
//
//   TACTICAL   planning gain is low: the fast weak/medium/strong ladder is a
//              reasonable judge.
//   STRATEGIC  planning gain is high: the best two-turn plan starts with a move
//              our fast policies are unlikely to choose, so Authur on the
//              player's side is needed as a planning reference.
//   UNCERTAIN  in between: run both.
//
// Planning gain = bag-blind two-turn value of the best first move minus that of
// the highest-scoring first move (Authur's real reply in between). The
// thresholds are provisional and configurable; calibration so far is small.

export const ROUTES = ["TACTICAL", "UNCERTAIN", "STRATEGIC"];

export const DEFAULT_ROUTING = Object.freeze({
  // Evidence (2026-09-25): confirmed separating candidates had a median planning
  // gain of 6.6; positions Authur won but the fast policies lost had 76–98.
  tacticalMax: 20,
  strategicMin: 60,
});

export function validateRouting(thresholds) {
  const { tacticalMax, strategicMin } = thresholds;
  if (!Number.isFinite(tacticalMax) || !Number.isFinite(strategicMin)) {
    throw new Error("routing thresholds must be numbers");
  }
  if (tacticalMax >= strategicMin) {
    throw new Error(`routing tacticalMax (${tacticalMax}) must be below strategicMin (${strategicMin})`);
  }
  return { tacticalMax, strategicMin };
}

/** Route one candidate from its bag-blind planning gain. Returns the raw value and the reason. */
export function route(planningGainBlind, thresholds = DEFAULT_ROUTING) {
  const { tacticalMax, strategicMin } = validateRouting(thresholds);
  if (planningGainBlind == null || !Number.isFinite(planningGainBlind)) {
    return { route: "UNCERTAIN", planningGainBlind: null, reason: "no planning gain measured: run both evaluations" };
  }
  if (planningGainBlind <= tacticalMax) {
    return { route: "TACTICAL", planningGainBlind, reason: `planningGainBlind ${planningGainBlind} <= tacticalMax ${tacticalMax}` };
  }
  if (planningGainBlind >= strategicMin) {
    return { route: "STRATEGIC", planningGainBlind, reason: `planningGainBlind ${planningGainBlind} >= strategicMin ${strategicMin}` };
  }
  return {
    route: "UNCERTAIN",
    planningGainBlind,
    reason: `tacticalMax ${tacticalMax} < planningGainBlind ${planningGainBlind} < strategicMin ${strategicMin}`,
  };
}

export const STATUSES = [
  "SCREENED",
  "TACTICAL_CONFIRMED",
  "STRATEGIC_CONFIRMED",
  "BOTH_CONFIRMED",
  "UNCONFIRMED",
  "TIMING_LIMITED",
];

/**
 * Research status from what each evaluation reached. NOT a publication status.
 *
 *   tactical   null (not run) | "screened" (small N only, not promoted)
 *              | "confirmed" (full N, a definite category) | "unconfirmed"
 *   strategic  null (not run) | "confirmed" (enough clean reference games)
 *              | "timing_limited" (too few clean games after the fixed attempts)
 */
export function pipelineStatus(routeName, tactical, strategic) {
  const tConfirmed = tactical === "confirmed";
  const sConfirmed = strategic === "confirmed";
  if (tConfirmed && sConfirmed) return "BOTH_CONFIRMED";
  if (routeName === "TACTICAL") {
    if (tConfirmed) return "TACTICAL_CONFIRMED";
    return tactical === "screened" ? "SCREENED" : "UNCONFIRMED";
  }
  if (routeName === "STRATEGIC") {
    if (sConfirmed) return "STRATEGIC_CONFIRMED";
    return strategic === "timing_limited" ? "TIMING_LIMITED" : "UNCONFIRMED";
  }
  // UNCERTAIN: both evaluations ran.
  if (tConfirmed) return "TACTICAL_CONFIRMED";
  if (sConfirmed) return "STRATEGIC_CONFIRMED";
  if (strategic === "timing_limited") return "TIMING_LIMITED";
  if (tactical === "screened") return "SCREENED";
  return "UNCONFIRMED";
}
