import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cache from "../src/botActivityCache";

const ROOM = "room-1";
const ACTIVITY = {
  commitId: "commit-7",
  revision: 7,
  progress: {
    phase: "sim" as const,
    percent: 50,
    elapsedMs: 5_000,
    etaMs: 5_000,
    bestScore: 0,
    detail: "samples=2/4",
  },
};

beforeEach(() => {
  window.sessionStorage.clear();
  cache.forget(ROOM);
});

describe("bot activity cache", () => {
  it("restores the last real progress after a full page reload", async () => {
    cache.remember(ROOM, ACTIVITY);

    vi.resetModules();
    const reloadedCache = await import("../src/botActivityCache");

    expect(reloadedCache.get(ROOM)).toEqual(ACTIVITY);
  });

  it("forgets a completed turn", () => {
    cache.remember(ROOM, ACTIVITY);
    cache.forget(ROOM);
    expect(cache.get(ROOM)).toBeUndefined();
  });
});
