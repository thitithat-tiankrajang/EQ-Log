/// <reference lib="webworker" />
// ArchBot's dedicated module worker: Stage 5B runs here, never on the page's
// thread. One worker, one model, one decision at a time.
import { decideArchBot } from "./decide";
import { loadArchBotModel } from "./model";
import type { ArchBotFromWorker, ArchBotToWorker } from "./protocol";
import { createArchBotWorkerHandler } from "./workerHandler";

const scope = self as unknown as DedicatedWorkerGlobalScope;

const handle = createArchBotWorkerHandler({
  loadModel: (modelPath) => loadArchBotModel(modelPath),
  decide: decideArchBot,
  post: (message: ArchBotFromWorker) => scope.postMessage(message),
});

scope.onmessage = (event: MessageEvent<ArchBotToWorker>) => {
  void handle(event.data);
};
