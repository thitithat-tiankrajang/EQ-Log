/** Trusted Stage generation helper. Never import from browser code. */
import { canonicalFromSnapshot, encodeCanonical } from "../../domain/projection";
import { createSurvivalTestGame } from "./seededGame";

export function stageStartCanonical(seed: number) {
  const canonical = encodeCanonical(
    canonicalFromSnapshot(createSurvivalTestGame(seed, "Player"), 1),
  ) as {
    inventory: unknown[];
    scores: { A: number; B: number };
    activeSide: string;
    turnNumber: number;
    startingSide: string;
  };
  return {
    inventory: canonical.inventory,
    scores: canonical.scores,
    activeSide: canonical.activeSide,
    turnNumber: canonical.turnNumber,
    startingSide: canonical.startingSide,
  };
}
