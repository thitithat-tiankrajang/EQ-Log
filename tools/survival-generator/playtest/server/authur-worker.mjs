// Authur on its own thread, so a long search (an exact endgame can take its
// full 60 s) never stalls the page server. The same bundle, models and offline
// config the generator used (lib/authur.mjs).
import { parentPort, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { loadAuthur } from "../../lib/authur.mjs";

const authur = await loadAuthur(workerData?.authurDir);
const cpu = () => {
  const usage = process.threadCpuUsage();
  return (usage.user + usage.system) / 1000;
};

parentPort.on("message", async ({ id, request }) => {
  const c0 = cpu();
  const w0 = performance.now();
  try {
    const decision = await authur.decide(request, "offline");
    parentPort.postMessage({
      id,
      ok: true,
      decision: {
        action: decision.action,
        id: decision.id,
        endgame: decision.endgame ? { exact: decision.endgame.exact === true, mode: decision.endgame.mode ?? null } : null,
        netFired: decision.trace.safetyNetFired === true,
        cpuMs: Math.round(cpu() - c0),
        wallMs: Math.round(performance.now() - w0),
      },
    });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: String(error?.stack ?? error) });
  }
});
parentPort.postMessage({ ready: true });
