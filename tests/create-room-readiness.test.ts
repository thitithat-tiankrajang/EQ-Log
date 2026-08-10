import { describe, expect, it } from "vitest";
import { getCreateRoomReadiness } from "../src/features/rooms/create/createRoomReadiness";
import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";

describe("create room readiness", () => {
  it("requires the creator to occupy one side in direct online play", () => {
    const result = getCreateRoomReadiness({
      mode: "direct_email",
      settings: {
        ...DEFAULT_NEW_GAME_SETTINGS,
        playerAUserId: "player-a",
        playerBUserId: "player-b",
      },
      userId: "creator",
    });
    expect(result).toEqual({
      ready: false,
      reason: "Choose which side uses your account.",
    });
  });

  it("rejects assigning the same account to both sides", () => {
    const result = getCreateRoomReadiness({
      mode: "hosted_email",
      settings: {
        ...DEFAULT_NEW_GAME_SETTINGS,
        playerAUserId: "same-player",
        playerBUserId: "same-player",
      },
      userId: "host",
    });
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("Side A and Side B must use different registered accounts.");
  });

  it("accepts local play without an account", () => {
    expect(
      getCreateRoomReadiness({
        mode: "hotseat",
        settings: DEFAULT_NEW_GAME_SETTINGS,
        userId: null,
      }),
    ).toEqual({ ready: true, reason: null });
  });
});
