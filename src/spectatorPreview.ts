import type { GameState } from "./game";
import { revisionOf } from "./gameSync";
import { applyCanonicalToSnapshot } from "./domain/projection";
import type { CanonicalState } from "./domain/canonical";

/** Show a broadcast position immediately without claiming its full room row arrived. */
export function spectatorPreview(
  current: GameState,
  canonical: CanonicalState,
  broadcastRevision: number,
): GameState {
  if (broadcastRevision <= revisionOf(current) || canonical.gameId !== current.gameId) {
    return current;
  }
  // Broadcast omits logs, clocks and match-control. Keeping the old revision
  // lets the room row or reconnect probe fill those fields for this move.
  return applyCanonicalToSnapshot(current, canonical);
}
