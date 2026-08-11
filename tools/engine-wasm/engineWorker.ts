// Web Worker wrapper around the C++ engine (WASM). Keeps the UI thread free
// while the bot thinks; forwards engine progress reports as messages.
import createModule, { type AmathEngineModule } from "./amath_engine.mjs";
import type { WorkerInbound, WorkerOutbound } from "./types";

let modulePromise: Promise<AmathEngineModule> | undefined;
let activeRequestId = 0;

function post(message: WorkerOutbound) {
  (self as unknown as Worker).postMessage(message);
}

function getModule(): Promise<AmathEngineModule> {
  modulePromise ??= createModule().then((mod: AmathEngineModule) => {
    // The engine calls this hook (via EM_JS) on every progress report.
    (globalThis as Record<string, unknown>).__amathProgress = (json: string) => {
      try {
        post({ type: "progress", id: activeRequestId, progress: JSON.parse(json) });
      } catch {
        // ignore malformed progress
      }
    };
    post({ type: "ready" });
    return mod;
  });
  return modulePromise;
}

getModule();

self.onmessage = async (event: MessageEvent<WorkerInbound>) => {
  const msg = event.data;
  if (msg.type !== "think") return;
  try {
    const mod = await getModule();
    activeRequestId = msg.id;
    const request = JSON.stringify(msg.request);
    const bytes = mod.lengthBytesUTF8(request) + 1;
    const inPtr = mod._engine_alloc(bytes);
    mod.stringToUTF8(request, inPtr, bytes);
    const outPtr = mod._engine_handle(inPtr);
    const responseText = mod.UTF8ToString(outPtr);
    mod._engine_free(inPtr);
    mod._engine_free(outPtr);
    post({ type: "result", id: msg.id, response: JSON.parse(responseText) });
  } catch (error) {
    post({
      type: "error",
      id: msg.id,
      message: error instanceof Error ? error.message : "engine failure",
    });
  }
};
