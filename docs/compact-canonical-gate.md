# Milestone 6: Compact v1 canonical gate

Base/HEAD `840ef0e24a558e4392c3399bd2dd487fadb94a95`, branch
`codex/compact-completed-game`, existing uncommitted isolated worktree. This is
a storage-representation decision and local regression gate, not a production
cutover or Phase 4 implementation.

## Meaning and decision

For **supported new completed captures after a coordinated future cutover**,
"canonical" means the durable full-game payload is Compact v1: one genesis,
ordered physical/metadata/turn deltas, optional branch suffixes, no periodic
checkpoints, explicit rules/tile-manifest/provenance pins and integrity digests.
Public, Region, Private and Stage readers return only authorized safe
projections. Listing, owner, folder, visibility, quota and result authority
remain in storage envelopes. Legacy rows stay in their original format and
remain readable; neither reading nor this decision rewrites them. A capture
without complete genesis/history or required source pins stays legacy or is
deferred rather than being represented as a fabricated Compact game.

**Representation gate: PASS for the supported complete-capture set below.**
Compact v1 is suitable as the canonical internal payload for those captures.
This does **not** mean current normal archive writes have switched: the live
`finalize_live_game` still writes encoded legacy state, and no general trusted
Compact writer has been deployed. Milestone 7 may design History against this
versioned payload/legacy adapter boundary. Activating new canonical writes
requires the coordinated cutover below. Ranked completion and unproven Stage
terminal variants retain their special handling until their capture paths are
proven. `captured_client_state` / `client-reported` remains the honest Stage
authority; no competitive authority change is implied.

The simpler option of storing the current `encodeGame` as the new canonical
payload was rejected: it repeats logs, history logs and historical positions,
and its live/transient fields are not game facts. The existing `snapshot`
columns can carry versioned Compact JSON without new History/Drive tables.

## Completion eligibility

`A` is a supported complete payload **when a trusted writer supplies the full
history, frozen source facts and terminal status**. It is not a claim that the
current normal finalizer already writes Compact. `B` remains readable or needs
a special capture proof; `C` is not a completed game.

| Path                                                                                  | Class                                              | Evidence and limit                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal friend/local/Solo finished game with complete v3 history                       | A                                                  | Legal 40/60, rack-out and resignation corpora reconstruct every captured revision; future trusted writer must enforce terminal eligibility.                                                                                  |
| Authur/other bot game with complete history and server-frozen catalog/version         | A                                                  | Bot pin and physical replay tests pass; no missing pin may be invented from a client state. Current normal finalizer still writes legacy.                                                                                    |
| Hosted finished game with complete history and rack/score/turn/clock corrections      | A                                                  | Domain tests preserve correction effects and identity; actor/reason not present in old state cannot be invented. Notes/stars are excluded by the accepted v1 policy, so an annotated source needing those facts is B/legacy. |
| Ranked new server-reduced match                                                       | B                                                  | Transactional private revisions and pure adapter are proven; no durable terminal Compact write/read destination is wired. Old latest-state-only matches cannot be promoted. Ratings/results remain in the Ranked system.     |
| Stage sealed manual terminal                                                          | A                                                  | Real Auth/PostgREST/Edge/SQL capture, nonzero seed score and owner-only replay pass; record remains `client-reported`.                                                                                                       |
| Stage natural rack-out/no-score/perfect or surrender                                  | B                                                  | Terminal code paths exist, and fabricated rack-out is rejected; positive real endpoint captures for all variants are not yet proven.                                                                                         |
| Normal natural rack-out                                                               | A                                                  | Validator-legal frozen rack-out and ordinary archive safe read pass.                                                                                                                                                         |
| Normal no-score-streak, Solo perfect-game, surrender, manual/admin/timeout/disconnect | B until positive end-to-end canonical writer cases | The codec can preserve status, logs and recorded outcomes, but this milestone did not prove every future trusted capture path. Legacy completion still works.                                                                |
| Save/Exit draft, abandoned/cancelled/expired room, unfinished attempt                 | C                                                  | No finished transition; canonical-write validator rejects an unfinished record.                                                                                                                                              |
| Old v1/v2 face-only, incomplete v3, advisory Stage result, old Ranked latest state    | B                                                  | Keep readable source/metadata; never manufacture original physical history or a Compact Stage/Ranked replay.                                                                                                                 |

## Fidelity, size and replay

The fixed legal corpus includes 40-action, 61-log finished, 65-action and
natural rack-out traces; every captured revision matches physical board,
ordered racks/bag, pending returns, scores, side/turn, clocks, players, visible
logs and final status. The seeded legal sweep covered **24 seeds, 404 actions,
66 placements, zero mismatches**. Focused tests cover exchange/pass,
annotations policy, manual edits, bot/Stage pins and one/nested/heavy branch
suffixes. Compact stores exact draws, exchanges and clock outcomes rather
than rerunning RNG, scorer or bot code. No periodic checkpoint is warranted:
the measured final seeks below remain single-digit milliseconds.

One warm opt-in benchmark run measured raw UTF-8 `JSON.stringify` bytes:

| Fixture                                | Legacy B | Compact B | Saved B | Saved | Build ms | Read ms | Full replay ms | Final seek ms |
| -------------------------------------- | -------: | --------: | ------: | ----: | -------: | ------: | -------------: | ------------: |
| Validator-legal 40 actions             |  218,772 |    39,991 | 178,781 | 81.7% |   161.38 |   20.49 |           8.29 |          5.06 |
| Validator-legal 60 actions + finish    |  368,382 |    54,818 | 313,564 | 85.1% |   266.29 |   32.60 |          10.50 |          8.16 |
| Natural rack-out, 39 actions + end log |  250,138 |    49,649 | 200,489 | 80.2% |   117.57 |   16.96 |           8.90 |          4.21 |
| Sealed Stage manual finish at opening  |    6,176 |     2,818 |   3,358 | 54.4% |     5.35 |    2.30 |           0.24 |          0.14 |

The Stage row is a **minimal terminal capture**, not a 40-turn Stage sample.
The 60-action record exceeds the provisional 50 KB target by 4,818 B because
it retains 61 exact logs and physical outcomes. The benchmark corpus has 24
fixtures, including exploratory unfinished and physical-only stress cases;
those cases are not eligibility evidence. Timings are local single samples,
not production latency guarantees. An initial combined benchmark run hit
Vitest's default five-second timeout; the isolated rerun with a 120-second
benchmark timeout passed both benchmark tests.

## Safe read, write authority and integrity

The trusted `archive-replay` endpoint obtains viewer/owner/region facts from
Auth and database rows, then dispatches legacy or Compact to the same explicit
projection. Real local HTTP checks cover eligible Public/Region, saved Private
copy, unauthorized user, owner spoofing, and Stage owner-only access. Output
contains visible board faces, sorted final rack faces, scores, allowed clocks
and safe bot display data. It omits ordered bag/draw order, physical tile IDs,
seal digest, private bot runtime/decision seed, weights, reasoning, account
identifiers and secret notes. Direct browser `snapshot` SELECT, INSERT and
UPDATE are denied; SQL effective-grant checks cover Public, Region and
Private, and Stage raw result/record writes are denied. Stage concurrent
duplicate/retry capture produces one immutable record. There is no browser
Compact replacement/upsert path.

The record digest and final-state digest reject changed bytes and inconsistent
reconstruction; event sequence, tile conservation and branch parent checks
reject invalid facts even with a recomputed digest. The new storage-write
validator requires a genuine transition to `finished`. A missing
`completionAuthority`, malformed delta, truncated payload, unknown format,
unknown rules/manifest, impossible order and altered terminal record fail
closed. The general codec still accepts early positions for benchmark and
legacy-adapter work; it is **not** itself the canonical-write eligibility gate.

The rules label is `eq-lab-840ef0e`; the tile manifest is hashed, and observed
physical/score/clock outcomes replay without current RNG or scoring. The
registry has only this interpreter. A contract test pins the literal label,
rejects unknown labels and disables use of a different active validator.
**Before any gameplay rules change ships**, retain the v1 interpretation for
historic Study/Analysis legality. This milestone does not invent a future
rules engine. Stage seal and bot catalog versions are separately pinned.

## Minimal coordinated write cutover (design only)

1. Keep `public_game_snapshots.snapshot`, `region_game_snapshots.snapshot` and
   `private_library_items.snapshot` as mixed legacy/Compact JSONB columns;
   Stage already uses `stage_completed_attempts.record`. Old rows remain raw.
   Ranked stays on private revisions until its terminal destination is wired.
   No full-payload dual-write is required. Existing listing/result metadata
   remains in its envelope, not in Compact.
2. Deploy the safe `archive-replay` Edge reader before changing browser read
   grants. Deploy the compatible web reader and drain/force-refresh cached old
   clients before revoking raw payload reads. Old cached clients may fail closed
   if they have not refreshed; preserving their raw read privilege would expose
   hidden facts once Compact writes begin. Keep the existing new-reader/SQL
   privilege cutover atomic at activation.
3. Keep the amended `attach_game_timeline_to_archive` guard in the archive
   migration. Legacy writes still fold `timeline`. A Compact insert with live
   parked lines must contain the exact `branches` document already; the trigger
   refuses an omission or mismatch and never appends a post-digest key. Its real SQL branch regression
   passed. The trusted writer must bind the parked-line version and branches
   to the same final live revision before deletion.
4. Add a trusted normal/bot/Hosted terminal builder/transaction **at cutover**:
   read the locked live state and frozen room/bot metadata, require complete
   history, use `buildCompletedGameRecord` followed by
   `validateCanonicalCompletedGameRecord`, check record/source identity and
   branch revision, insert Compact once into the selected archive column,
   preserve existing result/stat operations, then delete the live room in one
   transaction. Never accept a browser-supplied Compact payload or provenance
   assertion. Keep unsupported/incomplete captures on their explicit legacy
   route; do not silently mark them canonical.
5. Deploy the trusted builder disabled, then its SQL transaction/grants, then
   route eligible terminal web traffic to it. Enable Compact writes only after
   safe reads, cached-client handling and SQL permissions are verified. Mixed
   legacy/Compact reads dispatch by explicit `format`; an unknown/corrupt
   Compact record errors instead of falling back to plausible legacy data.
   A stale browser must never be able to replace `snapshot` directly.
6. Roll back by disabling new Compact writes. Retain the dual-format safe
   reader and restrictive grants so already-written Compact rows remain
   accessible without exposing raw payloads. Do not roll back to a reader
   unable to decode Compact or restore broad browser snapshot access.

This cutover does not change Ranked rating/result authority, Pro-Bot economy,
Stage progression, normal statistics, Hosted permissions, room creation or
active-board accounting. The gate did not rewrite the live protocol.

## Commit plan for review only

No commit was made. Stage the mixed files by hunk so each boundary remains
reviewable; apply the migrations in timestamp order.

1. **`feat: add Compact v1 completed-game domain and legal corpus`** —
   `src/completedGame/record.ts`, `historicRules.ts`, `adapters.ts`,
   `projection.ts`, the `src/codec.ts` type export, Compact corpus/helpers and
   `tests/completed-game-{record,legal-corpus,boundaries,benchmark}.test.ts`,
   `tests/fixtures/completed-legal-*`, plus the format/final-validation and
   canonical-gate documents. Include only domain-related `.gitignore` hunks.
2. **`feat: capture Ranked revisions and preserve Stage seeded scores`** —
   migrations `20261001101000` and `20261001101100`, `src/game.ts`, the seeded
   score portions of `src/App.tsx`, `supabase/tests/ranked_private_revisions_smoke.sql`,
   and relevant blocker-closure tests/documentation.
3. **`feat: restrict archive payload reads to safe replay`** — migration
   `20261001101200` including the Compact timeline guard,
   `supabase/functions/archive-replay/index.ts` and `index.js`,
   `src/completedGame/archiveRead.ts`, `client.ts`,
   `src/components/pages/ArchiveReplayPage.tsx`, `src/app/AppRoot.tsx`,
   `src/app/NonPlayApplication.tsx`, archive-related hunks of `src/App.tsx`
   and `src/remoteRooms.ts`, the archive `.gitignore`/`package.json`/
   `supabase/config.toml` hunks, `supabase/tests/archive_payload_privileges_smoke.sql`,
   `supabase/tests/multiverse_timeline_smoke.sql`, archive route/safe/local/owner
   and game-end-sync tests, and `docs/archive-security-cutover.md`.
4. **`feat: capture sealed Stage terminal records atomically`** — migration
   `20261001101300`, `src/completedGame/stageTerminal.ts`, Stage-related
   `src/completedGame/adapters.ts`/`archiveRead.ts` and
   `src/App.tsx`/`src/remoteRooms.ts`/`package.json`/`supabase/config.toml`/
   `.gitignore` hunks, `src/features/survival/repository.ts`,
   `supabase/functions/stage-terminal/index.ts` and `index.js`,
   `supabase/tests/stage_attempt_smoke.sql`,
   `stage_terminal_privileges_smoke.sql`, Stage terminal/sync tests, and
   `docs/stage-terminal-{authority-audit,capture-gate}.md`.

Shared files are named in multiple logical groups because they require
selective staging; do not commit one group's unrelated hunks with another.
