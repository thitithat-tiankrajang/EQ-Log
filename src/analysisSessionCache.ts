// ── Analysis session cache ───────────────────────────────────────────────────
//
// The Analyze panel lives inside the Play component, so navigating away unmounts
// it and React throws its state on the floor. That used to mean a finished
// analysis vanished the moment you left, and a running one had to be started
// over on return. Neither is true of the SERVER any more — a search keeps
// running when its observer leaves, and a completed result is cached — so all
// this module has to do is let a remounted panel find its way back to it.
//
// It holds two things per room: the latest COMPLETED result, so a returning
// panel can show it without recomputing, and a descriptor of an analysis that
// was IN FLIGHT when the panel unmounted, so a returning panel knows to
// reconnect to it. Both are mirrored to this tab's sessionStorage because
// mobile browsers may discard the entire JS heap while backgrounded. Both also
// carry the revision they belong to; a result or a job for a position the game
// has left is never shown as though it applied to the current one — that check
// stays the caller's, here we only remember.
//
// Nothing sensitive lives here: an AnalysisResult is the engine's read of the
// caller's OWN turn, which the server already authorised sending them. No
// tokens, no opponent rack, no bag.

import type { AnalysisLevel, AnalysisResult, EngineProgress } from "./bot/engineApi";

/** An analysis that was running when the panel unmounted, so a remount can
 *  reconnect to the same server job instead of starting a new one. */
export type AnalysisInFlight = {
  revision: number;
  level: AnalysisLevel;
  /** Last server-reported progress, persisted so a refresh does not erase the
   * visible percentage while the new page reconnects to the same job. */
  progress?: EngineProgress;
};

const results = new Map<string, AnalysisResult>();
const inflight = new Map<string, AnalysisInFlight>();
const STORAGE_PREFIX = "eq-lab:analysis-session:v1:";
const LEVELS = new Set<AnalysisLevel>(["quick", "normal", "deep", "max"]);

type StoredAnalysisSession = {
  result?: AnalysisResult;
  inflight?: AnalysisInFlight;
};

function storageKey(roomId: string): string {
  return `${STORAGE_PREFIX}${roomId}`;
}

function isProgress(value: unknown): value is EngineProgress {
  if (!value || typeof value !== "object") return false;
  const progress = value as Partial<EngineProgress>;
  return (
    (progress.phase === "movegen" || progress.phase === "sim" || progress.phase === "endgame") &&
    typeof progress.percent === "number" &&
    Number.isFinite(progress.percent) &&
    typeof progress.elapsedMs === "number" &&
    typeof progress.etaMs === "number" &&
    typeof progress.detail === "string"
  );
}

function hydrate(roomId: string): void {
  if (results.has(roomId) || inflight.has(roomId)) return;
  try {
    const raw = window.sessionStorage.getItem(storageKey(roomId));
    if (!raw) return;
    const stored = JSON.parse(raw) as StoredAnalysisSession;
    if (!stored || typeof stored !== "object") throw new Error("Invalid analysis session");
    if (stored.result && typeof stored.result === "object") results.set(roomId, stored.result);
    if (
      stored.inflight &&
      Number.isInteger(stored.inflight.revision) &&
      LEVELS.has(stored.inflight.level) &&
      (stored.inflight.progress === undefined || isProgress(stored.inflight.progress))
    ) {
      inflight.set(roomId, stored.inflight);
    }
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
    const stored: StoredAnalysisSession = {};
    const result = results.get(roomId);
    const pending = inflight.get(roomId);
    if (result) stored.result = result;
    if (pending) stored.inflight = pending;
    if (result || pending) {
      window.sessionStorage.setItem(storageKey(roomId), JSON.stringify(stored));
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

/** Record that an analysis is in flight, so a remounted panel reconnects to it. */
export function markInFlight(roomId: string, descriptor: AnalysisInFlight): void {
  hydrate(roomId);
  inflight.set(roomId, descriptor);
  persist(roomId);
}

export function getInFlight(roomId: string): AnalysisInFlight | undefined {
  hydrate(roomId);
  return inflight.get(roomId);
}

export function rememberProgress(roomId: string, progress: EngineProgress): void {
  hydrate(roomId);
  const pending = inflight.get(roomId);
  if (!pending) return;
  inflight.set(roomId, { ...pending, progress });
  persist(roomId);
}

export function clearInFlight(roomId: string): void {
  hydrate(roomId);
  inflight.delete(roomId);
  persist(roomId);
}
