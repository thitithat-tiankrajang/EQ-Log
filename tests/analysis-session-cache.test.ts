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
  cache.clearResult(ROOM);
});

// The cache remembers ANSWERS, not running work. What is in flight is the
// server's to report (`GET /jobs`) and `engineSessions`' to observe — keeping a
// second copy of it here is what made a live search unreachable when this tab
// lost its note about it.
describe("analysis result cache", () => {
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
