// `engineSessions` exists to break one coupling:
//
//   REACT COMPONENT LIFETIME ≠ ENGINE JOB LIFETIME ≠ OBSERVATION LIFETIME
//
// The Play route is code-split, so leaving it destroys the whole gameplay tree.
// When the SSE connection lived in a component, that unmount closed it, and the
// returning mount had to rediscover and repaint from whatever a side cache
// remembered — which is why the bar went back to nothing.
//
// These tests pin the properties that make that impossible now: observation
// survives unmounts, the store never cancels what it merely stops rendering,
// and the SERVER decides what exists.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "token-1" } } }) },
  },
}));

const { attachAnalysis, attachBotMove, cancelAnalysis, listJobs, requestAnalysis, requestBotMove } =
  vi.hoisted(() => ({
    attachAnalysis: vi.fn(),
    attachBotMove: vi.fn(),
    cancelAnalysis: vi.fn(),
    listJobs: vi.fn(),
    requestAnalysis: vi.fn(),
    requestBotMove: vi.fn(),
  }));

vi.mock("../src/bot/engineApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bot/engineApi")>();
  return {
    ...actual,
    attachAnalysis,
    attachBotMove,
    cancelAnalysis,
    listJobs,
    requestAnalysis,
    requestBotMove,
    isEngineApiConfigured: true,
  };
});

import * as engineSessions from "../src/engineSessions";

const ROOM = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

const PROGRESS = {
  phase: "sim" as const,
  percent: 63,
  elapsedMs: 4_200,
  etaMs: 2_500,
  detail: "samples=5/8",
};

beforeEach(() => {
  engineSessions.resetForTests();
  window.sessionStorage.clear();
  attachAnalysis.mockReset().mockResolvedValue({ kind: "idle" });
  attachBotMove.mockReset().mockResolvedValue({ kind: "idle" });
  cancelAnalysis.mockReset().mockResolvedValue(true);
  listJobs.mockReset().mockResolvedValue([]);
  requestAnalysis.mockReset().mockImplementation(() => new Promise(() => undefined));
  requestBotMove.mockReset().mockImplementation(() => new Promise(() => undefined));
});

describe("observation outlives the component tree", () => {
  it("keeps accumulating progress with nothing rendering it", async () => {
    let report!: (progress: typeof PROGRESS) => void;
    requestAnalysis.mockImplementation(
      (options: { onProgress?: (progress: typeof PROGRESS) => void }) =>
        new Promise(() => {
          report = options.onProgress!;
        }),
    );

    void engineSessions.startAnalysis({ roomId: ROOM, revision: 7, level: "quick" });
    await Promise.resolve();

    // No React anywhere in this test — that is the point. The store is the thing
    // that knows, and it knows whether or not anyone is looking.
    report(PROGRESS);
    expect(engineSessions.analysisFor(ROOM, 7)?.progress).toMatchObject({ percent: 63 });

    report({ ...PROGRESS, percent: 88 });
    expect(engineSessions.analysisFor(ROOM, 7)?.progress).toMatchObject({ percent: 88 });
  });

  it("mirrors the live percentage for the one gap the server cannot cover: a reload", async () => {
    let report!: (progress: typeof PROGRESS) => void;
    requestAnalysis.mockImplementation(
      (options: { onProgress?: (progress: typeof PROGRESS) => void }) =>
        new Promise(() => {
          report = options.onProgress!;
        }),
    );
    void engineSessions.startAnalysis({ roomId: ROOM, revision: 7, level: "deep" });
    await Promise.resolve();
    report(PROGRESS);

    // Simulate the reload: the module's memory is gone, session storage is not.
    engineSessions.resetForTests();
    const hints = engineSessions.restoreHints(ROOM);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      kind: "analysis",
      revision: 7,
      level: "deep",
      progress: { percent: 63 },
    });
  });

  it("forgets a finished session, so a reload does not resurrect it", async () => {
    requestAnalysis.mockResolvedValue({ revision: 7, level: "quick" });
    await engineSessions.startAnalysis({ roomId: ROOM, revision: 7, level: "quick" });
    engineSessions.resetForTests();
    expect(engineSessions.restoreHints(ROOM)).toEqual([]);
  });
});

describe("looking away is not cancelling", () => {
  it("drops a session without telling the server to stop", () => {
    void engineSessions.startAnalysis({ roomId: ROOM, revision: 7, level: "quick" });
    engineSessions.drop(engineSessions.analysisKey(ROOM, 7, "quick"));
    expect(engineSessions.analysisFor(ROOM, 7)).toBeUndefined();
    // The search keeps running for anyone else watching, and for this player
    // when they come back.
    expect(cancelAnalysis).not.toHaveBeenCalled();
  });

  it("cancels only when the player actually asked", () => {
    void engineSessions.startAnalysis({ roomId: ROOM, revision: 7, level: "quick" });
    engineSessions.cancel(engineSessions.analysisKey(ROOM, 7, "quick"));
    expect(cancelAnalysis).toHaveBeenCalledWith({
      gameId: ROOM,
      expectedRevision: 7,
      level: "quick",
    });
  });

  it("drops work for positions the game has left, and only those", () => {
    void engineSessions.startAnalysis({ roomId: ROOM, revision: 7, level: "quick" });
    void engineSessions.startAnalysis({ roomId: ROOM, revision: 8, level: "quick" });

    engineSessions.dropStale(ROOM, 8);

    expect(engineSessions.analysisFor(ROOM, 7)).toBeUndefined();
    expect(engineSessions.analysisFor(ROOM, 8)).toBeDefined();
    expect(cancelAnalysis).not.toHaveBeenCalled();
  });
});

describe("the server decides what exists", () => {
  it("finds and attaches to a running analysis with no local pointer", async () => {
    listJobs.mockResolvedValue([
      { kind: "analysis", level: "deep", status: "running", progress: PROGRESS },
    ]);
    attachAnalysis.mockImplementation(() => new Promise(() => undefined));

    await engineSessions.discover({ roomId: ROOM, revision: 7 });

    expect(attachAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: ROOM, expectedRevision: 7, level: "deep" }),
    );
    // The server's own percentage, available before the stream produces one.
    expect(engineSessions.analysisFor(ROOM, 7)?.progress).toMatchObject({ percent: 63 });
  });

  it("does not disturb an observation it is already running", async () => {
    void engineSessions.startAnalysis({ roomId: ROOM, revision: 7, level: "quick" });
    await Promise.resolve();
    listJobs.mockResolvedValue([{ kind: "analysis", level: "quick", status: "running" }]);

    await engineSessions.discover({ roomId: ROOM, revision: 7 });

    // Already watching it: no second stream, and the live session is untouched.
    expect(attachAnalysis).not.toHaveBeenCalled();
    expect(requestAnalysis).toHaveBeenCalledTimes(1);
  });

  it("survives a discovery failure without destroying live sessions", async () => {
    void engineSessions.startAnalysis({ roomId: ROOM, revision: 7, level: "quick" });
    await Promise.resolve();
    listJobs.mockRejectedValue(new Error("network"));

    await engineSessions.discover({ roomId: ROOM, revision: 7 });

    // Discovery is an optimisation over asking again later. Failing it must
    // never be worse than not having asked.
    expect(engineSessions.analysisFor(ROOM, 7)).toBeDefined();
  });
});

describe("one logical job, one request", () => {
  it("collapses two starts for the same position and level", async () => {
    const first = engineSessions.startAnalysis({ roomId: ROOM, revision: 7, level: "quick" });
    const second = engineSessions.startAnalysis({ roomId: ROOM, revision: 7, level: "quick" });
    void first;
    void second;
    expect(requestAnalysis).toHaveBeenCalledTimes(1);
  });

  it("collapses two bot observations for the same turn", async () => {
    void engineSessions.observeBot({ roomId: ROOM, revision: 5, freshlyAdmitted: true });
    void engineSessions.observeBot({ roomId: ROOM, revision: 5, freshlyAdmitted: true });
    expect(requestBotMove).toHaveBeenCalledTimes(1);
    expect(attachBotMove).not.toHaveBeenCalled();
  });

  it("keeps different levels apart: they are different questions", () => {
    void engineSessions.startAnalysis({ roomId: ROOM, revision: 7, level: "quick" });
    void engineSessions.startAnalysis({ roomId: ROOM, revision: 7, level: "deep" });
    expect(requestAnalysis).toHaveBeenCalledTimes(2);
  });
});

describe("subscribers", () => {
  it("notifies on every change and stops on unsubscribe", async () => {
    const listener = vi.fn();
    const unsubscribe = engineSessions.subscribe(listener);

    void engineSessions.startAnalysis({ roomId: ROOM, revision: 7, level: "quick" });
    expect(listener).toHaveBeenCalled();

    const seen = listener.mock.calls.length;
    unsubscribe();
    engineSessions.drop(engineSessions.analysisKey(ROOM, 7, "quick"));
    expect(listener).toHaveBeenCalledTimes(seen);
  });

  it("changes its version whenever the store changes, so React re-reads", () => {
    const before = engineSessions.getVersion();
    void engineSessions.startAnalysis({ roomId: ROOM, revision: 7, level: "quick" });
    expect(engineSessions.getVersion()).not.toBe(before);
  });
});
