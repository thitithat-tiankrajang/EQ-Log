import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { botDisabledNotice, botKeyFor, isBotDisabledMessage } from "../src/bot/catalog";
import { EngineApiError } from "../src/bot/engineApi";
import {
  BOT_DISABLED_RECHECK_MS,
  botRetryDelay,
  isDesyncBotFailure,
  isRetryableBotFailure,
} from "../src/bot/botController";

const migration = readFileSync(
  `${process.cwd()}/supabase/migrations/20260927120000_bot_catalog.sql`,
  "utf8",
);

function functionBody(name: string): string {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = migration.indexOf("end; $$;", start);
  return migration.slice(start, end);
}

describe("bot catalog keys", () => {
  it("names every existing bot by the mode key its rooms already record", () => {
    expect(botKeyFor({ botEngine: "authur", botDifficulty: "super" })).toBe("authur_strong");
    // An Authur room's difficulty is not part of its identity.
    expect(botKeyFor({ botEngine: "authur", botDifficulty: "medium" })).toBe("authur_strong");
    expect(botKeyFor({ botEngine: "aether", botDifficulty: "max" })).toBe("aether_max");
    expect(botKeyFor({ botEngine: "aether" })).toBe("aether_medium");
    // A room written before botEngine existed defaults the same way the app does.
    expect(botKeyFor({})).toBe("authur_strong");
  });
});

describe("disabled bot on the engine path", () => {
  const message = "bot_disabled: Authur has been disabled by an administrator.";

  it("recognises the database's refusal inside the engine's generic forbidden", () => {
    expect(isBotDisabledMessage(message)).toBe(true);
    expect(new EngineApiError("forbidden", message).code).toBe("bot_disabled");
    expect(new EngineApiError("forbidden", "No such game, or it is not yours to read.").code).toBe(
      "forbidden",
    );
    expect(isBotDisabledMessage("the bot_disabled flag")).toBe(false);
  });

  it("keeps checking slowly so a re-enabled bot resumes by itself", () => {
    const error = new EngineApiError("forbidden", message);
    expect(isRetryableBotFailure(error)).toBe(true);
    expect(isDesyncBotFailure(error)).toBe(false);
    expect(botRetryDelay(error, 0)).toBe(BOT_DISABLED_RECHECK_MS);
    expect(botRetryDelay(error, 9)).toBe(BOT_DISABLED_RECHECK_MS);
    expect(botDisabledNotice("th")).toMatch(/ปิดใช้งาน/);
    expect(botDisabledNotice("en")).toMatch(/disabled this bot/);
  });
});

describe("bot catalog migration", () => {
  it("takes bot configuration from the catalog, not from the state blob", () => {
    const trigger = functionBody("derive_live_bot_config");
    expect(trigger).toContain("bot_room_requires_catalog");
    expect(trigger).toContain("new.bot_difficulty := bot.difficulty");
    expect(trigger).toContain("new.bot_access_tier := bot.access_tier");
    expect(trigger).toContain("new.bot_execution_type := bot.execution_type");
    expect(trigger).not.toMatch(/new\.bot_difficulty\s*:=\s*coalesce\(\s*nullif\(new\.state/);

    const core = functionBody("create_live_game_core");
    expect(core).toContain("'botEngine', bot.engine_family");
    expect(core).toContain("when target_bot_key is not null then bot.mode_key");
  });

  it("freezes every bot identity column for the life of a room", () => {
    const freeze = functionBody("freeze_live_bot_config");
    for (const column of [
      "bot_side",
      "bot_difficulty",
      "bot_key",
      "bot_access_tier",
      "bot_execution_type",
      "bot_config_version",
    ]) {
      expect(freeze).toContain(`new.${column} is distinct from old.${column}`);
    }
  });

  it("never lets a room take a bot mode, or a bot room change mode, after creation", () => {
    const freeze = functionBody("freeze_live_bot_config");
    expect(freeze).toContain(
      "(old.bot_key is not null and new.mode_key is distinct from old.mode_key)",
    );
    expect(freeze).toContain(
      "bot_room_requires_catalog: a room cannot become a bot room after creation",
    );

    const configure = functionBody("update_live_game_state");
    expect(configure).toContain("when live.bot_key is not null then mode_key");
    expect(configure).toContain(
      "when caller_can_configure and coalesce(target_state ->> 'botSide', '') = ''",
    );

    // Seating reads the room's column, not the client-written state.
    const join = functionBody("join_live_game");
    expect(join).toContain("live.game_mode = 'solo' or live.bot_side is not null");
    expect(join).not.toContain("live.state ->> 'botSide'");
  });

  it("keys unknown legacy modes to the Aether tier the engine actually plays", () => {
    const backfill = migration.slice(
      migration.indexOf("update public.room_live l\n   set bot_key = coalesce("),
      migration.indexOf("where l.bot_side is not null and l.bot_key is null;"),
    );
    expect(backfill).toContain("where c.bot_key = l.mode_key");
    expect(backfill).toContain("'aether_' || l.bot_difficulty");
    expect(backfill).not.toContain("botEngine");
  });

  it("closes the anon grant on the old creation path and exposes the core to nobody", () => {
    expect(migration).toContain(
      "revoke all on function public.create_live_game(jsonb, text, text, uuid, text, uuid) from public, anon;",
    );
    expect(migration).toMatch(
      /revoke all on function public\.create_live_game_core\([^)]*\)\s+from public, anon, authenticated, service_role;/,
    );
    expect(migration).not.toMatch(/grant execute on function public\.create_live_game_core/);
    expect(migration).toMatch(
      /grant execute on function public\.create_bot_game\([^)]*\)\s+to authenticated;/,
    );
    expect(migration).toContain(
      "revoke all on table public.bot_catalog, public.bot_catalog_audit from public, anon, authenticated;",
    );
    expect(migration).toContain(
      "revoke all on table public.room_creation_requests from public, anon, authenticated;",
    );
  });

  it("gates every catalog change on is_admin and records it", () => {
    for (const name of ["admin_set_bot_enabled", "admin_upsert_bot", "admin_list_bots"]) {
      expect(functionBody(name)).toContain("if not public.is_admin() then");
    }
    expect(functionBody("admin_set_bot_enabled")).toContain("insert into public.bot_catalog_audit");
    expect(functionBody("admin_upsert_bot")).toContain("insert into public.bot_catalog_audit");
  });

  it("enforces hard disable on the engine context and on bot-side commits", () => {
    expect(functionBody("get_live_game_engine_context")).toContain(
      "raise exception 'bot_disabled:",
    );
    const commit = functionBody("commit_live_game_command");
    // Locked, and read whatever its value: a disable waits for bot commits in flight.
    expect(commit).toMatch(
      /select c\.enabled, c\.display_name into bot_enabled, disabled_name\s+from public\.bot_catalog c where c\.bot_key = live\.bot_key\s+for share;/,
    );
    expect(commit).toContain(
      "(target_issued_by = live.bot_side or live.canonical ->> 'activeSide' = live.bot_side)",
    );
    expect(commit).toContain("raise exception 'bot_disabled:");
  });

  it("seeds every bot as a provisional free default and adds no quota, credit or plan logic", () => {
    const seed = migration.slice(
      migration.indexOf("insert into public.bot_catalog\n"),
      migration.indexOf("on conflict (bot_key) do nothing;"),
    );
    const rows = seed.match(/\('(?:authur|aether)_[a-z]+',[^\n]*\)/g) ?? [];
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row).toContain("'free', 'provisional'");

    // The only "quota" is the existing private-library limit, carried over unchanged.
    expect(migration.match(/quota/gi)).toEqual(["quota"]);
    expect(migration).toContain("'private library quota reached'");
    expect(migration).not.toMatch(
      /\b(credits?|allowance|entitlement|probot|plan_key|weekly|stripe)\b/i,
    );
  });
});
