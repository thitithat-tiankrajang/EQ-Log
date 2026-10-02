import { beforeEach, describe, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({ configured: true }));
const { from, rpc, invoke } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), invoke: vi.fn() }));

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { from, rpc, functions: { invoke } },
}));
vi.mock("../src/bot/engineApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/bot/engineApi")>()),
  get isEngineApiConfigured() {
    return engine.configured;
  },
}));

import { chooseLocale, resetActiveLocale } from "../src/i18n/locale";
import { listMySurvivalWins, startSurvivalPractice } from "../src/features/survival/repository";

beforeEach(() => {
  engine.configured = true;
  window.localStorage.clear();
  resetActiveLocale();
  from.mockReset();
  rpc.mockReset();
  invoke.mockReset();
});

describe("starting a Stage", () => {
  it("still asks the server for the attempt, by level and request id only", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "stop after the attempt call" } });
    await expect(
      startSurvivalPractice({ id: "level-3" }, "Ada", "user-1", "request-1"),
    ).rejects.toThrow("stop after the attempt call");
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(["live-game"]);
    const args = invoke.mock.calls[0]![1].body as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(["levelId", "operation", "playerName", "requestId"]);
    expect(args.levelId).toBe("level-3");
    expect(args.requestId).toBe("request-1");
  });

  it("surfaces the server's localised Stage refusal", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: "stage_level_not_sealed: the level has no sealed start" },
    });
    await expect(startSurvivalPractice({ id: "level-3" }, "Ada", "user-1")).rejects.toThrow(
      "This Stage isn't ready to play yet",
    );
  });

  it("says, in the player's language, why it cannot start", async () => {
    await expect(startSurvivalPractice({ id: "l" }, "Ada", null)).rejects.toThrow(
      "Sign in to play a Stage.",
    );
    engine.configured = false;
    chooseLocale("th");
    invoke.mockResolvedValue({ data: { id: "trusted-stage" }, error: null });
    await expect(startSurvivalPractice({ id: "l" }, "Ada", "user-1")).resolves.toBe(
      "trusted-stage",
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("the player's recorded wins", () => {
  it("are read for this player only, since an administrator can read every attempt", async () => {
    const eq = vi.fn();
    const query = { select: vi.fn(() => query), eq };
    eq.mockReturnValueOnce(query).mockResolvedValueOnce({
      data: [{ level_id: "level-2" }],
      error: null,
    });
    from.mockReturnValue(query);
    await expect(listMySurvivalWins("user-1")).resolves.toEqual(new Set(["level-2"]));
    expect(from).toHaveBeenCalledWith("survival_attempts");
    expect(eq.mock.calls).toEqual([
      ["player_id", "user-1"],
      ["result", "win"],
    ]);
  });

  it("are empty without an account", async () => {
    await expect(listMySurvivalWins(null)).resolves.toEqual(new Set());
    expect(from).not.toHaveBeenCalled();
  });
});
