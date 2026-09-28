import type { BotDifficulty, BotEngine } from "../game";
import { getActiveLocale, type Locale } from "../i18n/locale";
import { serverErrorNotice, type ServerErrorCode } from "../i18n/serverErrors";
import { translate } from "../i18n/translate";

/**
 * The catalog key that names a bot to the server.
 *
 * The key is the ONLY bot fact a client sends when it creates a bot room. The
 * server looks it up in `bot_catalog` and copies the engine, strength, mode,
 * execution type and access tier onto the room from there; whatever bot fields
 * the client's state blob carries are overwritten. Every seeded key equals the
 * room's historical `mode_key`, so a room's key follows from what it already
 * records.
 */
export function botKeyFor(bot: { botEngine?: BotEngine; botDifficulty?: BotDifficulty }): string {
  if ((bot.botEngine ?? "authur") === "authur") return "authur_strong";
  return `aether_${bot.botDifficulty ?? "medium"}`;
}

/** The server refuses a bot turn, or a bot room, with a message that starts with this. */
export const BOT_DISABLED_PREFIX = "bot_disabled";

export function isBotDisabledMessage(message: string | null | undefined): boolean {
  return typeof message === "string" && message.includes(`${BOT_DISABLED_PREFIX}:`);
}

/** What the player is told while an administrator has disabled the bot. */
export function botDisabledNotice(locale: Locale = getActiveLocale()): string {
  return translate(locale, "errors.server.bot_disabled");
}

/** How a Pro-tier bot room is paid for. Always chosen explicitly by the player. */
export type BotFunding = "allowance" | "credit";

/**
 * The refusals `economyErrorNotice` explains: exactly the set Phase 3 shipped.
 * `bot_disabled` and `bot_closed` are answered separately by their callers.
 */
export const ECONOMY_ERROR_CODES = [
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
] as const satisfies readonly ServerErrorCode[];

/**
 * What the player is told when the server refuses a room for an economy or
 * board-limit reason. The server's message starts with a stable code; the
 * wording (from the catalogue, in the player's language) never invents a
 * reason the server did not give.
 */
export function economyErrorNotice(
  message: string | null | undefined,
  locale: Locale = getActiveLocale(),
): string | null {
  if (typeof message !== "string") return null;
  return serverErrorNotice(message, locale, ECONOMY_ERROR_CODES);
}

/** The server's answer to `get_my_probot_status`: the only source of truth. */
export type ProBotStatus = {
  evaluated_at: string;
  plan_key: string;
  plan_name: string;
  plan_ends_at: string | null;
  allowance: {
    capacity: number;
    available: number;
    regen_minutes: number | null;
    next_unit_at: string | null;
    reason: "ok" | "free_plan" | "not_configured" | "empty" | "weekly_cap";
  };
  weekly: { used: number; cap: number; remaining: number; week_start: string; week_end: string };
  credits: number;
  boards: { active: number; limit: number | null };
};
