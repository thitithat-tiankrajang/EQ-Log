import { beforeEach, describe, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({ configured: true }));
const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { from, rpc },
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
});

describe("starting a Stage", () => {
  it("still asks the server for the attempt, by level and request id only", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "stop after the attempt call" } });
    await expect(
      startSurvivalPractice({ id: "level-3", seed: 4242 }, "Ada", "user-1", "request-1"),
    ).rejects.toThrow("stop after the attempt call");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["create_stage_attempt"]);
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual([
      "target_level_id",
      "target_request_id",
      "target_state",
    ]);
    expect(args.target_level_id).toBe("level-3");
    expect(args.target_request_id).toBe("request-1");
  });

  it("surfaces the server's localised Stage refusal", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "stage_level_not_sealed: the level has no sealed start" },
    });
    await expect(
      startSurvivalPractice({ id: "level-3", seed: 4242 }, "Ada", "user-1"),
    ).rejects.toThrow("This Stage isn't ready to play yet");
  });

  it("says, in the player's language, why it cannot start", async () => {
    await expect(startSurvivalPractice({ id: "l", seed: 1 }, "Ada", null)).rejects.toThrow(
      "Sign in to play a Stage.",
    );
    engine.configured = false;
    chooseLocale("th");
    await expect(startSurvivalPractice({ id: "l", seed: 1 }, "Ada", "user-1")).rejects.toThrow(
      "สเตจต้องเชื่อมต่อเซิร์ฟเวอร์เกมก่อน",
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
