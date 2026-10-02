> Current milestone status and the locked client-side ArchBot practice decision
> are recorded in [live-security-milestone-s-2026-10-01.md](live-security-milestone-s-2026-10-01.md).
> That report supersedes older compatibility status and server-ArchBot requirements
> below. This document is retained as historical scope/evidence; the 58 classes
> and ordinary competitive secrecy contract remain the established basis.

# Live hidden-information correction — review candidate

Date: 1 October 2026, Asia/Bangkok. Baseline: `34d5ae676fc460bfff02fe142b5d76354206b903`.

**NO-GO for production.** The isolated candidate establishes a server boundary for live state and preserves completed Replay. The tested access paths fail closed, including bot-seat impersonation and legacy raw readers. However, actual Authur/Stage bot execution, several existing gameplay tools, and complete browser/economy regression coverage remain blockers. This is a review candidate, not a completed all-mode production correction.

Nothing was deployed. Performance optimization and latency benchmarking remain stopped. Changes are uncommitted in `/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync`, branch `codex/live-sync-optimization-phase1`; HEAD and the locally fetched `origin/main` still equal the frozen baseline above. This does not verify the currently deployed database or runtime configuration.

## Exposure paths found at the production baseline

| Path                                                                      | Hidden information available to an authorized browser                                                  | Candidate boundary                                                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Normal/friend/Authur `readRoom` → `room_live.state`                       | Both racks, ordered bag, historical snapshots and Turn Log rack/bag/draw/exchange fields               | Raw column access revoked; authenticated Edge returns a seat projection                                 |
| Client `commitRoomState` / `commit_live_game_command`                     | Browser constructs/sends full state; duplicate/conflict acknowledgements return canonical inventory    | Old browser writer revoked; typed actions reduced from stored private state                             |
| `get_live_game_snapshot` and canonical inventory                          | Physical tile ordinals, rack owners and bag sequence reconstruct hidden tiles and future draws         | Browser execution revoked                                                                               |
| `get_live_game_engine_context`, `list_live_game_events`, `game_timelines` | Canonical state, historical events and parked branches                                                 | Service-only; no browser fallback                                                                       |
| `room_live` row Realtime and `broadcast_live_game_commit`                 | Shared state/session or canonical inventory reaches both seats and spectators                          | Private tables removed from publication; shared broadcast contains invalidation only                    |
| Legacy normal/stage terminal endpoints                                    | Browser supplies purported finished state/history                                                      | Endpoints return 409; new reducer invokes service-only atomic capture                                   |
| Stage `survival_levels.select("*")` and admin POC import                  | Seed, sealed canonical start and winning replay samples                                                | Safe columns only; generation/import/sealing moved to the server                                        |
| External engine bot proposal/reasoning/reconnect                          | Proposed exchange data and search alternatives can describe still-unrevealed bot tiles                 | Old engine context read denied; replacement server-to-server adapter remains required                   |
| Completed archive readers                                                 | Baseline raw archive columns were already revoked, but full Replay needed a live lifecycle/alias guard | One database snapshot selects eligible persisted sources and rejects live outer/inner IDs               |
| Offline legacy play                                                       | Entire authoritative state exists in the browser                                                       | Offline live play, room opening and creation disabled in this candidate; existing stored files retained |

The former concealed-rack option only concealed rendering. It did not remove the unauthorized values from network responses or JavaScript state. Canonical compression also retained enough information to reconstruct the secrets.

Ranked already used a server action reducer and own-rack projection. Its board/own-tile serialization is now an explicit field allowlist, physical board IDs are replaced, its raw row is removed from Realtime publication, and completed historical Replay uses captured private revisions.

The external engine was inspected read-only. Its `loadContext(gameId, token)` queries `get_live_game_engine_context` using the caller's JWT. Revoking that RPC therefore makes the existing path fail closed. The engine was not modified or exercised end-to-end against this candidate; do not assume its integration is complete.

## Architecture and live schema

The database/service boundary keeps full `EncodedGame`, canonical inventory, bag order, timeline branches and history. Browsers send only an authenticated action, room ID, expected revision and stable intent UUID. Actor identity comes from JWT verification; the seat comes from database membership. Request-supplied actor/seat/full-state/score/history fields are ignored.

New rooms use `authority_protocol = server-v1`. Existing rooms retain `legacy-client`; their reads are projected but their moves are refused. Previously client-authored histories are not relabeled as server authoritative.

The live allowlist contains:

- Room ID, revision, name, mode, status, player display names/seat IDs, readiness, starting/active side and turn.
- Public board, scores, clocks and public bag/rack **counts**.
- `yourSide` and `yourRack` for the authenticated human seat; waiting rooms disclose no rack. Spectators receive neither rack.
- Turn Log: `{id, turnNumber, side, action, score, exchangedCount, boardAfter}`. Only the acting viewer additionally receives their own `rackBefore` and `rackAfter`.
- Normal clock policy needed to preserve untimed play and the overtime floor.

Board tiles use coordinate IDs such as `board:7:7` and explicit public token/assigned-face fields. Own tiles contain only ID and token. Private physical board identities and arbitrary extension fields are not spread into responses. Public placement of a tile legitimately reveals that tile.

There is no live full history, ordered bag, bag delta, hidden incoming/outgoing exchange list, seed, RNG state, canonical inventory, timeline document, private session or search reasoning in this projection. Counts and known public tile distribution remain available for legitimate inference.

Every nonterminal action is validated/reduced on the server and committed with revision comparison and existing database command deduplication. Validation refusal messages do not echo hidden rack or queue values. The client retains a retry UUID in bounded memory across a lost response and does not persist full live state. Replies use `Cache-Control: no-store`.

Shared Normal/Stage broadcasts have server body `{gameId, revision}`. The real Realtime transport also adds an opaque message UUID; it is neither a command ID nor a private tile reference. All recipients refetch their own authorized projection. Subscription establishment, focus and network restoration trigger refetch, and the play page retains polling and monotonically adopts revisions. Ranked uses its existing safe polling path.

## Mode visibility matrix

“Own history” below means the authenticated player's own log rack observations. “Public log” includes actions, scores, exchange counts and public boards, never an opponent's hidden rack/draw/exchange details. Bag visibility is count only in every live mode.

| Mode                               | Own live rack                     | Opponent live rack                          | Live log/history                                            | Realtime policy                     | Completed Replay                                                             | Functional gate                                                         |
| ---------------------------------- | --------------------------------- | ------------------------------------------- | ----------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Normal                             | Own seat only                     | No unrevealed contents                      | Public log + own observations; no private snapshots         | Invalidation only                   | Both historical racks for authorized archive/Recent/Saved readers            | Human action boundary tested; manual draw/host tools incomplete         |
| Friend/private                     | Own seat only                     | No unrevealed contents                      | Same projection; private room RLS                           | Invalidation only                   | Private owner/eligible personal Recent or Saved access; no public grant      | Private JWT access tested; full friend lifecycle/UI coverage incomplete |
| Ranked                             | Own participant seat only         | No unrevealed contents                      | Public log + own observations                               | No private row events; safe polling | Both historical racks for participants; spectator denied                     | Real create/join/ready/resign/Replay tested                             |
| Authur/bot                         | Human seat only                   | Bot rack excluded                           | Public log + human observations                             | Invalidation only                   | Both historical racks under archive/retention policy                         | Paid creation/retry/human action/surrender tested; bot turns blocked    |
| Stage                              | Human seat only                   | Bot rack excluded; public deduction allowed | Public log + human observations; seed/seal/samples excluded | Invalidation only                   | Owner's captured completed attempt                                           | Creation/surrender/Replay tested; bot turns blocked                     |
| Authorized public/region spectator | Neither                           | Neither                                     | Public log only                                             | Same secret-free invalidation       | Both historical racks only where completed publication/region policy permits | Real public subscriber tested; private/Ranked access denied             |
| Completed Replay                   | Both sides' historical rack faces | Both sides' historical rack faces           | Captured boards/scores/clocks/turns and branches            | No live private-state stream        | Requires persisted completion and source access                              | Compact and supported legacy projection/roundtrip tested                |
| Offline live play                  | Disabled                          | Disabled                                    | No legacy play fallback                                     | None                                | Existing local files retained; offline viewer/tool compatibility unresolved  | Product behavior change requiring review                                |

Anonymous users cannot use the authenticated live Edge reader. Spectator projection tests for otherwise inaccessible modes test the serializer defensively; they do not grant new spectator access.

## Live → completed lifecycle and fidelity

The intended sequence is: trusted stored live state → server action reduction establishes terminal state → atomic database capture persists the full record and result → live row disappears → authorized Replay becomes readable.

Normal capture previously tolerated failure to retain Recent Compact. The candidate raises an outer exception when the supplied Compact completion cannot persist, rolling back finalization, result/history and archive work. Stage retains its atomic capture route with server-reduced provenance. Ranked completion requires finished match/result rows and uses server-captured private revision history.

The archive Edge obtains sources through `read_completed_replay_sources`, one stable SQL call. Its live guard covers the requested outer ID and the snapshot's inner game ID, including Compact genesis IDs, ordinary objects, plain JSON strings and `c1:` strings. It does not perform separate “is live?” and “load completed payload” HTTP reads.

Real local tests established:

1. Replay is unavailable for both seats and an authorized spectator while live.
2. An archive with a different outer UUID but the live game's inner UUID is denied for object, JSON-string, `c1:` and Compact representations.
3. An injected Normal Recent-payload insertion failure returns refusal, leaves the live room present, creates no terminal History, and exposes no Replay.
4. Removing that test-only trigger and retrying the same intent completes successfully; both seats can read the authorized public Replay and the live row is absent.
5. The opening racks for both sides and multiple historical frames remain available after persistence. Ranked and Stage terminal access policies are exercised separately.

These are transaction-failure and alias regression tests, not an exhaustive concurrent terminal/request fuzz campaign. Additional two-browser terminal races and every terminal mode remain release gates.

The trusted Compact record continues to preserve physical IDs, bag order, exact clocks, scores, boards, both racks, all captured revisions and parked branches. Replay now shows both historical rack **faces**, sorted for presentation, at every captured frame, and acting-rack evolution in turns. It omits raw bag order, private IDs and seeds. Sorting presentation does not alter the trusted record. Identical adjacent authoritative frames are retained; only the separately appended duplicate current tip is omitted.

Compact and legacy full-history roundtrips are tested. A legacy Ranked record without a captured zero-log opening retains its available state/log information; missing historical racks are not invented. Legacy branch snapshots that never existed remain explicitly unavailable.

## Adversarial tests and RNG findings

`live-hidden-boundary.test.ts` has 24 passing tests. Across Normal, friend, Ranked, Authur and Stage it compares alternative hidden worlds with the same public/own observations, symmetrically for A and B and defensively for spectators. It changes opponent past/current racks, physical IDs, future queue, hidden exchanges, history and seed/canonical/session extension fields. Authorized live projections remain equal. This checks reconstructive disclosures beyond simply searching for `rackB`.

Additional tests cover forged seats/full states, unseated actions, generic hidden-ID refusals, stale revisions, retry intent stability, safe reconciliation, subscriber/focus/online refetch, no client live-state persistence, offline fallback rejection, failed commit, public placements and completed two-sided history. The original raw-reader leak reproduction now passes by refusing that protocol.

The real loopback gate uses three independent authenticated JWT clients and actual Realtime sockets. Raw state/canonical/session, timelines, events, Ranked private revisions and engine/snapshot RPC reads are denied. Waiting rooms disclose no racks; own-seat reads work; opponents see exchange count without rack fields; stale recovery returns only the caller projection. Public spectators receive no rack, private spectators are denied, and old terminal endpoints return 409.

Normal creation and refill use the existing unbiased `crypto.getRandomValues` shuffle on the trusted server; no decision seed or ordered queue reaches the browser. UUIDs do not encode bag position. Initial deals are now created by the server, not accepted from a submitted client state.

Stage's draft generator is deterministic and **is not a cryptographic RNG**. Its seed, canonical seal and sample replays are now server-only, and labels omit the seed. The current endgame has an empty bag and nine unplayed tiles: a player can infer the remaining opponent multiset from the public board, known tile distribution and their own rack. That is permitted public inference and cannot be “fixed” by concealing an explicit rack field. Prior publicly shipped Stage seeds/samples cannot be made unknown again by ACL changes. Any future Stage with hidden future draws requires a separate unpredictable per-attempt draw design; do not certify the deterministic generator for that use. Reused challenge/completed-Replay information must also be included in the product's Stage review.

## Validation results and limits

| Gate                                                                                         | Result                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final focused live/client/offline/archive-route/creation tests                               | **35 passed**, six files                                                                                                                                                                                                                     |
| Real JWT/RLS/Edge/Realtime/lifecycle gate on final fresh migration                           | **Passed**; includes human creation retry, three real subscribers, four archive alias representations, Normal/Ranked/Stage completion and Authur funding                                                                                     |
| Paid Authur retry                                                                            | Same room; one consumption, one `-1` credit ledger entry, balance 10 → 9; forged bot seat/action refused                                                                                                                                     |
| Real Recent retention / explicit Saved capacity / archive access                             | **Three integration gates passed** on final migration                                                                                                                                                                                        |
| SQL archive payload privileges / Ranked private revisions / plan timeline smoke              | **Passed** on final migration; transactions rolled back                                                                                                                                                                                      |
| ArchBot production parity                                                                    | **101 passed**, two files; model parity does not prove new server bot integration                                                                                                                                                            |
| Broad suite with two workers                                                                 | **1,336 passed, 3 failed, 36 skipped**, 162 files; not an all-green gate                                                                                                                                                                     |
| Failed broad tests                                                                           | Two expect the browser engine chunk removed by the new live route; one expects `wasm-mt` in the untouched sibling engine Makefile. The first two are compatibility regressions of this candidate; the third is an external checkout mismatch |
| Earlier broad run                                                                            | 1,332 passed, seven failures. Five timeout failures passed on a separate one-worker run; the Replay-frame assertion was corrected to preserve the same revisions rather than append a synthetic one                                          |
| Existing Pro-Bot economy / active-board SQL smoke                                            | **Not passed**: scripts call the intentionally revoked raw browser creation RPCs. Port the full scenarios to the trusted endpoint before release; the paid creation test is not a substitute for those suites                                |
| Offline Survival playtest harness                                                            | **Four passed, two failed**: missing ignored recorded-playout fixture; no completed response reached in its browser API scenario. Leak guard/build/startup/retry passed, but full end-to-end parity is uncertified                           |
| Type checking, ESLint, formatting, production frontend build, Edge bundling, diff whitespace | **Passed**                                                                                                                                                                                                                                   |

The broad run covers the final frontend routing changes. Subsequent identity/idempotency corrections were validated by a fresh local database reset and the final real API/Storage/SQL gates. Final nested player/score allowlists also passed 45 focused boundary/Ranked-authority/UI tests and the real API gate. Opt-in integration skips in the broad run are reported as skips, not passes.

Tests used only disposable stack `/private/tmp/eq-live-hidden-security-20261001`, API `http://127.0.0.1:54521`, database port 54522. Its 37 migrations applied fresh. The disposable services were stopped with their backup retained after validation; other local stacks were not stopped. No production credentials, accounts, rooms or services were exercised. Authentication is verified inside each Edge handler; disabling the local gateway's JWT check does not bypass those checks.

No complete browser automation run inspected every Network/IndexedDB/cache/service-worker surface. The live client makes no storage writes, responses are no-store, and the existing service worker skips non-GET/cross-origin requests, but those observations do not replace full browser E2E coverage. Already disclosed values in old tabs/caches cannot be withdrawn. A complete mode/tool matrix, actual bot actions, delayed/duplicate event rendering and terminal concurrency remain required.

## Secondary payload observation

Representative frozen legal Normal traces; UTF-8 JSON **body bytes**, measured in a test, not captured HTTP/socket traffic. “Before” is legacy encoded full state; “after” is the A live projection. Headers, compression and request counts are excluded.

| Turn |  Before |   After | Reduction |
| ---- | ------: | ------: | --------: |
| 0    |   2,107 |   1,975 |      6.3% |
| 12   |  52,056 |  33,075 |     36.5% |
| 30   | 150,666 | 109,639 |     27.2% |

Public Turn Log boards still grow with history. No delta protocol, latency target, p50/p95 claim or performance optimization follows from these measurements.

## Exact implementation boundaries

All links below point into the isolated worktree.

- New [live projection](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/liveGame/projection.ts), [public tile allowlists](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/gameplay/publicTiles.ts), [typed client](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/liveGame/client.ts), [live page](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/liveGame/LivePage.tsx), [trusted handler](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/live-game/handler.ts) and [Edge entrypoint](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/live-game/index.ts).
- New [security migration](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/migrations/20261001103000_live_hidden_information_boundary.sql): private ACL/publication cutover; `authority_protocol`; invalidation broadcast; service-only `trusted_commit_live_game`, `trusted_create_live_game`, `trusted_create_stage`, `trusted_admin_stage`; private human-creation memo table; `completed_snapshot_game_id` and `read_completed_replay_sources`; atomic Normal retention requirement and Stage authority labels.
- [AppRoot](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/app/AppRoot.tsx), [NonPlayApplication](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/app/NonPlayApplication.tsx), [remoteRooms](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/remoteRooms.ts) and [RankedMatchPage](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/components/pages/ranked/RankedMatchPage.tsx): projected online route, no offline live fallback, typed creation, own-log rendering, clock policy and reconciliation. Legacy full-state helper code remains for unported tools, but its server grants are revoked and the live route does not consume it.
- [Ranked public view](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/features/ranked/publicView.ts) and [rules](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/features/ranked/rules.ts): explicit tile/board projection and a Normal clock/scoring policy without changing the default Ranked policy.
- [Stage repository](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/features/survival/repository.ts), [sealed-start helper](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/features/survival/sealedStart.ts), [admin panel](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/components/admin/SurvivalAdminPanel.tsx): safe level metadata; server creation/import/sealing/approval; no browser POC seed/sample import.
- [Completed projection](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/completedGame/projection.ts), [archive policy](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/completedGame/archiveRead.ts), [adapters](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/completedGame/adapters.ts), [Stage terminal preparation](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/completedGame/stageTerminal.ts), [archive Edge](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/archive-replay/index.ts) and [Replay page](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/components/pages/ArchiveReplayPage.tsx): lifecycle gating, Ranked captured history and both historical racks after completion.
- [Normal terminal](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/normal-terminal/index.ts) and [Stage terminal](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/stage-terminal/index.ts): legacy browser full-state endpoints retired. Corresponding `index.js` bundles, Ranked/archive bundles, the new live bundle, [package scripts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/package.json) and [Edge configuration](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/config.toml) updated. Generated local generator inputs are ignored.
- New tests: `live-hidden-information-repro`, `live-hidden-boundary`, `live-hidden-local`, `live-projection-client`, `live-offline-boundary`. Existing creation/Stage/archive tests now use the typed protocol/server-only Stage helper. Completed-frame tests preserve every authoritative revision.

## Remaining production blockers

1. Implement and test actual Authur/Stage turns through a trusted server adapter. Commit before returning a public action result; never return a hidden exchange proposal, opponent candidates or private reasoning to the human browser. Bind frozen bot/catalog versions and preserve funding/tool authorization. The old engine cannot simply receive its former authenticated raw-context grant again.
2. Port manual draw, host controls, supported branch/tools and compatible human lobby flows to typed authorized commands. The candidate currently forces server play/draw and direct concealed settings, reuses a narrower Ranked play screen and disables offline live play. Those are material product changes, not transparent compatibility.
3. Resolve the browser-engine packaging contract and external engine build mismatch; port the full economy, active-board/catalog/Stage regression and concurrency suites to the trusted interface. Keep the existing protected engine checkout untouched.
4. Complete real two-browser gameplay/reconnect/second-tab/cache/terminal-race testing, including actual bot play and every legal terminal cause. Verify direct reads and all deployed RPC overloads against the actual staging schema.
5. Inventory pre-cutover live rooms and old client caches. Preserve their full history; establish a reviewed legacy completion/quarantine policy without pretending a browser-authored history is server authoritative. Review previously published Stage material and challenge reuse.

## Proposed rollout order — future approval required

1. Resolve the blockers above and freeze matched frontend, database, Edge and engine revisions. Do not resume performance optimization.
2. Apply the complete migration chain in staging; exercise the full A/B/spectator matrix, tools, paid funding/concurrency, every terminal cause and legacy Replay. Compare deployed function definitions and publication/grants to the audited baseline. Back up full trusted histories before cutover.
3. Under a reviewed production maintenance window, stop new creation and legacy actions. Inventory/finish or quarantine existing `legacy-client` rooms according to the approved policy; retain their trusted/raw records privately. Do not delete existing histories or user archives.
4. Apply the ACL/publication/authority/lifecycle migration. Old readers/writers now fail closed. Deploy the trusted live/archive/terminal Edge bundle set and compatible engine adapter. Verify service authentication, RLS metadata checks and private broadcast authorization before admitting new games.
5. Deploy the compatible frontend and a versioned reload/update strategy. Retire old live clients and specifically obsolete remote-live caches; preserve user-owned completed/local records. Prior disclosure cannot be reversed.
6. Run controlled production smoke tests using authorized test accounts: A, B and spectator network/socket/cache inspection, stale/retry/reload, paid creation and persisted terminal Replay. Confirm both historical racks become readable only after completion and persistence.
7. Reopen creation only for `server-v1` games once all gates pass; monitor refused writes, stale retries, terminal persistence and duplicate charging. On failure, close access again. Do not restore the raw browser protocol as a rollback.

No rollout step above was executed in production.

## Protected repository state

All writes were confined to the new development worktree and disposable test files/stack. All 11 pre-existing registered worktrees remain registered; no old worktree was deleted or synchronized. At creation, the prior report recorded matching before/after status, index and tracked/nonignored-untracked content hashes. The final read-only audit confirms:

- Primary `/Users/thitithat_tiankrajang/Desktop/EQ-Lab`: HEAD `55352e205082b7f0fc6e30c5a54b891c864555ba`, branch `engine-endgame-win-objective`, **89 tracked changes + 284 untracked files**, matching the initial audit.
- `feature/host-draw-edit`: still `744afacaa9ff25c76521bdd27f4fc59ddf3f6995`.
- Old Compact, Storage release, terminal-routing, Authur runtime, platform/release and other phase worktrees remain at their recorded HEADs and clean. No archived/deleted old worktree cleanup was performed.

**Review decision: NO-GO.** The secrecy boundary and completed lifecycle have concrete passing local evidence, but the candidate must not be deployed or represented as fully compatible across all gameplay modes.
