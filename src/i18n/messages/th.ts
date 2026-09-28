import type { Catalog } from "../translate";

/** Thai. Same keys as `en.ts`; canonical product names stay untranslated. */
export const th: Catalog = {
  common: {
    language: {
      label: "ภาษา",
      en: "English",
      th: "ไทย",
    },
  },
  analysis: {
    botLevel: "{bot} · {depth} ตา",
  },
  study: {
    seeAnswerWith: "ดูเฉลยด้วย {bot}",
  },
  errors: {
    generic: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
    server: {
      funding_required: "เลือกวิธีใช้สิทธิ์ก่อนเริ่มเกมกับ Authur: โควตา Pro-Bot หรือใช้ 1 เครดิต",
      funding_not_applicable: "บอทตัวนี้เล่นฟรี ไม่ต้องใช้โควตาหรือเครดิต",
      allowance_free_plan: "แพ็กเกจ Free ไม่มีโควตา Pro-Bot — ใช้ 1 เครดิตแทนได้ถ้ามี",
      allowance_not_configured: "แพ็กเกจนี้ยังไม่ได้ตั้งค่าโควตา Pro-Bot",
      allowance_weekly_cap: "ใช้โควตา Pro-Bot ประจำสัปดาห์ครบแล้ว (รีเซ็ตวันจันทร์ 00:00 เวลาไทย)",
      allowance_empty: "โควตา Pro-Bot หมดชั่วคราว — จะเพิ่มขึ้นทีละ 1 ทุก 30 นาที",
      insufficient_credits: "เครดิต Pro-Bot ไม่พอ",
      active_board_limit: {
        self: "คุณมีกระดานที่กำลังเล่นครบจำนวนแล้ว — จบหรือยกเลิกเกมเดิมก่อนเริ่มเกมใหม่",
        seatedPlayer: "ผู้เล่นที่ถูกจัดที่นั่งมีกระดานที่กำลังเล่นครบจำนวนแล้ว",
      },
      active_board_limit_unconfigured:
        "ระบบยังไม่ได้ตั้งค่าจำนวนกระดานสูงสุด จึงเริ่มเกมใหม่ไม่ได้ — โปรดแจ้งผู้ดูแลระบบ",
      bot_pending: "บอทตัวนี้ยังไม่เปิดให้เล่น",
      bot_disabled:
        "บอทตัวนี้ถูกผู้ดูแลระบบปิดใช้งานชั่วคราว — เกมจะเล่นต่อได้เมื่อเปิดใช้งานอีกครั้ง",
      bot_closed: "บอทตัวนี้ไม่เปิดให้สร้างเกมใหม่แล้ว",
      stage_level_not_sealed: "ด่านนี้ยังไม่พร้อมให้เล่น (ยังไม่ได้ยืนยันตำแหน่งเริ่มต้น)",
      stage_level_unavailable: "ด่านนี้ไม่เปิดให้เล่น",
      stage_start_mismatch: "ตำแหน่งเริ่มต้นของด่านไม่ตรงกับที่กำหนด",
      stage_board_rewrite: "เกมในด่านไม่สามารถย้อนหรือเปลี่ยนตัวเบี้ยที่ลงไปแล้วได้",
      idempotency_conflict: "คำขอนี้ถูกใช้ไปแล้วกับการตั้งค่าอื่น — ลองสร้างใหม่อีกครั้ง",
    },
  },
};
