// ArchBot inside the bot-turn lifecycle: its turn is computed on this device and
// nowhere else, once per position, never persisted as a server job to rejoin,
// and a position the game has left takes its search with it.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "token-1" } } }) },
  },
}));

const server = vi.hoisted(() => ({
  attachAnalysis: vi.fn(),
  attachBotMove: vi.fn(),
  cancelAnalysis: vi.fn(),
  listJobs: vi.fn(),
  requestAnalysis: vi.fn(),
  requestBotMove: vi.fn(),
  validateBotMove: vi.fn(),
}));
vi.mock("../src/bot/engineApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/bot/engineApi")>()),
  ...server,
  isEngineApiConfigured: true,
}));

const archbot = vi.hoisted(() => ({ runArchBot: vi.fn() }));
vi.mock("../src/bot/archbot/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/bot/archbot/client")>()),
  runArchBot: archbot.runArchBot,
}));

const superEngine = vi.hoisted(() => ({ initialize: vi.fn() }));
vi.mock("../src/bot/superEngine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/bot/superEngine")>()),
  initialize: superEngine.initialize,
}));

import { ArchBotError } from "../src/bot/archbot/engine";
import { isRetryableBotFailure } from "../src/bot/botController";
import { EngineApiError, type BotMoveResult } from "../src/bot/engineApi";
import * as engineSessions from "../src/engineSessions";
import type { GameState } from "../src/game";

const ROOM = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const GAME = { botSide: "B", botEngine: "stage5b" } as unknown as GameState;

function result(revision: number): BotMoveResult {
  return {
    gameId: ROOM,
    revision,
    side: "B",
    move: { type: "pass", placements: [], exchange: [], score: 0 },
    solver: "stage5b",
    endgameSolved: false,
    stats: { elapsedMs: 10, nodes: 1, samples: 0 },
  };
}

function serverWasNeverAsked() {
  expect(server.requestBotMove).not.toHaveBeenCalled();
  expect(server.attachBotMove).not.toHaveBeenCalled();
  expect(server.validateBotMove).not.toHaveBeenCalled();
}

beforeEach(() => {
  engineSessions.resetForTests();
  window.sessionStorage.clear();
  for (const fn of Object.values(server)) fn.mockReset();
  server.listJobs.mockResolvedValue([]);
  server.requestBotMove.mockImplementation(() => new Promise(() => undefined));
  server.attachBotMove.mockResolvedValue({ kind: "idle" });
  archbot.runArchBot.mockReset();
  superEngine.initialize.mockReset();
});

describe("an ArchBot turn", () => {
  it("is computed on this device, and the server is never asked", async () => {
    archbot.runArchBot.mockResolvedValue(result(5));
    const session = await engineSessions.observeBot({
      roomId: ROOM,
      revision: 5,
      freshlyAdmitted: true,
      archbot: { game: GAME },
    });
    expect(session.status.kind).toBe("completed");
    expect(session.result).toEqual(result(5));
    expect(session.engine).toBe("archbot");
    expect(archbot.runArchBot).toHaveBeenCalledWith(
      expect.objectContaining({ game: GAME, roomId: ROOM, revision: 5 }),
    );
    serverWasNeverAsked();
  });

  it("is searched once per position, however many times it is asked for", async () => {
    let finish!: (value: BotMoveResult) => void;
    archbot.runArchBot.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const first = engineSessions.observeBot({
      roomId: ROOM,
      revision: 5,
      freshlyAdmitted: true,
      archbot: { game: GAME },
    });
    const second = engineSessions.observeBot({
      roomId: ROOM,
      revision: 5,
      freshlyAdmitted: false,
      archbot: { game: GAME },
    });
    finish(result(5));
    const [a, b] = await Promise.all([first, second]);
    expect(archbot.runArchBot).toHaveBeenCalledTimes(1);
    expect(a.result).toBe(b.result);
  });

  it.each([
    [
      new ArchBotError("model_unavailable", "offline", "model_fetch_failed"),
      "archbot_model_unavailable",
    ],
    [new ArchBotError("compute_failed", "boom"), "archbot_failed"],
    [new ArchBotError("unsupported", "no workers"), "archbot_unsupported"],
    [new Error("anything else"), "archbot_failed"],
  ])("fails with a reason and never falls back to the server (%s)", async (failure, code) => {
    archbot.runArchBot.mockRejectedValue(failure);
    const session = await engineSessions.observeBot({
      roomId: ROOM,
      revision: 6,
      freshlyAdmitted: true,
      archbot: { game: GAME },
    });
    expect(session.status).toMatchObject({ kind: "failed", code });
    serverWasNeverAsked();
  });

  it("does not keep retrying in a browser that cannot run ArchBot", () => {
    expect(isRetryableBotFailure(new EngineApiError("archbot_unsupported", "no"))).toBe(false);
    expect(isRetryableBotFailure(new EngineApiError("archbot_model_unavailable", "no"))).toBe(true);
    expect(isRetryableBotFailure(new EngineApiError("archbot_failed", "no"))).toBe(true);
  });

  it("is never written to session storage, so a reload cannot become a server request", async () => {
    archbot.runArchBot.mockImplementation(() => new Promise(() => undefined));
    void engineSessions.observeBot({
      roomId: ROOM,
      revision: 7,
      freshlyAdmitted: true,
      archbot: { game: GAME },
    });
    await Promise.resolve();
    expect(engineSessions.botFor(ROOM, 7)?.status.kind).toBe("running");
    const stored = window.sessionStorage.getItem(`eq-lab:engine-session:v1:${ROOM}`);
    expect(stored === null || !stored.includes("bot:")).toBe(true);
  });

  it("ignores a stored bot hint for an ArchBot room after a reload", async () => {
    engineSessions.markClientBotRoom(ROOM);
    window.sessionStorage.setItem(
      `eq-lab:engine-session:v1:${ROOM}`,
      JSON.stringify([
        {
          key: `bot:${ROOM}:8`,
          kind: "bot",
          roomId: ROOM,
          revision: 8,
          progress: null,
          startedAt: 1,
        },
      ]),
    );
    engineSessions.adoptHints(ROOM);
    await Promise.resolve();
    expect(engineSessions.botFor(ROOM, 8)).toBeUndefined();
    serverWasNeverAsked();
  });

  it("refuses the server path for an ArchBot room even if a caller forgets the position", async () => {
    engineSessions.markClientBotRoom(ROOM);
    const session = await engineSessions.observeBot({
      roomId: ROOM,
      revision: 9,
      freshlyAdmitted: true,
    });
    expect(session.status).toMatchObject({ kind: "failed", code: "archbot_failed" });
    serverWasNeverAsked();
  });

  it("does not adopt a server bot job that discovery reports for an ArchBot room", async () => {
    engineSessions.markClientBotRoom(ROOM);
    server.listJobs.mockResolvedValue([{ kind: "bot", status: "running", revision: 10 }]);
    await engineSessions.discover({ roomId: ROOM, revision: 10 });
    expect(engineSessions.botFor(ROOM, 10)).toBeUndefined();
    serverWasNeverAsked();
  });

  it("aborts the search when the game moves to another revision", async () => {
    let signal!: AbortSignal;
    archbot.runArchBot.mockImplementation((options: { signal: AbortSignal }) => {
      signal = options.signal;
      return new Promise(() => undefined);
    });
    void engineSessions.observeBot({
      roomId: ROOM,
      revision: 11,
      freshlyAdmitted: true,
      archbot: { game: GAME },
    });
    await Promise.resolve();
    engineSessions.dropStale(ROOM, 12);
    expect(signal.aborted).toBe(true);
    expect(engineSessions.botFor(ROOM, 11)).toBeUndefined();
  });

  it("is cancelled without touching the server or the Super engine", async () => {
    let signal!: AbortSignal;
    archbot.runArchBot.mockImplementation((options: { signal: AbortSignal }) => {
      signal = options.signal;
      return new Promise(() => undefined);
    });
    void engineSessions.observeBot({
      roomId: ROOM,
      revision: 13,
      freshlyAdmitted: true,
      archbot: { game: GAME },
    });
    await Promise.resolve();
    engineSessions.cancel(`bot:${ROOM}:13`);
    expect(signal.aborted).toBe(true);
    expect(server.cancelAnalysis).not.toHaveBeenCalled();
    expect(superEngine.initialize).not.toHaveBeenCalled();
  });

  it("reports whether it is loading the model or thinking", async () => {
    let phase!: (value: "loading_model" | "thinking") => void;
    archbot.runArchBot.mockImplementation((options: { onPhase: typeof phase }) => {
      phase = options.onPhase;
      return new Promise(() => undefined);
    });
    void engineSessions.observeBot({
      roomId: ROOM,
      revision: 14,
      freshlyAdmitted: true,
      archbot: { game: GAME },
    });
    await Promise.resolve();
    phase("loading_model");
    expect(engineSessions.botFor(ROOM, 14)?.localPhase).toBe("loading_model");
    phase("thinking");
    expect(engineSessions.botFor(ROOM, 14)?.localPhase).toBe("thinking");
  });
});
