// ── TEMPORARY: engine session lifecycle probe ────────────────────────────────
//
// Here to answer one question that static reading has not been able to settle:
// when a player presses Analyze, switches to another tab, and comes back, WHY is
// the session gone from the store while the server is still working on it?
//
// Two theories have already been killed by evidence: discovery does not destroy
// sessions, and the revision cannot advance without a committed move. So the
// next step is to watch the real thing rather than reason about it.
//
// Off by default and free when off. Turn it on with `?enginedebug=1`, which
// persists for the session so a reload or a navigation does not lose the run.
//
// **It records session keys, revisions and status names.** No tokens, no board,
// no rack, no player identity.
//
// DELETE THIS FILE once the bug is understood. Every call site is tagged
// `engineDebug.` so `grep -rn "engineDebug" src/` finds all of them.

const STORAGE_KEY = "eq-lab:engine-debug";

function enabledFromEnvironment(): boolean {
  try {
    const flag = new URLSearchParams(window.location.search).get("enginedebug");
    if (flag === "1") {
      window.sessionStorage.setItem(STORAGE_KEY, "1");
      return true;
    }
    if (flag === "0") {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return false;
    }
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export const isEngineDebugging = enabledFromEnvironment();

type Entry = { at: string; sinceStart: number; event: string; detail: Record<string, unknown> };

const log: Entry[] = [];
const startedAt = Date.now();

/**
 * Record one lifecycle event.
 *
 * Kept in a ring buffer as well as printed, because the interesting window here
 * spans a tab switch — and a console the player has not opened yet keeps nothing.
 * `copy(window.__eqDebug())` after reproducing gets the whole run out.
 */
export function note(event: string, detail: Record<string, unknown> = {}): void {
  if (!isEngineDebugging) return;
  const now = Date.now();
  const entry: Entry = {
    at: new Date(now).toISOString().slice(11, 23),
    sinceStart: now - startedAt,
    event,
    detail,
  };
  log.push(entry);
  if (log.length > 500) log.shift();
  console.log(`[eq-debug ${entry.at}] ${event}`, detail);
}

if (isEngineDebugging) {
  (window as unknown as { __eqDebug: () => string }).__eqDebug = () => JSON.stringify(log, null, 2);
  // Visibility is the axis the whole bug lives on, so it is recorded here rather
  // than left to the app's own wake handling — this fires even if that does not.
  document.addEventListener("visibilitychange", () =>
    note("visibility", { state: document.visibilityState }),
  );
  window.addEventListener("focus", () => note("window.focus"));
  window.addEventListener("blur", () => note("window.blur"));
  window.addEventListener("online", () => note("online"));
  window.addEventListener("offline", () => note("offline"));
  window.addEventListener("pageshow", (event) =>
    note("pageshow", { persisted: (event as PageTransitionEvent).persisted }),
  );
  window.addEventListener("pagehide", () => note("pagehide"));
  window.addEventListener("freeze", () => note("freeze"));
  window.addEventListener("resume", () => note("resume"));
  note("probe_installed", { url: window.location.hash });
}
