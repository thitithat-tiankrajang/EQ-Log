# EQ-Lab Phase A takeover report

Date: 2026-10-03, Asia/Bangkok. Worktree: `/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync`. Branch: `codex/live-sync-optimization-phase1`.

**PRODUCT VISUAL APPROVAL: WAITING.** Local functional gates passed. Nothing was pushed, deployed, changed in production, or implemented for Phase B. The primary `/Desktop/EQ-Lab` checkout was not accessed or changed.

## A. HANDOFF STATE

Inherited HEAD: `58667ceca7b9b70734af04c2f4ee7f1474d34c9d`, immediately following frozen Milestone-S candidate `4e1fcdc95b6305ee3ae017c2fdd8118f16088ca0`. There was no later local Phase A commit. The larger redesign was uncommitted: 20 modified tracked files, the staged removal of `ContextTools.tsx`, and the new shell, three unit/component suites, fixture browser suites/config and design document. All were preserved and understood before editing. The design document remains in this commit.

No test process was still running. Two inherited Vite servers (5173 and 5191) and an old log tail were present and left alone. The disposable Milestone-S Docker stack was already running; its trusted worker was stopped. The previous agent's retained rerun log showed **5 passed, 1 failed**: mouse compatibility, frozen legacy, Authur/Stage and both Solo cases passed; touch compatibility failed when the tools sheet intercepted Close practice. Its saved screenshot/error context corroborated the log.

No reset, stash, clean, checkout-away, history rewrite, worktree creation or deletion occurred.

## B. IMPLEMENTATION SUMMARY

Inherited implementation: the unified shell/model/capability adapter, new board/rack/draft, accessible grid, turn awareness, sound, pointer guard, tool taxonomy, Notes/storage, Last Move/bag, non-modal pause, waiting/handoff integration, Result hold, fixture environment, responsive geometry, i18n and the existing security selector adaptations.

Takeover changes:

- Fixed mobile practice's real pointer/focus failure: use the existing portal-backed Sheet and close the secondary tools sheet before opening practice. Escape and focus handling now use the shared dialog lifecycle; practice fits its sheet width. Security selectors follow this legitimate presentation change, with every hidden-information assertion retained.
- Removed the arbitrary 68px board-cell cap. Wide 2560×1310 now uses a **1168px** board instead of 1059px; normal and short-window geometry is unchanged.
- Fixed a real Notes cleanup race on Result → Replay. The new Replay reader rendered before the departing Result cleanup, then cancelled deletion and resurrected Notes. A Result-seen marker is now saved immediately and honored by the completed-game Notes reader. Players who were away at completion still see their Notes on first visit.
- Added failing-then-passing component and real-backend Result lifecycle regressions, mobile practice pointer/Escape/focus/axe coverage, the missing viewport evidence classes, and final contact sheets/gallery.
- Added explicit disposable-local app/auth demo, reproducible gates, artifact scanning and the manual run guide. No normal-app authentication bypass was introduced.

## C. ARCHITECTURE

`LivePage` opens `LiveGameScreen`; the old `RankedMatchPage` is a thin compatibility adapter into that same screen. `LiveGameScreen` owns recipient reads, typed existing commands, bot dispatch, waiting/handoff gates, review/practice and local workspace state. It does not decode a canonical live game.

`useLiveMatch` accepts the newest revision, subscribes/polls as before and holds finished Results. `model.ts` maps the existing authorized recipient view into shell state and UI capabilities. `useTurnDraft` owns only the player's local placement, selection, exchange and cursor; `workspace.ts` owns local rack order/Notes. `LiveGameShell` composes `LiveBoard`, `LiveRack`, `PlayerCard`, `TurnActions`, `EventLine`, `LastMovePanel`, `NotesPad`, `TileBagPanel`, `GameTools`, `RecordTools`, `PhysicalConsole` and `MatchControls`. `layout.ts` chooses the largest fitting square among desktop gutters, a single column, portrait stack and landscape phone arrangements; CSS receives the resulting dimensions.

The Phase B opponent-tentative input is an empty layer boundary. There is no tentative transport, fake synchronization or historical reconstruction. The dev fixture module is loaded only under `import.meta.env.DEV`; production builds omit it. Authoritative clients, reducers, security projections, Edge functions, database migrations and trusted worker semantics have no diff from the security candidate.

## D. RESPONSIVE BOARD GEOMETRY

These are actual CSS viewport sizes, representing available browser space. Board measurements are the outer square frame, including its coordinate band/border. The playable grid is 15 cells wide. Browser assertions checked squareness, viewport bounds, rack bounds/non-overlap, zero page overflow, and 25 sampled board points free of accidental occlusion. Secondary sheets intentionally cover the game while open and are excluded from that occlusion assertion.

| Viewport                                   | Arrangement     | Rack   | Board frame | Playable grid |
| ------------------------------------------ | --------------- | ------ | ----------: | ------------: |
| 320×460                                    | stack, compact  | below  |       302px |         300px |
| 375×548                                    | stack, compact  | below  |       362px |         360px |
| 390×664                                    | stack           | below  |       377px |         375px |
| 768×950 tablet portrait                    | stack           | below  |       686px |         660px |
| 820×1100 large tablet                      | stack           | below  |       780px |         750px |
| 1024×700 tablet landscape                  | column          | below  |       608px |         585px |
| 1280×690 13-inch class                     | duo             | below  |       593px |         570px |
| 1440×790 laptop                            | duo             | below  |       686px |         660px |
| 1920×960 1080p class, usable browser space | duo             | below  |       842px |         810px |
| 2560×1310 wide                             | duo             | below  |      1168px |        1125px |
| 1280×560 short desktop                     | duo             | gutter |       531px |         510px |
| 750×340 phone landscape                    | landscape stack | side   |       332px |         330px |

All 12 classes passed both the layout matrix and browser evidence checks. Geometry does not imply product visual approval.

## E. ACTIVE / THINKING / TURN INTERACTION

ACTIVE emphasizes the player/clock and board/rack; THINKING emphasizes the opponent and retains readable tiles and the usable workspace. Rack reorder, Notes, board inspection, public bag/records and permitted tools remain available in THINKING; authoritative turn actions and board placement are unavailable.

No Place button exists. Empty draft: Exchange/Pass; tentative draft: Recall/Commit. Fast batched transitions converge to the newest revision, stale reads cannot roll the view backward, turn announcements preserve focus, and no queued dialogs or blanket 250ms lock exists. The action guard requires a press to begin on the currently painted button. Your-turn sound defaults on, is brief, easy to mute and locally persistent; audible playback requires a browser gesture. Reduced motion removes sweep/pulse effects without removing turn state. Pause requests are inline and immediately actionable while play continues. Match controls retain separate confirmed surrender and authoritative pause/resume/Coffee semantics.

## F. RACK / NOTES / LAST MOVE

Rack size remains eight. Selection, drag, exposed slots and point values are distinct; mouse and real CDP touch tests cover placement, moving, swapping and returning. Reorder works during ACTIVE and THINKING; saved order reconciles with authorized tile IDs across turns/revisions/reload/reopening. Pass & Play uses memory-only workspace data and preserves conceal/confirmation gates.

Notes are browser-local, limited to 4000 characters, never included in a request or authoritative record. Local storage retains them through unfinished-game refresh/reopening; approximately 30-day orphan cleanup bounds abandoned records. Result holds them until leaving, including opening Replay; the new component/real-browser regressions verify deletion without resurrection. Away-at-completion Notes remain visible on first completed-game visit, then delete on departure. Browser storage restrictions may limit durability.

Last Move independently shows committed placement/expression and score, Exchanged N tiles, or Passed. Tentative placement/recall never becomes Last Move or Turn Log. Committed tiles, the latest committed move, and local tentative tiles have separate readable treatments.

## G. ACCESSIBILITY

The 225-cell board exposes named cells and one roving grid tab stop. Arrow navigation, Space direction change, typed placement and Enter commit are covered in the real browser. Rack Alt+arrow reorder and persistence are covered in components; pointer drag reorder is covered in the browser. Focus is preserved on turn announcements. Shared Sheet handles modal focus, Escape and app inert state; the repaired mobile practice path verifies these with actual clicks.

Axe found **no serious or critical violations** in desktop ACTIVE/Result, phone THINKING/pause-request, and the mobile practice dialog. This is scoped automated evidence, not a complete manual screen-reader audit. Reduced-motion and phone target-size checks passed.

## H. SECURITY REGRESSION RESULTS

**Final real local browser gate: 16 passed, no skips, approximately three minutes**, against only the existing disposable API at 54521/database at 54522. It exercises:

- Physical host/A+host/B+host current-rack authority, ordinary-player denial and no predictive bag.
- Pass & Play concealment and fresh reload/second-tab handoff; ArchBot's explicit practice exception.
- Mouse and touch draft/reorder/swap/return, own-rack practice and Coffee Return.
- Funding limits, CAS/stale/duplicate/idempotent commands and safe retries.
- Hosted administration across three browsers; frozen v2/v3 legacy read-only/reconnect/storage preservation.
- Normal public/private two-browser exchange/reload/reconnect/second-tab/completion.
- Full-strength trusted Authur and Stage, real bot moves/retry/analysis/reload/completed Replay.
- Ranked authority, both Solo variants and terminal Result/Notes/explicit Replay.

Existing security assertions were retained. All repaired product failures are closed. Stage smoke here is disposable test coverage only; it does not approve or enable Stage in production. No server security semantics or production flags changed.

The 14 focused unit/component/security files passed **120 tests**. Separately, `engine-in-browser` passed 13/14: its only failure reads `../amath-engine/Makefile` and requires a `wasm-mt:` target absent in that sibling checkout. Its source/test and sibling repository were not modified. This is an unrelated repository dependency failure, not a Phase A build failure; it was classified once and not repeatedly rerun.

## I. BUILD / ARTIFACT SCANS

Format (including the new live shell/tools), lint, typecheck and production build passed. Lint emits an existing jsx-ast-utils diagnostic about `TSNonNullExpression`, but exits successfully with zero lint errors/warnings. Frontend scanning covered both the ordinary `dist` build and disposable-backend preview, 42 files each: **zero source maps, known local secret-value matches, private-credential patterns, Authur executor/model fingerprints/names, or dev fixture/executor-code markers**. ArchBot/browser analysis artifacts remain under their accepted existing contracts. These are finite local artifact scans, not a claim about future builds or production deployment.

## J. VISUAL EVIDENCE

Evidence directory: `docs/evidence/phase-a-final/` in this worktree. `index.html` is the readable gallery; every image links to its original resolution. `manifest.json` records the exact viewport, layout, rack placement, state, turn and measured board size.

| Contact sheet / original                                | Content                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| `contact-phone-states.png`                              | Native-width 390px ACTIVE, THINKING, tentative and incoming pause request |
| `contact-phone-tools.png`                               | Mobile Record, public Bag and repaired own-rack practice sheet            |
| `contact-desktop-layout.png`                            | Laptop 1440×790 and short desktop 1280×560 with gutter rack               |
| `contact-desktop-workspace.png`                         | Desktop Notes and Last Move: Exchanged 4 tiles                            |
| `09-tablet-portrait.png`, `10-tablet-landscape.png`     | Tablet arrangements                                                       |
| `13-desktop-1080p.png`, `14-desktop-wide.png`           | Large desktops, including the larger final wide board                     |
| `18-desktop-last-place.png`                             | Last committed placement +score                                           |
| `19-desktop-pause-request.png`, `20-desktop-paused.png` | Non-blocking request and authoritative pause                              |
| `21-desktop-result.png`, `22-390-result.png`            | Result keeps Notes for that visit                                         |
| `23-physical-host.png`                                  | Authorized Physical console                                               |
| `24-phone-landscape.png` through `27-laptop-1280.png`   | Remaining viewport classes                                                |
| `normal-local-login.png`                                | Fresh configured normal app's actual Login screen                         |

I inspected the phone states, mobile tools/practice, tablet portrait, desktop/laptop, Notes, short-window, wide-screen and Result images. The only obvious geometry defect found in that review, the wide-board cap, was corrected. The final fixture browser run passed **39 checks: 11 behavior/accessibility tests and 28 evidence views**; the affected Result views were recaptured after the Notes lifecycle fix. The product owner's visual review is still required.

## K. DEFERRED PHASE-B ITEMS

Trusted ephemeral opponent tentative placement remains deferred. There is no browser-to-browser tentative broadcast or reconstruction for disconnected players. A future trusted lightweight relay must validate ownership/turn/revision, avoid historical draft storage, and exclude spectators/Physical Hosted/Pass & Play V1. Capability protocol changes, Live Sync benchmarks and infrastructure redesign were not started.

## L. KNOWN LIMITATIONS

- Product visual approval is outstanding; production smoke remains paused.
- Local Google OAuth is unconfigured. The safe demo uses genuine disposable password sessions in separate Chromium contexts.
- The inspected local stack and its protected files are prerequisites; the guide is not a fresh-machine bootstrap.
- Unconfigured ordinary dev mode still permits legacy local-only access as before. It does not test online authentication or a real live game.
- Fixture refresh resets gameplay state; fixtures do not validate real networking/auth/authority or execute a real trusted Authur.
- Browser evidence is Chromium, with CDP touch and axe/reduced-motion checks. Safari/Firefox, hardware touch and a full screen-reader audit are not claimed.
- Notes/rack durability depends on available browser storage; sound depends on audio unlock. Very short/narrow viewports use compact controls/sheets.
- The unrelated sibling Makefile assertion described above remains failing.

## M. LOCAL COMMIT SHA

One focused local Phase A commit is created after these gates, preserving both 58667ce and the security candidate. The exact resulting SHA is supplied in the chat's final report and can be read with `git log -1 --format=%H`. No push occurs. A document within the commit cannot contain its own final commit hash without a history rewrite.

## N. PRODUCT VISUAL APPROVAL: WAITING

The implementation is ready for the product owner's local visual review. This report grants no deployment, production readiness or visual approval.

## O. LOCAL RUN / MANUAL TEST GUIDE

See [the exact local run guide](phase-a-local-run-2026-10-03.md). It includes prerequisites, services/private variable names, commands grouped by terminal, ports/first screens, safe real local sign-in and game launch, fixture states/capabilities/limits, targeted process shutdown, and **HOW I CAN TELL I RAN THE RIGHT THING**.

Normal workflow: local Edge functions in Terminal 1; `node tools/phase-a/local.mjs app` in Terminal 2 (5192); `node tools/phase-a/local.mjs demo` in Terminal 3. Fixture workflow: empty Supabase frontend variables and `npm run dev -- --port 5193`, then `/#/play/live-shell-fixture:active:a`.

## Retained evidence and regression ledger

- Inherited rerun: 5 passed / mobile practice Close blocked. Reproduced with two dialogs; fixed with one portal Sheet; focused fixture and real CDP touch passed.
- Wide board: fixed-cap reproduction failed the board-maximization test; removing only that cap passed matrix and wide browser geometry, increasing the board by 109px.
- Real Result test first needed the duo viewport to expose its persistent Notes pad (column layout puts Notes in a tab). Once corrected, it exposed Notes resurrection on Replay. The matching component transition went red before the fix; both component and real browser passed after the marker fix.
- Manual demo initially sent B's Ready before B observed A's revision; waiting for authoritative readiness corrected the helper's sequence. Real login and both UI launches then passed.
- Final logs/check metadata/scans: `security-browser-final.log`, `shell-browser-final.log`, `checks.json`, `build-scan.json`, `engine-unrelated.log`, plus the focused Result log, in the evidence directory. Test/build process logs remain under `test-results/phase-a-gate`.
