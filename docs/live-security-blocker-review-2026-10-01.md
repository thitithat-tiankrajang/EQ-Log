> Current milestone status and the locked client-side ArchBot practice decision
> are recorded in [live-security-milestone-s-2026-10-01.md](live-security-milestone-s-2026-10-01.md).
> That report supersedes older compatibility status and server-ArchBot requirements
> below. This document is retained as historical scope/evidence; the 58 classes
> and ordinary competitive secrecy contract remain the established basis.

# Live security correction: blocker continuation review

Date: 2026-10-01 (Asia/Bangkok). Verdict: **NO-GO for production**.

Work stayed in `/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync`, branch
`codex/live-sync-optimization-phase1`, based on
`34d5ae676fc460bfff02fe142b5d76354206b903`. Local `origin/main` still resolves to
that SHA. No deployment, commit, pull, checkout synchronization, worktree deletion
or latency optimization was performed.

The primary checkout still has HEAD
`55352e205082b7f0fc6e30c5a54b891c864555ba`, 89 changed tracked files and 284
untracked files. `feature/host-draw-edit` remains
`744afacaa9ff25c76521bdd27f4fc59ddf3f6995`. All 12 registered worktrees remain.
No files were written in the primary checkout or either sibling engine repository.
The disposable test services were stopped after verification, with the local database backup retained. The local Supabase work was limited to disposable project
`eq_live_hidden_security_20261001`, API port 54521 and database port 54522.

This continues, rather than replaces, the earlier
[security report](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/docs/live-hidden-information-security-review-2026-10-01.md).

## The three failing tests

All three were reproduced before the continuation changes: **11 passed, 3 failed**
in `tests/engine-in-browser.test.ts`. An exact `git archive` of the production
commit was built in a disposable directory, using the same dependencies and a
read-only link to the same sibling engine checkout: **13 passed, 1 failed**.

| Exact test                                                                                                | Original failure                                                                                                 | Classification                                                                                                    | Final disposition                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `the production bundle > instantiates and runs from the built chunk, not just from source`                | No engine chunk; `expect(chunk).toBeDefined()` received undefined                                                | Correction regression: removing the legacy live route let the build remove browser engine code                    | Fixed through actual own-rack analysis from the authorized projection. Built WASM instantiation/calibration passes; real Stage browser analysis also passes.         |
| `the production bundle > ships the engine as its own chunk`                                               | Engine chunk count was zero                                                                                      | Same correction regression; own-turn analysis had lost its packaged engine                                        | Fixed. Engine remains a lazy worker dependency, outside the initial page load.                                                                                       |
| `the engine still builds both ways > keeps a wasm build target that deploys into the bundled source tree` | Sibling `../amath-engine/Makefile` lacks `/^wasm-mt:/m`; the required multi-thread deployment contract is absent | Reproduces unchanged at production baseline. Environment/build-source mismatch, not introduced by this correction | Still fails. No test skip, weakened assertion or edit to the protected sibling repository. Rebuilding the multi-thread engine from this checkout remains unverified. |

Evidence: `/private/tmp/eq-live-blockers-engine-red.log`,
`/private/tmp/eq-live-blockers-engine-baseline.log`,
`/private/tmp/eq-live-blockers-engine-green.log`.

## Authur trusted execution

Path: authenticated live-game action/start → stored authoritative reducer/CAS →
private `live_bot_jobs` enqueue → supervised Node worker claims a private lease →
production Strong computation → private callback → authoritative tile mapping,
rules, revision/CAS and terminal capture → recipient projection/invalidation.

One job exists per room/revision. Claims use `FOR UPDATE SKIP LOCKED`, private
lease tokens and ten-minute lease expiry. The child has a six-minute process
ceiling; timeout, cancellation or incomplete generation fails without a weaker
fallback. The stable job UUID is also the move command ID. No per-turn funding
call exists. Failed jobs can be retried by the authenticated owner.

The Edge Function queues before replying to successful human actions/start and
repairs a missed enqueue on authorized reads. Browser requests provide a retry
path. **Commit and enqueue are separate transactions**: a server failure between
them still needs a subsequent owner read. This narrow recovery gap needs an
atomic outbox or equivalent server reconciliation before unattended execution
can be promised.

The private request contains public board facts, the bot's own rack/pending
returns, public counts, scores and scoreless-turn context. It does not contain the
true human rack, authoritative ordered bag, historical hidden positions or draw
RNG. Scores explicitly allow only A and B. The runtime constructs an anonymous
unseen pool, as the canonical Authur worker does. The request seed is a public
hash of room/revision used for search sampling, not a deal/future-draw seed.

The callback requires BOTH the server service-role credential and a separate
random private secret, then checks job/lease/revision. Human JWTs cannot invoke it.
Its response is only a receipt; the internal bot projection never reaches a human
caller. Browser table/RPC access to jobs and claim/enqueue functions is revoked.

The Strong bundle hash matches the exact production commit. All three copied
models also match `tests/fixtures/authur-models` at that commit, byte for byte:

| Artifact                    | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `src/bot/authur/strong.mjs` | `1bfe583051812453cd047894243ebe9b44ad0569ce977bcf28bd7ee2b533ee49` |
| `next-turn.json`            | `e5af04452ede84e16aea6a52cdc582363b9b2efc90708966dcfc754b8c9be966` |
| `reply-opponent.json`       | `6f502bf133ee2769a966ddc1b0cb219a54c0f7ac622aaba44c6aed5ac9632f7f` |
| `reply-self.json`           | `b2ea60519c4566825250809a832557ac2e92f92256684b850e7219eec34b331a` |

The Node wrapper was mirrored from the local sibling service; its observer
construction and default `decideStrong` call were cross-checked against the
canonical `src/bot/authur/worker.ts`. Startup verifies the pinned bundle/model
hashes. It uses the default full Strong schedule, with no sample/time-budget
reduction inside the search. The deployed service's artifact inventory and worker
platform were not inspected or changed.

Real integration exercised two authoritative Authur turns, concurrent enqueue
retries, a second owner tab, reload, a queued turn completing while the entire
owner browser was offline, public observation and terminal two-sided Replay.
Each revision committed once; one creation consumption remained one consumption.
Random deals can produce placements, exchanges or passes; the gate validates
committed legal actions rather than demanding a particular move from every deal.

## Stage

The same private worker completed a real turn on a sealed local seed-17 endgame
fixture. The browser ran its own-rack analysis, submitted a human pass, received
only its projection, and obtained owner-only completed Replay. The attempt has a
persisted finish/result and `server_reduced` authority. Stage did not create an
additional Pro-Bot consumption. Starts retain the server-generated sealed
position and seeded score baseline.

This fixture was approved **only in the disposable database**. This is not proof
that a production level is currently approved, sealed and available, nor a
production progression/win campaign. The old offline generator playtest also
has unresolved research-fixture/terminal-coverage failures below. Production
level availability and natural winning progression remain evidence gaps.
The Stage UI no longer depends on the unrelated legacy public engine URL.

## Host/manual and offline decisions

Players receive their own current/historical observations and public actions.
An unseated host receives public board/logs/counts and no rack. Ownership does
not confer a playing seat or permission to obtain opponent secrets.

Hosted automatic draws preserve `emailPlayMode=hosted`; two human players can
ready/play/finish, while the host observes a projection and cannot forge a seat.
The candidate previously silently forced hosted settings to direct play. That
was fixed. Hosted setup defaults explicitly to automatic draws and hides no
unsupported setting conversion.

Physical manual-draw recording is explicitly refused before creation. The online
setup disables that choice with a visible reason. Visible-opponent-rack setup is
also explicitly disabled. The baseline physical workflow lets a host pick tokens
from canonical inventories and inspect/refill both racks. That workflow has not
been ported to a recipient-safe typed protocol. Testing membership in the actual
bag could also become a hidden-rack oracle, so restoring those APIs is not a fix.
Host pause/score-edit/refill/branch tools and Pass & Play physical recording remain
product blockers; automatic Hosted play does not establish their compatibility.

Offline choice **B** is intentional: creating or continuing authoritative live
play requires an online account. A disconnected browser may retain its already
authorized projection, but cannot commit moves or acquire hidden state. No full
canonical-state download, offline bot turn or secret cache was restored. The
online-only message is explicit, and historical local files are preserved.
Unit tests cover offline route refusal and preservation of existing data; the
real browser gate confirms an offline attempted action leaves the authoritative
revision unchanged. This intentionally removes earlier device-owned live bot/
hotseat/record behavior; it is a product change, not transparent compatibility.

## Browser, economy and lifecycle evidence

Fresh independent Chromium contexts exercise public Normal, friend/private,
Ranked, Authur, local Stage and Hosted automatic rooms. Coverage includes ready,
pass/exchange, real bot moves, reconnect, reload, second tab, stale revisions,
terminal completion and archive policy. Production approved Stage availability
and physical manual success are not claimed.

Actual live function responses and Realtime frames were collected. Storage
writes, IndexedDB writes and Worker messages were instrumented. Current private
opponent/bag identities were checked against browser-visible observations,
excluding legitimately known own observations. Live schemas/logs contain no
canonical inventory, bag/order, RNG, opponent rack history or exchange contents.
The own-turn engine accepts only the projection. Raw tables/RPCs, private jobs,
bot callback forgery and premature archive reads were attempted from the browser.
No unauthorized secret was returned in these gates. This tests fresh sessions;
it cannot erase information already disclosed to old tabs or caches.

Funding gates use real JWTs and Edge calls: Free refusal/credit, Plus/Pro
allowance, concurrent creation retries, idempotency conflicts, repeated reads,
no silent credit fallback, board limits, no host board, rollback of a refused
charge, and reconnect/moves on an existing board above a lowered limit. Ranked
revision authority and private completed Replay policy also pass.

Normal terminal capture was tested with an injected Recent persistence failure:
the live room remains, History/Recent/Replay do not become available, and a later
retry completes. A separate real transaction hold before persistence was tested
with concurrent archive reads: all readers saw 404 until completion committed.
Alias coverage includes object, plain JSON, `c1:` and Compact inner game IDs.
Completed Normal/Ranked/Stage Replay retains both historical racks at captured
positions, subject to completed-game access policy. Storage tests cover concurrent
Recent retention, explicit Save surviving eviction, capacity and archive access.

## Checks and every previous failure

| Gate                                                                                      | Result                                                                                           |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Broader Vitest suite, 163 files                                                           | **1,341 passed, 1 failed, 34 skipped**; one failure is the reproduced baseline Makefile contract |
| Real browser/current Edge economy suite, four gates                                       | **4 passed, 0 failed, 0 skipped**; final settled-service run, two test files                     |
| JWT/RLS/Realtime/persistence rollback integration                                         | 1 passed, 0 failed                                                                               |
| Storage/Recent/archive real integration                                                   | 3 passed, 0 failed                                                                               |
| Focused projection/offline/setup/engine checks                                            | 89 passed, 1 failed; the same baseline sibling Makefile failure                                  |
| Final Authur observation/own-analysis/projection checks                                   | **31 passed, 0 failed** across three files                                                       |
| Archive payload privileges / Ranked private revisions / plan timeline SQL smoke           | All three passed                                                                                 |
| Formatting, lint, TypeScript/frontend production build, live Edge bundle, diff whitespace | Passed                                                                                           |
| Earlier unchanged ArchBot module parity gate                                              | 101 passed across two files; not a trusted live ArchBot integration                              |

Broad skipped tests are opt-in local/database/benchmark tests; the separately
listed integration gates were explicitly enabled. Engine tests were not skipped.

Other previous failures and limits:

- Earlier five broad-run timeouts passed isolated rechecks and did not recur in
  the final broad run. They were not removed or given blanket longer timeouts.
- The two correction engine-packaging failures are fixed; the third baseline
  Makefile failure remains red, as detailed above.
- `probot_economy_smoke.sql` and `active_boards_smoke.sql` still use browser
  `create_bot_game` / `create_live_game` and raw commit contracts. Their prior runs
  fail with permission denied after the intentional ACL retirement. Current
  focused invariants are covered by the real Edge gate, but these larger legacy
  SQL harnesses have not been ported; their complete scenario coverage is not
  claimed. No raw grants were restored to make them green.
- Offline generator test `parity: recorded generator games through the human
side reproduce Authur, the states, the fixed bag and the result` fails because
  ignored `research/playouts.jsonl` is absent. `browser API: no response carries
hidden information (all 4 levels, illegal moves, exchanges, Authur, results)`
  fails with `no finished response was checked`. Earlier result: 4 passed,
  2 failed. These separate generator/research gates remain unresolved; the new
  real Stage turn/terminal gate does not substitute for them.
- Browser harness development failures included Node JSON-module loading,
  duplicate fixture display names, random Ranked starting side, an asynchronous
  submit read race, a Replay selector expecting the wrong heading, and an
  over-specific placement expectation for a random Authur deal. They were traced
  and corrected in fixtures/assertions; no product security assertion was removed.
- One later browser run had 2 passes/2 failures: an upstream 502 and a closed
  Auth socket while the locally served function bundle was being replaced.
  The CLI recorded a file-change restart and the Edge container start time
  changed. Settled-service reruns pass without adding request retries to hide
  the failure. That failed run is retained in the evidence logs.

## Remaining blockers and smallest next work

1. **Physical recording and host tools:** implement recipient-safe typed
   operations or obtain a deliberate product scope change. Current explicit
   refusal is secure, but does not fulfill the old gameplay promise.
2. **Worker operations/recovery:** verify the private image, supervised platform,
   credentials, production gateway/key mode, restart/lease recovery and queue
   monitoring. Commit/enqueue are not an atomic outbox; add durable server
   reconciliation for failures between them. No production worker was deployed.
3. **Production Stage:** verify approved/sealed level availability and natural
   winning/progression behavior; retain the unresolved generator evidence gap.
4. **Legacy active games and tools:** `legacy-client` games are deliberately
   read-only under the new move protocol. Decide the live-game cutover and already
   disclosed deals. Canonical-dependent pause/refill/score/branch tools are
   unported. Other bot families have no trusted live execution adapter and are
   explicitly refused before creation; ArchBot module parity is insufficient.
5. **Validation/build debt:** reconcile the protected sibling's missing
   multi-thread build contract in its own authorized work, and port the old
   full SQL funding/board-limit scenarios to trusted/current entry points.

A single public projection or restoring browser canonical access would be a
smaller code change, but neither meets the accepted secrecy requirement. The
worker reuses the canonical Strong artifacts rather than inventing a weaker bot.
The remaining compatibility work should extend typed operations, not restore
the retired full-state route.

## Rollout order — proposed only, not executed

1. Close the blockers above and review the explicit offline/product scope.
   Confirm target migrations/function definitions and explicit-table Realtime
   publication; back up the production database.
2. Prepare and verify the private worker image, artifact hashes and server-only
   credentials. Test the target JWT gateway/key mode. Pause creation/play for
   the coordinated cutover and decide how legacy active games will be handled.
3. Apply `20261001103000_live_hidden_information_boundary.sql`, then
   `20261001103100_trusted_live_bot_jobs.sql`. The first migration intentionally
   breaks old raw clients and asserts expected existing capture definitions.
4. Publish the live-game, Ranked and archive bundles, and retired normal-terminal/
   stage-terminal handlers. Start the private worker after its queue migration.
   Verify its callback and authoritative persistence before opening bot rooms.
5. Publish the projection-only frontend, require old tabs to reload, and run a
   small real multi-user smoke through funding, bot moves, terminal storage and
   two-sided Replay. Reopen only supported flows after all checks pass.

Rollback must retain the secrecy ACLs, private Realtime boundary and authoritative
completed records. Stop new rooms and worker dispatch if necessary; use a safe
read-only frontend. Do not roll back by restoring raw state grants, canonical
browser caching or old client terminal writers. Keep private job records and
completed payloads for recovery. A worker restart can reclaim expired leases;
CAS/command IDs prevent duplicate committed moves and no turn retry charges.

The candidate is materially improved and passes the demonstrated secrecy gates,
but **NO-GO** remains because physical/host compatibility and production execution/
cutover evidence are incomplete. Stop for review; no deployment or performance
track should start from this result.

## Exact changed-file manifest

- [.gitignore](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/.gitignore)
- [docs/live-hidden-information-security-review-2026-10-01.md](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/docs/live-hidden-information-security-review-2026-10-01.md)
- [docs/live-security-blocker-review-2026-10-01.md](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/docs/live-security-blocker-review-2026-10-01.md)
- [eslint.config.js](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/eslint.config.js)
- [package.json](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/package.json)
- [playwright.live-security.config.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/playwright.live-security.config.ts)
- [services/trusted-bot/Dockerfile](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/services/trusted-bot/Dockerfile)
- [services/trusted-bot/README.md](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/services/trusted-bot/README.md)
- [services/trusted-bot/models/next-turn.json](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/services/trusted-bot/models/next-turn.json)
- [services/trusted-bot/models/reply-opponent.json](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/services/trusted-bot/models/reply-opponent.json)
- [services/trusted-bot/models/reply-self.json](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/services/trusted-bot/models/reply-self.json)
- [services/trusted-bot/runtime.mjs](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/services/trusted-bot/runtime.mjs)
- [services/trusted-bot/worker.mjs](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/services/trusted-bot/worker.mjs)
- [src/app/AppRoot.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/app/AppRoot.tsx)
- [src/app/NonPlayApplication.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/app/NonPlayApplication.tsx)
- [src/bot/authur/request.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/bot/authur/request.ts)
- [src/completedGame/adapters.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/completedGame/adapters.ts)
- [src/completedGame/archiveRead.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/completedGame/archiveRead.ts)
- [src/completedGame/projection.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/completedGame/projection.ts)
- [src/completedGame/stageTerminal.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/completedGame/stageTerminal.ts)
- [src/components/admin/SurvivalAdminPanel.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/components/admin/SurvivalAdminPanel.tsx)
- [src/components/pages/ArchiveReplayPage.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/components/pages/ArchiveReplayPage.tsx)
- [src/components/pages/lobby/CreateRoomPanel.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/components/pages/lobby/CreateRoomPanel.tsx)
- [src/components/pages/pregame/CreateRoomPage.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/components/pages/pregame/CreateRoomPage.tsx)
- [src/components/pages/ranked/RankedMatchPage.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/components/pages/ranked/RankedMatchPage.tsx)
- [src/features/ranked/publicView.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/features/ranked/publicView.ts)
- [src/features/ranked/rules.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/features/ranked/rules.ts)
- [src/features/survival/repository.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/features/survival/repository.ts)
- [src/features/survival/sealedStart.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/features/survival/sealedStart.ts)
- [src/gameplay/publicTiles.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/gameplay/publicTiles.ts)
- [src/liveGame/LivePage.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/liveGame/LivePage.tsx)
- [src/liveGame/analysis.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/liveGame/analysis.ts)
- [src/liveGame/botAction.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/liveGame/botAction.ts)
- [src/liveGame/client.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/liveGame/client.ts)
- [src/liveGame/projection.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/liveGame/projection.ts)
- [src/remoteRooms.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/remoteRooms.ts)
- [supabase/config.toml](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/config.toml)
- [supabase/functions/archive-replay/index.js](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/archive-replay/index.js)
- [supabase/functions/archive-replay/index.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/archive-replay/index.ts)
- [supabase/functions/live-game/handler.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/live-game/handler.ts)
- [supabase/functions/live-game/index.js](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/live-game/index.js)
- [supabase/functions/live-game/index.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/live-game/index.ts)
- [supabase/functions/normal-terminal/index.js](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/normal-terminal/index.js)
- [supabase/functions/normal-terminal/index.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/normal-terminal/index.ts)
- [supabase/functions/ranked/index.js](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/ranked/index.js)
- [supabase/functions/stage-terminal/index.js](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/stage-terminal/index.js)
- [supabase/functions/stage-terminal/index.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/stage-terminal/index.ts)
- [supabase/migrations/20261001103000_live_hidden_information_boundary.sql](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/migrations/20261001103000_live_hidden_information_boundary.sql)
- [supabase/migrations/20261001103100_trusted_live_bot_jobs.sql](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/migrations/20261001103100_trusted_live_bot_jobs.sql)
- [tests/archive-route.test.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/archive-route.test.tsx)
- [tests/authur-request.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/authur-request.test.ts)
- [tests/completed-game-benchmark.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/completed-game-benchmark.test.ts)
- [tests/completed-game-blocker-closure.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/completed-game-blocker-closure.test.ts)
- [tests/completed-game-boundaries.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/completed-game-boundaries.test.ts)
- [tests/create-experience.test.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/create-experience.test.tsx)
- [tests/live-hidden-boundary.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-hidden-boundary.test.ts)
- [tests/live-hidden-information-repro.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-hidden-information-repro.test.ts)
- [tests/live-hidden-local.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-hidden-local.test.ts)
- [tests/live-offline-boundary.test.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-offline-boundary.test.tsx)
- [tests/live-own-analysis.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-own-analysis.test.ts)
- [tests/live-projection-client.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-projection-client.test.ts)
- [tests/live-security-browser/economy.spec.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-security-browser/economy.spec.ts)
- [tests/live-security-browser/fixtures.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-security-browser/fixtures.ts)
- [tests/live-security-browser/security.spec.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-security-browser/security.spec.ts)
- [tests/phase3-economy.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/phase3-economy.test.ts)
- [tests/remote-room-creation.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/remote-room-creation.test.ts)
- [tests/stage-repository.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/stage-repository.test.ts)
- [tests/stage-terminal-local.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/stage-terminal-local.test.ts)
- [tests/stage-terminal.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/stage-terminal.test.ts)
- [tests/terminal-routing-local.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/terminal-routing-local.test.ts)

## Evidence logs and reproduction

Final protected-worktree map: [read-only verification](/private/tmp/eq-live-blockers-worktree-final.txt).

- [eq-live-blockers-engine-red.log](/private/tmp/eq-live-blockers-engine-red.log)
- [eq-live-blockers-engine-baseline.log](/private/tmp/eq-live-blockers-engine-baseline.log)
- [eq-live-blockers-engine-green.log](/private/tmp/eq-live-blockers-engine-green.log)
- [eq-live-blockers-full-final3.log](/private/tmp/eq-live-blockers-full-final3.log)
- [eq-live-blockers-browser-final6.log](/private/tmp/eq-live-blockers-browser-final6.log)
- [eq-live-blockers-browser-final4.log](/private/tmp/eq-live-blockers-browser-final4.log)
- [eq-live-blockers-local-final2.log](/private/tmp/eq-live-blockers-local-final2.log)
- [eq-live-blockers-storage-final.log](/private/tmp/eq-live-blockers-storage-final.log)
- [eq-live-blockers-focused-final.log](/private/tmp/eq-live-blockers-focused-final.log)
- [eq-live-blockers-authur-final.log](/private/tmp/eq-live-blockers-authur-final.log)
- [eq-live-blockers-lint-final3.log](/private/tmp/eq-live-blockers-lint-final3.log)
- [eq-live-blockers-format-final2.log](/private/tmp/eq-live-blockers-format-final2.log)
- [eq-live-blockers-build-final4.log](/private/tmp/eq-live-blockers-build-final4.log)
- [eq-live-blockers-archive_payload_privileges_smoke-final.log](/private/tmp/eq-live-blockers-archive_payload_privileges_smoke-final.log)
- [eq-live-blockers-ranked_private_revisions_smoke-final.log](/private/tmp/eq-live-blockers-ranked_private_revisions_smoke-final.log)
- [eq-live-blockers-plan_timeline_smoke-final.log](/private/tmp/eq-live-blockers-plan_timeline_smoke-final.log)
- [eq-live-hidden-probot_economy_smoke.log](/private/tmp/eq-live-hidden-probot_economy_smoke.log)
- [eq-live-hidden-active_boards_smoke.log](/private/tmp/eq-live-hidden-active_boards_smoke.log)
- [eq-live-hidden-playtest.log](/private/tmp/eq-live-hidden-playtest.log)
- [eq-live-hidden-rerun.log](/private/tmp/eq-live-hidden-rerun.log)
- [eq-live-hidden-archbot-parity.log](/private/tmp/eq-live-hidden-archbot-parity.log)

Use only the disposable local project. Private configuration/status files contain
local credentials and are intentionally excluded from this report and Git.

```sh
npm run build
npx vitest run --maxWorkers=2
LIVE_SECURITY_TEST_WORKDIR=/private/tmp/eq-live-hidden-security-20261001 npx vitest run tests/live-hidden-local.test.ts --maxWorkers=1
LIVE_SECURITY_STATUS_FILE=/private/tmp/eq-live-hidden-security-20261001/status.private.json npx playwright test --config playwright.live-security.config.ts
```

The local tests require that project's Edge services and trusted worker to be
running. Local serving used the JWT gateway override; human JWTs are independently
verified inside the functions, and the bot callback checks both private
credentials. Production gateway behavior is an explicit rollout verification.
