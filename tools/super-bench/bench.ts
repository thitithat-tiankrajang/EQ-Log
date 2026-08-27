// ── What a full Super move costs on THIS device ──────────────────────────────
//
//   npm run dev  →  http://127.0.0.1:5173/tools/super-bench/
//
// A page rather than a script because the number that matters is a BROWSER
// number. The engine is the same WASM either way, but a browser's JIT tiering,
// its worker boundary and a laptop's thermal behaviour over a multi-minute run
// are not reproduced by running the module under Node — and Node measurably
// disagrees, at roughly 8.7M generation nodes/s against the browser's ~5.7M on
// the same machine. Predicting a player's wait from the faster of those two
// would under-promise every estimate by a third.
//
// It drives the REAL worker (`src/bot/superEngine.ts`), not a copy of it, so a
// run here exercises the same initialise → calibrate → think → cancel path a
// game does.
//
// The `#beat` counter on the page is the UI-responsiveness check, and it is
// deliberately not an assertion: a frozen UI thread is something you see. It is
// driven by requestAnimationFrame, so it stops dead if the search ever lands on
// the UI thread and keeps ticking for as long as the search stays in the worker.
import { calibrate, cancel, initialize, lastInitialisationMs, think } from "../../src/bot/superEngine";
import type { SuperEngineRequest } from "../../src/bot/superTypes";

const out = document.getElementById("out")!;
const beat = document.getElementById("beat")!;
const fpsLabel = document.getElementById("fps")!;

function log(line: string): void {
  out.textContent += `\n${line}`;
}

// ── the UI-thread heartbeat ─────────────────────────────────────────────────
const FRAMES = ["·", "•", "●", "•"];
let frames = 0;
let lastSecond = performance.now();
let fps = 0;
(function tick() {
  frames += 1;
  beat.textContent = FRAMES[Math.floor(frames / 8) % FRAMES.length]!;
  const now = performance.now();
  if (now - lastSecond >= 1000) {
    fps = frames / ((now - lastSecond) / 1000);
    fpsLabel.textContent = `${fps.toFixed(0)} fps`;
    frames = 0;
    lastSecond = now;
  }
  requestAnimationFrame(tick);
})();

/**
 * A mid-game position, hard-coded.
 *
 * Mid-game on purpose: it is where Super is most expensive. An opening rack has
 * few candidates and an endgame hands off to the exact solver, so benchmarking
 * either would price a move the player rarely waits for.
 */
const POSITION: SuperEngineRequest = {
  board: [
    { r: 7, c: 7, kind: "8", token: "8" },
    { r: 7, c: 8, kind: "+", token: "+" },
    { r: 7, c: 9, kind: "9", token: "9" },
    { r: 7, c: 10, kind: "=", token: "=" },
    { r: 7, c: 11, kind: "17", token: "17" },
    { r: 6, c: 9, kind: "4", token: "4" },
    { r: 8, c: 9, kind: "3", token: "3" },
    { r: 9, c: 9, kind: "=", token: "=" },
    { r: 10, c: 9, kind: "12", token: "12" },
  ],
  rack: ["2", "5", "11", "x", "-", "=", "?", "0"],
  bagCount: 46,
  oppRackCount: 8,
  myScore: 74,
  oppScore: 66,
  noScoreStreak: 0,
  exchangeAllowed: true,
  difficulty: "super",
  solver: "sim",
  // The two fields that make this full Super: run to the END of the schedule,
  // and say nothing at all about `sampleCap` so the engine uses all 160
  // samples. A `sampleCap` here would be measuring a different, weaker bot.
  unlimited: true,
  topN: 24,
  seed: 20260827,
};

document.getElementById("init")!.addEventListener("click", () => {
  const started = performance.now();
  initialize();
  // `initialize()` is fire-and-forget; the worker answers with `ready`. Poll for
  // the recorded figure rather than inventing a completion event for a
  // benchmark page.
  const poll = setInterval(() => {
    const ms = lastInitialisationMs();
    if (ms === null) return;
    clearInterval(poll);
    log(
      `WASM init: ${ms} ms (worker clock) / ` +
        `${Math.round(performance.now() - started)} ms including chunk fetch`,
    );
  }, 20);
});

document.getElementById("cal")!.addEventListener("click", async () => {
  log("calibrating…");
  const started = performance.now();
  const result = await calibrate();
  log(
    `calibration: ${Math.round(result.nodesPerSec).toLocaleString()} nodes/s ` +
      `over ${Math.round(result.elapsedMs)} ms engine / ` +
      `${Math.round(performance.now() - started)} ms wall  [${result.benchmark}]`,
  );
});

document.getElementById("full")!.addEventListener("click", async () => {
  log("\nFULL Super — this takes MINUTES. Watch the heartbeat above stay smooth.");
  const started = performance.now();
  let worstFps = Infinity;
  const watch = setInterval(() => {
    if (fps > 0) worstFps = Math.min(worstFps, fps);
  }, 500);
  try {
    const outcome = await think({
      request: POSITION,
      onProgress: (progress) => {
        out.textContent = out.textContent!.replace(/\n {2}\d+% .*$/, "");
        log(`  ${Math.round(progress.percent)}% ${progress.phase}`);
      },
    });
    clearInterval(watch);
    const stats = outcome.response.stats;
    // Three clocks, narrowing. The gap between them is the cost of the worker
    // boundary and the WASM heap copies — worth watching, and at this scale
    // reliably lost in the noise of a multi-minute search.
    log(
      `\nFULL Super: ${((performance.now() - started) / 1000).toFixed(1)}s as the UI thread saw it, ` +
        `${(outcome.wallMs / 1000).toFixed(1)}s in the worker, ` +
        `${(stats.elapsedMs / 1000).toFixed(1)}s in the engine`,
    );
    // The assertion that this was Super and not something cheaper wearing the
    // name. 160 is the compiled schedule; anything less means a cap got in.
    log(
      `samples: ${stats.samples}${stats.samples === 160 ? "  ✓ full schedule" : "  ✗ REDUCED"}`,
    );
    log(`nodes: ${stats.nodes.toLocaleString()}`);
    log(`move: ${outcome.response.type} score=${outcome.response.score}`);
    log(`worst UI frame rate during the search: ${worstFps.toFixed(0)} fps`);
  } catch (failure) {
    clearInterval(watch);
    log(`stopped: ${failure instanceof Error ? failure.message : String(failure)}`);
  }
});

document.getElementById("cancel")!.addEventListener("click", () => {
  cancel();
  log("cancel() — worker terminated");
});
