import type { TurnLog } from "../game";

export const COMPLETED_RULES_VERSION = "eq-lab-840ef0e";

export type HistoricRulesInterpretation = {
  version: string;
  /** Recorded outcomes are facts even if a newer scorer would differ. */
  observedScore: (log: TurnLog) => number;
  /**
   * Re-analysis with the active validator is allowed only for its own rules
   * version. Old games remain replayable/inspectable from recorded outcomes.
   */
  mayUseActiveValidator: boolean;
};

/**
 * Explicit dispatch for completed records. Add a version here before changing
 * live rules; never make an unknown historic label mean today's rules.
 */
export function historicRulesFor(
  version: string,
  activeRulesVersion = COMPLETED_RULES_VERSION,
): HistoricRulesInterpretation {
  switch (version) {
    case COMPLETED_RULES_VERSION:
      return {
        version,
        observedScore: (log) => log.finalScore,
        mayUseActiveValidator: activeRulesVersion === version,
      };
    default:
      throw new Error(`Unknown rules version ${String(version)}.`);
  }
}
