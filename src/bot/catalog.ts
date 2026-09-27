import type { BotDifficulty, BotEngine } from "../game";

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

export const BOT_DISABLED_NOTICE = "บอทตัวนี้ถูกผู้ดูแลระบบปิดใช้งานชั่วคราว — เกมจะเล่นต่อได้เมื่อเปิดใช้งานอีกครั้ง";
