// Worker pool, plus the one piece of work worth sharing between workers:
// Authur's decisions.
//
// Offline Authur is a pure function of (what the side to move can see, seed,
// config), so a decision computed by one worker is exactly the decision any
// other worker would compute. The pool keeps ONE table of finished decisions
// and of decisions being computed right now; a worker that needs a position
// another worker is already on waits for that answer instead of recomputing it.
// Nothing about any decision changes — it is the same value, computed once.
//
// Decisions that ran out of Authur's own endgame clock (not exact) are never
// shared: their content depends on timing, and spreading them would make that
// timing dependence look like a determined result.
import { Worker } from "node:worker_threads";
import { resolve } from "node:path";

const WORKER = resolve(import.meta.dirname, "../worker.mjs");
const SHARED_MAX = 100_000;

export async function createPool(size, workerData = {}) {
  const workers = [];
  const queue = [];
  const pending = new Map();
  const shared = new Map(); // key -> { done: true, value } | { done: false, waiters: [] }
  const sharedStats = { hits: 0, waits: 0, misses: 0, stored: 0, refused: 0 };
  let nextId = 1;

  const pump = () => {
    for (const w of workers) {
      if (w.busy || !w.ready) continue;
      queue.sort((a, b) => b.priority - a.priority || a.id - b.id);
      const job = queue.shift();
      if (!job) return;
      w.busy = true;
      pending.set(job.id, { job, w });
      w.worker.postMessage({ id: job.id, task: job.task, payload: job.payload });
    }
  };

  const onCache = (w, message) => {
    if (message.type === "cache-get") {
      const entry = shared.get(message.key);
      if (entry?.done) {
        sharedStats.hits += 1;
        w.worker.postMessage({ type: "cache-reply", rid: message.rid, value: entry.value });
      } else if (entry) {
        sharedStats.waits += 1;
        entry.waiters.push({ w, rid: message.rid });
      } else {
        sharedStats.misses += 1;
        shared.set(message.key, { done: false, waiters: [] });
        w.worker.postMessage({ type: "cache-reply", rid: message.rid, compute: true });
      }
      return;
    }
    const entry = shared.get(message.key);
    const waiters = entry && !entry.done ? entry.waiters : [];
    if (message.type === "cache-put") {
      sharedStats.stored += 1;
      shared.set(message.key, { done: true, value: message.value });
      if (shared.size > SHARED_MAX) shared.delete(shared.keys().next().value);
      for (const waiter of waiters) {
        waiter.w.worker.postMessage({ type: "cache-reply", rid: waiter.rid, value: message.value });
      }
    } else if (message.type === "cache-abandon") {
      // The computing worker failed or refused to share: each waiter computes itself.
      sharedStats.refused += 1;
      shared.delete(message.key);
      for (const waiter of waiters) {
        waiter.w.worker.postMessage({ type: "cache-reply", rid: waiter.rid, compute: true, private: true });
      }
    }
  };

  await Promise.all(
    Array.from({ length: size }, () => new Promise((ready, fail) => {
      const worker = new Worker(WORKER, { workerData });
      const w = { worker, busy: false, ready: false };
      worker.on("message", (message) => {
        if (message.ready) {
          w.ready = true;
          ready();
          pump();
          return;
        }
        if (message.type) {
          onCache(w, message);
          return;
        }
        const { job } = pending.get(message.id);
        pending.delete(message.id);
        w.busy = false;
        if (message.ok) job.resolve(message.result);
        else job.reject(new Error(message.error));
        pump();
      });
      worker.on("error", fail);
      workers.push(w);
    })),
  );

  return {
    size,
    run(task, payload, priority = 0) {
      return new Promise((resolveJob, rejectJob) => {
        queue.push({ id: nextId++, task, payload, priority, resolve: resolveJob, reject: rejectJob });
        pump();
      });
    },
    sharedStats: () => ({ ...sharedStats, entries: shared.size }),
    close: () => Promise.all(workers.map((w) => w.worker.terminate())),
  };
}
