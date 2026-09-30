# Compact completed-game v1: final validation gate

> Historical prototype report from before blocker closure. The later audit and
> current release verdict are in `completed-game-blocker-closure.md`.

Base `840ef0e24a558e4392c3399bd2dd487fadb94a95`; branch
`codex/compact-completed-game`; worktree
`~/.codex/worktrees/compact-completed-game/EQ-Lab`. This is an uncommitted,
isolated prototype. No production path calls it.

## 1. Executive verdict

**CONDITIONAL PASS for the representation; do not freeze v1 or begin Phase 4
writes yet.** Legal, placement-heavy reconstruction and size are now proven on
the frozen corpus. The remaining blockers are the absent persistent Ranked
revision capture for existing server matches, archival access/disclosure policy
and enforcement, and a maintained historic rules/decoder implementation. The
Stage adapter has a real sealed-start check and rejects the current client
completion path because it drops the seeded score baseline. A corrected
completion round-trips.
It is not wired to a server-authoritative completion transaction.

## 2. Branch, worktree, HEAD and status

The worktree is the existing isolated checkout above, on base SHA `840ef0e`.
All changes are untracked prototype files; no tracked file was changed. No
commit, push, merge or deploy was performed.

## 3. Changes in this gate

Added fixed legal action traces, a validator-backed replay helper, deterministic
property tests, Stage and Ranked capture adapters, conservative public views,
adversarial leak tests, displayed-turn lookup, branch-tree validation, bot
execution provenance, and repeated performance measurements. The original
record and benchmark were hardened in place.

## 4–5. Representative legal corpus and quality

The traces originated from A-Math's native static move generator with a seeded
initial deal. Tests do not depend on that binary: they map every fixed intent
to actual physical rack tiles, call EQ-Lab's `validateMove` and
`applyRankedAction`, check score agreement, and verify inventory after every
action. The 60+ game deliberately spaces placements with passes/exchanges; it
is a long-game stress case, not a claim about typical human strategy.

| Fixture              | Actions | Place | Pass | Exchange | Tiles placed | Avg/place | Max/place | Final board | Bag | Finished | Mode   | Clock | Edits | Branches |
| -------------------- | ------: | ----: | ---: | -------: | -----------: | --------: | --------: | ----------: | --: | -------- | ------ | ----- | ----- | -------- |
| Legal 40             |      40 |    14 |   22 |        4 |           70 |       5.0 |         8 |          70 |  14 | no       | versus | yes   | no    | no       |
| Legal 60 + surrender |      60 |    20 |   35 |        5 |           81 |       4.1 |         8 |          81 |   3 | yes      | versus | yes   | no    | no       |
| Legal 65 prefix      |      65 |    22 |   38 |        5 |           87 |       4.0 |         8 |          87 |   0 | no       | versus | yes   | no    | no       |
| Natural rack-out     |      39 |    29 |    8 |        2 |           92 |       3.2 |         8 |          92 |   0 | yes      | versus | yes   | no    | no       |

The 60-turn row has 61 visible logs because surrender appends `end_game` after
the 60 actions. Natural rack-out has 40 logs after its automatic end log.
Separate Hosted, Stage, Ranked, bot, manual-edit, and branch fixtures test
their distinct structures.

## 6. Legality proof

Every placement in the fixed traces passed the current `validateMove` before
the server-authoritative Ranked transition accepted it. The helper checks the
resulting `calculatedScore` and `finalScore` against the validator, verifies
all 100 physical tiles at each revision, and lets production draw/exchange
shuffle and end-game code produce the exact outcomes. The completed decoder
replays the resulting positions; it never reruns RNG or scoring rules.

## 7. Randomized property validation

Twenty-four deterministic seeds produced 24 legal prefixes, 404 actions and
66 placements. Each prefix built, validated, decoded, and matched its original
semantic final state and entire revision sequence. Failures: **0**. These are
shorter and sparser than the fixed engine corpus; they probe different initial
deals and draw/exchange paths rather than serving as the size benchmark.

## 8. Current versus compact size

Raw UTF-8 JSON bytes, with current `encodeGame` v3 as the baseline:

| Legal fixture                | Current B | Compact B | Saved B | Saved | Compact B/action | Compact B/placement |
| ---------------------------- | --------: | --------: | ------: | ----: | ---------------: | ------------------: |
| 40 actions                   |   218,772 |    39,951 | 178,821 | 81.7% |              999 |               2,854 |
| 60 actions + finish          |   368,382 |    54,778 | 313,604 | 85.1% |              913 |               2,739 |
| Natural rack-out, 39 actions |   250,138 |    49,609 | 200,529 | 80.2% |            1,272 |               1,711 |

The 65-action prefix measured 400,044 B current and 58,004 B compact (85.5%
saved). Its 87 board tiles and empty bag show late-game coverage.

## 9. Event size distribution

| Fixture           |   p50 |   p90 |   p95 |   p99 |   Max |
| ----------------- | ----: | ----: | ----: | ----: | ----: |
| Legal 40          |   484 | 1,848 | 1,981 | 2,064 | 2,064 |
| Legal 60 + finish |   484 | 1,717 | 1,930 | 2,064 | 2,064 |
| Rack-out          | 1,299 | 1,804 | 2,037 | 2,506 | 2,506 |

The largest ordinary placement event (2,064 B) comprises about 1,232 B of
visible log core, 315 B of physical position outcome, 299 B of score/clock/
turn metadata, and 143 B of the log's intermediate outcome. Its log core
includes placed-tile order and historic detected-equation/score details. The
2,506 B rack-out event contains both placement and automatic end facts. There
is some intermediate/final position overlap, but removing it would complicate
exact visible-log reconstruction; this gate did not chase the byte target by
dropping facts.

## 10. Exact round-trip result

All four fixed legal fixtures match physical board tile IDs, racks, ordered
bag, pending returns, score, side, turn, status, phase, clock values, player
names, and every visible log at every recorded revision. Existing focused tests
cover settings, player identities, notes/stars, Host manual score, bot and
Stage metadata, and branch positions. Live commit IDs, save timestamps,
readiness, and cache pointers are intentionally outside semantic identity.

## 11. Stage completion adapter

`createSurvivalTestGame` seeds a 91-tile endgame; `stageStartCanonical` supplies
the server seal. `create_stage_attempt` creates the Stage room and attempt,
marks purpose `stage`, and checks the first canonical position against the
seal through `check_stage_commit`. The adapter requires a finished state,
compares its first physical/score/turn position to the supplied seal, and
records the seal digest. A test follows the current client surrender
log/status/score path and exposes a **pre-existing Stage score defect**: the
sealed start is 481–500,
while `performEndGame` applies `calculateTotals` to a single zero-score
surrender log, yielding 0–0. Ordinary Stage moves use the same zero-based
total calculation. The adapter rejects that 0–0 result; a completion retaining
the seeded score baseline round-trips. The separate
`survival_attempts` score/result/finished-at update is practice accounting,
not a game-payload field; the adapter performs no billing or DB operation.
Correct Stage score handling, production wiring and authoritative result
capture remain open.

## 12. Stage 5B provenance

Stage mode uses provenance `mode: "stage"`; the future Stage 5B opponent is a
catalog bot, represented with `mode: "bot"` and `catalogId: "stage5b"`. The
record can pin catalog/config version, frozen `CLIENT`/`SERVER`/`HYBRID`
execution type, difficulty/model level, engine/runtime version and decision
seed. Actual moves/outcomes are stored; reasoning traces and model data are
not. A test proves these identities remain distinct. The current catalog row
has Stage 5B pending and disabled; no playable runtime was added.

## 13. Ranked completion adapter

Ranked uses `createRankedGame`, `applyRankedAction`, and the private
`ranked_matches.state` server path. Each action currently clears `history`;
the DB keeps the latest private state and records result/rating separately.
`buildRankedCompletedGameRecord` accepts a captured, ordered sequence of
private authoritative states from after readiness through completion,
validates adjacent action revisions, and emits the **same internal v1 format**.
Tests cover the actual Ranked constructor, pass and resignation, plus a longer
captured placement game. Final board, racks/bag, scores, timers, logs, players,
and result are preserved. Existing old Ranked matches without captures cannot
be promoted losslessly and must remain readable as legacy.

## 14–15. Disclosure policy and projection tests

The immutable record is private internal data. `projectCompletedGame` emits a
small explicit board-face/turn/score allowlist for Public, Region or Ranked;
it requires a finished game and does not spread any internal object. It omits
opponent and own racks, bag/order, draw facts, notes, clocks, account IDs,
emails, physical tile IDs, bot pins, and ratings. An adversarial test plants
distinct strings in nested action detail, note, identities and bot metadata,
then checks all three serialized projections and hidden rack/bag IDs for leaks.
Access control and archive eligibility belong to the future envelope/server,
and must be enforced **before** calling the projection. Whether any of these
facts should become visible post-game is a Product Owner decision; default
projection reveals none of them.

| Fact                                            | Conservative classification                                                                  | Current projection |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------ |
| Board faces, turn actions, final scores         | Safe after finish, subject to archive eligibility                                            | Included           |
| Racks, bag/order, hidden draws                  | Product Owner decision for post-game disclosure; internal/authorized participants until then | Omitted            |
| Clocks and timer history                        | Product Owner decision                                                                       | Omitted            |
| Notes, annotations and Host comments            | Owner/participant only; wider disclosure is a Product Owner decision                         | Omitted            |
| Account IDs, emails and private server metadata | Admin/internal only for this archive boundary                                                | Omitted            |
| Physical tile IDs and bot version/config pins   | Internal canonical facts; wider disclosure is a Product Owner decision                       | Omitted            |
| Bot reasoning or model data                     | Not a game-payload fact                                                                      | Not stored         |

## 16. Hosted result

Hosted identity, manual rack/bag swap, score override, turn override, clock
correction, note and stars round-trip exactly. The current product's manual
refill/edit path mutates state, and old `GameState` does not record a distinct
actor/reason for every correction. v1 preserves the exact effects but cannot
invent attribution. Future capture can add it if product audit policy requires.

## 17. Historic rules and provenance

The format pins `format: 1`, `rules: "eq-lab-840ef0e"`, and a SHA-256 tile
manifest digest. Decoder reconstruction applies recorded physical, score,
clock and log outcomes, rather than rerunning current scoring/RNG/bot code.
Unknown format/rules/manifest values fail closed in mutation tests. The
implementation behind a known rules label must still be retained/versioned
when current code changes, especially for historical Study legality and
interpretation. A label alone is not an executable historic adapter.

## 18. Legacy compatibility matrix

| Source                                     | Classification                  | Limit                                                         |
| ------------------------------------------ | ------------------------------- | ------------------------------------------------------------- |
| Completed v1 object or serialized JSON     | FULL ROUND TRIP                 | Known format/rules/manifest only                              |
| `encodeGame` v3, complete zero-log genesis | FULL ROUND TRIP via adapter     | Original retained                                             |
| `encodeGame` v3, incomplete history        | READ + REPLAY / NONBRANCHABLE   | Cannot invent missing revision positions                      |
| `encodeGame` v2 or v1                      | READ + REPLAY / NONBRANCHABLE   | Face-only source lost original physical IDs                   |
| Plain JSON of v3 or full `GameState`       | Same as underlying facts        | Inventory checked; complete history needed for promotion      |
| Legacy parked timelines                    | READ + REPLAY                   | Separate original timeline retained; null positions stay null |
| Legacy missing branch continuation         | READ ONLY for that continuation | Viewable, cannot restore from missing exact position          |
| Unknown/corrupt version                    | UNSUPPORTED                     | Precise fail-closed error                                     |

No destructive migration is performed. Some old games are correctly readable
without being fully branchable.

## 19. Branch correctness and size

The active trunk appears once; parked branches use the existing exact
`EncodedMultiverse` suffix codec. Tests cover one/multiple lines, a nested
line, notes, tip restoration, legacy `after: null`, and duplicate-turn
rejection. Branch-tree validation now rejects broken/cyclic parents instead
of silently hiding them. A 30-line × 12-turn pathological case is 379,313 B
compact including 358,647 B branch suffix, versus 470,401 B for current game
plus separate timeline (19.4% saved). The suffix preserves necessary distinct
racks, clocks, scores and bag outcomes. Repeated unchanged rack/bag fragments
and full legacy position retention remain duplication and optimization
opportunities. Separate referenced immutable branch objects are a future
optimization, not a blocker for ordinary games.

## 20. Checkpoint decision

Keep **no checkpoints**. For the 60-action legal game, no-cache final seek
median/p95 is 5.20/5.80 ms and full replay 8.59/9.00 ms on this local
machine. A final full-position checkpoint costs ~1,893 B; every ten actions
costs ~9,741 B. There is no measured need to pay those bytes or add cache
invalidation complexity.

## 21. Build, decode, replay and seek performance

Local Vitest process only, **not production latency**. Each figure below is
median/p95 over 21 sequential warm iterations, in milliseconds:

| Fixture           | Build         | Validate   | Read/decode | Full replay | Mid seek  | Final seek |
| ----------------- | ------------- | ---------- | ----------- | ----------- | --------- | ---------- |
| Legal 40          | 90.19/92.70   | 7.29/7.86  | 11.95/12.62 | 5.51/5.71   | 1.67/1.82 | 4.05/4.28  |
| Legal 60 + finish | 198.97/211.30 | 9.44/10.65 | 17.53/20.43 | 8.59/9.00   | 2.39/3.17 | 5.20/5.80  |
| Rack-out          | 88.88/89.93   | 6.63/6.76  | 12.13/12.47 | 5.24/5.54   | 1.56/1.70 | 3.34/3.61  |

For 60 actions, seek at genesis/10/20/40/60 is approximately
0.05/0.79/1.56/3.26/5.41 ms median. Build currently validates and walks
verbose snapshots, so it is slower than read; this is a one-time completed
save operation.

## 22. Storage budget and memory

The ~20–50 KB provisional target is defensible for a 40-action legal game and
the placement-dense natural rack-out (39,951 B and 49,609 B). The paced
60-action finished game is 54,778 B, 9.6% above 50 KB; 61 logged turns,
clock/score metadata and exact placement outcomes explain the difference.
Long games, annotation-heavy, edit-heavy and branch-heavy games need distinct
budgets. `JSON.stringify(GameState)` was ~8.7 MB for the legal 40 fixture and
~20.9 MB for 60 versus 40/55 KB records; these are serialized object graph
proxies, **not measured retained heap or allocation counts**. Reading into
`GameState` rebuilds its verbose history in memory.

## 23. Phase 4 API contract

Phase 4 should take a finished, complete, trusted game through
`buildCompletedGameRecord`, or the Stage/Ranked source adapters, then call
`validateCompletedGameRecord` and store canonical JSON and `digest` inside a
private envelope. Reads use `readCompletedGameRecord` (game, branches and
provenance) or `readCompletedGame` for legacy. `positionAt` accepts event revision; `positionAtDisplayedTurn`
accepts visible-log index; `finalPosition` and `replayCompletedGame` provide
Study/Analysis/replay positions. `projectCompletedGame` is the conservative
public boundary. Phase 4 must not depend on `room_live` state layout.
The ordered completed facts can accept a future authoritative server-event
adapter; no live command, Realtime transport or move semantics changed here.

The **payload** contains game facts and provenance. A future **envelope** owns
owner, folder, visibility, Active/Overflow/Trash, `drive_seq`, capacity, save
request ID, and storage timestamps. No such tables or flows were added.

## 24. Shared storage

One internal immutable payload can underpin Recent, Private Drive, Public,
Region and Ranked references if server access control keeps it private and
serves explicit views. A record digest is stable for identical canonical
payloads and useful for integrity; because it includes names, account IDs and
notes, exposing hashes or deduplicating across user scopes could correlate
private games. No cross-user deduplication was implemented.

## 25–26. Validation and pre-existing failures

**PASS:** focused tests (22), opt-in benchmark (2), typecheck, lint, format
check and production build. The final full Vitest run passed 115 test files
with 1 benchmark file skipped: 978 tests passed and 4 skipped. The first full
run had one **new test-timeout configuration failure**: the 24-seed property
test exceeded Vitest's 5-second default under full-suite load, despite passing
alone. Its timeout was set to 30 seconds and the full suite passed (the
property test took about 20 seconds under that final full-suite load). Prior
prototype runs intermittently hit an existing Ranked keyboard UI timing test,
which passes alone; it did not fail in this final run. No unrelated product
code was edited for that race.

## 27. Risks

Current ordinary live Play remains client-trusting; a digest is an integrity
check, not proof a client-supplied game was legal. The Stage completion result
is currently practice telemetry, not a server reducer, and seeded Stage scores
can reset to zero on action/completion. Ranked historic states
lack captured revisions. Host attribution absent from old state cannot be
recovered. Rules adapters must remain available for historic Study semantics.
Heavy branch objects can dominate size. Conservative projections still need
server-side access control.

## 28. Product Owner decisions

Set post-game disclosure policy for racks, bag/draw order, clocks, notes,
account identities, bot diagnostics and Stage attempts in Public/Region/Ranked;
decide whether Host edit actor/reason is an audit requirement; decide whether
branch-heavy archives may reference a separate immutable object. No Drive
capacity change is proposed: Free 100, Plus 1,000 and Pro 1,000 **active**
saved games remain the direction; History/Recent do not count.

## 29. Exact blockers before Phase 4

1. Persist/capture every private authoritative Ranked completion revision or
   explicitly route old matches through legacy; wire the capture at the server
   boundary without exposing hidden state.
2. Define and enforce archive eligibility/access and post-game disclosure
   policy before any Public/Region/Ranked projection is served.
3. Retain a versioned historic decoder/rules interpretation when evolving
   `eq-lab-840ef0e`; verify Stage sealed-start facts and bot room pins from
   authoritative server rows at integration time.
4. Correct the current Stage score baseline transition before treating Stage
   completion scores or practice results as archive truth. Keep that live fix
   outside this format prototype.

## 30. Files

Modified from the existing prototype: `src/completedGame/record.ts`,
`tests/helpers/completedCorpus.ts`, `tests/completed-game-record.test.ts`,
`tests/completed-game-benchmark.test.ts`. Added:
`src/completedGame/adapters.ts`, `src/completedGame/projection.ts`,
`tests/completed-game-legal-corpus.test.ts`,
`tests/completed-game-boundaries.test.ts`, the two JSON traces, their README,
and this report. The earlier `docs/completed-game-format-prototype.md` remains
as the initial prototype report.

## Explicit answers A–N

- **A.** Legal 40 actions: 39,951 B; legal 60 actions plus finish: 54,778 B;
  placement-dense rack-out at 39 actions: 49,609 B. These are separate styles,
  not a population percentile estimate.
- **B.** Yes for every fixed representative fixture and its full captured
  revision sequence.
- **C.** No semantic mismatch in 24 seeds, 404 actions and 66 placements.
- **D.** Yes as an approximate 40-action budget; a long 60-action finished game
  measured ~55 KB, so 50 KB is not a hard ceiling.
- **E.** Structurally yes: a corrected finished Stage state passed the supplied
  server seal and round-tripped. The adapter rejects the current 0–0 score
  reset, so Stage archive integration is blocked until that live defect is
  fixed and server wiring is complete.
- **F.** Yes: Stage 5B catalog/version, CLIENT execution, model/runtime level
  and actual outcomes fit without model files or reasoning traces.
- **G.** Yes internally if private Ranked revisions are captured. Current
  latest-state-only old matches cannot be converted losslessly.
- **H.** Yes, conservative Public/Region projections passed leak tests; actual
  publication needs authorization and Product Owner policy.
- **I.** Unknown format/rules/manifest fail closed. Keep a historic
  interpretation adapter when the implementation evolves.
- **J.** Yes; legal final seeks are ~3–6 ms and periodic checkpoints would add
  up to ~9.7 KB in the measured 60-action case.
- **K.** No for ordinary Phase 4 games; pathological branches remain large and
  may later deserve a separate referenced object.
- **L.** Stable as a domain seam for complete ordinary games; Stage/Ranked
  source capture must be wired and public access control placed around it.
- **M.** Not yet. Verdict is **CONDITIONAL PASS**, so do not freeze v1 now.
- **N.** Wait until the blockers above are resolved and reviewed.
