import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { economyErrorNotice } from "../src/bot/catalog";
import { canonicalFromSnapshot, encodeCanonical } from "../src/domain/projection";
import { stageStartCanonical } from "../src/features/survival/repository";
import { createSurvivalTestGame } from "../src/features/survival/seededGame";

const read = (name: string) => readFileSync(`${process.cwd()}/supabase/migrations/${name}`, "utf8");
const catalog = read("20260929100000_bot_catalog_final.sql");
const stats = read("20260929110000_bot_stats_hardening.sql");
const economy = read("20260929120000_probot_economy.sql");
const boards = read("20260929130000_active_boards.sql");
const charging = read("20260929140000_room_creation_charging.sql");
const phase3 = [catalog, stats, economy, boards, charging];

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = source.indexOf("$$;", source.indexOf("$$", start) + 2);
  return source.slice(start, end);
}

describe("Stage sealed start", () => {
  it("is deterministic and independent of the player's name and account", () => {
    const sealed = stageStartCanonical(4242);
    expect(stageStartCanonical(4242)).toEqual(sealed);
    expect(sealed.inventory).toHaveLength(100);
    for (const [name, user] of [
      ["Ada", "00000000-0000-4000-8000-000000000001"],
      ["ผู้เล่น", undefined],
    ] as const) {
      const canonical = encodeCanonical(
        canonicalFromSnapshot(createSurvivalTestGame(4242, name, user), 1),
      ) as Record<string, unknown>;
      expect({
        inventory: canonical.inventory,
        scores: canonical.scores,
        activeSide: canonical.activeSide,
        turnNumber: canonical.turnNumber,
        startingSide: canonical.startingSide,
      }).toEqual(sealed);
    }
  });

  it("differs between seeds", () => {
    expect(stageStartCanonical(1).inventory).not.toEqual(stageStartCanonical(2).inventory);
  });
});

describe("economy error notices", () => {
  it("maps every server code to a player-facing message", () => {
    for (const code of [
      "funding_required",
      "funding_not_applicable",
      "allowance_free_plan",
      "allowance_not_configured",
      "allowance_weekly_cap",
      "allowance_empty",
      "insufficient_credits",
      "active_board_limit",
      "active_board_limit_unconfigured",
      "bot_pending",
      "stage_level_not_sealed",
      "stage_level_unavailable",
      "stage_start_mismatch",
      "stage_board_rewrite",
      "idempotency_conflict",
    ]) {
      expect(economyErrorNotice(`${code}: detail`), code).toEqual(expect.any(String));
    }
  });

  it("tells a seated-player refusal apart from the caller's own", () => {
    expect(
      economyErrorNotice(
        "active_board_limit: a seated player has 3 active boards already (limit 3)",
        "th",
      ),
    ).toContain("ผู้เล่นที่ถูกจัดที่นั่ง");
    expect(
      economyErrorNotice("active_board_limit: you have 3 active boards already (limit 3)", "th"),
    ).toContain("คุณมีกระดาน");
    expect(
      economyErrorNotice(
        "active_board_limit: a seated player has 3 active boards already (limit 3)",
        "en",
      ),
    ).toContain("A seated player");
    expect(
      economyErrorNotice("active_board_limit: you have 3 active boards already (limit 3)", "en"),
    ).toContain("You already have");
  });

  it("leaves unrelated errors alone", () => {
    expect(economyErrorNotice("live game not found")).toBeNull();
    expect(economyErrorNotice(undefined)).toBeNull();
  });
});

describe("Phase 3 migration contracts", () => {
  it("decides funding from the bot's access tier only, never its execution type", () => {
    const create = functionBody(charging, "create_bot_game");
    expect(create).toContain("bot.access_tier = 'pro'");
    expect(create).not.toMatch(/execution_type/);
    const charge = functionBody(economy, "probot_charge");
    expect(charge).not.toMatch(/execution_type|SERVER|CLIENT/);
  });

  it("never derives a Stage exemption from a bot key, a name or a client field", () => {
    const create = functionBody(charging, "create_bot_game");
    expect(create).not.toMatch(/stage5b|Survival|room_purpose/);
    expect(create).toContain("'normal'");
    const core = functionBody(charging, "create_live_game_core");
    expect(core).not.toMatch(/target_state\s*->>?\s*'(roomPurpose|purpose)'/);
    // The only caller that asks for purpose 'stage' is create_stage_attempt.
    const stageCallers = charging
      .split("create or replace function public.")
      .filter((fn) => /'stage',\s*new_room/.test(fn))
      .map((fn) => fn.slice(0, fn.indexOf("(")));
    expect(stageCallers).toEqual(["create_stage_attempt"]);
  });

  it("keeps bot statistics out of every economy and entitlement path", () => {
    const statistics = /bot_stat_(games|folders)|record_bot_stat|record_bot_game/;
    expect(economy).not.toMatch(statistics);
    expect(boards).not.toMatch(statistics);
    for (const name of ["create_bot_game", "create_stage_attempt", "probot_status_for"]) {
      expect(functionBody(charging, name)).not.toMatch(statistics);
    }
  });

  it("has no automatic refund, no silent fallback and no cleanup job", () => {
    for (const source of phase3) {
      expect(source).not.toMatch(/cron\.schedule|pg_cron/);
      expect(source).not.toMatch(/'refund'/);
    }
    const create = functionBody(charging, "create_bot_game");
    // One charge call, with the caller's own funding choice.
    expect(create.match(/probot_charge\(/g)).toHaveLength(1);
    expect(create).toMatch(/probot_charge\([^)]*target_funding/);
  });

  it("prepares Stage 5B as a free CLIENT bot that cannot be opened yet", () => {
    expect(catalog).toMatch(
      /\('stage5b', 'Stage 5B', 'stage5b', 'stage5b64', 'stage5b_standard', 'CLIENT',\s*'free', 'decided', false, false, 'pending'/,
    );
    expect(catalog).not.toMatch(/'CLIENT_WASM'/);
    expect(functionBody(catalog, "admin_set_bot_enabled")).toContain("bot_pending:");
  });
});
