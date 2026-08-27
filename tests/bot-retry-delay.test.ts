// When the server states how long to wait, that number is the answer.
//
// `budget_exhausted` and `queue_full` both come back with `retryAfterMs`, and
// the bot used to ignore it in favour of a fixed 1.5s/4s/8s schedule — so a
// refusal that resolved itself in six seconds became three failed retries with
// an error on screen for all of them.
import { describe, expect, it } from "vitest";

import { botRetryDelay } from "../src/bot/botController";
import { EngineApiError } from "../src/bot/engineApi";

const refusal = (retryAfterMs?: number) =>
  new EngineApiError(
    "budget_exhausted",
    "You have used your engine budget for now.",
    retryAfterMs === undefined ? undefined : { retryAfterMs },
  );

describe("how long the bot waits before asking again", () => {
  it("waits the time the server stated, plus a small margin", () => {
    // The exact number from the report that started this.
    expect(botRetryDelay(refusal(5_672), 0)).toBe(5_922);
  });

  it("does not race the server's own clock", () => {
    // Retrying on the exact millisecond the window rolls over is a coin flip.
    expect(botRetryDelay(refusal(1_000), 0)).toBeGreaterThan(1_000);
  });

  it("falls back to the schedule when the server states nothing", () => {
    expect(botRetryDelay(refusal(), 0)).toBe(1_500);
    expect(botRetryDelay(refusal(), 1)).toBe(4_000);
    expect(botRetryDelay(refusal(), 2)).toBe(8_000);
    // The schedule holds rather than growing without limit.
    expect(botRetryDelay(refusal(), 9)).toBe(8_000);
  });

  it("ignores a stated wait long enough to park the bot", () => {
    // A wrong or hostile number must not take the turn away; the schedule keeps
    // the bot asking.
    expect(botRetryDelay(refusal(60 * 60 * 1000), 0)).toBe(1_500);
    expect(botRetryDelay(refusal(-5), 0)).toBe(1_500);
  });

  it("falls back for anything that is not an engine refusal", () => {
    expect(botRetryDelay(new Error("network down"), 1)).toBe(4_000);
  });
});
