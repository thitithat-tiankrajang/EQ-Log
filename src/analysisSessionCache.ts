// ── Analysis session cache ───────────────────────────────────────────────────
//
// The Analyze panel lives inside the Play component, so navigating away unmounts
// it and React throws its state on the floor. That used to mean a finished
// analysis vanished the moment you left, and a running one had to be started
// over on return. Neither is true of the SERVER any more — a search keeps
// running when its observer leaves, and a completed result is cached — so all
// this module has to do is let a remounted panel find its way back to it.
//
// It holds two things per room, in memory only (never persisted): the latest
// COMPLETED result, so a returning panel can show it without recomputing, and a
// descriptor of an analysis that was IN FLIGHT when the panel unmounted, so a
// returning panel knows to reconnect to it. Both carry the revision they belong
// to; a result or a job for a position the game has left is never shown as
// though it applied to the current one — that check stays the caller's, here we
// only remember.
//
// Nothing sensitive lives here: an AnalysisResult is the engine's read of the
// caller's OWN turn, which the server already authorised sending them. No
// tokens, no opponent rack, no bag.

import type { AnalysisLevel, AnalysisResult } from "./bot/engineApi";

/** An analysis that was running when the panel unmounted, so a remount can
 *  reconnect to the same server job instead of starting a new one. */
export type AnalysisInFlight = { revision: number; level: AnalysisLevel };

const results = new Map<string, AnalysisResult>();
const inflight = new Map<string, AnalysisInFlight>();

/** Remember the latest completed analysis for a room. */
export function rememberResult(roomId: string, result: AnalysisResult): void {
  results.set(roomId, result);
}

/** The latest completed analysis for a room, if one is remembered. The caller
 *  still checks its revision against the live game before trusting it. */
export function getResult(roomId: string): AnalysisResult | undefined {
  return results.get(roomId);
}

export function clearResult(roomId: string): void {
  results.delete(roomId);
}

/** Record that an analysis is in flight, so a remounted panel reconnects to it. */
export function markInFlight(roomId: string, descriptor: AnalysisInFlight): void {
  inflight.set(roomId, descriptor);
}

export function getInFlight(roomId: string): AnalysisInFlight | undefined {
  return inflight.get(roomId);
}

export function clearInFlight(roomId: string): void {
  inflight.delete(roomId);
}
