// Authur plays when the engine service does not answer, and stops when it answers "no".
//
// This is the bug that made Authur unplayable: the bot computed its move on the device, then
// asked the backend engine service to check it, and the check was a REQUIREMENT. With that
// service down — which for a client-side bot is an ordinary state, not a fault — every Authur
// turn died on `ERR_CONNECTION_REFUSED` after the thinking was already done.
//
// The rule these tests pin: only an answer that was actually RECEIVED may reject a move.
// Failing to obtain one is not evidence about the move. Nothing reaches the board unchecked
// either way, because `applyBotResult` runs EQ-Lab's own `validateMove` before committing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNewGame } from "../src/game";

const validateBotMove = vi.fn();

vi.mock("../src/bot/engineApi", async () => {
  const actual =
    await vi.importActual<typeof import("../src/bot/engineApi")>("../src/bot/engineApi");
  return { ...actual, validateBotMove: (...args: unknown[]) => validateBotMove(...args) };
});

/** A real Authur game: `buildAuthurRequest` refuses anything less, and rightly. */
function authurGame() {
  return createNewGame({
    name: "Human vs Authur",
    playerA: "Human",
    playerB: "Authur",
    startingSide: "B",
    botSide: "B",
    botEngine: "authur",
    botDifficulty: "super",
    tileDrawMode: "play",
  });
}

const ANSWER = {
  revision: 7,
  move: { type: "pass" as const, placements: [], exchange: [] },
  score: 0,
  solver: "strong",
  stats: {},
};

/** A worker that has already finished thinking: the test is about what happens next. */
class InstantWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  postMessage(): void {
    queueMicrotask(() => this.onmessage?.({ data: { type: "result", result: ANSWER } }));
  }
  terminate(): void {}
}

beforeEach(() => {
  validateBotMove.mockReset();
  vi.stubGlobal("Worker", InstantWorker);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function run() {
  const { runAuthur } = await import("../src/bot/authur/client");
  return runAuthur({
    game: authurGame(),
    roomId: "room-1",
    revision: 7,
    signal: new AbortController().signal,
    onProgress: () => {},
  });
}

describe("Authur and the shared validator", () => {
  it("plays its move when the engine service refuses the connection", async () => {
    // What a down service actually throws: a raw fetch failure, not an EngineApiError.
    validateBotMove.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(run()).resolves.toMatchObject({ move: { type: "pass" } });
  });

  it("plays its move when no engine service is configured at all", async () => {
    const { EngineApiError } = await import("../src/bot/engineApi");
    validateBotMove.mockRejectedValue(
      new EngineApiError("unconfigured", "No engine service is configured."),
    );
    await expect(run()).resolves.toMatchObject({ move: { type: "pass" } });
  });

  it("refuses the move when the service answers that it is invalid", async () => {
    // A received verdict is evidence, and this one says no. That must still stop the move.
    validateBotMove.mockResolvedValue({ valid: false, reason: "not your turn" });
    await expect(run()).rejects.toThrow(/not your turn/);
  });

  it("plays the move when the service answers that it is valid", async () => {
    validateBotMove.mockResolvedValue({ valid: true });
    await expect(run()).resolves.toMatchObject({ move: { type: "pass" } });
  });
});
