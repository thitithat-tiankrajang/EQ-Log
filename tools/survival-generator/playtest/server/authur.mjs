// One Authur worker thread; decisions are answered in the order they were asked.
import { Worker } from "node:worker_threads";
import { DEFAULT_AUTHUR_DIR } from "../../lib/authur.mjs";

export function startAuthur({ authurDir = DEFAULT_AUTHUR_DIR } = {}) {
  const worker = new Worker(new URL("./authur-worker.mjs", import.meta.url), { workerData: { authurDir } });
  const pending = new Map();
  let nextId = 1;
  const ready = new Promise((resolveReady, rejectReady) => {
    worker.once("error", rejectReady);
    worker.on("message", (message) => {
      if (message.ready) {
        resolveReady();
        return;
      }
      const job = pending.get(message.id);
      pending.delete(message.id);
      if (message.ok) job.resolve(message.decision);
      else job.reject(new Error(message.error));
    });
  });
  return {
    ready,
    decide(request) {
      return ready.then(
        () =>
          new Promise((resolveJob, rejectJob) => {
            const id = nextId++;
            pending.set(id, { resolve: resolveJob, reject: rejectJob });
            worker.postMessage({ id, request });
          }),
      );
    },
    close: () => worker.terminate(),
  };
}
