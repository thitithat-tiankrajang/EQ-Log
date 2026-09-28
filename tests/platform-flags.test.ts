import { describe, expect, it } from "vitest";
import { isArenaPlatformEnabled } from "../src/app/platformFlags";

describe("Arena platform rollout switch", () => {
  it("is off unless the build turns it on", () => {
    expect(isArenaPlatformEnabled({})).toBe(false);
    expect(isArenaPlatformEnabled({ VITE_ARENA_PLATFORM: "0" })).toBe(false);
    expect(isArenaPlatformEnabled({ VITE_ARENA_PLATFORM: "true" })).toBe(false);
    expect(isArenaPlatformEnabled({ VITE_ARENA_PLATFORM: "1" })).toBe(true);
  });

  it("is off in this build", () => {
    expect(isArenaPlatformEnabled()).toBe(false);
  });
});
