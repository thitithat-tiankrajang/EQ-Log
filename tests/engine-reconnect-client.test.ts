// The reconnect half of the engine client: rejoining work that outlived the
// page that started it, without ever starting new work or paying for it twice.
//
// The properties pinned here:
//   • `attach*` reads a real result off a stream, and reads `idle` (no job for
//     this position) as a settled, non-error outcome the caller acts on.
//   • `thinkWithBot` REJOINS a running/cached bot search when one exists, and
//     only STARTS one when the server says there is none — a returning player,
//     a second tab, or a double-fired effect must not launch a duplicate search.
//   • Cancelling is an explicit POST, distinct from merely closing the page.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "token-1" } } }) },
  },
}));

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamOf(frames: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of frames) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const BOT_RESULT = {
  revision: 5,
  gameId: "room-1",
  side: "B",
  move: { type: "pass", placements: [], exchange: [], score: 0 },
  solver: "greedy",
  endgameSolved: false,
  stats: { elapsedMs: 12, nodes: 1, samples: 0 },
};

async function loadApi() {
  vi.stubEnv("VITE_ENGINE_API_URL", "https://engine.test");
  vi.resetModules();
  return import("../src/bot/engineApi");
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("attaching to existing work", () => {
  it("reads a completed result off the reconnect stream", async () => {
    const { attachAnalysis } = await loadApi();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamOf([frame("result", { revision: 7 })])),
    );
    const outcome = await attachAnalysis({ gameId: "room-1", expectedRevision: 7, level: "quick" });
    expect(outcome).toEqual({ kind: "result", result: { revision: 7 } });
  });

  it("reads `idle` as a settled outcome, not an error", async () => {
    const { attachAnalysis } = await loadApi();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamOf([frame("idle", {})])),
    );
    const outcome = await attachAnalysis({ gameId: "room-1", expectedRevision: 7, level: "quick" });
    expect(outcome).toEqual({ kind: "idle" });
  });

  it("attaches with a GET that names the revision and level", async () => {
    const { attachAnalysis } = await loadApi();
    const fetchMock = vi.fn(async () => streamOf([frame("idle", {})]));
    vi.stubGlobal("fetch", fetchMock);
    await attachAnalysis({ gameId: "room-1", expectedRevision: 7, level: "deep" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("GET");
    expect(url).toContain("/v1/games/room-1/analysis?revision=7&level=deep");
    // A reconnect carries no body: it starts nothing.
    expect(init.body).toBeUndefined();
  });

  it("reconnects to a bot move without a body either", async () => {
    const { attachBotMove } = await loadApi();
    const fetchMock = vi.fn(async () => streamOf([frame("result", BOT_RESULT)]));
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await attachBotMove({ gameId: "room-1", expectedRevision: 5 });
    expect(outcome.kind).toBe("result");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("GET");
    expect(url).toContain("/v1/games/room-1/bot-move?revision=5");
  });
});

describe("cancelling is explicit", () => {
  it("posts a cancel and reports what the server did", async () => {
    const { cancelAnalysis } = await loadApi();
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ cancelled: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const cancelled = await cancelAnalysis({
      gameId: "room-1",
      expectedRevision: 7,
      level: "quick",
    });
    expect(cancelled).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/games/room-1/analysis/cancel");
    expect(init.method).toBe("POST");
  });

  it("treats an unreachable server as simply not cancelled", async () => {
    const { cancelAnalysis } = await loadApi();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(
      cancelAnalysis({ gameId: "room-1", expectedRevision: 7, level: "quick" }),
    ).resolves.toBe(false);
  });
});

describe("thinkWithBot rejoins before it starts", () => {
  it("resumes from the server's last progress without starting another search", async () => {
    await loadApi();
    const { thinkWithBot } = await import("../src/bot/botController");
    const states: Array<{ kind: string; progress?: { percent: number } | null }> = [];
    const fetchMock = vi.fn(async () =>
      streamOf([
        frame("running", {}),
        frame("progress", {
          phase: "sim",
          percent: 50,
          elapsedMs: 900,
          etaMs: 900,
          detail: "samples=2/4",
        }),
        frame("result", BOT_RESULT),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await thinkWithBot(
      "room-1",
      { gameId: "blob", revision: 5 } as unknown as Parameters<typeof thinkWithBot>[1],
      (state) => states.push(state),
    ).promise;

    expect(states).toContainEqual(
      expect.objectContaining({
        kind: "running",
        progress: expect.objectContaining({ percent: 50 }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("GET");
  });

  it("returns the move from an existing search without starting a new one", async () => {
    await loadApi();
    const { thinkWithBot } = await import("../src/bot/botController");
    // The first (and only) fetch is the GET reconnect, which already has the move.
    const fetchMock = vi.fn(async () => streamOf([frame("result", BOT_RESULT)]));
    vi.stubGlobal("fetch", fetchMock);

    await thinkWithBot(
      "room-1",
      { gameId: "blob", revision: 5 } as unknown as Parameters<typeof thinkWithBot>[1],
      () => undefined,
    ).promise;

    // No second request: the running/cached search served this turn.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("GET");
  });

  it("starts a search only when the server has none", async () => {
    await loadApi();
    const { thinkWithBot } = await import("../src/bot/botController");
    const fetchMock = vi
      .fn()
      // GET reconnect: nothing running for this position.
      .mockImplementationOnce(async () => streamOf([frame("idle", {})]))
      // POST start: now it runs and returns a move.
      .mockImplementationOnce(async () =>
        streamOf([frame("running", {}), frame("result", BOT_RESULT)]),
      );
    vi.stubGlobal("fetch", fetchMock);

    await thinkWithBot(
      "room-1",
      { gameId: "blob", revision: 5 } as unknown as Parameters<typeof thinkWithBot>[1],
      () => undefined,
    ).promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("GET");
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("POST");
  });
});
