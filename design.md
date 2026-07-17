# EQ Lab — Mobile-first UX/UI Redesign (ทุกหน้า ยกเว้นหน้า Play)

> เอกสารนี้คือ spec สำหรับออกแบบ UX/UI ใหม่ของทุกหน้า **ยกเว้นหน้า Play** (`#/play/:id`)
> เป้าหมาย: ใช้บนโทรศัพท์เป็นหลัก, เริ่มเล่นได้เร็ว, ตั้งค่าได้ง่ายแม้ config เยอะ,
> ทุกการตัดสินใจมีเหตุผลกำกับ และข้อความทุกชิ้นอธิบายได้ว่าเขียนทำไม
>
> เวอร์ชันก่อนหน้าของไฟล์นี้ (Material AI Design System template) อยู่ใน git history
> ส่วนที่ยังใช้จริงถูกยกมาไว้ใน §8 Visual language แล้ว
> การออกแบบ Edit Board / Branching ของหน้า Play ยังอยู่ที่
> [`EDIT_BOARD_BRANCHING_DESIGN.md`](./EDIT_BOARD_BRANCHING_DESIGN.md) — ไม่แตะในรอบนี้

---

## 0. ขอบเขตและหลักฐาน

หน้าที่อยู่ในขอบเขต (route → component หลัก):

| Route | หน้า | Component |
|---|---|---|
| `#/` | Home / Lobby (แท็บ Rooms · Members · Stats) | `Lobby.tsx` + `lobby/*` |
| `#/create`, `#/create?mode=solo` | สร้างห้อง | `CreateRoomPage.tsx` + `CreateRoomPanel.tsx` |
| `#/join` | เข้าห้องด้วยโค้ด | `JoinRoomPage.tsx` |
| `#/room/:id` | ห้องรอ (waiting room) | `WaitingRoomPage.tsx` + `pregame/*` |
| — | จอ auth (login / ตั้งชื่อ / รออนุมัติ / ถูกบล็อก) | `auth.tsx` |
| — | Admin panel (modal) | `admin.tsx` |
| — | Loading / sync overlay | `LoadingActivity.tsx` |

การ audit ทำจากโค้ดจริง + เปิดแอปจริงที่ viewport 375×812 (iPhone-class)
ปัญหาที่อ้างถึงทั้งหมดเห็นจริงบนหน้าจอหรือยืนยันจากโค้ดแล้ว ไม่ใช่การคาดเดา

---

## 1. ปัญหาปัจจุบัน (audit findings)

เรียงตามความรุนแรงต่อ "เริ่มเล่นบนมือถือ":

### P0 — บั๊กหรือทำ flow พังบนมือถือ

1. **ช่อง search ในแท็บ Rooms แตกเป็นกล่องเปล่าสูง ~250px** ที่ 375px
   (`.room-filters-search` ใน `60-filters.css`) — ผู้ใช้เจอกล่องขาวใหญ่กั้นระหว่างปุ่ม
   กับรายการห้องทันทีที่เปิดแอป
2. **เหตุผลที่ปุ่มถูก disable ซ่อนอยู่ใน `title=` tooltip** — บนจอสัมผัสไม่มี hover
   ผู้ใช้เห็นแค่ปุ่มจาง ๆ กดไม่ได้โดยไม่รู้สาเหตุ จุดที่โดนจริง:
   - ปุ่ม **Start room** ของหน้า Create (เหตุผล เช่น "Enter two valid player emails…")
   - ปุ่ม **Start game** ของ waiting room ("Waiting for Side B to be ready.")
   - ปุ่ม 5 ตัวของ Play mode (คำอธิบายโหมดทั้งหมดอยู่ใน tooltip)
   - ปุ่มไอคอนบน room card (rename/duplicate/export/delete)
3. **ใช้ `window.prompt/confirm/alert`** สำหรับ rename ห้อง, ลบห้อง/สมาชิก,
   error ตอน import — หน้าตาหลุดธีม, ใน in-app browser บางตัวถูกบล็อกเงียบ ๆ

### P1 — เริ่มเล่นยากบนมือถือ

4. **หน้า Home ครึ่งจอแรกไม่มี action** — eyebrow + H1 + คำโปรย + account chip
   กินพื้นที่ ~40% ก่อนถึงปุ่ม Play Alone และไม่มีทาง "กลับเข้าเกมที่ค้างอยู่"
   โดยไม่เลื่อนหารายการห้องเอง ทั้งที่ use case ที่บ่อยที่สุดคือเปิดแอปกลับเข้าห้องเดิม
5. **Play mode 5 ตัวเลือกเป็นศัพท์ภายใน ไม่มีคำอธิบายบนจอ** —
   "Hot-seat (this device)", "Solo · System draw", "Online with host", "Hosted solo",
   "Direct online" ผู้ใช้ต้องเดาก่อนเลือก แล้วค่อยเห็น hint หลังเลือกแล้ว
   (เทียบ-ก่อน-เลือกไม่ได้เลย)
6. **ฟอร์ม Create ยาว ~3 จอโดยทุกอย่างสำคัญเท่ากันหมด** — room name ขึ้นก่อนทั้งที่
   ไม่มีผลต่อเกม, ปุ่ม submit อยู่ล่างสุด, ไม่มีสรุปว่าสร้างแล้วจะเกิดอะไรต่อ
7. **Waiting room เอา action หลักไว้ล่างสุด** — host ต้องเลื่อนผ่าน participants +
   config ทั้งหมดกว่าจะถึงปุ่ม Start game; ผู้เล่นก็ต้องเลื่อนหา Ready

### P2 — จุดเสียดทานสะสม

8. **Room card ใช้พื้นที่แพงกับ action ที่นานๆ ใช้ที** — แถบไอคอน 4 ปุ่ม
   (rename/duplicate/export/delete) ติดถาวรทุกใบ ปุ่มลบ (ทำลายข้อมูล) อยู่ห่างนิ้วโป้ง
   แค่ 1 tap และ์ไอคอนอย่างเดียวไม่มี label
9. **แท็บ lobby ตกบรรทัด** ที่ 375px (Rooms/Members อยู่แถวบน Stats หลุดไปแถวสอง)
10. **ปุ่ม New room / Import ในแท็บ Rooms ซ้ำกับการ์ด Create Room ข้างบน** ในจอเดียวกัน
11. **คำที่ใช้ไม่ตรงกับสิ่งที่เกิด** — "Start room" ที่จริงคือสร้างห้องรอ (ยังไม่เริ่มเกม),
    "Cancel room" ที่จริงคือลบห้องถาวร, สถานะ "Draft" ที่จริงคือห้องรอเริ่ม,
    role บนการ์ดแสดง "best SPECTATOR" (ชื่อเจ้าของ+role ชนกันไม่มีตัวคั่น)
12. **Stats เป็นตาราง 8 คอลัมน์** — ที่ 375px ต้องบีบ font 12px และเลื่อนแนวนอน
13. **"Choose member" ไม่บอกว่า link ไปทำไม** (ที่จริงคือผูกกับ directory เพื่อรวมสถิติ)
14. **Timer มี "No timer" ซ่อนอยู่ท้าย dropdown** และไม่บอกว่าทำไม default = 22 นาที
    (22 นาที/ฝั่ง คือกติกาแข่ง A-Math มาตรฐาน — ควรพูดออกมา)

---

## 2. หลักการออกแบบ (ทุกข้อมีเหตุผล ใช้ตัดสินทุกหน้า)

| # | หลักการ | เหตุผล |
|---|---|---|
| D1 | **มือถือคือ canvas หลัก** ออกแบบที่ 360–430px ก่อน แล้วค่อยขยาย ≥760px (breakpoint เดียวกับ `MOBILE_LAYOUT_MAX_PX = 759` ที่หน้า Play ใช้อยู่) | ผู้ใช้จริงบันทึกเกมข้างกระดานด้วยโทรศัพท์ desktop ตอนนี้ดีอยู่แล้วตามโจทย์ |
| D2 | **Action หลักของหน้าอยู่ใน sticky bottom bar เสมอ** (create / start / ready / join) พร้อม safe-area inset | โซนนิ้วโป้งคือที่ที่กดง่ายที่สุดบนมือถือ และหน้า Play มี `MobileActionBar` อยู่แล้ว → ทั้งแอปพูดภาษาเดียวกัน |
| D3 | **ปุ่ม disable ต้องมีเหตุผลเป็นตัวหนังสือมองเห็นได้เหนือปุ่ม ห้ามใช้ `title=` เป็นที่เก็บข้อมูลสำคัญ** | จอสัมผัสไม่มี hover — tooltip เท่ากับไม่มีข้อมูล |
| D4 | **เลือกก่อนเห็นคำอธิบาย = ผิด** ตัวเลือกใหญ่ (play mode ฯลฯ) ใช้ radio card ที่มีชื่อ + ประโยคผลลัพธ์ 1 บรรทัดบนหน้าจอตลอดเวลา | ผู้ใช้ต้องเทียบตัวเลือกได้โดยไม่ต้องลองผิด |
| D5 | **Progressive disclosure**: จำเป็น (โหมด, ผู้เล่น, เวลา) เห็นทันที / ปรับละเอียด (tile draw, rack visibility, ชื่อห้อง) พับใน "Advanced" ที่โชว์ค่าปัจจุบันบนหัวข้อ | config เยอะได้ แต่ต้องไม่บังทางคนที่อยากเริ่มเลย ค่า default ต้องดีพอให้ข้ามได้ทั้ง section |
| D6 | **Action ที่นานๆใช้/ทำลายข้อมูล อยู่หลังเมนู ⋯ + confirm sheet ในแอป** | ลดพื้นที่การ์ด, กันกดพลาด, เลิกพึ่ง `window.confirm` |
| D7 | **หนึ่งความหมาย = หนึ่งคำ ทั้งแอป** (นิยามใน §7) ปุ่มบอก "สิ่งที่จะเกิดขึ้นถัดไป" ไม่ใช่ชื่อ feature | คำเพี้ยนกันระหว่างหน้า = ผู้ใช้ต้องแปลใหม่ทุกหน้า |
| D8 | **Ergonomics ขั้นต่ำ**: tap target ≥ 44×44px, input font ≥ 16px (กัน iOS auto-zoom), ห้าม overflow แนวนอน, สถานะใช้ สี+คำ เสมอ (ไม่ใช้สีเดี่ยว) | มาตรฐาน accessibility ที่ราคาถูกแต่ผลสูง |
| D9 | **ทุก string อยู่ใน `uiText.ts`** (ขยายไฟล์เดิม) ไม่ hardcode ในคอมโพเนนต์ | บังคับความสม่ำเสมอ + เปิดทางทำภาษาไทยทีหลังในไฟล์เดียว |
| D10 | **ภาษา UI: อังกฤษแบบง่าย** (คงเดิม) | หน้า Play (นอกขอบเขต) เป็นอังกฤษ — เปลี่ยนเฉพาะฝั่ง lobby จะได้แอปสองภาษาครึ่งๆกลางๆ ที่แย่กว่าเดิม; D9 เตรียมทางไว้ถ้าจะทำไทยทั้งแอป |

---

## 3. แพตเทิร์นกลางที่สร้างครั้งเดียวใช้ทุกหน้า

คอมโพเนนต์ใหม่ 5 ตัว (ทั้งหมดเป็นเวอร์ชัน generic ของสิ่งที่หน้า Play มีอยู่แล้ว):

1. **`ActionDock`** — แถบล่าง sticky: ปุ่ม primary เต็มความกว้าง + แถว "เหตุผล/สถานะ"
   เหนือปุ่ม (ตอบ D2+D3) บน desktop (≥760px) แถบนี้กลายเป็นปุ่มปกติท้าย section เดิม
   — desktop ไม่เปลี่ยนโครง
2. **`ChoiceCardGroup`** — radio card แนวตั้ง: ไอคอน + ชื่อ + ประโยคผลลัพธ์ 1 บรรทัด
   + ติ๊กถูกด้านขวาเมื่อถูกเลือก (ตอบ D4) ใช้กับ play mode, role, tile draw
3. **`Sheet`** — bottom sheet บนมือถือ / dialog กลางจอบน desktop ใช้กับ: confirm ลบ,
   rename, filter, admin panel (แทน `window.*` ทั้งหมด — ตอบ D6)
4. **`OverflowMenu`** — ปุ่ม ⋯ เปิด Sheet รายการ action พร้อม label + ไอคอน
5. **`FieldRow`** — label + control + คำอธิบายบรรทัดเดียว (ใต้ control) + error
   สีแดงพร้อมข้อความ ตำแหน่งคงที่ทุกฟอร์ม

กติกาที่มากับแพตเทิร์น:

- ปุ่ม primary disabled → `ActionDock` แสดงบรรทัดเหตุผล เช่น
  `⚠ Waiting for Side B to tap Ready` (ข้อความเดียวกับที่เคยอยู่ใน tooltip)
- Sheet ทุกตัวปิดได้ด้วยปุ่ม Cancel ที่มองเห็น + ลากลง + tap ฉากหลัง
- ลำดับใน confirm sheet: ประโยคผลลัพธ์ ("Delete "Friday practice"? Turn history
  will be lost.") → ปุ่มทำลาย (แดง) → Cancel

---

## 4. การออกแบบรายหน้า

### 4.1 Home (`#/`)

**เจตนา:** เปิดแอปแล้วภายในจอแรกต้องทำ 1 ใน 3 อย่างได้ทันที —
กลับเข้าห้องล่าสุด / เริ่มใหม่ / เข้าห้องด้วยโค้ด

```
┌──────────────────────────────┐
│ EQ Lab            (๏) (⚙)   │ ← แถวเดียว: brand ย่อ + account avatar + admin
├──────────────────────────────┤
│ ▶ CONTINUE                   │ ← มีเฉพาะเมื่อมีห้อง playing/waiting ของเรา
│ ┌──────────────────────────┐ │
│ │ Friday practice   ▸ T7   │ │   แตะ = เข้าห้องทันที (ใช้ห้องที่ updatedAt
│ │ Namfon 170 · Mek 19      │ │   ล่าสุดที่เราเป็น owner/player)
│ └──────────────────────────┘ │
│ START                        │
│ ┌────────────┬─────────────┐ │
│ │ + New match│ ⌗ Join with │ │ ← การ์ดคู่ครึ่งความกว้าง สูง ~72px
│ │            │   a code    │ │
│ └────────────┴─────────────┘ │
│ ┌──────────────────────────┐ │
│ │ ◉ Practice alone         │ │ ← แถวเตี้ย รองจากสองอันบน
│ └──────────────────────────┘ │
├──────────────────────────────┤
│ [Rooms 17] [Members] [Stats] │ ← แท็บ 3 ช่องเท่ากัน ไอคอนบน+labelล่าง จบใน 1 แถว
├──────────────────────────────┤
│ (เนื้อหาแท็บ — §4.2)         │
└──────────────────────────────┘
```

เหตุผลรายจุด:

- **ตัด hero copy ("Record real-life matches and review…") ออกจากมือถือ** —
  คนที่เปิดแอปคือคนที่รู้แล้วว่าแอปทำอะไร คำโปรยมีไว้ขายของ ไม่ได้มีไว้ใช้งาน
  (desktop คงไว้ได้ ไม่กระทบ)
- **Continue มาก่อน Start** — เกมหนึ่งกินเวลาหลายสิบนาทีและถูกเปิด-ปิดหลายรอบ
  ความถี่ "กลับเข้าเกมเดิม" > "สร้างเกมใหม่" การ์ดนี้ตัดขั้นตอน เลื่อนหา→กรอง→แตะ
  เหลือแตะเดียว
- **"New match" ไม่ใช่ "Create Room"** — ผู้ใช้คิดเป็น "จะเล่น/บันทึกแมตช์ใหม่"
  ส่วน "room" เป็นกลไกภายใน (ยังใช้คำ room ในบริบทโค้ด/การแชร์ที่มันคือห้องจริงๆ)
- **"Join with a code"** — บอก input ที่ต้องมีในมือ (โค้ด/ลิงก์) ชัดกว่า "Join Room"
- **"Practice alone"** — สื่อ use case จริง (ซ้อม) ชัดกว่า "Play Alone" ซึ่งฟังเหมือน
  โหมดหลักของเกม และลดระดับความเด่นลง เพราะกลุ่มผู้ใช้หลักบันทึกแมตช์ 2 คน
- **ยังไม่ล็อกอิน**: การ์ด New match / Practice ไม่จาง แต่แตะแล้วเปิด Sheet
  "Sign in to create rooms — your rooms sync to your account" + ปุ่ม Google
  (แก้ปัญหา "ปุ่มจางไม่มีคำอธิบาย" และเปลี่ยน dead-end เป็นทางไปต่อ; Join ใช้ได้
  โดยไม่ล็อกอินเหมือนเดิม)
- แท็บใช้ **ไอคอนบน + label ล่าง + count เป็น badge เล็ก** — จบใน 1 แถวที่ 360px
  ("12 FINISHED" ของแท็บ Stats ตัดทิ้ง — count ของแท็บมีหน้าที่แค่บอกว่ามีของ)

### 4.2 แท็บ Rooms

```
│ [🔍 Search…            ] [≡] │ ← search 1 แถว (แก้บั๊ก P0-1) + ปุ่มเปิด filter sheet
│ [All][Playing][Waiting][Done]│ ← status chips แถวเดียว scroll แนวนอนได้
│ Showing 17 rooms             │ ← โชว์เฉพาะเมื่อ filter ตัดของออก ("3 of 17")
│ ┌──────────────────────────┐ │
│ │ Friday practice  PLAYING │ │ ← แถว 1: ชื่อ + status pill (สี+คำ)
│ │ Namfon 170 · Mek 19  T7  │ │ ← แถว 2: สกอร์บรรทัดเดียว + เทิร์น
│ │ Hosted by best · 14m ago │ │ ← แถว 3: เจ้าของ + เวลา (แก้ "best SPECTATOR")
│ └────────────────────[⋯]──┘ │ ← action เดียวที่เหลือบนการ์ด
│ …                            │
```

- **การ์ดจาก ~5 บรรทัด+แถบไอคอน → 3 บรรทัด + ⋯** ที่ 375px เห็น 3–4 ห้อง/จอ
  แทนที่จะเห็น 1.5 ห้อง — การ์ดทั้งใบแตะเพื่อเปิด (target ใหญ่ ตอบ D8)
- ⋯ เปิด Sheet: `Rename · Duplicate · Export file · Delete` — Delete แดง +
  confirm sheet บอกผลลัพธ์ (ตอบ D6, แทน `window.confirm`); Rename เป็น Sheet
  มี input (แทน `window.prompt`)
- **"Waiting" แทน "Draft"** — ห้องสถานะนี้คือห้องรอเริ่ม ไม่ใช่ฉบับร่างของเอกสาร
  ("Done" ใช้บน chip เพื่อความสั้น ส่วน pill บนการ์ดใช้ "Finished" เต็ม)
- **Filter สมาชิก (member chips + played/started 1st/2nd) ย้ายเข้า filter sheet [≡]**
  — เป็นเครื่องมือวิเคราะห์ที่ใช้ไม่บ่อย ไม่ควรดันรายการห้องลงล่างทุกครั้งที่เปิดแอป
  ปุ่ม ≡ ขึ้น badge จุดเมื่อมี filter ทำงานอยู่
- ปุ่ม New room / Import ลอยๆ **ตัดออก** — New match มีอยู่ข้างบนแล้ว (แก้ P2-10)
  Import ย้ายไปเป็นแถวหนึ่งใน filter sheet (ของหายาก ใช้ยามกู้ข้อมูล)
- Empty state ตามสถานการณ์: ไม่มีห้องเลย → "No matches yet. Start your first one
  above." / filter แล้วว่าง → "No rooms match. [Clear filters]" (ปุ่มจริง ไม่ใช่คำสั่งบอกให้ไปหาเอง)

### 4.3 Create (`#/create`) — หน้าที่หนักสุด

**เจตนา:** เปลี่ยน "ฟอร์ม 8 ช่องที่สำคัญเท่ากันหมด" เป็นคำถาม 3 ข้อ + Advanced
ที่ข้ามได้ทั้งก้อน / ตอบครบ = ปุ่มใน dock พร้อมกดตลอดเวลา ไม่มี step ที่ต้องกด Next
(ยังเป็นหน้าเดียว scroll ได้ — stepper แบบแยกหน้าเพิ่มจำนวน tap และทำให้ย้อนแก้ยาก)

```
│ ← New match                  │
│ 1 · WHO IS PLAYING?          │
│ ┌──────────────────────────┐ │
│ │ 👥 Pass & play        ✓ │ │
│ │ Two players, this phone  │ │
│ ├──────────────────────────┤ │
│ │ 👤 Solo practice         │ │
│ │ Just you; app draws tiles│ │
│ ├──────────────────────────┤ │
│ │ ✉ Online (invite emails) │ │
│ │ Each player on own device│ │
│ └──────────────────────────┘ │
│   ↳ ถ้าเลือก Online:         │
│ YOUR ROLE                    │
│ ┌──────────────────────────┐ │
│ │ ▶ I play one side      ✓ │ │  = direct_email
│ │ Invite your opponent     │ │
│ ├──────────────────────────┤ │
│ │ ◉ I host two players     │ │  = hosted_email
│ │ You referee, they play   │ │
│ ├──────────────────────────┤ │
│ │ ◉ I host one player      │ │  = hosted_solo
│ │ Solo board you supervise │ │
│ └──────────────────────────┘ │
│ 2 · PLAYERS                  │
│ ┌─ Side A · plays first ───┐ │ ← "plays first" ติดหัวการ์ด
│ │ Name       [Namfon     ] │ │
│ │ Link to member [none  ▾] │ │
│ │  ↳ Counts games in Stats │ │
│ │ (Email    [ ...        ])│ │ ← เฉพาะโหมด online
│ └──────────────────────────┘ │
│ ┌─ Side B ─────────────────┐ │
│ │ …                        │ │
│ └──────────────────────────┘ │
│ [⇄ Side B plays first]       │ ← ปุ่มสลับตัวเดียว แทน segmented แยก section
│ 3 · TIME PER SIDE            │
│ (22·tournament)(15)(10)(8)(∞)│ ← chips; แตะซ้ำช่องเดิม = ตั้งแยกฝั่ง A/B
│ ADVANCED ─ defaults are fine │
│ ▸ Room name · "Namfon vs Mek"│
│ ▸ Tile draw · App draws      │
│ ▸ Opponent rack · Hidden     │
├──────────────────────────────┤
│ ⚠ Enter your opponent's email│ ← แถวเหตุผล (เฉพาะเมื่อยังกดไม่ได้)
│ [   Create match room   ]    │ ← ActionDock
└──────────────────────────────┘
```

เหตุผลรายจุด:

- **5 โหมดเดิม → คำถาม 2 ชั้น** (ใครเล่น → บทบาทเรา) แต่ละชั้นเหลือ ≤3 ตัวเลือก
  ที่มีประโยคผลลัพธ์กำกับตลอดเวลา (ตอบ D4) — map กลับ data model เดิมแบบ 1:1:
  `hotseat`, `solo`, `direct_email`, `hosted_email`, `hosted_solo` **ไม่แตะ logic**
- ชื่อโหมดใหม่:
  - "Pass & play" — ศัพท์สากลของเกมเทิร์นเบสบนเครื่องเดียว เข้าใจได้โดยไม่ต้องรู้จัก
    คำว่า hot-seat; วงเล็บผลลัพธ์ "Two players, this phone" ทำงานแทนคำนิยาม
  - "Online (invite emails)" — บอกทั้งกลไก (online) และสิ่งที่ต้องเตรียม (email
    ของอีกฝั่ง) ตั้งแต่ยังไม่เลือก
  - บทบาท 3 แบบใช้รูปประโยค "I …" — ผู้ใช้ตอบคำถามเกี่ยวกับตัวเอง ง่ายกว่าจำ
    ชื่อ feature ("Direct email" ไม่บอกเลยว่าใครเล่น)
- **Starting side ยุบเป็น badge "plays first" บนการ์ด Side A + ปุ่มสลับใต้การ์ด**
  — ของเดิมมี segmented "Starting side" หนึ่งที่ + badge "STARTS" อีกที่
  (สอง UI หนึ่งความหมาย) เหลือจุดความจริงจุดเดียว มองเห็นผลทันทีที่การ์ดผู้เล่น
- **"Link to member" + บรรทัด "Counts this game in Stats"** — บอกเหตุผลของ
  field ในตัวมันเอง (ของเดิม "Choose member / No linked member" ไม่รู้ผูกไปทำไม)
- **Timer เป็น chips ไม่ใช่ dropdown** — ตัวเลือกมีแค่ 7 ค่า (22/20/15/12/10/8/∞)
  เห็นครบไม่ต้องเปิด; "22 · tournament" ติด label เพราะเป็นเวลาแข่งมาตรฐาน A-Math
  = อธิบายว่าทำไมมันคือ default; ∞ แสดง "No timer" ชัดๆ ไม่ซ่อนท้ายลิสต์
  ต้องการเวลา A ≠ B (ของเดิมทำได้) → แตะ "A 22 · B 22" ที่โชว์อยู่เพื่อกางเป็นสองแถว
- **Advanced พับเก็บ 3 อย่าง โดยหัวข้อโชว์ค่าปัจจุบันเสมอ** (`Tile draw · App draws`)
  — คนไม่เปิดก็รู้ว่าข้างในตั้งไว้ว่าอะไร ไม่ใช่กล่องดำ (ตอบ D5):
  - **Room name** อยู่ใน Advanced เพราะไม่มีผลต่อเกม และ default ใหม่สร้างจากชื่อ
    ผู้เล่น "Namfon vs Mek" (ของเดิม "Equation Lab" ทุกห้อง = list ที่ค้นหาไม่ได้)
  - **Tile draw** เปลี่ยนคำ: `App draws — shuffles and deals for you` (=`play`) /
    `Enter real tiles — record draws from a physical bag` (=`manual`;
    โหมด host ใช้ label `Host enters tiles`) — ของเดิม "Manual fill / System draw"
    ไม่บอกว่า manual มีไว้บันทึกเกมจริงบนโต๊ะ ซึ่งเป็น use case หลักของแอปนี้
  - **Opponent rack** (เฉพาะ online 2 คน): `Hidden — like a real match (default)` /
    `Visible — spectator-style` พูดเป็นผลลัพธ์ ไม่ใช่ on/off เปล่าๆ
  - เมื่อโหมดบังคับค่า (solo/direct → App draws) แถวนั้นแสดงค่า + `set by mode`
    แทนที่จะหายไปเฉยๆ — ผู้ใช้รู้ว่าถูกล็อกเพราะอะไร
- **ActionDock**: ปุ่มบอกผลถัดไป — `Create match room` (มีห้องรอ ไม่ใช่เริ่มเกมทันที
  แก้ P2-11), โหมด online ใช้ `Create room & get invite link` เพราะงานถัดไปของ
  ผู้ใช้คือส่งลิงก์; เหตุผล blocked ทุกกรณี (email ซ้ำ, email = host, ยังไม่ล็อกอิน)
  ขึ้นเป็นข้อความเหนือปุ่ม ไม่อยู่ใน tooltip (ตอบ D3) — logic เดิมมีครบแล้ว
  แค่ย้ายที่แสดงผล
- Validation ต่อช่องยังอยู่ใต้ช่องเหมือนเดิม (ตำแหน่ง error คงที่ตาม `FieldRow`)

### 4.4 Join (`#/join`)

หน้าเดิมดีสุดในกลุ่ม ปรับ 4 จุด:

- input ใหญ่ตรงกลาง `font-size ≥ 20px`, `autocapitalize=characters` (คงเดิม),
  monospace + letter-spacing — โค้ด 8 ตัวอ่านทวนง่าย
- ปุ่ม **Paste** ข้าง input — เคสจริงคือโค้ด/ลิงก์ถูกส่งมาทางแชท การพิมพ์เองคือ fallback
- ปุ่ม Join อยู่ใน ActionDock ให้เหมือนหน้าอื่น + ระหว่างรอ: `Opening room…`
- error ใต้ input พูดแบบแก้ได้: `Room not found — check the code with the person
  who shared it.` (ของเดิมโยน error ตรงๆ จาก backend)

### 4.5 Waiting room (`#/room/:id`)

**เจตนา:** หน้านี้มีงานเดียวต่อ role — host: แจกโค้ดแล้วกด Start / player: กด Ready /
viewer: รู้ว่าตัวเองรอดูได้ ทุกอย่างอื่นเป็นข้อมูลประกอบ

```
│ ← Friday practice   WAITING  │
│ ┌──────────────────────────┐ │
│ │ ROOM CODE                │ │ ← ก้อนแรก: เหตุผลเดียวที่หน้านี้มีอยู่ก่อนเริ่ม
│ │   AB12 CD34   [Copy]     │ │   คือพาอีกฝั่งเข้าห้อง → โค้ดต้องใหญ่และมาก่อน
│ │ [ Share invite link ]    │ │
│ └──────────────────────────┘ │
│ ● Waiting for Mek to join    │ ← status line ประโยคเดียว รวมสถานะทั้งห้อง
│ PLAYERS                      │   (แทนที่ผู้ใช้ต้องไล่อ่าน list เอาเอง)
│ ┌ A Namfon (you)   Ready ✓ ┐ │
│ ├ B Mek · mek@…    Invited ┤ │ ← "Invited" = ยังไม่เข้า, "Joined · not ready",
│ └ ◉ best · Host           ┘ │   "Ready ✓" — สถานะคน ไม่ใช่คำระบบ
│ SETTINGS          [Edit]     │
│ Pass & play? No — Online     │
│ Time  A 22 min · B 22 min    │ ← สรุป config แบบอ่าน ไม่ใช่ grid ไอคอน 6 ช่อง:
│ Tiles App draws              │   ใช้คำเดียวกับหน้า Create ทุกบรรทัด (D7)
│ Rack  Hidden                 │
│ First move  Side A           │
├──────────────────────────────┤
│ ⚠ Waiting for Mek to be ready│
│ [      Start game       ]    │ ← host; player เห็น [ I'm ready ] toggle,
└──────────────────────────────┘   viewer เห็นข้อความ ไม่มีปุ่ม
```

- **โค้ดห้องขึ้นก้อนแรก** เพราะงานแรกของ host หลังสร้างห้องคือส่งโค้ด (ของเดิมโค้ด
  อยู่ในการ์ด header ปนกับ role badge)
- **Status line หนึ่งประโยค** สังเคราะห์จาก ready state — ผู้ใช้ไม่ต้องแปล list เอง
  ว่าตกลงรอใคร (ของเดิมเหตุผลเดียวกันนี้ซ่อนใน tooltip ของปุ่ม Start)
- **Start game อยู่ใน ActionDock** — host ไม่ต้องเลื่อน (แก้ P1-7); ปุ่ม player ใช้คำ
  `I'm ready` / กดแล้วเป็น `Ready ✓ (tap to undo)` — first person ตรงกับคำถามที่เขา
  กำลังตอบ; "Cancel room" เปลี่ยนเป็น `Delete room` สีแดงใน ⋯ ของ header + confirm
  (มันคือการลบจริง ไม่ใช่ cancel เฉยๆ — แก้ P2-11)
- **Edit ทั้ง config เปิดเป็น full-screen sheet ใช้ฟอร์ม §4.3 ตัวเดียวกัน** prefill
  ค่าปัจจุบัน (โค้ดเดิม reuse `CreateRoomPanel` อยู่แล้ว — พฤติกรรมเดิม แค่เข้าผ่าน
  sheet และปุ่ม submit เปลี่ยนเป็น `Save changes`)
- สรุป Settings ใช้ **คำเดียวกับตอนตั้งค่า** ทุกบรรทัด — ผู้ใช้เพิ่งเห็นคำพวกนี้
  ในหน้า Create เมื่อสิบวินาทีก่อน (D7)

### 4.6 แท็บ Members

โครงเดิมดี ปรับ:

- แถวสมาชิก: avatar + ชื่อ + สถาบัน + สถิติย่อ `12 games · 58%` บรรทัดเดียว
  (grid สถิติ 3 ช่องเดิมสูงเกินจำเป็น) แตะแถว = ไปหน้า head-to-head ใน Stats
  (ตอนนี้ข้อมูลนี้มีอยู่แล้วแต่ไปถึงได้จากแท็บ Stats เท่านั้น)
- Edit/Delete ย้ายเข้า ⋯ ต่อแถว (D6) — delete ใช้ confirm sheet ข้อความเดิม
  ("Existing game records keep the name on file." — ประโยคนี้ดี เก็บไว้)
- ฟอร์ม add/edit เป็น Sheet แทน inline card — บนมือถือ ฟอร์ม inline ดันรายการ
  ทั้งหน้าและหลุดโฟกัสง่าย
- คำอธิบายหัวหน้า ("This is your private player directory…") ย่อเหลือบรรทัดเดียว:
  `Private directory — link members when creating rooms to track their stats.`
  บอกครบทั้ง ownership และประโยชน์ในประโยคเดียว

### 4.7 แท็บ Stats

- **ตาราง 8 คอลัมน์ → ranked list บนมือถือ**: แถวละคน
  `#1 Namfon · 12 games · 58% win · avg 412` แตะ = head-to-head (ของเดิมต้อง
  scroll ตารางแนวนอน font 12px — ขัด D8); ≥760px ยังใช้ตารางเต็มได้
- head-to-head view คงโครงเดิม (ดีอยู่แล้ว) ปรับ header ให้มีปุ่ม back มาตรฐานเดียว
  กับ `PreGameShell`
- บรรทัดอธิบาย "Stats are derived from finished rooms" เก็บไว้ — เป็นคำตอบของ
  คำถามแรกที่ทุกคนถาม ("ทำไมเกมเมื่อกี้ไม่ขึ้น") แต่ย่อ:
  `Counted from finished rooms only.`

### 4.8 Auth (login / ตั้งชื่อ / รออนุมัติ / ถูกบล็อก)

โครงการ์ดกลางจอเดิมใช้ได้ ปรับ:

- ปุ่ม Google เต็มความกว้างการ์ด ≥48px (ตอนนี้เกือบได้อยู่แล้ว)
- ลำดับคำบนจอ login: ชื่อแอป → ประโยคเดียวว่าแอปทำอะไร (`Record and replay
  equation board matches`) → ปุ่ม → บรรทัดเล็กอธิบาย flow อนุมัติ
  (`New accounts need admin approval before creating rooms.`) — ผู้ใช้ใหม่รู้ว่า
  หลังกดจะยังเล่นไม่ได้ทันทีเพราะอะไร ลดความรู้สึก "แอปพัง" ตอนโดนหน้ารออนุมัติ
- หน้ารออนุมัติ: ปุ่ม `Check again` คงไว้ + เพิ่มบรรทัดว่าใครอนุมัติ
  (`Ask your club admin to approve you.`) — บอก next step ที่ทำได้จริงนอกแอป

### 4.9 Admin panel

- Modal เดิม → **full-screen Sheet บนมือถือ** (มาตรฐานเดียวกับ sheet อื่น)
- แถว pending: ชื่อ + email + `[Approve]` `[Block]` เป็นปุ่มมีคำ ไม่ใช่ไอคอน —
  งาน approve เป็นงานตัดสินใจ ต้องไม่กดพลาด
- badge จำนวน pending บนปุ่ม admin ใน header คงเดิม (ดีแล้ว — เป็น signal เดียว
  ที่บอกว่ามีงานค้าง)

### 4.10 Loading / sync

- `GlobalActivity` (มุมจอ "Syncing…") คงพฤติกรรม แต่ย้ายให้พ้น ActionDock
  (bottom bar ใหม่จะทับของเดิม) → เลื่อนขึ้นเหนือ dock อัตโนมัติเมื่อ dock แสดงอยู่
- Foreground loading ("Opening room…") คงเดิม

---

## 5. สิ่งที่ *ไม่* ทำ และเหตุผล

- **ไม่ทำ multi-step wizard แยกหน้าใน Create** — เพิ่ม tap, ทำให้ย้อนแก้ค่าเก่ายาก
  และ state ฟอร์มเดิมเป็นก้อนเดียว (`NewGameSettings`) การเป็น long-form หน้าเดียว
  ที่จัดกลุ่ม+พับ ตอบโจทย์เดียวกันโดย risk ต่ำกว่า
- **ไม่แตะ data model / sync logic ใดๆ** — ทุกการเปลี่ยนแปลงคือ presentation
  (`NewGameSettings`, `GameState`, remoteRooms API คงเดิมทั้งหมด) เพื่อไม่ชน
  invariant ของ sync ที่เปราะ (ดู memory: remote state keys / tile ids)
- **ไม่เปลี่ยนภาษา UI เป็นไทยในรอบนี้** — เหตุผลใน D10; แต่ D9 (รวม string ใน
  `uiText.ts`) ทำให้งานแปลในอนาคตเป็นงานไฟล์เดียว
- **ไม่รื้อ desktop layout** — โจทย์ระบุ desktop ตอนนี้ไม่มีปัญหา; breakpoint ≥760px
  คงโครงเดิมไว้ให้มากที่สุด (ActionDock กลายเป็นปุ่ม inline, Sheet กลายเป็น dialog)

---

## 6. Copy system — ตารางข้อความหลัก (เดิม → ใหม่ → เหตุผล)

หลักการตั้งชื่อ: (ก) ปุ่ม = ผลลัพธ์ที่จะเกิด ไม่ใช่ชื่อระบบ (ข) ตัวเลือก = ประโยคที่ผู้ใช้
พูดเกี่ยวกับตัวเองได้ (ค) สถานะ = คำที่คนนอกวงการอ่านรู้เรื่อง (ง) ทุกคำอยู่ที่เดียวใน
`uiText.ts` และใช้ซ้ำทุกหน้า

| ที่ | เดิม | ใหม่ | เหตุผล |
|---|---|---|---|
| Home action | Play Alone / Start a solo board with system draw | Practice alone / Just you — the app draws tiles | "Practice" บอก use case; "system draw" เป็นศัพท์ภายใน |
| Home action | Create Room / Configure local or online play | New match / Play or record a real game | ผู้ใช้คิดเป็นแมตช์ ไม่ใช่ห้อง; play mode คือ config ไม่ใช่เหตุผลที่จะกด |
| Home action | Join Room / Use a room code or shared link | Join with a code / Enter a code or paste a link | บอกของที่ต้องมีในมือ |
| Play mode | Hot-seat (this device) | Pass & play — Two players, this phone | ศัพท์เกมสากล + ประโยคผลลัพธ์บนจอ (ไม่อยู่ใน tooltip) |
| Play mode | Solo · System draw | Solo practice — Just you; app draws tiles | รวมเหตุผลการมีอยู่ของโหมดไว้ในคำอธิบาย |
| Play mode | Online with host / Hosted solo / Direct online | Online → I play one side / I host two players / I host one player | เปลี่ยนจากชื่อฟีเจอร์เป็นบทบาทที่ผู้ใช้เลือกตอบเองได้ และเลือกบัญชีด้วย username ไม่แสดง email |
| Tile draw | Manual fill | Enter real tiles — record draws from a physical bag | บอกว่าโหมดนี้มีไว้บันทึกเกมจริง (จุดขายหลักของแอปที่ของเดิมไม่เคยพูด) |
| Tile draw | System draw | App draws — shuffles and deals for you | ประธานคือ app ไม่ใช่ "system"; บอกสิ่งที่มันทำแทนเรา |
| Timer | (dropdown มี "No timer" ท้ายลิสต์) | chips: 22 · tournament / 20 / 15 / 12 / 10 / 8 / No timer | 22 คือกติกาแข่งจริง — ติด label เพื่ออธิบาย default; No timer มองเห็นเสมอ |
| Member link | Choose member / No linked member | Link to member (counts in Stats) / Not linked | บอกผลของการ link; "Not linked" เป็นสถานะ ไม่ใช่คำสั่ง |
| Submit create | Start room | Create match room / Create room & get invite link (online) | ของจริงคือสร้างห้องรอ ไม่ใช่เริ่มเกม; โหมด online บอก next step ต่อเลย |
| Waiting status | Draft | Waiting | draft = เอกสารร่าง ไม่ใช่ห้องรอเริ่มเกม |
| Waiting action | Cancel room | Delete room (แดง + confirm) | มันลบถาวร ไม่ใช่ยกเลิกเฉยๆ — คำต้องรับผิดชอบผลลัพธ์ |
| Ready | Ready / Not ready | I'm ready / Ready ✓ · tap to undo | ตอบคำถาม "คุณพร้อมไหม" ด้วยเสียงผู้ใช้เอง และบอกวิธีถอนได้ |
| Start blocked | (tooltip) Waiting for Side B to be ready. | ⚠ Waiting for Mek to tap Ready (เหนือปุ่ม มองเห็นเสมอ) | ใช้ชื่อคนจริงแทน "Side B" เมื่อรู้ชื่อ; tooltip บนมือถือ = ไม่มีอยู่จริง |
| Participant status | Host controlled | Played on host's board | "controlled" ฟังเหมือนถูกยึดเครื่อง; บอกภาพจริงว่าเล่นบนกระดานของ host |
| Card role | `best SPECTATOR` | Hosted by best (+ pill Spectator เมื่อเกี่ยวข้อง) | แยกสองข้อมูลที่เคยชนกัน: ใครเป็นเจ้าของ / เรามีสิทธิ์อะไร |
| Empty rooms | No rooms yet. Tap New room to… | No matches yet. Start your first one above. | ชี้ไปที่ปุ่มที่มีอยู่จริงบนจอ (New room ถูกตัดออกแล้ว) |
| Stats note | Stats are derived from finished rooms in the lobby. | Counted from finished rooms only. | สั้นลงครึ่งหนึ่ง ใจความเท่าเดิม — ตอบคำถาม "ทำไมเกมไม่ขึ้น" |

ข้อความ error ให้เขียนตามสูตร **"เกิดอะไร + แก้ยังไง"** เสมอ เช่น
`Room not found — check the code with the person who shared it.`

---

## 7. คำศัพท์กลาง (vocabulary — ใช้เหมือนกันทุกหน้า)

| คำ | ความหมายเดียวที่อนุญาต |
|---|---|
| **Match** | เกมหนึ่งกระดาน (ภาษาผู้ใช้) |
| **Room** | กลไกห้อง: โค้ด, ลิงก์, การเข้าร่วม (ใช้เมื่อพูดถึงการเชื่อมต่อ/แชร์) |
| **Waiting** | สถานะห้องที่ยังไม่เริ่ม (แทน Draft ทุกที่) |
| **Host** | คนคุมห้องที่ไม่ได้เล่นเอง |
| **Side A / Side B** | ฝั่งบนกระดาน — ใช้คู่ชื่อคนเสมอเมื่อรู้ชื่อ (`Side B · Mek`) |
| **Pass & play** | สองคนเครื่องเดียว (แทน hot-seat) |
| **App draws / Enter real tiles / Host enters tiles** | 3 ค่าของ tile draw |
| **plays first** | starting side (เลิกใช้คำ starting side บน UI) |

---

## 8. Visual language (Material glass สำหรับ Lobby + กติกามือถือ)

ยกมาจาก design system เดิมเฉพาะที่บังคับใช้ต่อ:

- โทน: ขาว/เทาอ่อน `#F8F9FA`, ตัวหนังสือ `#3C4043`, น้ำเงิน `#4285F4` = primary,
  แดง `#EA4335` = destructive/error เท่านั้น, เขียว `#34A853` = สำเร็จ/ready,
  เหลือง `#FBBC05` = คำเตือน; ห้ามใช้สีเดี่ยวสื่อสถานะโดยไม่มีคำ (D8)
- หน้า Home/Lobby ใช้กระจกใสที่อ่านง่าย: พื้นขาวโปร่ง, `backdrop-filter`, เส้นขอบขาว
  และเงาระดับต่ำ โดยใช้ radius ไม่เกิน 8px; หน้า Play และ control เชิงงานยังคงพื้นทึบเดิม
- **แยก action ออกจาก state ชัดเจน**: `New match` เป็น CTA น้ำเงินเต็มพื้นที่และมี elevation,
  ส่วน tab/filter ที่เลือกเป็นพื้นขาว/charcoal พร้อม indicator จึงห้ามใช้สีเดียวกับ CTA
- ทุก control มี `:active` แบบกดจมลงเล็กน้อย (`translate/scale + brightness`) และ hover
  ใช้เฉพาะอุปกรณ์ที่รองรับ hover; effect เคลื่อนไหวเฉพาะ transform/opacity และเคารพ
  `prefers-reduced-motion`
- Focus: standalone input ใช้ outline 2px `outline-offset: -2px`; wrapper ที่หุ้ม
  input (search ฯลฯ) วาด focus ที่ wrapper เท่านั้น
- Typography: sans-serif เดิม; ตัวเลขใช้ tabular numerals ในสกอร์/ตาราง/โค้ดห้อง
- กติกาที่เพิ่มใหม่สำหรับมือถือ:
  - breakpoint เดียว: `≤759px` = mobile (สอดคล้อง `MOBILE_LAYOUT_MAX_PX`)
  - tap target ≥44px, input `font-size ≥16px`, `min-h` ปุ่มหลัก 48px
  - bottom bar / sheet ใส่ `padding-bottom: env(safe-area-inset-bottom)`
  - ห้าม horizontal overflow ทุกหน้า (ตารางต้องแปลงร่าง ไม่ใช่ให้เลื่อน)
  - z-index ตามสัญญาเดิม: sticky 100 / overlay 200 / modal(Sheet) 300 / toast 500

---

## 9. แผนการลงมือ (เรียงตาม impact/เสี่ยงน้อยก่อน)

| เฟส | งาน | ไฟล์หลักที่แตะ |
|---|---|---|
| **P0 แก้บั๊กก่อนออกแบบทับ** | search box แตก; ย้ายเหตุผล disabled จาก tooltip มาเป็นข้อความ (จุดที่มี logic อยู่แล้ว) | `60-filters.css`, `CreateRoomPanel.tsx`, `RoomActions.tsx` |
| **P1 คอมโพเนนต์กลาง** | `ActionDock`, `Sheet`, `ChoiceCardGroup`, `OverflowMenu`, `FieldRow` + string ใหม่ใน `uiText.ts` | `components/ui/*` (ใหม่), `uiText.ts` |
| **P2 Create form** | restructure ตาม §4.3 (mapping โหมดเดิม 1:1) | `CreateRoomPanel.tsx`, `CreateRoomPage.tsx`, `30-create.css` |
| **P3 Home + Rooms** | header ย่อ, Continue card, action ใหม่, แท็บ, การ์ด 3 บรรทัด + ⋯, filter sheet | `Lobby.tsx`, `RoomsView.tsx`, `RoomCard.tsx`, `RoomFilters.tsx`, lobby css |
| **P4 Waiting room** | ลำดับใหม่ + status line + ActionDock + edit เป็น sheet | `WaitingRoomPage.tsx`, `pregame/*`, `pregame.css` |
| **P5 ที่เหลือ** | Join, Members, Stats(list บนมือถือ), Auth copy, Admin sheet, GlobalActivity หลบ dock | ตามหน้า |

ทุกเฟส verify บน viewport 375×812 + 430px + desktop 1280px ก่อนถือว่าเสร็จ
(เกณฑ์ผ่านต่อหน้า: action หลักมองเห็นโดยไม่ scroll, ไม่มี tooltip-only info,
ไม่มี horizontal overflow, สถานะทุกอันมีคำกำกับ)
