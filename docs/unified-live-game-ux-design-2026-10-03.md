# Unified Live Game UX / UI — Discovery & Implementation Design

Date: 2026-10-03 · Worktree: `EQ-Lab-live-sync` · Branch `codex/live-sync-optimization-phase1` · HEAD `58667ce`
Status: **DESIGN ONLY — nothing implemented, committed, or deployed.** Awaiting review.

Baseline facts used throughout:

- Production runs `4e1fcdc` (Milestone S). `LIVE_GAME_CREATION_ENABLED` / `STAGE_CREATION_ENABLED` are false.
- The "uncommitted minimal UI fix" is in fact **local commit `58667ce`** on this branch (working tree clean, not pushed or deployed). It is treated as the checkpoint.
- The primary checkout `~/Desktop/EQ-Lab` was not touched.

---

## A. CURRENT ARCHITECTURE

### A.1 Route and component chain

```
AppRoot
 ├─ #/room/:id  ─────────────► LivePage ─► RankedMatchPage(client=liveGameClient, ranked=false)
 ├─ #/play/:id ─► PlayApplication ─(room_live row?)─► LivePage ─► RankedMatchPage
 │                                └─(no row / read fails)─► ArchiveReplayPage
 ├─ #/play/(survival|study) [DEV] ─► DevelopmentSources ─► RankedMatchPage(dev client) / LivePractice
 └─ #/ranked/:id ─► RankedPage ─► RankedMatchPage(client=rankedClient, ranked=true)
```

`RankedMatchPage.tsx` (1,555 lines) is the single view and controller for every live mode. In one component it holds:

| Concern | Where it lives today |
|---|---|
| Fetching | `client.read` + realtime `commit` signal + a 4 s poll + a 1 s clock tick; a revision guard keeps the newest view |
| Turn draft | `placements`, `selectedCell`, `selectedTileId`, `selectedPendingId`, `exchangeIds`, `mode` (`none / place_equation / exchange / pass`) |
| Keyboard | a global `keydown` handler (`resolveStudyKey`, `resolveRackTile`, blank arming, cursor direction) |
| Drag | `useLiveTileDrag` (pointer events on `[data-draft-tile-id]` → board cell / rack slot) |
| Rack order | `rackOrder` state. **It resets on every revision.** |
| Fake GameState | `playUiGame()` builds a `GameState` hard-coded as `"Ranked match"` / `versus` / `phase: choose_action` so `Scoreboard` and `ActionPanel` can render |
| Header | title, turn text, status badges, bag badge, rating badge, Resume, **Resign (`window.confirm`)**, Leave / OverflowMenu "Game menu" |
| Layout | the legacy three-column `.workspace` grid (`log-rail / board-zone / right-rail`), styled by 16 legacy CSS layers imported in `play-styles.css` (~25.9k CSS lines in all) |
| Actions | **both** `MobileActionBar` and `ActionPanel`, each with an explicit Place / Exchange / Pass mode model |
| Tools | `ContextTools` (desktop: right-rail panel; phones: a Sheet): Physical draws, Analysis, Bot turn, History, Administration |
| Pause | `PauseSheets`: the incoming request is a **non-dismissible modal Sheet that makes `#root` inert** |
| Waiting room / handoff | `PreGameShell` + `WaitingControls` + the Pass & Play handoff card |

### A.2 Data contract (what the browser receives)

- `LiveGameView` = `RankedMatchView` plus capability-ish flags: `canAdminister`, `canConfigure`, `canLaunch`, `canRename`, `canEditHistory`, `canUndo`, `canRedo`, `canSaveExit`, `directPause`, `localHandoff`, `canHandoff`, `localConfirmed`, `hostRacks?` (Physical host only), `practiceBot?` (ArchBot only), `timeline?` (editHistory only), `matchControl`, `clockPolicy`, `botTurn`, `paused`, `phase`, `tileDrawMode`.
- The board comes through `visibleBoard()`, which replaces tile IDs with `board:r:c`. The rack comes through `ownTiles()`, which keeps real IDs. **Tile IDs are stable manifest ordinals (`tileIdOf(ordinal)`), so an ID reveals its token.** That is why opponent IDs must never reach a recipient, and the security spec asserts it.
- Logs carry `action`, `score`, `exchangedCount`, `boardBefore/After`, and own `rackBefore/After` + `analysisContext`. That is enough for Last Move. Every turn carries two full 15×15 boards, and that payload is re-read on every poll.
- Capabilities resolve server-side in `resolveLiveCapabilities` from frozen seats, owner, mode, purpose and protocol. **Exception:** tool availability (`analysis / replay / multiverse`) comes from a client catalog fetch (`loadPlayTools(mode)`). Resign, Coffee Break and "is my turn" are also derived client-side.
- Ranked uses its own `ranked` Edge Function. It has **no realtime subscription and only the 4 s poll**.

### A.3 Sync transport

- Channel `game:{id}`, private, receive-only. RLS on `realtime.messages`: select is allowed when `can_read_live_game()` passes (seats, owner, admin, and **approved spectators of public/region rooms**). **No insert policy exists, so browsers cannot broadcast.**
- The server emits `commit {gameId, revision}` through `realtime.send` (DB-backed broadcast). The client answers with a full `read` through the Edge Function.
- **There is no ephemeral lane.** The live-security docs (F20) explicitly required "no broadcast of draft racks". The pre-security legacy `LiveRoomSession` *did* share drafts (pending placements with real tile IDs, plus exchange drafts and selection), persisted in the room row. The cutover retired it, and the security spec now forbids the `"session"` key in traffic.

### A.4 Behavioural defects relevant to the redesign (found in code)

1. **Rack order and the tentative draft reset on every revision** (`useEffect([match.revision])`). Non-turn revisions (pause request, annotate, rename, a host correction) wipe the active player's tentative tiles and rack arrangement.
2. **THINKING is effectively disabled.** `onTileClick` and drag are gated on `isMyTurn`, so a player cannot reorder the rack during the opponent's turn.
3. **An incoming pause request blocks play.** It is a modal Sheet with an inert app root, even when the recipient is the player on move.
4. **The Result screen is unstable.** Completion deletes the `room_live` row. The next poll (≤4 s) fails, `read()` dispatches `eq-lab:archive-replay-ready`, and `PlayApplication` unmounts the live page in favour of `ArchiveReplayPage`. Polling also keeps running after the game finishes.
5. Destructive confirms use `window.confirm` (Resign, Hosted Finish).
6. The 225 board cells are unlabeled buttons with no grid semantics. The keyboard model is a global key handler, not focus-based.
7. The clock is computed from `Date.now()` against the server's `clockStartedAt` with no skew correction.
8. UI strings mix Thai and English inline, outside i18n.

### A.5 Retain / refactor / replace / retire

| Piece | Verdict | Notes |
|---|---|---|
| `liveGame/client.ts` (command idempotency, handoff tokens, `concealLocalView`, bot-turn sharing) | **Retain** | Transport for the authoritative lane. Gains a separate ephemeral channel in Phase B. |
| `projection.ts`, `capabilities.ts`, `controls.ts`, `hostedAdmin.ts`, `physical.ts`, `botAction.ts` (server side) | **Retain** | Frozen security contract. Phase B *adds* a normalized capability block; nothing is removed. |
| `analysis.ts` | **Retain** | Own-projection-only analysis. |
| `Board.tsx` / `Tile.tsx` | **Refactor** | Add layers: remote tentative, last-move marks, review tint. Add grid a11y semantics and roving focus. Keep the memo comparator. |
| `Rack.tsx` | **Refactor** | Reorder in THINKING, keyboard reorder, "exposed" ghost slots. Keep `sameRack`. |
| `tileDrag.ts` | **Refactor** | Two enable flags: rack-reorder (always while seated) and board-drop (ACTIVE only). |
| `RankedMatchPage.tsx` | **Replace** (view) / **Refactor** (logic) | Split into hooks: `useLiveMatch`, `useTurnDraft`, `useClock`, `useBotTurn`, `useLaunchCountdown`. The view becomes `LiveGameShell`. |
| `playUiGame()` fake GameState | **Replace** | A mode-correct `ShellModel` built by adapters (Live / Ranked / Dev). |
| `Scoreboard` | **Replace** in live → `PlayerCard` | The legacy board keeps `Scoreboard`. |
| `ActionPanel`, `MobileActionBar` (live usage) | **Retire** for live | They encode the Place-mode model. `TurnActions` replaces both. |
| `ContextTools` ("Game tools" grab-bag) | **Retire** | Split into Game Tools / Record Tools / Match Controls. |
| `CompatibilityControls`: `WaitingControls` | **Refactor** | Waiting-room surface (pre-game), restyled. |
| `PauseSheets` | **Replace** → `PauseNotice` in the EventLine | Non-modal. The handlers are kept. |
| `HistoryControls` | **Refactor** → Record Tools (History / Branches / Annotate) | |
| `HostedControls` | **Split** | Lifecycle (pause/resume/finish) → Match Controls (host). Score correction → Record Tools. |
| `PhysicalControls` | **Refactor** → `PhysicalConsole` (mode-specific) | |
| `LivePractice` | **Retain** (re-skin) | Game Tool. |
| `PreGameShell` | **Retain** | Waiting room + Handoff gate. |
| Header `top-bar`, the `.workspace` 3-col grid, legacy CSS layer import for the live route | **Retire** for live | A dedicated `live-shell.css` built on `tokens.css`. The legacy `App` keeps its layers. |
| `Sheet`, `OverflowMenu`, `TextPromptSheet` | **Retain** | Mobile drawers and confirmations. |
| `window.confirm` | **Retire** | Use a ConfirmSheet. |

---

## B. REQUIREMENT / CAPABILITY MAP

Every control or state the current live page exposes, plus the required new items.

| # | Current control / state | Today | Target category | Target surface |
|---|---|---|---|---|
| 1 | Place by cell click / type / cursor / direction | board + global keys | **Turn Actions** (direct interaction) | Board (focus grid) |
| 2 | Drag rack→board, board→board, board→rack | `useLiveTileDrag` | Turn Actions | Board / Rack |
| 3 | Blank / choice face edit (hold, E, dbl-click) | Board | Turn Actions | Board, plus a face picker popover anchored to the tile |
| 4 | Backspace/Delete remove last / at cursor | keys | Turn Actions (**Recall** one) | keys + drag to rack |
| 5 | Place / Exchange / Pass mode buttons + confirm + cancel + undo placement | ActionPanel + MobileActionBar | Turn Actions | `TurnActions`: **Exchange · Pass** ↔ **Recall · Commit** |
| 6 | Exchange tile selection, rectangle select | Rack | Turn Actions (Exchange sub-mode) | Rack + `TurnActions` (Cancel · Exchange N) |
| 7 | Rack select / swap / move to empty slot | Rack (ACTIVE only) | **Workspace** (rack) | Rack, ACTIVE **and** THINKING |
| 8 | Resign (`window.confirm`) | header | **Match Controls** (destructive) | Match menu → ConfirmSheet |
| 9 | Coffee Break (local bookmark, clock keeps running) | Game menu | Match Controls | Match menu (+ lobby return chip, unchanged) |
| 10 | Request pause (Direct only) | Game menu | Match Controls | Match menu; pending state shown in status |
| 11 | Incoming pause request (accept / decline / decline+block 5 min) | modal Sheet | **Persistent status** (actionable) | EventLine notice, non-modal |
| 12 | Pause response + Acknowledge | Sheet | Persistent status | EventLine notice |
| 13 | Resume (Direct paused) | header | Match Controls, surfaced in status | Paused state panel |
| 14 | Rename game | Game menu | Match Controls (game settings) | Match menu |
| 15 | Leave / Save & Exit | Game menu / Ranked button | Match Controls | Match menu |
| 16 | Paused / Pause requested badges | header | Persistent status | PlayerCards + EventLine |
| 17 | Bag count | header + rail | **Tile Bag Info** | TileBagInfo + opponent card |
| 18 | Rack counts A/B | rail | Persistent status | PlayerCard (opponent rack count) |
| 19 | Turn text "ตา N · name · กำลังเล่น" | header | **Turn Awareness** | visual hierarchy (no reading needed) |
| 20 | Error banner | top | Persistent status | EventLine (non-covering), connection pip |
| 21 | Legacy read-only notice (`continuationBlocked`) | top | Mode-specific status | Blocking state panel in the action zone |
| 22 | Result line + rating change | top | **Terminal / Result** | Result panel |
| 23 | keyNotice toast | floating | Turn Actions feedback | Inline hint under the rack |
| 24 | Scoreboard | left rail | **Game Status** | PlayerCards |
| 25 | Turn Log list, select turn | left rail / below board | **Record Tools** | Record panel / sheet |
| 26 | Review before/after, back to current | log detail | Record Tools (review mode) | Board review banner |
| 27 | Practice this position (`LivePractice`) | log detail | **Game Tools** | Game Tools |
| 28 | Analysis level + Analyze my turn / historical turn | ContextTools | Game Tools | Game Tools |
| 29 | Bot thinking + Retry bot turn | ContextTools | Persistent status (+ recovery) | Opponent PlayerCard; Retry only on stall/error |
| 30 | Undo / Redo committed | ContextTools | Record Tools | Record → History |
| 31 | Continue before/after, alternate lines view/restore/prune | ContextTools | Record Tools | Record → Lines |
| 32 | Annotate note + stars | ContextTools | Record Tools | Record → Turn detail |
| 33 | Host Pause / Resume / Finish | ContextTools | Match Controls (host) | Match menu (host section), Finish via ConfirmSheet |
| 34 | Host Correct score | ContextTools | Record Tools (host correction) | Record → Corrections (paused only, as the server enforces) |
| 35 | Physical: both current racks, palette, record draw, correct rack, return tile | ContextTools | **Mode-specific** (Physical console) + Record Tools | PhysicalConsole |
| 36 | Physical host records a move for the active side | `client.record` | Turn Actions (host-acting) | Same TurnActions, labelled "Record for {side}" |
| 37 | Pass & Play handoff | full-page gate | **HandoffGate** | HandoffGate |
| 38 | Waiting room: Ready / Launch / Configure / Copy link / Cancel / Leave / countdown / Ranked stakes | PreGameShell | Pre-game (mode surface) | WaitingRoom (restyled, unchanged semantics) |
| 39 | Spectator (no seat) | partial | Mode-specific | Spectator shell (no rack / notes / actions) |
| — | **New:** Notes | — | Workspace | NotesPad |
| — | **New:** Last Move | — | Persistent status | LastMove + board marks |
| — | **New:** unseen tile distribution | — | Tile Bag Info | TileBagInfo |
| — | **New:** opponent tentative tiles | — | Board (public ephemeral) | Remote tentative layer (Phase B) |
| — | **New:** turn attention (motion, sound, title/favicon, opt-in notifications) | — | Turn Awareness | Attention service |

---

## C. PROPOSED LIVE GAME ARCHITECTURE

### C.1 Component tree

```
LiveGameRoute                      chooses adapter: live | ranked | dev
└─ LiveMatchProvider               useLiveMatch(): read / subscribe / poll / revision guard / terminal hold
   │                               useClock(): server-offset-corrected clocks
   │                               toShellModel(view) → ShellModel (+ ShellCapabilities)
   ├─ WaitingRoom                  (pre-game; WaitingControls refactor; Ranked stakes)
   ├─ HandoffGate                  (Pass & Play; concealment preserved)
   └─ LiveGameShell                layout engine (computeLiveLayout) + named slots
      ├─ PlayerCard[opponent]      GameStatus + TurnAwareness (top / “across the table”)
      ├─ PlayerCard[self]          GameStatus + TurnAwareness (bottom / next to rack)
      ├─ BoardStage                Board + RemoteTentativeLayer + LastMoveLayer + ReviewBanner
      ├─ RackWorkspace             Rack + useLiveWorkspace (order persistence)
      ├─ TurnActions               Exchange·Pass ↔ Recall·Commit | Exchange sub-mode | Thinking | Result
      ├─ EventLine                 one fixed-height slot: pause request/response · paused · connection · error · (phone) last move
      ├─ LastMove                  latest committed outcome
      ├─ TileBagInfo               bag count, unseen distribution (derived)
      ├─ NotesPad                  private scratch (local only)
      ├─ GameTools                 Analysis, Practice, Bot insight (capability-gated)
      ├─ RecordTools               Turn Log, Review, History (undo/redo), Lines, Annotate, Host corrections
      ├─ MatchControls             Coffee, Pause request, Resume, Rename, Save&Exit/Leave, Surrender, Host lifecycle
      ├─ PhysicalConsole           mode-specific (Physical host)
      └─ Attention                 title/favicon/sound/notification; reduced-motion aware
```

Hooks (pure logic, unit-testable):

- `useTurnDraft(model)`: placements, cursor, selection, exchange selection, keyboard, drag. It **revalidates against the new board/rack instead of resetting on every revision**. It resets only when `activeSide`, `turnNumber`, or `historyIndex` changes, or when a placement becomes illegal.
- `useLiveWorkspace(key)`: rack order + notes persistence (§G).
- `useTurnTransition(model)`: derives `{phase: ACTIVE|THINKING|…, transitionKey}` from the newest authoritative view only.
- `useTentativeChannel(model)` (Phase B): publish own draft / receive opponent draft (§F).
- `useBotTurn`, `useLaunchCountdown`: lifted unchanged from the page.

### C.2 ShellModel (mode-correct, no fake GameState)

```ts
type ShellModel = {
  game: { id; name; modeKey; modeLabel; revision };
  viewer: { role: "player" | "physical-host" | "local-controller" | "spectator";
            side: Side | null;          // seat being played/viewed
            perspective: { top: Side; bottom: Side } };
  seats: Record<Side, { name; kind: "human" | "authur" | "archbot" | "solo-empty"; present?: boolean }>;
  turn: { activeSide; number; phase; status: "playing" | "paused" | "finished" | "blocked";
          pausedBy?: "agreement" | "host" | "save-exit"; botThinking?: "server" | "device" };
  clocks: Record<Side, { seconds; running; untimed; overtime }>;
  scores: Record<Side, number>;
  board; rack: { tiles; side } | null; hostRacks?;
  bag: { count; rackCount: Record<Side, number> };
  logs; lastMove: LastMoveView | null;
  pause: { incoming?; outgoing?; response?; blockedUntil? };
  result?: { winner; reason; ratingChange? };
  caps: ShellCapabilities;
};
```

### C.3 ShellCapabilities (server-authoritative)

```ts
type ShellCapabilities = {
  turn: { act: boolean; exchange: boolean; pass: boolean; recordForActiveSide: boolean };
  match: { coffee; requestPause; respondPause; resumeDirect; rename; saveExit; leave; surrender;
           hostPause; hostResume; hostFinish };
  record: { turnLog; review; undo; redo; branches; annotate; correctScore; physicalIntake };
  tools: { analysis; practice; botInsight };
  tentative: { publish: boolean; view: boolean };     // Phase B
  workspace: { notes: boolean; rackPersistence: "local" | "session" | "none" };
};
```

**Rule:** the shell renders a control only when its capability is true. Capabilities come from the projection, never from `modeKey` checks in components. In Phase A, the adapter fills them from existing server flags (`canX`, `directPause`, `hostRacks`, `localHandoff`, `canAdminister`…). A short, explicitly listed set of interim client derivations covers what the server does not yet project:

- `surrender`: seated + playing + not blocked
- `coffee`
- `tools.*`: the catalog fetch
- `turn.act`: a mirror of the server checks

Phase B moves these into a projected `capabilities` block for both the live and Ranked functions. The server-side command checks stay authoritative either way. The UI capability only decides what is *offered*.

---

## D. RESPONSIVE LAYOUT DESIGN

### D.1 Geometry model

A pure, unit-tested function decides layout. CSS consumes its output as custom properties:

```ts
computeLiveLayout({ w, h, safe: {top, bottom, left, right}, pointer: "coarse" | "fine" })
  → { mode: "duo" | "column" | "stack" | "stack-landscape";
      board: px; cell: px; rackTile: px; labels: boolean; gutters: {left, right} }
```

- The board frame is 15 cells plus a coordinate band of about 0.6 cell (desktop/tablet). The band is hidden on phones, so frame ≈ 15 cells there.
- Desktop vertical budget: `H = 2P + S + g + rackRow`, with rackRow ≈ 0.074·S + 8. So **`S = min(W_avail, (H − 40) / 1.074)`** (P = 12, g = 8).
- Mode selection (using G_min = 280 px per gutter):
  - `duo` (two side gutters) when `W − S ≥ 2·280`.
  - `column` (one side column) when `W − S ≥ 300`.
  - Otherwise `stack` (portrait).
  - Phones in landscape use `stack-landscape`.
- Stack budget: `S = min(W − 2m, H − (oppStrip + selfStrip + rackRow + actionRow + safe))`.
- Soft cap: cell ≤ ~68 px (S ≈ 1,060 px). Beyond that, extra size goes to margins, and the gutter content stays at max-width ~460 px hugging the board.
- `ResizeObserver` on the shell feeds the function, with no layout thrash: one write of CSS variables per frame. The values are integer-rounded so tile glyphs stay crisp.

### D.2 Device matrix (CSS-px viewports, browser chrome deducted, approximate)

| Target | Viewport | Mode | Board S | Cell | Leftover use |
|---|---|---|---|---|---|
| Small phone (SE 1st gen / folded) | 320×460 | stack | 312 | 20.8 | opp strip 44 · self+event strip 40 · rack 44 · actions 48. The EventLine folds into the self strip |
| Normal small phone (SE 2/3) | 375×548 | stack | 367 | 24.5 | as above, ~5 px spare |
| Normal phone (iPhone 13–16) | 390×664 (bars shown) | stack | 382 | 25.5 | ~56 px spare → taller rack (tile 46) + dedicated EventLine |
| Tablet portrait (iPad mini / 10th) | 768×950 · 820×1100 | stack | 702 · 796 | 45 · 51 | labels on; Last Move + bag strip; secondary dock row |
| Tablet landscape | 1024×700 · 1180×750 | column | 614 · 661 | 39 · 42 | one 380–480 px right column |
| 13″ laptop | 1280×690 · 1440×790 | duo | 605 · 698 | 39 · 45 | gutters 337 · 371 |
| Normal desktop | 1920×960 | duo | 857 | 55 | gutters 531 (content 460) |
| Wide desktop | 2560×1310 | duo (capped) | ~1,060 | 68 | gutters ~750 → content 460 + margin; Turn Log may stay expanded |
| Short desktop window | 1280×560 | duo | 484 | 31 | gutters 398. **Option:** at H < 520, move the rack into the lower-right gutter (8×1 at 40 px) → S = H − 24 = 536 |
| Phone landscape | 750×340 | stack-landscape | 332 | 22 | left: player strips; right: rack 4×2 + actions |

### D.3 Arrangements

**Desktop `duo`.** The board is centred and maximal. Each gutter mirrors the table: opponent and what they just did on top, you and your controls on the bottom.

```
┌──────────────── left gutter ───────────┬──────── BOARD (S×S) ────────┬──────── right gutter ────────┐
│ ≡ Game name · mode         ◦ connection│                             │ LAST MOVE                    │
│ ┌ OPPONENT CARD ───────────┐           │                             │  B · 12=4×3 · +24            │
│ │ ● name     312   04:51 ⏵ │           │                             │ TILE BAG  37 bag · 45 unseen │
│ │ rack 8 · thinking…       │           │                             │  [unseen distribution grid]  │
│ └──────────────────────────┘           │                             │ ▸ Turn Log / Record          │
│ NOTES (private)                        │                             │ ▸ Game Tools (Analysis…)     │
│  ┌──────────────────────────┐          │                             │                              │
│  │ free text…               │          │                             │ (EventLine notices appear    │
│  └──────────────────────────┘          │                             │  at the top of this gutter)  │
│ ┌ YOUR CARD ───────────────┐           ├──── RACK (8 tiles) ─────────┤ ┌ TURN ACTIONS ───────────┐  │
│ │ ● you      298   06:12   │           │ [7][+][3][=][?][×][2][1]    │ │ [Exchange]   [ Pass ]   │  │
│ └──────────────────────────┘           │                             │ └─────────────────────────┘  │
└────────────────────────────────────────┴─────────────────────────────┴──────────────────────────────┘
```

- The **bottom row** reads identity → tiles → actions. **Turn actions sit lower-right**, aligned with the rack row. **Surrender is not there.** It lives in the Match menu (≡), top-left, far from Commit and Pass.
- The **opponent card** is top-left, aligned with the board's top edge. **Last Move** is top-right. Both carry the opponent's identity colour when they relate to the opponent's move.
- **Notes** fill the lower-left between the two cards.
- **Record and Game Tools** are collapsible sections in the right gutter. Heavy flows (History editing, Lines, Physical console, Host corrections) open as a **gutter drawer** that covers only the right gutter, never the board.

**Desktop `column`** (tablet landscape, narrow laptops). The board sits left with a 12 px margin. A single right column, top to bottom: duel scoreboard (both cards compact), EventLine, Last Move, Bag, tabs [Record | Tools | Notes], then Turn Actions pinned bottom, aligned with the rack row. The rack stays under the board.

**`stack`** (phones, tablet portrait):

```
┌ OPPONENT STRIP  ● name · 312 · 04:51⏵ · rack 8 · (2 tentative) ≡ ┐
│                                                                   │
│                        BOARD  (W − 8)                             │
│                                                                   │
├ SELF STRIP  ● you · 298 · 06:12   │ EventLine / Last move ▸        ┤
│ RACK  [7][+][3][=][?][×][2][1]                                    │
│ [⋯ More]          [ Exchange ]  [ Pass ]                          │
└───────────────────────────────────────────────────────────────────┘
```

- **More** opens a bottom sheet with segmented tabs: **Record · Bag · Notes · Tools · Match**. These are the same capabilities as desktop, just behind drill-down. The Match tab holds Surrender behind its own confirmation.
- The EventLine is a fixed-height slot. Notices **replace** its content and never push the board. Priority: incoming pause request > paused > pause response > connection/error > last move.
- A tap on the EventLine's last move opens the Record sheet at that turn.
- Tablet portrait has spare height, so it adds a persistent secondary row (Bag · Notes · Record · Tools) instead of hiding those behind "More".

---

## E. VISUAL / INTERACTION STATE MACHINE

### E.1 States

The phase is derived **only** from the newest authoritative view plus the local draft. There is no state that depends on an animation finishing.

```
Loading → Waiting(room) → [HandoffGate] → InGame → Terminal
InGame.turn  ∈ { ACTIVE, THINKING, HOST_RECORDING, SPECTATING }      (from activeSide + viewer)
InGame.draft ∈ { Idle, Tentative(n), ExchangeSelect(n), Committing }  (ACTIVE only)
InGame.match ∈ overlays { PauseIncoming, PauseOutgoing, PauseAnswered, Paused(agreement|host|save-exit), Blocked(legacy) }
InGame.view  ∈ { Live, Reviewing(logId) }
Local-only   : CoffeeBreak (viewer left the board; clock keeps running — existing semantics)
```

### E.2 Visual contract per state

| State | Board | Rack | Player cards | Action zone | Interaction |
|---|---|---|---|---|---|
| **ACTIVE** | Frame edge glow in **your side colour** (2–3 px); premium squares at full saturation; placement cursor visible | Tiles "lifted" (raised), fully saturated | Your card elevated + side-colour fill; **your clock large, bold, running dot pulsing 1 Hz**; opponent card at resting elevation (not greyed) | Exchange · Pass (no tentative) / Recall · Commit (tentative) | All of board, rack and keys |
| **THINKING** | Frame edge in **opponent colour**, thinner; **no overlay, no dimming** of committed tiles; opponent tentative tiles shown (Phase B) | Tiles resting (flat), **fully readable and reorderable**; no "disabled" grey | Opponent card elevated, **their clock running** with pulsing dot; your card resting | "**{Opponent} thinking**" + their clock mirror; no mutating buttons rendered (absent, not disabled) | Rack reorder, notes, tools, record, bag, review. Board taps select/inspect only |
| **Tentative (own)** | Tentative tiles in the "pending" treatment: dashed inner outline, raised, live score badge + validity tint; source slots in the rack show **exposed ghost outlines** | Exposed slots outlined | — | **Recall · Commit (+score)**; Commit disabled with an inline reason if invalid | Drag, retype, face edit, Backspace |
| **Tentative (opponent)** | Opponent-tinted translucent face (token + value fully legible), dashed opponent-colour border, no shadow; enters/moves/leaves with ≤120 ms fade/FLIP | — | Opponent card shows "◌ 3 on board" | — | Not interactive |
| **ExchangeSelect** | Unchanged | Selected tiles drop slightly + check mark | — | **Cancel · Exchange N** | Rack only (selection is local and never published) |
| **Committing** | Tentative tiles shimmer (no spinner overlay) | Locked | — | Commit shows progress inline | Input locked only for this command; on failure, tiles revert to Tentative with an inline error |
| **Commit transition** (any side) | Committed tiles snap to committed style. **Last-move emphasis:** strong side-colour ring + "+24" badge for ~1.5 s, then settles to a thin persistent side-colour corner mark until the next commit. Reduced motion: no glow animation, the settled mark only | Your rack refills into the holes (staggered ≤150 ms) | Score count-up ≤300 ms on the mover's card (reduced motion: instant) | Switches to the new turn immediately | Never blocked |
| **Turn transition A→B** | The frame-edge colour **transitions** (CSS transition, re-targetable) over ~300 ms | — | Card elevation and clock emphasis cross-fade ~300 ms; a one-shot glow on the newly active card. **Sound cue** (opt-out) only when *you* become ACTIVE | **Arming delay 250 ms** on Pass/Exchange only (prevents a thumb hitting a just-appeared Pass); board and rack usable instantly | Interruptible: a newer revision re-targets transitions; nothing is queued |
| **PauseIncoming** | Unchanged; the game continues (the clock keeps running for the player on move) | Usable | Requester card shows "requested pause" | — | EventLine notice: **Accept · Decline · ⋯ Decline & block 5 min**; `role=alert`; non-modal |
| **PauseOutgoing** | Unchanged | Usable | Your card: "pause requested…" | — | No cancel (there is no server op; not invented) |
| **PauseAnswered** | — | — | — | — | EventLine: "Pause declined (requests blocked 5 min)" + **OK** (= `acknowledge-pause`) |
| **Paused** (agreement / host / save-exit) | Board shown, unobscured; a subtle desaturation of the *frame only* | Reorder allowed | **Both clocks frozen** with a ⏸ glyph replacing the running dot | Paused panel: "Paused by agreement" + **Resume** (Direct, either seat) / "Paused by host" (players: no resume; host: Resume) | Notes, tools, record, reorder |
| **CoffeeBreak** (local) | The viewer is off the board; the lobby shows the existing return chip, **amended to state that the clock is running** | — | — | — | Returning restores the workspace unchanged |
| **Reviewing** | Historical board + banner "Reviewing T12 · Back to live"; the banner turns into your side colour + "Your turn — back to live" if you become ACTIVE. **Auto-return to live on becoming ACTIVE** unless a Record edit form is open | Shows historical own rack (own turns) or closed slots | Live cards keep updating (scores / clocks stay live) | Record controls for that turn | — |
| **Blocked (legacy)** | Read-only board | — | — | Explanation panel (existing copy) | Record/Replay of own data only, per existing rules |
| **Terminal / Result** | Final board; the last move stays emphasized | Final rack (own) | Winner card crowned; final clocks | **Result panel**: winner, scores, reason (score / resign / timeout / rack-out / …), rating Δ (Ranked), **Open Replay** (when the archive is available), **Back to lobby** | Notes stay visible this visit. **Polling stops; the shell does not auto-swap to ArchiveReplayPage** |

### E.3 Turn-awareness redundancy (works with sound off and motion reduced)

There are five simultaneous channels:

1. card elevation and fill;
2. the running-clock dot and size;
3. the board frame-edge colour;
4. the rack's lifted vs resting style;
5. action zone content (buttons vs "{Opponent} thinking").

None of them is a text label you must read, but each has a text equivalent for assistive tech. Colour is never the only cue: elevation, size, dot and button presence carry the meaning in greyscale too.

### E.4 Background tab attention

- On becoming ACTIVE while `document.hidden`: the title becomes `● Your turn — {game}` and a dotted favicon variant is used. Both restore on `visibilitychange`.
- **Opt-in** "Notify me when it's my turn" lives in the Match menu. `Notification.requestPermission()` is called only from that toggle's click.
- Notifications fire only when hidden, for: your turn, incoming pause request, game finished. Each has `tag = gameId`, and **no tile or rack content** in the text.
- Sound: one short two-note cue on becoming ACTIVE. Rules:
  - The AudioContext unlocks on the first pointerdown (existing `launchSound` pattern).
  - The cue never plays on initial load, reconnect catch-up, or more than once per 400 ms.
  - The mute toggle persists locally.

---

## F. PUBLIC TENTATIVE-PLACEMENT SYNC DESIGN

### F.1 Current support: **none**

- The draft is React state inside the page. Nothing is published.
- The only realtime message is a server-sent `commit` signal. Recipients then re-read the full projection through the Edge Function (two hops), with a 4 s poll fallback. **Ranked has no realtime at all** (poll only).
- `realtime.messages` has **no insert policy**, so browsers cannot broadcast.
- The Milestone S contract (F20) says "no broadcast of draft racks". The security spec forbids `"session"` (the legacy draft carrier) and any foreign tile ID in recipient traffic.
- The legacy draft-sharing design is not reusable as is. It persisted drafts in the room row (reconstructable later), carried real tile IDs (ID ⇒ token), and shared exchange drafts and selection.

**Conclusion:** opponent-visible tentative placement needs **new protocol/infra work plus an explicit security-contract amendment**. It is not frontend-only, and it belongs at the start of the Live Sync track.

### F.2 Recommended design: a non-persisted "ephemeral lane" beside the authoritative lane

| Aspect | Design |
|---|---|
| Topic | `game:{id}:draft:{A\|B}`, one per seat. The existing select policy already matches (`topic like 'game:%'` + `split_part(topic,':',2)` = game id), so the reader set is the same as the board's (seats, owner, admin, approved spectators of public/region rooms). |
| Who may send | New **insert** policy on `realtime.messages`, `extension='broadcast'`. It matches **exactly** `game:<uuid>:draft:<seat>` and allows it only when `auth.uid()` is that seat's user in `room_live` (`authority_protocol='server-v1'`, not local/physical/bot seat). It must never match the bare `game:<uuid>` commit topic. |
| Transport | **Client websocket broadcast** (not `realtime.send`, which writes DB rows). Drafts are therefore never stored in Postgres, `live_game_events`, or the projection. |
| Payload | `{ v:1, rev, seq, turn, cells:[{r,c,token,face?}] }`. This is a **full snapshot** (latest-wins, loss-tolerant, idempotent), ≤8 cells. **No tile IDs**, no rack, no exchange selection, no rack order, no selection/cursor, no timestamps beyond `seq`. |
| When sent | On every *discrete* change while ACTIVE (drop, retype, face change, recall, recall-all). The mid-drag path is not streamed. Coalesced to at most one message per animation frame, latest-wins. Re-sent on a peer `hello` (join or rejoin) so a reconnecting peer gets the **current** state only. A low-rate heartbeat (e.g. every few seconds) runs while non-empty. |
| Receiver filter | Render only if: sender seat == `model.turn.activeSide`, `rev == model.revision`, `seq` > last seen, every cell is empty on the recipient's board, `cells.length ≤ 8`, every token is in the alphabet, and token counts are possible against the recipient's **unseen pool**. Drafts for a future `rev` are buffered (latest per seat) until the view catches up. Drafts are dropped when the revision advances, on pause or finish, or when heartbeats stop (TTL). |
| Not reconstructed | No server copy and no history. A peer who missed reveal-then-recall never learns it. On rejoin a peer sees only what is on the board *now*, matching the physical-table analogy. |
| Disabled | Pass & Play (single device), Physical Hosted v1 (the physical board is the public surface; the host's console must not broadcast either player's tiles), bot seats (bots never publish), Solo, Stage, and while Reviewing / Paused / Committing. |
| Bots | **Authur never receives drafts.** They never reach the server, so the Authur request is unchanged. ArchBot (client) never reads opponent drafts. Analysis does not consume opponent drafts. |
| Commit ordering | Drafts and commits travel on different topics, so ordering is unguaranteed. The `rev` tag resolves it: a commit (rev+1) clears drafts; late drafts for an old rev are dropped. |
| Ranked | Ranked seats live in `ranked_matches`. It needs an equivalent insert policy and its own commit broadcast (a Live Sync item it needs anyway for turn awareness). |

### F.3 The alternative considered: server-validated relay (Edge `draft` op)

The server checks that the tokens are a subset of the actor's real current rack, then relays through the Realtime **REST** broadcast (non-persisted).

- **Pro:** prevents a modified client from showing *fabricated* tiles, which would be a bluff that is impossible at a physical table.
- **Con:** an Edge invocation plus a canonical state decode per draft change, adding latency and cost under rapid moves.

The fabrication risk is a fairness issue, not a secrecy issue: a sender can only misrepresent itself, and the receiver-side unseen-pool check limits it to plausible tokens. **Recommendation:** ship the client-direct lane behind a `TentativeChannel` interface so the relay can be swapped in per mode (e.g. Ranked) if the product owner rejects the residual risk. The number to measure, not invented here, is p50/p95 draft visibility across two browsers on production-like infra, recorded in the Live Sync gate.

### F.4 Fit with future Live Sync work

Live Sync should be planned as two lanes:

- **Authoritative lane:** commit → projection. Future work: Ranked broadcast, skipping redundant reads by revision, and trimming the per-turn double-board payload.
- **Ephemeral lane:** drafts; optionally presence ("opponent connected / away") later.

The tentative feature is the first consumer of the ephemeral lane and its acceptance test.

---

## G. LOCAL WORKSPACE STATE (RACK + NOTES)

### G.1 Storage choice

**`localStorage`**, one JSON record per workspace, every access wrapped in `try/catch`, with an in-memory fallback when storage is unavailable (private mode, quota).

- The data is small (an 8-slot array plus ≤ 5,000 characters of notes) and must be read synchronously at mount so there is no flash of the default rack order.
- IndexedDB is unnecessary.
- Writes are debounced ~150 ms and flushed on `pagehide` / `visibilitychange`.

```
key   = eq-lab:live-ws:v1:{userId}:{gameId}:{slot}
slot  = "A" | "B"            (seated player)
      | "host:A" | "host:B"  (Physical host — one per current rack)
value = { v:1, rackOrder:(tileId|null)[8], notes:string, updatedAt:ISO, terminalSeen?:true }
```

### G.2 Rack order lifecycle

- **Reconcile on every projection.**
  - Saved IDs still present keep their slot.
  - IDs no longer present (played / exchanged / undone) become holes.
  - New tiles **fill the holes left by departed tiles, left to right**, so a player's arrangement survives a refill.
  - Holes the player made deliberately are preserved, as the current code already supports.
- **It never resets on revision.** The current blanket reset is removed. Reorder works in ACTIVE, THINKING and Paused.
- It survives turn changes, refresh, reconnect, Coffee Break, and leaving/reopening an unfinished game (same user, browser, game, slot).
- Tentatively placed tiles keep their slot as an "exposed" ghost. Recall returns them there. Commit turns the ghost into a hole for the refill.
- It never affects gameplay: commands still carry only the tile IDs and cells of the move.

### G.3 Notes lifecycle

- **Visibility:**
  - Created lazily on first keystroke.
  - Shown wherever `caps.workspace.notes` is true: seated players, the Physical host and the Pass & Play confirmed side; not spectators.
  - **Never sent anywhere**: not in commands, projections, realtime or analytics.
  - They persist turn to turn and survive refresh and reconnect for the unfinished game.
- **On terminal**, while the shell instance that observed completion stays mounted:
  - Notes remain visible (and editable) beside the Result panel.
  - The shell **holds the terminal view**: polling stops and there is no auto-swap to ArchiveReplayPage.
  - Leaving (route change or unmount after `terminalSeen`) **deletes the record**.
- **Purge rules:**
  - If the live row is gone when the game is opened (completed while away, refresh after completion → `PlayApplication` routes to Replay), the workspace record for that `gameId` is deleted **before** Replay renders. Notes never appear in Replay or History.
  - On sign-out, delete all `eq-lab:live-ws:v1:{userId}:*`.
  - On boot, garbage-collect records older than 30 days, plus an LRU cap of about 50 records.
- **Pass & Play:** the shared device is a known boundary ("cannot isolate private information from someone with unrestricted device access"). Recommendation (decision needed, §N):
  - Per-side records are shown **only after handoff confirm**.
  - Rack order is held in **memory only**, because tile IDs ⇒ tokens and persisting them would let the other player read the rack from storage after a refresh.
  - Notes per side persist with the caveat stated in the handoff gate.

---

## H. MODE / CAPABILITY MATRIX

The values below are what today's server flags and catalog imply. Phase B projects them explicitly. ✓ = offered, — = not offered, (cat) = per mode-tool catalog.

| Mode | Acts on turn | Publish tentative (B) | See opp. tentative (B) | Notes / rack persist | Analysis | Turn Log / Review | Undo/Redo | Lines (branches) | Annotate | Direct pause | Host / practice admin | Save & Exit | Surrender | Coffee | Mode surface |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Direct (online_versus) | seat | ✓ | ✓ | ✓ / local | (cat) ✓ | ✓ | — | — | — | ✓ | — | — | ✓ | ✓ | — |
| Ranked | seat | ✓ (needs ranked policy) | ✓ | ✓ / local | — | ✓ | — | — | — | — (unchanged) | — | — | ✓ | — (Leave only, unchanged) | Stakes / Ready, rating Δ |
| Hosted app-drawn | seat; host administers | ✓ seats | ✓ | ✓ / local | (cat) ✓ | ✓ | — | — | — | — | Host: pause/resume/finish, correct score | — | ✓ seats | ✓ | Host section in Match menu |
| Physical Hosted (manual) | host records for active side | — (v1) | — | ✓ host per side | (cat) ✓ host | ✓ | ✓ | (cat) ✓ | ✓ | — | ✓ | — | ✓ seats | ✓ | **PhysicalConsole** (both current racks, intake, return, correct) |
| Pass & Play (local_versus) | confirmed side | — (local) | — | per side, after handoff (§G) | (cat) ✓ | ✓ | ✓ | (cat) ✓ | ✓ | — | ✓ local controller | ✓ | ✓ | ✓ | **HandoffGate** |
| Authur (server bot) | human seat | — | — | ✓ / local | (cat) ✓ | ✓ | — | — | — | — | — | — | ✓ | ✓ | Bot thinking "on the server", Retry on stall |
| ArchBot (stage5b) | human seat | — | — | ✓ / local | (cat) ✓ | ✓ | ✓ (practice exception) | (cat) ✓ | ✓ | — | — | — | ✓ | ✓ | Bot thinking "on this device" |
| Solo | A | — | — | ✓ / local | (cat) ✓ | ✓ | ✓ | — | ✓ | — | ✓ practice controls | ✓ | ✓ | ✓ | Single player card |
| Stage | human seat | — | — | ✓ / local | (cat) **inherits authur_strong → ✓ (open question)** | ✓ | ✓ (bagless) | (cat) | ✓ | — | — | — | ✓ | ✓ | Stage label, terminal → Stage result |
| Spectator | — | — | per decision (§N) | — | — | ✓ public logs | — | — | — | — | — | — | — | — | No rack, notes or actions |

---

## I. SECURITY IMPACT

The hidden-information boundaries are **unchanged** for everything except one deliberate, actor-initiated disclosure: the active player's own tentative board tiles.

| Item | Impact | Safeguard / test |
|---|---|---|
| Public tentative placement | **Contract amendment.** The active seat may disclose tokens it chooses to place on the board. The opponent rack, ordered bag, RNG and canonical history are unaffected; drafts originate from the sender's own projection only | Insert policy scoped per seat topic; no IDs in payload; non-persisted transport; receiver filters; tests assert no draft rows in DB, no foreign IDs, nothing published in disabled modes |
| Commit topic spoofing | A wrong policy could allow fake `commit` signals (harmless refresh, but noise) | The policy pattern matches only `:draft:<seat>`; a negative test sends to `game:<id>` and expects rejection |
| Physical host | The host sees both current racks (existing). The console must **not** broadcast | Tentative publishing is disabled for the host role |
| Pass & Play | Concealment preserved. Workspace shown only after handoff; rack order memory-only | Handoff test asserts the previous side's notes and rack order are not rendered |
| Analysis | Unchanged: own projection only, independent of Authur, never consumes opponent drafts | Unit test: the analysis request contains no draft input |
| Authur | Unchanged: drafts never reach the server or the job request | Existing job-request secrecy assertions stay |
| Tile distribution | Derived client-side from board + own rack + counts (unseen pool), never from server bag data. For the Physical host, derivation from both racks equals bag *composition* (unordered), already derivable under its privilege; order is never exposed | Test: the TileBagInfo source has no new network field; counts reconcile (bag + opp rack = unseen) including pending exchange returns |
| Notes / rack order | Local only | Network-capture test with a sentinel note string across play, commit, realtime and Replay |
| Capabilities block (Phase B) | Tightening: moves UI offers server-side; command authorization unchanged | Capability tests per mode (§L) |
| Notifications / title | No tile or rack content | Unit test on notification text |
| Spectators | If drafts are visible to spectators, that is consistent with "public", but it is a product decision | Policy chooses the reader set (§N) |

**Safely implementable with the current server model:** everything in Phase A, which is frontend-only and uses no new data. That covers the shell, layout, turn awareness, rack persistence and reorder in THINKING, Notes, Last Move, unseen distribution, the non-modal pause notice, surrender confirmation, sound, title, notifications and accessibility.

**Not implementable safely with the current server model (needs server work):**

1. Opponent-visible tentative placement: needs a realtime insert policy, the ephemeral protocol, and contract sign-off.
2. "Server-authoritative capabilities" for everything: Resign, Coffee, tool availability and Ranked controls are currently client-derived or catalog-fetched. The projection needs a capability block.
3. Fast turn awareness in **Ranked**: poll-only (≤4 s), no commit broadcast.
4. A stable Result screen after completion: needs a client change (hold terminal, stop polling). No server change.

---

## J. ACCESSIBILITY

- **Board:** `role="grid"` 15×15 with roving tabindex (one Tab stop).
  - Arrow keys move focus. **Focus is the placement cursor**, unifying today's global-key cursor with focus.
  - Typing a token places at focus (existing `resolveStudyKey` / `resolveRackTile`). Space or Shift cycles direction. Enter commits. Esc recalls the last tile or exits a mode. E edits a face.
  - Each cell's accessible name covers coordinate, premium, and content: committed (by A/B, last move), own tentative, or opponent tentative.
- **Rack:** a roving-focus list. Selecting with Enter/Space and **reordering with Alt+←/→** work in ACTIVE and THINKING. Exchange selection uses Space. Positions are announced.
- **Shortcuts** never steal plain letters (they are tile input). Global commands use Alt-chords plus skip links / landmarks: Board, Rack, Actions, Notes, Record. Playwright caveat: `+` arrives as `=`; tests type `p`.
- **Live regions:**
  - polite: turn changes ("Your turn. B played 12 = 4 × 3 for 24, total 312"), commit result, exchange/pass outcomes;
  - assertive: incoming pause request, connection lost;
  - clocks are not live (announced at thresholds: 60 s, 30 s);
  - opponent tentative changes are summarized and throttled ("Opponent has 3 tiles on the board"), with a toggle.
- **Focus:** turn changes **never move focus**. Sheets trap and restore focus (existing `Sheet`). The pause notice is reachable by a landmark and an Alt-shortcut and never steals focus mid-placement.
- **Contrast:** text ≥ 4.5:1, using darker side tokens for text on light surfaces. Tentative vs committed vs last-move are distinguished by border style and shape, not hue alone. Active vs inactive uses elevation, size and the running dot as well as colour.
- **Reduced motion:** no sweeps, pulses, count-ups or FLIP. State swaps instantly and keeps the static cues.
- **Sound-independent:** every audio cue has a visual equivalent, and sound is off-able.
- **Touch targets:**
  - Actions ≥ 44×44.
  - Rack tiles ≥ 44 wide on ≥ 375 px phones; 37 px at 320 px (spacing compensates, WCAG 2.5.8 AA).
  - Board cells (21–25 px on phones) are below 44. Placement is tap-select-then-tap-cell or drag with an enlarged drop indicator; an optional loupe is a later enhancement.
- **i18n:** all shell strings go through i18n (fixing today's inline Thai/English mix), and the layout is tested with the longer Thai strings.

---

## K. IMPLEMENTATION PHASES

There are three vertical slices, each with an explicit gate. **Nothing ships to production without the operator's step-by-step approval.**

### Phase A: Unified Live Game Shell (frontend only, no server or contract change)

- `LiveGameRoute` + adapters (Live / Ranked / Dev). `ShellModel` + an interim `ShellCapabilities` adapter (the interim client derivations are enumerated in one file).
- Hooks: `useLiveMatch` (incl. terminal hold + stop polling + no auto Replay swap), `useClock` (server offset from response `Date`), `useTurnDraft` (revalidate, not reset), `useLiveWorkspace`, `useTurnTransition`.
- `computeLiveLayout` + `live-shell.css` on `tokens.css`. The legacy layers are not imported for the shell.
- PlayerCards / TurnAwareness, BoardStage (last-move layer, a11y grid), RackWorkspace (THINKING reorder, persistence), TurnActions (Exchange·Pass ↔ Recall·Commit, exchange sub-mode, arming delay), EventLine (non-modal pause notice / response / paused / connection), LastMove, TileBagInfo (derived unseen), NotesPad, MatchControls (Surrender ConfirmSheet; Host lifecycle; Finish ConfirmSheet), RecordTools (Turn Log / review / history / lines / annotate / host corrections), GameTools, PhysicalConsole, HandoffGate, WaitingRoom restyle, Attention (sound, title/favicon, opt-in notifications).
- All modes render in the shell, including Ranked and the dev sources. `RankedMatchPage`, `ContextTools`, and live use of `ActionPanel` / `MobileActionBar` are retired.
- **Gate A:**
  - unit (layout matrix, adapters, workspace lifecycle, draft revalidation, transition derivation);
  - component (every state in §E);
  - visual matrix (§L) reviewed and **approved by the product owner**;
  - existing live-security browser and functional specs green with updated selectors;
  - network-secrecy assertions unchanged and extended with the Notes sentinel;
  - axe zero serious/critical issues;
  - keyboard-only playthrough.
  - **No server diff.**

### Phase B: Ephemeral lane + capability block (server + client, one security-reviewed release unit)

- Migration: a `realtime.messages` insert policy for `game:<id>:draft:<seat>`, plus the Ranked equivalent and a Ranked commit broadcast.
- Projection: an explicit `capabilities` block (live + Ranked). Interim client derivations are deleted.
- Client: `TentativeChannel` (client-direct), the receiver filter, the remote tentative layer, and peer hello / heartbeat / TTL.
- Security doc amendment: F20 "no broadcast of draft racks" is replaced by the public-tentative contract.
- **Gate B:**
  - local disposable-stack two-browser specs (§L);
  - policy positive and negative tests;
  - no persisted draft rows;
  - foreign-ID and forbidden-key scans over draft traffic;
  - disabled-mode assertions;
  - measured draft visibility p50/p95 and Ranked turn latency recorded (targets set at review, after measurement);
  - operator preflight for the migration.

### Phase C: Release hardening and launch

- Performance: payload trimming for logs, redundant-read skipping.
- Final visual and accessibility approval on real devices (iOS Safari, Android Chrome).
- Production deploy (frontend + Phase B unit) with approval, a smoke subset re-run for UI and tentative flows, then **creation flags flipped only by explicit operator decision**.

---

## L. TEST / ACCEPTANCE PLAN

| Area | Method | Acceptance |
|---|---|---|
| **Visual regression** | Playwright screenshots, disposable stack. States × viewports: ACTIVE-idle, ACTIVE-tentative (valid/invalid), ExchangeSelect, THINKING (+opp tentative in B), Committing, last-move settled, PauseIncoming, Paused, Reviewing, Terminal+Notes, HandoffGate, Physical console, Spectator, Solo | Product-owner sign-off on the image set. Diff threshold after baseline. Not just "no overlap" |
| **Responsive geometry** | Unit: `computeLiveLayout` table tests for the §D.2 matrix + boundary widths (gutter thresholds ±1 px, H 519/520). Browser: assert the board is square, `board == expected ±1 px`, no element overlaps board/rack, no horizontal scroll, safe-area respected; rack directly under the board (gap ≤ 12 px) on desktop | Every matrix row within ±1 px of the model; zero overlap / clipping / page scroll |
| **Interaction** | Component + browser: click / type / drag / face edit / Backspace / Recall / Commit / Exchange N / Pass; reorder in ACTIVE, THINKING and Paused; a non-turn revision (pause request, annotate) **does not wipe** the draft or rack order; arming delay; review auto-return | All pass with keyboard-only and pointer-only |
| **Capability authorization** | Per mode (§H): the rendered controls equal the projected capabilities. Server: commands refused when the capability is absent (existing tests retained). Phase B: a projection snapshot per mode | No control rendered without its capability; no command accepted that the server denies |
| **Hidden-information security** | Existing `security.spec` forbidden-key and foreign-ID scans extended to: draft topic traffic, Notes sentinel, notification text, TileBagInfo source; Pass & Play conceal; Physical host draft disabled; Authur job request unchanged | Zero findings; existing assertions unchanged |
| **Two-browser tentative sync (B)** | Browsers A and B on a Direct game: place / move / recall / face change / recall-all / commit; B sees each within the measured budget; reveal→recall then the observer reconnects → **nothing** reconstructed; rejoin mid-turn → current tiles only; sender disconnect → TTL clears; stale-rev drafts dropped; spectator per decision; negative: B cannot publish on A's topic or on `game:<id>` | All pass; latency distribution recorded |
| **Fast turn transitions** | Scripted rapid alternation (commit/pass within ~200 ms) and a burst of 3 revisions arriving together: the UI converges to the latest; no stuck animation; sound at most once per 400 ms; nothing queued; input on board never blocked | Final DOM state == latest projection within one frame of its arrival |
| **Reconnect** | Offline → online, tab sleep, second tab, reload mid-turn and mid-tentative: workspace (rack order, notes) restored; draft revalidated; clocks corrected by server offset; no duplicate command (existing idempotency) | Pass |
| **Terminal** | Finish by score / resign / timeout / host finish: Result is stable >10 s (no auto Replay swap), Notes visible, leaving deletes the record, a reload shows Replay with no Notes | Pass |
| **Mobile** | Device emulation 320 / 375 / 390 / 768 and landscape plus real iOS Safari and Android Chrome: drag precision, sheets, EventLine notices, no fixed-popup containing-block traps, no horizontal scroll (iOS) | Pass on real devices |
| **Accessibility** | axe on every state; keyboard-only full game; screen-reader smoke (VoiceOver: turn announcement, pause alert); reduced-motion emulation; contrast token check; target-size audit | Zero serious/critical issues; documented exceptions only (board cell size on phones) |

The local gates use the established disposable stack (API 54521 / DB 54522, functions served from the private workdir, preview 4478). Run `uptime` first, because high host load causes spurious auth 504s.

---

## M. WHAT TO REUSE FROM THE CURRENT UI CHECKPOINT (`58667ce`)

**Reuse:**

- The decomposition of `CompatibilityControls` into `WaitingControls` / `PauseSheets` / `HistoryControls`, and their **handlers and command payloads**. The presentation is replaced.
- The direct pause respond / acknowledge wiring through `client.control`. It moves into the EventLine notice.
- `liveClockLine` (correct per-side untimed waiting-room copy).
- The principle of "no unstyled native controls"; the `.eq-button` / `.eq-field` adoption for forms inside drawers.
- The fix for the Sheet backdrop target on the play route.
- `OverflowMenu`'s `triggerClassName` / `children` extension (harmless).
- The test pattern in `tests/live-play-layout.test.tsx` (matchMedia-driven mobile/desktop), extended for layout modes.
- The paused state visible on phones, kept as a requirement (now in the PlayerCards / EventLine).

**Do not let it constrain the redesign:**

- The right-rail "Game tools" grab-bag (`ContextTools`) and the single "Game menu" mixing Coffee / Pause / Rename / Leave. The IA is now four distinct groups.
- The `top-bar` header with **Resign beside the menu**.
- The legacy three-column `.workspace` grid and the 16-layer legacy CSS cascade.
- The Place-mode `MobileActionBar` / `ActionPanel`.
- The phone Turn Log stacked below the board.
- The pause request as a modal Sheet.
- `window.confirm`.
- The `ranked` prop forks and `playUiGame`.
- The compatibility spec selectors ("Game tools", "Game menu"), which will be rewritten to the new landmarks.

---

## N. RISKS / OPEN TECHNICAL QUESTIONS

**Product decisions needed:**

1. **Tentative sender trust:** client-direct (fast; fabricated-but-plausible tiles possible from a modified client) or server-validated relay (slower, exact)? Per mode, e.g. a relay for Ranked?
2. **Spectators and tentative tiles:** same audience as the board (current read policy), or seats only?
3. **Physical Hosted tentative:** keep disabled in v1?
4. **Pass & Play workspace:** memory-only rack order and persisted per-side notes, as recommended?
5. **Notes when the game completes while the player is away:** recommended purge without display (Replay must never show them). Acceptable?
6. **Stage tools:** Stage inherits the `authur_strong` catalog (incl. analysis). Is that intended? It is out of scope for the UI, but the capability block will make it explicit.
7. **Short-height desktop:** allow the rack to move into the lower-right gutter below H ≈ 520 px (+~50 px board)?
8. **Wide desktop cap:** cell ≤ 68 px, or let the board keep growing?
9. **Sound default:** on (opt-out) or off (opt-in)?
10. **Premove:** private local planning on the board during THINKING. Out of scope; it would conflict with "board = public" semantics unless clearly separated.

**Technical risks:**

- Supabase Realtime **rate limits** and join-time authorization caching for client broadcasts. Seats are stable, so the join-time check suffices, but this must be verified on the production project tier.
- Realtime **private-channel insert** behaviour with the custom policy must be validated on the hosted project, not only locally.
- **Clock skew:** current clocks ignore server/client offset. `useClock` uses the response `Date` header or a server timestamp, which needs verifying through the Edge Function's CORS and `Cache-Control` headers.
- **Terminal hold vs Replay availability:** the archive may not be ready immediately, so "Open Replay" must poll `readSafeArchiveReplay` politely.
- **Payload growth:** logs carry two full boards per turn and are re-read every 4 s. Not a UX blocker, but it affects reconnect and transition latency. Phase C.
- **Ranked parity:** a separate function, so capability and broadcast work happens twice.
- **Unseen-pool reconciliation** with pending exchange returns and face-down counts. Needs explicit tests so the displayed distribution never contradicts counts.
- **Legacy `App.tsx` shares Board/Rack:** the refactors must keep the legacy board's behaviour (memo comparators, props). Board/Rack changes stay additive.

---

## O. RECOMMENDED NEXT STEP

1. **Close Milestone S first, using `58667ce` as the smoke vehicle.** That is a frontend-only deploy, only with explicit operator approval; creation stays disabled for the public, and the Phase 6 smoke resumes at A1.
   - The smoke validates backend authority and secrecy in production, which is UI-independent. Phase B modifies the same server surfaces (projection, realtime policies), so a verified production baseline should exist before that work starts.
   - The smoke is an operator activity, not a public launch, so it does not need visually approved UI. Phase C re-runs the UI-dependent smoke subset on the new shell anyway.
   - If the operator prefers not to deploy `58667ce`, the fallback is to start Phase A immediately and run the smoke on the Phase A shell. That delays security closure by the length of Phase A.
2. In parallel, after review: decide the §N product questions (at least 1–5, 7 and 9), then start **Phase A** in a fresh worktree branched from `58667ce`.
3. Write the Phase B security amendment (§F / §I) for review **before** any migration is drafted.
