// ── Analysis result cache ────────────────────────────────────────────────────
//
// One job: remember the latest COMPLETED analysis per room, so a panel that
// remounts can offer an answer the engine already produced instead of asking for
// it again. A search costs real server time and a real slice of the player's
// compute budget; recomputing an immutable position is pure waste.
//
// It deliberately no longer remembers what is RUNNING. It used to, and that was
// the bug: the running job's identity — chiefly its analysis level, which cannot
// be derived from the game row — existed nowhere but this map and one tab's
// session storage. Anything that lost the note (a second tab, a reload racing a
// revision check, a mistimed clear) stranded a live search on the server with no
// way for the client to find it, and the only escape was to press Analyze and
// pay again. That question is now the server's to answer: `GET /jobs` reports
// what exists for a position, and `engineSessions` owns the observation.
//
// What is left here is a pure result cache, and it is only ever a hint: the
// server keeps its own TTL'd copy, so losing this costs one round trip.
//
// Nothing sensitive lives here: an AnalysisResult is the engine's read of the
// caller's OWN turn, which the server already authorised sending them. No
// tokens, no opponent rack, no bag.

import type { AnalysisResult } from "./bot/engineApi";

const results = new Map<string, AnalysisResult>();
const STORAGE_PREFIX = "eq-lab:analysis-session:v1:";

type StoredAnalysisSession = { result?: AnalysisResult };

function storageKey(roomId: string): string {
  return `${STORAGE_PREFIX}${roomId}`;
}

function hydrate(roomId: string): void {
  if (results.has(roomId)) return;
  try {
    const raw = window.sessionStorage.getItem(storageKey(roomId));
    if (!raw) return;
    const stored = JSON.parse(raw) as StoredAnalysisSession;
    if (!stored || typeof stored !== "object") throw new Error("Invalid analysis session");
    if (stored.result && typeof stored.result === "object") results.set(roomId, stored.result);
  } catch {
    try {
      window.sessionStorage.removeItem(storageKey(roomId));
    } catch {
      // Storage itself is unavailable.
    }
  }
}

function persist(roomId: string): void {
  try {
    const result = results.get(roomId);
    if (result) {
      window.sessionStorage.setItem(storageKey(roomId), JSON.stringify({ result }));
    } else {
      window.sessionStorage.removeItem(storageKey(roomId));
    }
  } catch {
    // The in-memory cache still works when storage is unavailable.
  }
}

/** Remember the latest completed analysis for a room. */
export function rememberResult(roomId: string, result: AnalysisResult): void {
  hydrate(roomId);
  results.set(roomId, result);
  persist(roomId);
}

/** The latest completed analysis for a room, if one is remembered. The caller
 *  still checks its revision against the live game before trusting it. */
export function getResult(roomId: string): AnalysisResult | undefined {
  hydrate(roomId);
  return results.get(roomId);
}

export function clearResult(roomId: string): void {
  hydrate(roomId);
  results.delete(roomId);
  persist(roomId);
}
