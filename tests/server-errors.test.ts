import { afterEach, describe, expect, it } from "vitest";
import { ECONOMY_ERROR_CODES, economyErrorNotice } from "../src/bot/catalog";
import { chooseLocale, resetActiveLocale } from "../src/i18n/locale";
import { SERVER_ERROR_CODES, serverErrorCode, serverErrorNotice } from "../src/i18n/serverErrors";

afterEach(() => {
  window.localStorage.clear();
  resetActiveLocale();
});

describe("Phase 3 error prefixes", () => {
  it("parse from the database's message for every known code", () => {
    for (const code of SERVER_ERROR_CODES) {
      expect(serverErrorCode(`${code}: detail`), code).toBe(code);
      expect(serverErrorCode(new Error(`${code}: detail`)), code).toBe(code);
      // Supabase errors carry the message; their `code` is a SQLSTATE, not ours.
      expect(serverErrorCode({ message: `${code}: detail`, code: "P0001" }), code).toBe(code);
    }
  });

  it("read the Ranked function's { error, code } body", () => {
    expect(
      serverErrorCode({
        error: "You already have the maximum number of active boards.",
        code: "active_board_limit",
      }),
    ).toBe("active_board_limit");
  });

  it("never read the unconfigured limit as the limit itself", () => {
    expect(
      serverErrorCode("active_board_limit_unconfigured: the active board limit is not configured"),
    ).toBe("active_board_limit_unconfigured");
    // The Ranked function forwards this one as a raw 400 message today.
    expect(
      serverErrorNotice(
        {
          error: "active_board_limit_unconfigured: the active board limit is not configured",
        },
        "en",
      ),
    ).toMatch(/isn't configured/);
  });

  it("do not match a code that is only a substring of other text", () => {
    expect(serverErrorCode("the bot_disabled flag")).toBeNull();
    expect(serverErrorCode("xactive_board_limit: 3")).toBeNull();
  });
});

describe("localised notices", () => {
  it("exist in English and Thai for every known code", () => {
    for (const code of SERVER_ERROR_CODES) {
      const english = serverErrorNotice(`${code}: detail`, "en");
      const thai = serverErrorNotice(`${code}: detail`, "th");
      expect(english, code).toEqual(expect.any(String));
      expect(thai, code).toEqual(expect.any(String));
      expect(english, code).not.toBe(thai);
    }
  });

  it("follow the active language when none is given", () => {
    expect(serverErrorNotice("insufficient_credits: 0")).toBe(
      "You don't have enough Pro-Bot Credits.",
    );
    chooseLocale("th");
    expect(serverErrorNotice("insufficient_credits: 0")).toBe("เครดิต Pro-Bot ไม่พอ");
  });

  it("tell whose board limit it is, from the database or the Ranked function", () => {
    expect(
      serverErrorNotice("active_board_limit: a seated player has 3 active boards already", "en"),
    ).toMatch(/^A seated player/);
    expect(
      serverErrorNotice(
        {
          error: "The other player already has the maximum number of active boards.",
          code: "active_board_limit",
        },
        "en",
      ),
    ).toMatch(/^A seated player/);
    expect(
      serverErrorNotice("active_board_limit: you have 3 active boards already (limit 3)", "en"),
    ).toMatch(/^You already have/);
  });
});

describe("unknown errors fail safely", () => {
  it("yield no notice, so the caller keeps its own fallback", () => {
    expect(serverErrorNotice("live game not found", "en")).toBeNull();
    expect(
      serverErrorNotice({ error: "Ranked request failed.", code: "whatever" }, "en"),
    ).toBeNull();
    // (ranked_room_claimed stood here until C7 made it a real code.)
    expect(serverErrorNotice({ code: "ranked_room_haunted" }, "en")).toBeNull();
    expect(serverErrorNotice(undefined, "en")).toBeNull();
    expect(serverErrorNotice(42, "th")).toBeNull();
  });
});

describe("economyErrorNotice keeps Phase 3's contract", () => {
  it("explains exactly the codes Phase 3 shipped, and not bot_disabled or bot_closed", () => {
    for (const code of ECONOMY_ERROR_CODES)
      expect(economyErrorNotice(`${code}: detail`), code).toEqual(expect.any(String));
    expect(economyErrorNotice("bot_disabled: Authur has been disabled.")).toBeNull();
    expect(economyErrorNotice("bot_closed: Aether is not available for new games.")).toBeNull();
    expect(economyErrorNotice(null)).toBeNull();
  });
});
