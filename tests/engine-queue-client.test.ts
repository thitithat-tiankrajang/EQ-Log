// The client half of the queue contract.
//
// The engine now runs on one shared server, so a request that has been accepted
// has not necessarily started. These tests pin the two things that has to mean
// on this side: the lifecycle events are read off the stream in the right
// order, and an overload is classified as something to retry rather than as a
// reason to make the bot pass its turn.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "token-1" } } }),
    },
  },
}));

/** One SSE frame, in the shape the service writes it. */
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
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function loadApi() {
  vi.stubEnv("VITE_ENGINE_API_URL", "https://engine.test");
  vi.resetModules();
  return import("../src/bot/engineApi");
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the queued → running → completed lifecycle", () => {
  it("reports queueing, then the start, then the result, in that order", async () => {
    const { requestAnalysis } = await loadApi();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamOf([
          frame("queued", { ahead: 1, position: 2 }),
          frame("running", {}),
          frame("progress", {
            phase: "sim",
            percent: 50,
            elapsedMs: 900,
            etaMs: 900,
            detail: "samples=2/4",
          }),
          frame("result", { revision: 7, level: "quick" }),
        ]),
      ),
    );

    const seen: string[] = [];
    const queued: Array<{ ahead: number; position: number }> = [];
    const result = await requestAnalysis({
      gameId: "g1",
      expectedRevision: 7,
      level: "quick",
      onQueued: (state) => {
        seen.push("queued");
        queued.push(state);
      },
      onRunning: () => seen.push("running"),
      onProgress: () => seen.push("progress"),
    });

    expect(seen).toEqual(["queued", "running", "progress"]);
    expect(queued[0]).toEqual({ ahead: 1, position: 2 });
    expect(result).toMatchObject({ revision: 7 });
  });

  it("never reports queueing for a request the server started at once", async () => {
    // Saying "queued" when nothing waited would put the UI into a state the
    // server was never in, and the player would read a busy server that is not.
    const { requestBotMove } = await loadApi();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamOf([frame("running", {}), frame("result", { revision: 3, move: { type: "pass" } })]),
      ),
    );

    const seen: string[] = [];
    await requestBotMove({
      gameId: "g1",
      expectedRevision: 3,
      onQueued: () => seen.push("queued"),
      onRunning: () => seen.push("running"),
    });
    expect(seen).toEqual(["running"]);
  });

  it("follows the queue as it moves rather than freezing on the first number", async () => {
    const { requestAnalysis } = await loadApi();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamOf([
          frame("queued", { ahead: 2, position: 3 }),
          frame("queued", { ahead: 1, position: 2 }),
          frame("queued", { ahead: 0, position: 1 }),
          frame("running", {}),
          frame("result", { revision: 7 }),
        ]),
      ),
    );
    const positions: number[] = [];
    await requestAnalysis({
      gameId: "g1",
      expectedRevision: 7,
      level: "quick",
      onQueued: (state) => positions.push(state.position),
    });
    expect(positions).toEqual([3, 2, 1]);
  });

  it("still reports the wait when the count is unusable, rather than inventing one", async () => {
    // Being told "you are waiting" is the part the player needs. A position
    // that cannot be trusted is surfaced as absent, not as a plausible number.
    const { requestAnalysis } = await loadApi();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamOf([
          frame("queued", { ahead: "soon" }),
          frame("running", {}),
          frame("result", { revision: 7 }),
        ]),
      ),
    );
    const positions: number[] = [];
    await requestAnalysis({
      gameId: "g1",
      expectedRevision: 7,
      level: "quick",
      onQueued: (state) => positions.push(state.position),
    });
    expect(positions).toEqual([-1]);
  });
});

describe("overload reaches the client as a distinguishable condition", () => {
  it("reads a queue-full error event as queue_full, not as a generic failure", async () => {
    const { requestAnalysis, EngineApiError } = await loadApi();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamOf([
          frame("error", { code: "queue_full", error: "The engine is busy. Try again shortly." }),
        ]),
      ),
    );
    await expect(
      requestAnalysis({ gameId: "g1", expectedRevision: 7, level: "quick" }),
    ).rejects.toMatchObject({ code: "queue_full" });
    await expect(
      requestAnalysis({ gameId: "g1", expectedRevision: 7, level: "quick" }),
    ).rejects.toBeInstanceOf(EngineApiError);
  });

  it("reads a queue-full status code from before the stream opened", async () => {
    const { requestAnalysis } = await loadApi();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "queue_full", error: "busy" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    await expect(
      requestAnalysis({ gameId: "g1", expectedRevision: 7, level: "quick" }),
    ).rejects.toMatchObject({ code: "queue_full" });
  });

  it("reads a stale revision the server detected while the job waited", async () => {
    const { requestAnalysis } = await loadApi();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamOf([
          frame("queued", { ahead: 0, position: 1 }),
          frame("error", { code: "stale_revision", error: "position changed" }),
        ]),
      ),
    );
    await expect(
      requestAnalysis({ gameId: "g1", expectedRevision: 7, level: "quick" }),
    ).rejects.toMatchObject({ code: "stale_revision" });
  });

  it("reads an engine timeout as its own condition", async () => {
    const { requestAnalysis } = await loadApi();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamOf([frame("error", { code: "engine_timeout", error: "too long" })])),
    );
    await expect(
      requestAnalysis({ gameId: "g1", expectedRevision: 7, level: "quick" }),
    ).rejects.toMatchObject({ code: "engine_timeout" });
  });
});

describe("which identifier the bot asks about", () => {
  it("names the live room, never the game blob's own id", async () => {
    // Regression, and the reason `thinkWithBot` takes the room id as its own
    // argument instead of reading one off `game`. `GameState.gameId` is a
    // client-generated UUID that the server has never stored; a request built
    // from it comes back `not_found` every single time, for the bot's turn and
    // for analysis alike.
    await loadApi();
    const { thinkWithBot } = await import("../src/bot/botController");
    const roomId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

    const fetchMock = vi.fn(async () =>
      streamOf([
        frame("result", {
          revision: 5,
          gameId: roomId,
          side: "B",
          move: { type: "pass", placements: [], exchange: [], score: 0 },
          solver: "greedy",
          endgameSolved: false,
          stats: { elapsedMs: 12, nodes: 1, samples: 0 },
        }),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await thinkWithBot(
      roomId,
      {
        gameId: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
        revision: 5,
      } as unknown as Parameters<typeof thinkWithBot>[1],
      () => undefined,
    ).promise;

    const requested = String(fetchMock.mock.calls[0]?.[0]);
    expect(requested).toContain(`/v1/games/${roomId}/bot-move`);
    expect(requested).not.toContain("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb");
  });
});

describe("classifying a failed bot turn", () => {
  it("treats server overload as worth retrying, not as a reason to pass", async () => {
    // A pass is a real, scoring, irreversible game action. "Someone else was
    // analysing for four seconds" must never produce one.
    const { EngineApiError } = await loadApi();
    const { isRetryableBotFailure, isDesyncBotFailure } = await import("../src/bot/botController");
    expect(isRetryableBotFailure(new EngineApiError("queue_full", "busy"))).toBe(true);
    expect(isRetryableBotFailure(new EngineApiError("offline", "gone"))).toBe(true);
    expect(isRetryableBotFailure(new EngineApiError("internal", "oops"))).toBe(true);
    expect(isDesyncBotFailure(new EngineApiError("queue_full", "busy"))).toBe(false);
  });

  it("treats a stale revision as a desync to wait out, never as a pass", async () => {
    const { EngineApiError } = await loadApi();
    const { isRetryableBotFailure, isDesyncBotFailure } = await import("../src/bot/botController");
    const stale = new EngineApiError("stale_revision", "moved on");
    expect(isDesyncBotFailure(stale)).toBe(true);
    expect(isRetryableBotFailure(stale)).toBe(false);
  });

  it("does not retry a timeout, which another five minutes will not fix", async () => {
    const { EngineApiError } = await loadApi();
    const { isRetryableBotFailure } = await import("../src/bot/botController");
    expect(isRetryableBotFailure(new EngineApiError("engine_timeout", "too long"))).toBe(false);
    expect(isRetryableBotFailure(new EngineApiError("analysis_not_allowed", "no"))).toBe(false);
  });
});
