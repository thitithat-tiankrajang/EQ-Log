import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../src/bot/engineApi";
import * as cache from "../src/analysisSessionCache";

const ROOM = "room-1";
const RESULT = {
  gameId: ROOM,
  revision: 7,
  level: "quick",
} as AnalysisResult;

beforeEach(() => {
  window.sessionStorage.clear();
  cache.clearInFlight(ROOM);
  cache.clearResult(ROOM);
});

describe("analysis session cache", () => {
  it("remembers an in-flight analysis across a page reload in the same tab", async () => {
    cache.markInFlight(ROOM, { revision: 7, level: "quick" });
    cache.rememberProgress(ROOM, {
      phase: "sim",
      percent: 50,
      elapsedMs: 5_000,
      etaMs: 5_000,
      detail: "samples=2/4",
    });

    vi.resetModules();
    const reloadedCache = await import("../src/analysisSessionCache");

    expect(reloadedCache.getInFlight(ROOM)).toMatchObject({
      revision: 7,
      level: "quick",
      progress: { percent: 50 },
    });
  });

  it("remembers a completed result across a page reload in the same tab", async () => {
    cache.rememberResult(ROOM, RESULT);

    vi.resetModules();
    const reloadedCache = await import("../src/analysisSessionCache");

    expect(reloadedCache.getResult(ROOM)).toMatchObject({
      gameId: ROOM,
      revision: 7,
      level: "quick",
    });
  });
});
