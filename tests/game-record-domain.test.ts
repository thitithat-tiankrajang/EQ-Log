import { describe, expect, it } from "vitest";
import {
  deriveCompletion,
  deriveModeKey,
  isTrainableCompletion,
} from "../src/features/gameRecords/domain";

describe("game record domain", () => {
  it("marks rule-driven endings as trainable natural completions", () => {
    const completion = deriveCompletion({
      matchControl: {},
      logs: [{ action: "end_game", actionDetail: { reason: "rack_out" } }],
    } as never);
    expect(completion).toEqual({ kind: "natural", reason: "rack_out", surrenderedSide: null });
    expect(isTrainableCompletion(completion)).toBe(true);
  });

  it("retains surrender while excluding it from bot-training data", () => {
    const completion = deriveCompletion({
      matchControl: { surrenderedSide: "B" },
      logs: [{ action: "end_game", actionDetail: { reason: "surrender", surrenderedSide: "B" } }],
    } as never);
    expect(completion).toEqual({ kind: "terminated", reason: "surrender", surrenderedSide: "B" });
    expect(isTrainableCompletion(completion)).toBe(false);
  });

  it("uses manual termination when a finished game has no natural end log", () => {
    expect(deriveCompletion({ logs: [], matchControl: {} } as never)).toMatchObject({
      kind: "terminated",
      reason: "manual",
    });
  });

  it("normalizes analytics modes independently from create-flow labels", () => {
    expect(
      deriveModeKey({ gameMode: "versus", botSide: "B", botDifficulty: "hard" } as never),
    ).toBe("aether_hard");
    expect(deriveModeKey({ gameMode: "solo" } as never)).toBe("solo_practice");
    expect(deriveModeKey({ gameMode: "versus", emailPlayMode: "direct" } as never)).toBe(
      "online_versus",
    );
  });
});
