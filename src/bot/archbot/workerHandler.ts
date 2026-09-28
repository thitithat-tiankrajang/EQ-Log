// The worker's logic, apart from the worker global so it can be tested directly.
//
// The model is loaded at most once per worker and reused by every decision. A
// failed load is NOT cached: the next request tries again, so a dropped
// connection costs one retry rather than the rest of the worker's life.
import type { ValueHead } from "./core/stage5b-core.mjs";
import type { ArchBotDecision, ArchBotRequest } from "./decide";
import { ArchBotModelError } from "./model";
import type { ArchBotFromWorker, ArchBotToWorker } from "./protocol";

export type ArchBotWorkerDeps = {
  loadModel: (modelPath: string) => Promise<ValueHead>;
  decide: (request: ArchBotRequest, value: ValueHead) => ArchBotDecision;
  post: (message: ArchBotFromWorker) => void;
  now?: () => number;
};

export function createArchBotWorkerHandler(deps: ArchBotWorkerDeps) {
  const now = deps.now ?? (() => performance.now());
  let model: Promise<ValueHead> | null = null;
  let modelMs = 0;

  const loadModel = (modelPath: string): Promise<ValueHead> => {
    if (!model) {
      const started = now();
      model = deps.loadModel(modelPath).then(
        (value) => {
          modelMs = now() - started;
          return value;
        },
        (error: unknown) => {
          model = null;
          throw error;
        },
      );
    }
    return model;
  };

  const modelFailure = (error: unknown) =>
    error instanceof ArchBotModelError
      ? { code: error.code, message: error.message }
      : {
          code: "model_invalid" as const,
          message: error instanceof Error ? error.message : String(error),
        };

  return async function onMessage(message: ArchBotToWorker): Promise<void> {
    if (message.type === "init") {
      try {
        await loadModel(message.modelPath);
        deps.post({ type: "ready", modelMs });
      } catch (error) {
        deps.post({ type: "model-error", ...modelFailure(error) });
      }
      return;
    }

    let value: ValueHead;
    try {
      value = await loadModel(message.modelPath);
    } catch (error) {
      const failure = modelFailure(error);
      deps.post({
        type: "failed",
        id: message.id,
        code: "model_unavailable",
        modelCode: failure.code,
        message: failure.message,
      });
      return;
    }
    const started = now();
    try {
      const decision = deps.decide(message.request, value);
      deps.post({ type: "decided", id: message.id, decision, wallMs: now() - started, modelMs });
    } catch (error) {
      deps.post({
        type: "failed",
        id: message.id,
        code: "compute_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
