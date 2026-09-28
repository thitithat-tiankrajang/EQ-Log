// The ArchBot browser harness. Runs ArchBot exactly as the app does — the same
// engine factory, worker and model — and reports what a page can measure about
// it: the decision's digest (for parity), wall time, model load time, how
// responsive the page's own thread stayed while the worker searched, and memory
// where the browser will say.
import { createArchBotEngine } from "../../../src/bot/archbot/client";
import type { ArchBotDecision, ArchBotRequest } from "../../../src/bot/archbot/decide";
import type { ArchBotEngine, ArchBotPhase } from "../../../src/bot/archbot/engine";

type Responsiveness = { maxFrameGapMs: number; frames: number; maxTimerLagMs: number };

async function digestOf(decision: ArchBotDecision): Promise<string> {
  const answer = JSON.parse(JSON.stringify(decision)) as ArchBotDecision;
  const stats: Partial<ArchBotDecision["stats"]> = { ...answer.stats };
  delete stats.elapsedMs;
  const bytes = new TextEncoder().encode(JSON.stringify({ ...answer, stats }));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Watch the page's own thread: animation frames and a 16 ms timer. */
function watchMainThread(): () => Responsiveness {
  let running = true;
  let lastFrame = performance.now();
  let maxFrameGapMs = 0;
  let frames = 0;
  const frame = (now: number) => {
    if (!running) return;
    maxFrameGapMs = Math.max(maxFrameGapMs, now - lastFrame);
    lastFrame = now;
    frames += 1;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  let maxTimerLagMs = 0;
  let expected = performance.now() + 16;
  const timer = setInterval(() => {
    const now = performance.now();
    maxTimerLagMs = Math.max(maxTimerLagMs, now - expected);
    expected = now + 16;
  }, 16);
  return () => {
    running = false;
    clearInterval(timer);
    return { maxFrameGapMs, frames, maxTimerLagMs };
  };
}

let engine: ArchBotEngine = createArchBotEngine();
let revision = 0;

async function memory() {
  const detail = performance as Performance & {
    memory?: { usedJSHeapSize: number };
    measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
  };
  let userAgentBytes: number | null = null;
  if (crossOriginIsolated && detail.measureUserAgentSpecificMemory) {
    try {
      userAgentBytes = (await detail.measureUserAgentSpecificMemory()).bytes;
    } catch {
      userAgentBytes = null;
    }
  }
  return { pageHeapBytes: detail.memory?.usedJSHeapSize ?? null, userAgentBytes };
}

const api = {
  crossOriginIsolated,
  /** Replace the engine: a new worker, and so a new model load. */
  reset() {
    engine.dispose();
    engine = createArchBotEngine();
  },
  async decide(request: ArchBotRequest, options: { cancelAfterMs?: number; full?: boolean } = {}) {
    const phases: Array<{ phase: ArchBotPhase; at: number }> = [];
    const started = performance.now();
    const stop = watchMainThread();
    const controller = new AbortController();
    if (options.cancelAfterMs != null) setTimeout(() => controller.abort(), options.cancelAfterMs);
    try {
      const answer = await engine.decide({
        key: { roomId: "bench", revision: (revision += 1) },
        request,
        signal: controller.signal,
        onPhase: (phase) => phases.push({ phase, at: performance.now() - started }),
      });
      const responsiveness = stop();
      return {
        ok: true as const,
        ...(options.full ? { decision: JSON.parse(JSON.stringify(answer.decision)) } : {}),
        digest: await digestOf(answer.decision),
        move: {
          type: answer.decision.type,
          placements: answer.decision.placements,
          exchange: answer.decision.exchange,
          score: answer.decision.score,
        },
        equity: answer.decision.equity,
        legalMoves: answer.decision.stats.moves,
        wallMs: answer.wallMs,
        modelMs: answer.modelMs,
        totalMs: performance.now() - started,
        phases,
        responsiveness,
      };
    } catch (error) {
      const responsiveness = stop();
      const failure = error as { code?: string; modelCode?: string; message?: string };
      return {
        ok: false as const,
        code: failure.code ?? "unknown",
        modelCode: failure.modelCode ?? null,
        message: failure.message ?? String(error),
        totalMs: performance.now() - started,
        responsiveness,
      };
    }
  },
  memory,
};

(window as unknown as { archbot: typeof api }).archbot = api;
document.getElementById("status")!.textContent = "ready";
