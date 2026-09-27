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

/** How a Pro-tier bot room is paid for. Always chosen explicitly by the player. */
export type BotFunding = "allowance" | "credit";

/**
 * What the player is told when the server refuses a room for an economy or
 * board-limit reason. The server's message starts with a stable code; the
 * wording here never invents a reason the server did not give.
 */
export function economyErrorNotice(message: string | null | undefined): string | null {
  if (typeof message !== "string") return null;
  const code = /\b(funding_required|funding_not_applicable|allowance_free_plan|allowance_not_configured|allowance_weekly_cap|allowance_empty|insufficient_credits|active_board_limit|active_board_limit_unconfigured|bot_pending|stage_level_not_sealed|stage_level_unavailable|stage_start_mismatch|stage_board_rewrite|idempotency_conflict):/.exec(
    message,
  )?.[1];
  switch (code) {
    case "funding_required":
      return "เลือกวิธีใช้สิทธิ์ก่อนเริ่มเกมกับ Authur: โควตา Pro-Bot หรือใช้ 1 เครดิต";
    case "funding_not_applicable":
      return "บอทตัวนี้เล่นฟรี ไม่ต้องใช้โควตาหรือเครดิต";
    case "allowance_free_plan":
      return "แพ็กเกจ Free ไม่มีโควตา Pro-Bot — ใช้ 1 เครดิตแทนได้ถ้ามี";
    case "allowance_not_configured":
      return "แพ็กเกจนี้ยังไม่ได้ตั้งค่าโควตา Pro-Bot";
    case "allowance_weekly_cap":
      return "ใช้โควตา Pro-Bot ประจำสัปดาห์ครบแล้ว (รีเซ็ตวันจันทร์ 00:00 เวลาไทย)";
    case "allowance_empty":
      return "โควตา Pro-Bot หมดชั่วคราว — จะเพิ่มขึ้นทีละ 1 ทุก 30 นาที";
    case "insufficient_credits":
      return "เครดิต Pro-Bot ไม่พอ";
    case "active_board_limit":
      return /a seated player/.test(message)
        ? "ผู้เล่นที่ถูกจัดที่นั่งมีกระดานที่กำลังเล่นครบจำนวนแล้ว"
        : "คุณมีกระดานที่กำลังเล่นครบจำนวนแล้ว — จบหรือยกเลิกเกมเดิมก่อนเริ่มเกมใหม่";
    case "active_board_limit_unconfigured":
      return "ระบบยังไม่ได้ตั้งค่าจำนวนกระดานสูงสุด";
    case "bot_pending":
      return "บอทตัวนี้ยังไม่เปิดให้เล่น";
    case "stage_level_not_sealed":
      return "ด่านนี้ยังไม่พร้อมให้เล่น (ยังไม่ได้ยืนยันตำแหน่งเริ่มต้น)";
    case "stage_level_unavailable":
      return "ด่านนี้ไม่เปิดให้เล่น";
    case "stage_start_mismatch":
      return "ตำแหน่งเริ่มต้นของด่านไม่ตรงกับที่กำหนด";
    case "stage_board_rewrite":
      return "เกมในด่านไม่สามารถย้อนหรือเปลี่ยนตัวเบี้ยที่ลงไปแล้วได้";
    case "idempotency_conflict":
      return "คำขอนี้ถูกใช้ไปแล้วกับการตั้งค่าอื่น — ลองสร้างใหม่อีกครั้ง";
    default:
      return null;
  }
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
