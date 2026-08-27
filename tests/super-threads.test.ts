// How many cores Super takes, and — more importantly — what it refuses to take.
//
// The number itself is a latency decision and nothing else: the engine reduces
// its samples in sample order at every thread count, so one thread and eight
// return the same move (amath-engine/tests/test_parallel_sim.cpp holds that
// end). What this file protects is the shape around it — that the threaded
// engine is never reached on a page that cannot run it, that a device which says
// it is small is believed, and that the walk-down always terminates at the
// module every browser can load.
import { describe, expect, it } from "vitest";

import {
  MAX_SUPER_THREADS,
  degradeThreadPlan,
  planSuperThreads,
  readThreadEnvironment,
  type ThreadEnvironment,
} from "../src/bot/superThreads";

/** A capable desktop, as the environment reads it. */
const CAPABLE: ThreadEnvironment = {
  crossOriginIsolated: true,
  sharedArrayBuffer: true,
  cores: 8,
  memoryGb: 8,
};

describe("choosing a thread count", () => {
  it("takes every core a capable device offers, up to the engine's own ceiling", () => {
    expect(planSuperThreads(CAPABLE)).toMatchObject({ threads: 8, threaded: true });
    // A 16-core workstation does not get 16: past eight, ~12 MB per pooled
    // worker costs more than the cores return, and the engine clamps to the same
    // constant anyway.
    expect(planSuperThreads({ ...CAPABLE, cores: 16 }).threads).toBe(MAX_SUPER_THREADS);
  });

  it("refuses the threaded engine on a page that is not cross-origin isolated", () => {
    // Not a preference. A -pthread module cannot instantiate without
    // SharedArrayBuffer, so asking for it here would be asking for a failure.
    const plan = planSuperThreads({ ...CAPABLE, crossOriginIsolated: false });
    expect(plan).toMatchObject({ threads: 1, threaded: false });
    expect(plan.reason).toMatch(/cross-origin/i);
  });

  it("refuses it when the headers are right but the constructor is missing", () => {
    // Isolation and SharedArrayBuffer are checked separately because a browser
    // can withhold the constructor with the headers in place.
    expect(planSuperThreads({ ...CAPABLE, sharedArrayBuffer: false })).toMatchObject({
      threaded: false,
    });
  });

  it("treats an unreported core count as one core, never as many", () => {
    expect(planSuperThreads({ ...CAPABLE, cores: undefined })).toMatchObject({
      threads: 1,
      threaded: false,
    });
    expect(planSuperThreads({ ...CAPABLE, cores: 1 })).toMatchObject({ threaded: false });
  });

  it("leaves a core for the UI on two- and three-core devices", () => {
    // The search is in a worker, but the UI thread still paints a progress bar
    // for minutes. Taking the last core to make a two-core phone 1.8x faster
    // buys the wait at the cost of the thing the player is watching.
    expect(planSuperThreads({ ...CAPABLE, cores: 2, memoryGb: 8 })).toMatchObject({
      threads: 1,
      threaded: false,
    });
    expect(planSuperThreads({ ...CAPABLE, cores: 3, memoryGb: 8 })).toMatchObject({
      threads: 2,
      threaded: true,
    });
    // Four is where taking every core starts being the right trade.
    expect(planSuperThreads({ ...CAPABLE, cores: 4, memoryGb: 8 }).threads).toBe(4);
  });

  it("believes a device that says it is short of memory", () => {
    // Each pooled worker costs ~12 MB at instantiation, used or not, on top of
    // an engine whose peak is already ~130 MB in the end-game.
    expect(planSuperThreads({ ...CAPABLE, memoryGb: 4 }).threads).toBe(4);
    expect(planSuperThreads({ ...CAPABLE, memoryGb: 2 }).threads).toBe(2);
    expect(planSuperThreads({ ...CAPABLE, memoryGb: 1 })).toMatchObject({
      threads: 1,
      threaded: false,
    });
  });

  it("does not invent a memory limit for browsers that do not report one", () => {
    // `deviceMemory` is Chromium-only. Absent is a lack of information, and
    // treating it as a small number would put every Safari and Firefox user on
    // one thread for no reason.
    expect(planSuperThreads({ ...CAPABLE, memoryGb: undefined }).threads).toBe(8);
  });
});

describe("walking down when the engine will not start", () => {
  it("halves, then lands on the module every browser can load", () => {
    // Instantiation is where a device that cannot afford the pool finds out, and
    // it finds out as an exception rather than a number — so the retry has to be
    // blind, and it has to terminate.
    const eight = planSuperThreads(CAPABLE);
    const four = degradeThreadPlan(eight)!;
    expect(four).toMatchObject({ threads: 4, threaded: true });
    const two = degradeThreadPlan(four)!;
    expect(two).toMatchObject({ threads: 2, threaded: true });
    const single = degradeThreadPlan(two)!;
    expect(single).toMatchObject({ threads: 1, threaded: false });
    // And the floor is the end of the walk, not another step.
    expect(degradeThreadPlan(single)).toBeNull();
  });

  it("terminates from every reachable starting point", () => {
    for (let cores = 1; cores <= 16; cores += 1) {
      let plan = planSuperThreads({ ...CAPABLE, cores });
      let steps = 0;
      while (plan) {
        const next = degradeThreadPlan(plan);
        if (!next) break;
        plan = next;
        steps += 1;
        expect(steps).toBeLessThan(8);
      }
      expect(plan.threaded).toBe(false);
    }
  });
});

describe("reading the environment", () => {
  it("reports a plain jsdom window as unable to thread", () => {
    // The real guard, run against a real global rather than a fixture: jsdom has
    // no cross-origin isolation, so this is the answer a test environment — and
    // any un-isolated page — must get.
    const env = readThreadEnvironment();
    expect(env.crossOriginIsolated).toBe(false);
    expect(planSuperThreads(env).threaded).toBe(false);
  });

  it("reads the counts a browser actually exposes", () => {
    const scope = {
      crossOriginIsolated: true,
      SharedArrayBuffer: function SharedArrayBuffer() {},
      navigator: { hardwareConcurrency: 6, deviceMemory: 8 },
    } as unknown as typeof globalThis;
    expect(readThreadEnvironment(scope)).toEqual({
      crossOriginIsolated: true,
      sharedArrayBuffer: true,
      cores: 6,
      memoryGb: 8,
    });
    expect(planSuperThreads(readThreadEnvironment(scope)).threads).toBe(6);
  });
});
