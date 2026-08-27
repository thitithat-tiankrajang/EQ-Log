// ── In-page performance harness ──────────────────────────────────────────────
//
// Installed via page.addInitScript BEFORE the app boots so it can register a
// React devtools hook shim: React only reports commits if the hook exists at the
// moment the renderer injects itself.
//
// What it records is deliberately framework-level and objective:
//   • React commit count per interaction
//   • the SYNCHRONOUS cost of the click — handler plus React's discrete render,
//     which is exactly the work that blocks the next input and the next frame
//   • Long Animation Frames, with script attribution
//   • dropped frames during a rapid burst of input
//
// It never changes app behaviour; the hook shim only counts.

export const HARNESS = `
(() => {
  const S = { commits: 0, loaf: [], samples: [], events: [], t0: 0, label: 'x' };

  const renderers = new Map();
  let uid = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers, supportsFiber: true,
    checkDCE() {}, inject(r) { const id = ++uid; renderers.set(id, r); return id; },
    onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    onCommitFiberRoot() { S.commits += 1; },
  };

  // React 19 delegates events to the root container, which is a DESCENDANT of
  // document. So a capture listener on document runs BEFORE React's handler and
  // a bubble listener on document runs AFTER it. Discrete events (click) are
  // flushed synchronously, so the span between the two is handler + render +
  // commit: exactly the work that blocks the next input and the next frame.
  let commitsAtStart = 0;
  document.addEventListener('click', () => {
    S.t0 = performance.now();
    commitsAtStart = S.commits;
  }, true);
  document.addEventListener('click', () => {
    const ms = performance.now() - S.t0;
    S.samples.push({ label: S.label, ms: +ms.toFixed(2), commits: S.commits - commitsAtStart });
  }, false);

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        S.loaf.push({
          dur: +e.duration.toFixed(1),
          blocking: +e.blockingDuration.toFixed(1),
          scripts: (e.scripts || [])
            .map((s) => ({ dur: +s.duration.toFixed(1), fn: s.sourceFunctionName || s.invoker || '?' }))
            .filter((s) => s.dur >= 5),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch {}

  // Event Timing reports any interaction whose click-to-next-paint exceeds 16ms.
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.name !== 'click') continue;
        S.events.push({
          inputDelay: +(e.processingStart - e.startTime).toFixed(1),
          processing: +(e.processingEnd - e.processingStart).toFixed(1),
          presentation: +(e.startTime + e.duration - e.processingEnd).toFixed(1),
          total: +e.duration.toFixed(1),
        });
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  } catch {}

  window.__EQPERF = {
    S,
    mark(label) { S.label = label; },
    reset() { S.commits = 0; S.loaf.length = 0; S.samples.length = 0; S.events.length = 0; },
    stats(label) {
      const rows = label ? S.samples.filter((s) => s.label === label) : S.samples;
      const a = rows.map((r) => r.ms).sort((x, y) => x - y);
      const q = (p) => (a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(2) : 0);
      return {
        n: a.length, p50: q(0.5), p95: q(0.95), max: q(1),
        mean: +(a.reduce((s, x) => s + x, 0) / (a.length || 1)).toFixed(2),
        commitsPerClick: +(rows.reduce((s, r) => s + r.commits, 0) / (rows.length || 1)).toFixed(2),
      };
    },
    eventStats() {
      const a = S.events.map((e) => e.total).sort((x, y) => x - y);
      return {
        slowInteractions: a.length,
        worst: a.length ? a[a.length - 1] : 0,
        p95: a.length ? a[Math.floor(a.length * 0.95)] : 0,
        worstProcessing: S.events.reduce((m, e) => Math.max(m, e.processing), 0),
      };
    },
    /**
     * What the app costs while the player is just thinking.
     *
     * The clock rewrites the game object once a second, and every one of those
     * ticks used to redraw the entire tree — a 225-cell board included. Nobody
     * clicks anything here: whatever this finds is work the app does to itself.
     */
    async idle(seconds) {
      const c0 = S.commits;
      const loaf0 = S.loaf.length;
      const gaps = [];
      let last = performance.now();
      let stop = false;
      const tick = (t) => { gaps.push(t - last); last = t; if (!stop) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      stop = true;
      const frames = S.loaf.slice(loaf0);
      gaps.sort((a, b) => a - b);
      const worstFrame = frames.reduce((m, x) => (!m || x.dur > m.dur ? x : m), null);
      return {
        worstScripts: worstFrame
          ? worstFrame.scripts.map((s) => s.fn + '=' + s.dur + 'ms').join(', ')
          : '',
        seconds,
        commits: S.commits - c0,
        loafFrames: frames.length,
        loafBlocking: +frames.reduce((s, x) => s + x.blocking, 0).toFixed(0),
        loafWorst: frames.reduce((m, x) => Math.max(m, x.dur), 0),
        frameGapP95: +(gaps[Math.floor(gaps.length * 0.95)] || 0).toFixed(1),
        frameGapMax: +(gaps[gaps.length - 1] || 0).toFixed(1),
      };
    },
    loafSummary() {
      const byFn = {};
      for (const f of S.loaf) for (const s of f.scripts) byFn[s.fn] = +((byFn[s.fn] || 0) + s.dur).toFixed(1);
      return {
        frames: S.loaf.length,
        blocking: +S.loaf.reduce((s, x) => s + x.blocking, 0).toFixed(0),
        worst: S.loaf.reduce((m, x) => Math.max(m, x.dur), 0),
        byFn: Object.entries(byFn).sort((x, y) => y[1] - x[1]).slice(0, 6),
      };
    },
  };
})();
`;

/** A structurally real mid-game state.
 *
 *  The board is built by MOVING tiles out of the tilebag, never by inventing
 *  them: the app validates every loaded game against the physical 100-tile set
 *  (`inventoryFrom`), and a fabricated tile id makes it refuse to open the room.
 *  TurnLogs carry the two board snapshots and two tilebags the real ones carry,
 *  which is the whole point of the fixture. */
export const SEED_FN = `
function seedGame(base, turns, filled) {
  const g = JSON.parse(JSON.stringify(base));
  // Deal side A a rack of PLAIN tiles. '+/-', 'x//' and '?' must be given a value
  // before they can be placed, which opens the assignment dialog instead of
  // moving the tile — a different interaction from the one being measured, and
  // one that would make the benchmark depend on a random deal.
  const NEEDS_VALUE = ['+/-', 'x//', '?'];
  const pool = g.tilebag.concat(g.rackA);
  const rack = pool.filter((t) => NEEDS_VALUE.indexOf(t.token) === -1).slice(0, 8);
  const taken = new Set(rack.map((t) => t.id));
  const bag = pool.filter((t) => !taken.has(t.id));
  g.rackA = rack;
  const board = Array.from({ length: 15 }, () => Array(15).fill(null));
  const cells = [];
  for (let r = 0; r < 15; r++)
    for (let c = 0; c < 15; c++)
      if (r !== 7 && (r * 15 + c) % 2 === 1) cells.push([r, c]);
  const take = Math.min(filled, bag.length, cells.length);
  for (let i = 0; i < take; i++) {
    const [r, c] = cells[i];
    board[r][c] = { tile: bag.shift(), placedTurn: Math.floor(i / 6) + 1, side: i % 2 ? 'B' : 'A' };
  }
  // Row 7 is deliberately left empty so the benchmark always has placeable cells.
  const snapshotAt = (n) => {
    const b = Array.from({ length: 15 }, () => Array(15).fill(null));
    for (let i = 0; i < n && i < take; i++) { const [r, c] = cells[i]; b[r][c] = board[r][c]; }
    return b;
  };
  g.logs = Array.from({ length: turns }, (_, i) => ({
    id: 'log-' + i, turnNumber: i + 1, side: i % 2 ? 'B' : 'A', action: 'place_equation',
    startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:10.000Z',
    timerBefore: { A: 1320, B: 1320 }, timerAfter: { A: 1310, B: 1320 },
    rackBefore: g.rackA, rackAfter: g.rackA,
    boardBefore: snapshotAt(Math.round(take * i / (turns || 1))),
    boardAfter: snapshotAt(Math.round(take * (i + 1) / (turns || 1))),
    tilebagBefore: bag.slice(i), tilebagAfter: bag.slice(i + 1),
    actionDetail: {
      placedTiles: (g.rackA || []).slice(0, 3).map((t, k) => ({
        tileId: t.id, token: t.token, displayToken: t.token, row: 7, col: k,
      })),
      equationsDetected: [], isMoveValid: true, errors: [],
    },
    calculatedScore: 12, finalScore: 12,
  }));
  g.board = board;
  g.tilebag = bag;
  g.turnNumber = turns + 1;
  g.phase = 'choose_action';
  g.activeSide = 'A';
  g.status = 'playing';
  g.historyIndex = 0;
  g.history = [];
  // The captured base carries a clock that has already been running. Reset it,
  // or advanceRunningClock floors the active side at minSeconds on load and the
  // position comes up read-only — which would measure a board nobody can touch.
  g.timers = { ...g.timers, A: g.timers.initialSeconds, B: g.timers.initialSeconds, paused: false };
  g.currentTurnStartedAt = new Date().toISOString();
  g.lastSavedAt = new Date().toISOString();
  return g;
}
`;
