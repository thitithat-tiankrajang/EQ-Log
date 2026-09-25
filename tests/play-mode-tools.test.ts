import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../src/supabaseClient", () => ({ supabase: { rpc } }));

import { defaultPlayTools, loadPlayTools } from "../src/playModeTools";

beforeEach(() => rpc.mockReset());

describe("Play tools by mode", () => {
  it("keeps the existing direct match rules and bot tools", () => {
    expect(defaultPlayTools("online_versus").has("multiverse")).toBe(false);
    expect(defaultPlayTools("online_versus").has("analysis")).toBe(true);
    expect(defaultPlayTools("authur_strong").has("bot_insight")).toBe(true);
    expect(defaultPlayTools("future_mode").size).toBe(0);
  });

  it("uses database assignments for a new mode and shares one fetch", async () => {
    rpc.mockResolvedValue({ data: [{ tool_key: "turn_log" }], error: null });
    const [a, b] = await Promise.all([
      loadPlayTools("future_mode_1"),
      loadPlayTools("future_mode_1"),
    ]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a.has("analysis")).toBe(false);
    expect(a.has("turn_log")).toBe(true);
  });

  it("keeps known rooms usable before the migration reaches a deployment", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function not found" } });
    expect((await loadPlayTools("local_versus")).has("replay")).toBe(true);
  });
});
