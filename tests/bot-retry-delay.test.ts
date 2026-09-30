import { afterEach, describe, expect, it, vi } from "vitest";
import { botRetryDelay, scheduleBotRetry } from "../src/bot/botController";
import { EngineApiError, retryAfterDelay } from "../src/bot/engineApi";

const busy = (retryAfterMs?: number) => new EngineApiError("queue_full", "busy", { retryAfterMs });
afterEach(() => vi.useRealTimers());

describe("bounded bot retries", () => {
  it("honors infrastructure waits including the reported long wait", () => {
    expect(botRetryDelay(busy(190289), 0)).toBe(190539);
    expect(botRetryDelay(busy(3600000), 0)).toBe(3600250);
    expect(botRetryDelay(busy(1), 0)).toBe(1500);
    expect(botRetryDelay(busy(-1), 1)).toBe(4000);
    expect(botRetryDelay(busy(Number.NaN), 2)).toBe(8000);
  });

  it("makes three attempts and never restarts after timers advance", async () => {
    vi.useFakeTimers();
    let requests = 0;
    const attempt = (tries: number) => {
      requests += 1;
      scheduleBotRetry(busy(), tries, () => attempt(tries + 1));
    };
    attempt(0);
    await vi.advanceTimersByTimeAsync(1499);
    expect(requests).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toBe(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(requests).toBe(3);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(requests).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never retries before Retry-After", async () => {
    vi.useFakeTimers();
    const retry = vi.fn();
    scheduleBotRetry(busy(190289), 0, retry);
    await vi.advanceTimersByTimeAsync(190288);
    expect(retry).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(251);
    expect(retry).toHaveBeenCalledOnce();
  });

  it.each([
    "budget_exhausted",
    "forbidden",
    "unauthenticated",
    "bad_request",
    "invalid_state",
    "bot_disabled",
    "cancelled",
    "stale_revision",
    "turn_rule",
  ] as const)("stops immediately on %s", async (code) => {
    vi.useFakeTimers();
    const retry = vi.fn();
    expect(scheduleBotRetry(new EngineApiError(code, "refused"), 0, retry)).toBeUndefined();
    await vi.runAllTimersAsync();
    expect(retry).not.toHaveBeenCalled();
  });

  it("allows navigation/unmount cleanup to cancel pending retry work", async () => {
    vi.useFakeTimers();
    const retry = vi.fn();
    const timer = scheduleBotRetry(busy(), 0, retry);
    clearTimeout(timer);
    await vi.runAllTimersAsync();
    expect(retry).not.toHaveBeenCalled();
  });

  it("stops instead of retrying early for an unrepresentable server wait", () => {
    expect(scheduleBotRetry(busy(3e12), 0, vi.fn())).toBeUndefined();
  });

  it("reads both Retry-After formats", () => {
    expect(retryAfterDelay("10")).toBe(10000);
    expect(
      retryAfterDelay("Wed, 30 Sep 2026 00:00:10 GMT", Date.parse("2026-09-30T00:00:00Z")),
    ).toBe(10000);
    expect(retryAfterDelay("invalid")).toBeUndefined();
    expect(retryAfterDelay("-1")).toBeUndefined();
  });
});
