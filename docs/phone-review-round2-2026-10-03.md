# Live shell — physical-phone review, round 2

Date 2026-10-03 · worktree `EQ-Lab-live-sync` · base `3dc8ec7` · **PRODUCT VISUAL APPROVAL: WAITING**

Interaction model and game UI only. No authority, projection, capability, Edge Function, migration or worker change. Opponent tentative sync remains Phase B. Nothing pushed or deployed.

## Interaction state machine (`useTurnDraft`)

One selection at a time — a rack tile or a tentative board tile. Select an object, then where it goes.

| State             | Tap                                | Result                                                                                                        |
| ----------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| NORMAL (my turn)  | rack tile                          | arrow showing → placed at the arrow; rack tile selected → the two swap slots; else select it                  |
|                   | tentative board tile               | rack tile selected → it takes the square (board tile goes home); board tile selected → they swap; else select |
|                   | same alternative, ≤400 ms          | value picker (a single tap never opens it)                                                                    |
|                   | empty square                       | selection → it goes there; else arrow: RIGHT (new square) → DOWN → OFF → RIGHT                                |
|                   | empty rack slot                    | board tile selected → returns into THAT slot; rack tile selected → moves into it                              |
|                   | occupied slot, board tile selected | the selection moves to that rack tile (no tile is ever displaced)                                             |
| unassigned alt.   | placed                             | picker opens at once; Commit stays disabled ("Double-tap the tile to choose its value")                       |
| EXCHANGE          | rack                               | tap or drag-across marks/unmarks; the board ignores taps                                                      |
| PASS              | board / rack                       | nothing                                                                                                       |
| VALUE PICKER OPEN | board / rack / elsewhere           | only closes it — never moves a tile; docked picker also swipes down                                           |
| SHEET OPEN        | inside                             | the sheet owns interaction and keys; drag only from the handle/title row                                      |
|                   | dimmed area                        | closes; the tap stops there (never reaches the board)                                                         |
| THINKING          | rack / empty square                | reorder; prepare the arrow (shown muted)                                                                      |

The arrow is never drawn under a tile: placing on its square advances it (RIGHT: H8 → I8, DOWN: H8 → H9), a square occupied any other way pushes it on, and at the board edge it turns off. Double taps use the tap's own event time, so a slow render never splits one.

## Root causes fixed

- **Notes keyboard opening/closing:** the shared `Sheet`'s open/focus effect depended on the inline `onClose`; every parent render (the clock ticks each second, every keystroke) re-ran it: focus jumped to the opener, then to the first button (the X). Effects now key on `open` only (shared `Sheet` fixed too). Also: 16 px textarea (iOS zooms on smaller fields), and the layout ignores height-only viewport changes while a text field is focused, so the on-screen keyboard can never switch the layout and remount the field.
- **Turn Log could not scroll:** the sheet body was a flex child without `min-height: 0`, so it grew to its content and the sheet clipped it. The new sheet has one scroller with a sticky tab row.
- **Opening the log entered review:** Last Move called `onSelectLog`; rows were review buttons. Now reading never reviews; each entry has an explicit **View position**.
- **10–20 small/off-centre, point value oversized on tiny tiles:** text sizes came from viewport-relative variables with a 7 px floor and font line boxes. A tile face is now one SVG on a 24-unit grid filling the tile (`TileFace`).
- **Sheet peek and dismissal:** release snaps by direction and distance (like native sheets), not to the nearest height; a dismissed sheet hands the game back at once (inert released, touches pass) and a quick re-open is never lost to the exit animation.

## Evidence

`docs/evidence/phone-round2/` — fixture views 01–23 (390×844 @2×, close-ups @3×, desktop 1440×790 and 1280×690), real-app `real-01…06` (LAN origin, two touch phones), `manifest.json`, `real-verification.json`.

Reproduce:

```sh
ROUND2_EVIDENCE=docs/evidence/phone-round2 npx playwright test -c playwright.live-shell.config.ts round2.spec.ts
# with local Edge functions running and `node tools/phase-a/local.mjs phone` in another terminal:
LAN_BASE_URL=http://<lan-ip>:5196/ \
LIVE_SECURITY_STATUS_FILE=/private/tmp/eq-live-hidden-security-20261001/status.private.json \
ROUND2_EVIDENCE=docs/evidence/phone-round2 \
  npx playwright test -c playwright.local-realplay.config.ts round2.spec.ts lan.spec.ts
```
