# EQ Lab non-Play production architecture

เอกสารนี้บันทึกผล refactor ทุกหน้าที่ไม่ใช่ `#/play/:id` และ invariant ที่ต้องรักษาไว้เมื่อพัฒนาต่อ

## 1. Product and privacy model

เกมที่กำลังเล่นมี scope และ archive policy ที่เปลี่ยนไม่ได้ตลอดอายุห้อง:

- `public`: สมาชิกที่ approved อ่าน Live และ History ได้
- `region`: อ่านได้เฉพาะ account ที่ได้รับ region เดียวกันและมีสถานะ approved หรือ admin
- `private`: อ่านได้เฉพาะ owner/player; เมื่อจบเลือกบันทึกถาวรหรือไม่เก็บ log
- admin เป็นผู้ assign `profiles.region_id`; user ห้าม assign หรือ approve ตัวเอง
- สร้างห้องใหม่ได้จากปุ่ม Play ตรงกลาง bottom navigation เท่านั้น
- admin ย้าย snapshot ที่จบแล้วจาก Public ไป Region ได้ทางเดียว; Region ย้ายกลับ Public ไม่ได้
- frontend filtering มีไว้เพื่อ UX เท่านั้น ขอบเขตความลับจริงต้องบังคับด้วย PostgreSQL RLS

เหตุผล: ยึด privacy by design และ defense in depth ต่อให้ผู้ใช้แก้ URL หรือเรียก API เองก็ต้องอ่านเกมข้าม region ไม่ได้

Migration ที่เป็น source of truth อยู่ที่ `supabase/game_archives_migration.sql`; deployment order และ rollback checklist อยู่ใน `GAME_RECORDS_ARCHITECTURE.md`

## 2. Route and module boundaries

Route หลักเป็น addressable URL ทั้งหมด:

- `#/public`, `#/public/history`
- `#/region`, `#/region/history`
- `#/create` (entry point เดียวสำหรับ Public, Region, Private Saved และ No-log)
- `#/public/join`, `#/region/join`
- `#/private`, `#/private/:folderId`, `#/private?view=trash`
- `#/profile`
- `#/admin/users`, `#/admin/regions`
- `#/room/:id`, `#/play/:id`

`AppRoot` แยก non-Play application กับ legacy Play application ที่ route boundary แบบ lazy loading ทั้ง JavaScript และ CSS หน้า Home จึงไม่ต้องดาวน์โหลด stylesheet ของหน้า Play

หลักที่ใช้คือ deep modules และ single responsibility: router แปลง URL, `RoomScope` นิยาม privacy scope, application controller orchestrate adapter, page components render UX, Supabase RLS ตัดสิน authorization ไม่กระจาย logic เดียวกันอยู่ทุก component

## 3. UI system

`ApplicationShell` เป็น shell เดียวสำหรับ Home, Create, Join, Waiting, Private, Profile และ Admin ประกอบด้วย skip link, brand, page heading, route focus management, responsive content container และ bottom navigation 5 รายการ: Public, Region, Play, Private, Profile

shared primitives ที่ต้อง reuse:

- `Sheet`, `ConfirmSheet`, `TextPromptSheet`: dialog semantics, focus trap, Escape, focus restore, body scroll lock
- `ChoiceCardGroup`: radio semantics, roving tab index, Arrow/Home/End keyboard control
- `FieldRow`: label-control association, stable hint/error ids
- `ActionDock`: action หลักอยู่ใน thumb zone บน mobile และแสดงเหตุผลเมื่อ disabled
- `OverflowMenu`: ซ่อน action ความถี่ต่ำและ destructive action ไว้หลังเมนูที่มี label

มาตรฐานเป้าหมายคือ semantic HTML, WCAG 2.2 AA, keyboard-only operation, visible focus, text contrast อย่างน้อย 4.5:1 สำหรับข้อความปกติ, target อย่างน้อย 44px ใน controls หลัก, reduced motion และไม่เกิด horizontal overflow ตั้งแต่ 320px ขึ้นไป

## 4. Responsive strategy

- mobile-first layout ที่ 320–640px
- content container สูงสุด 1180px
- Public/Region แยก Live กับ History; History โหลดครั้งละ 48 รายการเพื่อรองรับเพดาน 100,000 โดยไม่ดึงทั้งตาราง
- Create/Join/Waiting ใช้ sticky bottom action พร้อม safe-area inset บน mobile
- room cards เป็นหนึ่งคอลัมน์บน mobile และ grid บนจอกว้าง
- Admin rows ลดจากหลายคอลัมน์เป็น identity/status/region/actions stack

ไม่มี breakpoint ตามชื่ออุปกรณ์ การเปลี่ยน layout อิงพื้นที่ที่ component ต้องใช้ เพื่อลด device-specific CSS

## 5. Reliability and performance

- loading, empty, access denied, sync error และ retry state เป็น first-class UI
- optimistic ready update rollback เมื่อ request ล้มเหลว
- room mutations คืนผล success/failure แบบ discriminated result ป้องกัน delete/start เดินต่อหลัง request พัง
- top-level error boundary มี recovery action และส่ง `eq-lab:error` event ให้ telemetry adapter ภายนอกต่อได้
- room realtime subscription re-fetch หลัง reconnect
- PWA navigation ใช้ network-first และ hashed assets ใช้ cache-first
- non-Play CSS production bundle ลดจากประมาณ 286 KB เหลือประมาณ 46 KB; Play CSS ประมาณ 240 KB โหลดเฉพาะเมื่อเข้าเกม

## 6. Quality gates

ก่อน merge หรือ deploy ให้รัน:

```bash
npm run check
npm run test:e2e
npm audit --omit=dev
```

`npm run check` ครอบคลุม Prettier, ESLint สำหรับ non-Play scope, TypeScript, Vitest และ production build ส่วน E2E รัน desktop + mobile Chromium พร้อม axe WCAG checks และ horizontal-overflow checks

## 7. Deployment checklist

1. สำรองฐานข้อมูลและรัน migration ใน staging ก่อน
2. ตรวจว่า region RLS ปฏิเสธ user ต่าง region ทั้ง list, direct room URL และ realtime row
3. ทดสอบ admin create/rename/delete region และ assign/unassign user
4. รัน quality gates ทั้งหมด
5. deploy static build แล้วตรวจ Public, Region, Create, Join, Waiting และ Admin ที่ 390px กับ desktop
6. ตรวจ production telemetry, auth callback URL, service-worker update และ rollback artifact
