> Current milestone status and the locked client-side ArchBot practice decision
> are recorded in [live-security-milestone-s-2026-10-01.md](live-security-milestone-s-2026-10-01.md).
> That report supersedes older compatibility status and server-ArchBot requirements
> below. This document is retained as historical scope/evidence; the 58 classes
> and ordinary competitive secrecy contract remain the established basis.

# Live hidden-information release readiness — 2026-10-01

Dedicated worktree: `/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync`.
Branch: `codex/live-sync-optimization-phase1`. Base and current HEAD:
`34d5ae676fc460bfff02fe142b5d76354206b903`. All candidate changes remain uncommitted. A final read-only remote check confirms
`origin/main` is still this SHA.
This report supersedes the prior blocker report for current readiness; previous
reports remain historical evidence. No deployment, merge, or performance work.

## 1. Verdict

**NO-GO for production release.** Durable worker scheduling/recovery, local worker
provisioning, public Hosted administration, and a natural Stage win are now
verified. The security boundary stays intact. Secure refusal of an unsupported
workflow is not compatibility evidence for that workflow.

## 2. Remaining blockers and dispositions

1. **Physical/manual Hosted recording:** new manual rooms are refused. Physical
   draw entry, host-recorded moves, refill/rack corrections, and historical board
   correction/undo/branch tools have no complete trusted adapter. A host may not
   obtain either hidden rack or an inventory palette backed by the true bag.
   Manual selection must not become a membership oracle for the opponent rack.
   Public pause/resume/score/finish have been restored and tested; this does not
   close the physical workflow. Existing UI choices that imply unsupported
   capabilities must be reconciled before shipping the whole product.
2. **Legacy operational resolution:** the safest implemented cutover freezes
   `legacy-client` games, preserves private state, and serves authorized views.
   Both old and new writers are refused for continuation. There is no trusted
   migration/adjudication/cancellation path for finishing those sessions. A
   reviewed operational policy is required before rollout. Do not label imported
   client history as independently server-validated or promise retroactive secrecy.
3. **Other live modes:** the secure new bot adapter supports Authur Strong only.
   ArchBot has no secure live execution adapter; its old lifecycle integration
   fails at the deliberately revoked creation RPC. Solo/Pass & Play and the old
   host tool portfolio are not established by these online two-account gates.
   Their product compatibility must be restored or explicitly scoped out.
4. **Production facts:** this worktree is not linked to a hosted Supabase project;
   CLI project inspection returned `Cannot find project ref`. No authenticated
   production Stage catalog, worker platform, service-JWT/key mode, secrets, or
   publication/function definitions were verified. These cannot be marked passed
   or replaced with a claim that production has zero approved levels. Mandatory
   checks below remain. Production Stage play can be a bounded post-deployment,
   pre-enable smoke if Stage creation remains disabled until it passes.

Worker crash/restart is no longer a local algorithmic blocker. The baseline
sibling Makefile failure is build-source debt, not a new application failure.
Nine retired client-write integration tests and two old SQL harnesses are recorded
as failed when explicitly enabled, not silently described as green.

## 3. Final test results

Results are separate executions, not an inflated sum of overlapping tests:

| Gate                                                                                   | Result                                                                           |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Default full Vitest suite                                                              | 1,349 passed / 1 baseline failure / 39 skipped; 168 files                        |
| Adversarial Chromium release gates, built private worker container, normal JWT gateway | 6 passed / 0 failed / 0 skipped; 3 files                                         |
| Recovery + natural Stage progression + full Saved capacity                             | 4 passed / 0 failed / 0 skipped; 3 files                                         |
| Real JWT/RLS/Realtime/terminal rollback + Recent/Saved/archive integrations            | 4 passed / 0 failed / 0 skipped; 4 files                                         |
| Real Ranked Edge/database authority (previously 13 skips)                              | 13 passed / 0 failed / 0 skipped                                                 |
| Creation controls: all creation closed; separately Stage-only closed                   | 1 passed in each configuration                                                   |
| ArchBot parity (engine parity, not secure live execution)                              | 101 passed                                                                       |
| Archive payload ACL, Ranked private revisions, plan timeline SQL                       | 3 suites passed                                                                  |
| Explicitly enabled retired lifecycle integrations                                      | 0 passed / 9 failed / 0 skipped; 6 files                                         |
| Prior retired Pro-Bot economy / active-board SQL harnesses                             | Both fail at revoked raw creation RPCs; current Edge/browser economy gate passes |
| Lint, formatting, TypeScript/production build, Edge bundle, diff whitespace            | Passed                                                                           |

The 39 skips include 5 new opt-in integration cases. Their enabled executions are
listed above. Every skipped test has an individual disposition in the appendix.
No assertion was weakened, no baseline test was skipped to hide its failure,
and no performance benchmark environment was enabled.

## 4. Baseline failure

`tests/engine-in-browser.test.ts` → “the engine still builds both ways > keeps a
wasm build target that deploys into the bundled source tree” expects `wasm-mt:`
and the corresponding multi-thread deployment recipe in the sibling Makefile.
The protected sibling currently has neither contract. The same test fails from
an exact archive of canonical production HEAD using the same environment:
13 engine tests pass, 1 fails. Proof remains in
`/private/tmp/eq-live-blockers-engine-baseline.log` and the final full-suite log.
The two correction-caused missing-chunk failures stay fixed. The shipped bundles
build and run, including browser own-rack analysis. Rebuilding the multi-thread
artifact from this sibling checkout remains unverified; no sibling files changed.

## 5. Hosted/manual compatibility matrix

| Feature                                | Expected behavior                                  | Broken dependency                               | Actual data and classification                                           | Safe fix / current disposition                                                                                                 |
| -------------------------------------- | -------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Hosted automatic play                  | Two invited players play; host observes            | Old UI decoded the entire game for every viewer | Public board/log/scores; each seated player's own rack; server-only deal | Recipient projections and server rules work; browser gate passes                                                               |
| Physical move recording by host        | Record physically played equation and advance turn | Host mapped placements from either full rack    | Public placements; ownership/draw/history validation trusted-only        | Requires typed trusted recorder and physical provenance/role policy; unsupported                                               |
| Manual initial draw and refill         | Enter actual physical draws                        | Palette and token resolver used true bag        | Draw known only to its recipient; true remaining inventory trusted-only  | Dedicated own-recipient/trusted intake without a probing oracle; new manual creation refused                                   |
| Edit/refill correction                 | Repair a mistaken draw without advancing twice     | Client snapshots included bag and both racks    | Own submitted draw + trusted prior inventory/history                     | Trusted revision-checked correction required; unsupported                                                                      |
| Rack typing, removal, assignment edits | Correct recorded rack slots/faces                  | Host directly edited full canonical racks       | Own-player rack, opponent data trusted-only                              | No host rack read or edit DTO; unsupported                                                                                     |
| Public score correction                | Referee corrects a recorded turn                   | Client mutated logs and totals from full state  | Public log ID and integer score                                          | **Implemented** owner-only command, pause required, bounded score, recalculated totals, private history preserved              |
| Pause / resume / clock settlement      | Stop and restart active clock                      | Full lifecycle state upload                     | Public lifecycle/clock; server timestamp                                 | **Implemented** trusted owner command, elapsed clock settled once; no paused human moves                                       |
| Finish / public result                 | Referee ends tournament game; persist result       | Browser uploaded a finished canonical game      | Public decision; private history needed only inside trusted persistence  | **Implemented** trusted finish through atomic Normal capture; two participant History rows; completed Replay after persistence |
| Undo/redo/historical board correction  | Restore earlier position consistently              | Browser cloned hidden historical racks/bag      | Public board selection; full restore trusted-only                        | Trusted restore must conserve inventory and increment revision; unsupported                                                    |
| Play from turn / fork / multiverse     | Resume a historical branch                         | Client received full private branch snapshots   | Public position selector; hidden branch inventory trusted-only           | Server-side branch operations plus safe projection needed; unsupported                                                         |
| Waiting-room player/settings edits     | Adjust players/names/rules before start            | Generic client state replacement                | Public metadata; frozen seat/board-limit checks trusted                  | Current Ready/cancel supported; general host reconfiguration unported                                                          |
| Log notes / stars                      | Add annotations to public turns                    | Old full-state log mutation                     | Public text/numeric annotation with log ID                               | Small typed command possible; current safe page does not restore these tools                                                   |
| Bag panels / export/import live state  | Inspect/import/export a recording                  | Full bag, seed, historical secrets serialized   | Public remaining count lawful; canonical/ordered bag trusted-only        | Count and safe room link supported; full live canonical export/import prohibited                                               |
| Recovery / resume / reload             | Reopen latest authoritative position               | Full local secret snapshots used as fallback    | Authorized projection + server private state                             | Poll, private revision invalidation, online/focus/reload/second tab pass; no secret fallback                                   |
| Historical/live analysis               | Analyze a turn                                     | Old analysis passed historical opponent state   | Own current rack + public board/context                                  | Current own-turn analysis works; full hidden historical live analysis/branch portfolio unported                                |

Tournament owner authority is derived from the stored owner, Hosted mode, normal
purpose, and absence of a bot. Being owner of a Direct or Stage game confers no
host powers. Administration still returns no rack for an unseated host. Unknown
rack/draw commands are refused, and spectators/players cannot forge host authority.

## 6. Worker recovery

A database trigger inserts the durable revision-only job in the **same transaction**
as a stored room update. Start/resume and human commits therefore do not depend
on a browser read or a later Edge enqueue. The migration reconciles existing
server-v1 bot turns. The private worker obtains only its own observation after
claiming the lease; anonymous/human requests to that path return 401.

Tested actual worker missing configuration before claim; process-group kill just
after a real claim; restart; simulated passage of the ten-minute lease; stale
lease-token refusal; actual full-strength bot computation/commit; repeated
callback receipt; duplicate human command; stale revision; and no extra charge.
A SQL-only room transaction queues `{}` before any Edge read/enqueue, proving
closure of the former commit/enqueue crash window. Failed work retries with a
bounded exponential delay, without a browser. Lost acknowledgement uses the
committed command event or completed History; stale/paused/legacy rooms are not
replayed. Tests verify one bot log/event and one funding consumption.

The crash injection happens after claim, before completion; lease expiry is
advanced in the disposable DB rather than waiting ten real minutes. It does not
alter the production lease duration. Browser network-loss/reload/reconnect/second-
tab gates additionally pass with the built container, not only a process mock.

## 7. Provisioning result

**Production-equivalent local provisioning passes, within stated limits.** A
fresh isolated database was reset from every canonical baseline migration through
`20261001102600`, using repository artifacts. The documented existing room-code
secret prerequisite was initialized locally with cryptographic random bytes.
A real legacy game was created/committed through its original authenticated RPCs.
The CLI then applied the four candidate migrations, in filename order, without
ad-hoc schema/permission patches. Exact function bundles were copied from source.
The genuine pre-cutover game was tested again after the boundary.

A reusable loopback-only legacy cutover probe is retained in
`tools/live-security/legacy-cutover.mjs`; it keeps comparison sessions and private
state outside the repository.

The private Docker image builds with the pinned Node manifest, locked npm install,
canonical Strong and three SHA-verified model files. Compose runs it non-root,
read-only, supervised, with private temporary storage and **no published ports**.
Its process/heartbeat health is healthy and its actual Authur/Stage moves pass the
six browser gates. JWT gateway verification remains enabled; forged callbacks are
refused and valid service-JWT/private-secret callbacks succeed. A healthy process
alone is not enough: job age/failures/attempts and actual commits must be monitored.

Exact external dependencies: Supabase/PostgreSQL migrations and explicit-table
Realtime publication; existing `room_code_secret`; human JWTs; gateway-compatible
`SUPABASE_SERVICE_ROLE_KEY`; `SUPABASE_URL`; matching server-only `LIVE_BOT_SECRET`;
worker supervision/outbound access; immutable worker image; safe frontend and
archive bundles deployed together. No service key or bot secret is a VITE value.
`LIVE_GAME_CREATION_ENABLED=false` closes all new creation, and
`STAGE_CREATION_ENABLED=false` independently closes Stage. Existing projections
continue to work. Both closed and Stage-only closed configurations are exercised.
These opt-out controls must be explicitly configured during rollout.

A local loopback stack is not proof of the current hosted production key mode,
function definitions, schema, publication, catalog, registry or supervisor. Those
facts are deliberately left unverified rather than inferred from local success.

## 8. Stage evidence and remaining gap

The strongest new test uses **repository candidate seed 5117**, whose source
status is `awaiting_admin_approval`. It is sealed and approved **only in the
disposable database**. A human analysis helper chooses from the authorized own-
rack/public projection; the opponent independently executes through the real
private worker. The game reaches a natural human win, records `server_reduced`,
appears in the same owned-win query used for progression, removes the live room,
persists one completed Stage record, and returns two-sided Replay to the owner.
A stranger gets 404. Stage consumes zero Pro-Bot charges. The browser Stage gate
also verifies own-rack browser analysis and live secrecy against real Authur.

Production level availability is **unknown**, not “no approved levels.” This
worktree has no hosted link and no approved production player/admin session was
provided. There is no production deployment in this task. Stage has no independent
unlock state machine here; current progression is its owned completed-win query.
Existing advisory results retain their old provenance; new results are not silently
relabeled. The offline generator research suite's missing ignored corpus and
“no finished response checked” failure remain research-harness debt, not replaced
by a claim that its four historical levels were validated.

Decision: an actual run on a legitimately approved/sealed production level is a
**bounded post-deployment, pre-enable smoke requirement**, conditional on leaving
`STAGE_CREATION_ENABLED=false` until that smoke passes. If production has no
approved playable levels, record that actual catalog fact; an empty catalog does
not require invented approval. If Stage must be enabled immediately with this
release, the production catalog/worker/run checks are a hard enablement gate.
Overall release remains NO-GO for the separate material compatibility/cutover issues.

## 9. Legacy cutover strategy and evidence

Formats inventoried: raw legacy GameState JSON; `c1:` encoded JSON; compact
face-only v1/v2 (identity recovery); ordinal-preserving v3; private canonical,
session and event/timeline protocols; legacy completed snapshots/Compact records.
These are storage formats, not permission to return a full live state. The actual
live cutover fixtures exercise v2/v3 and the genuine baseline v3 protocol. v1
identity recovery has codec coverage; raw/c1 are also local/archive formats, and
are not all proven readable as live rows. An undecodable older live row fails
closed with a generic unavailable response and needs operational resolution.

The old bundle used raw `state`/`session` column reads, full snapshot/engine-context
RPCs, canonical/state/session writers and private table Realtime. Before candidate
migrations a genuine baseline RPC-created v3 game exposes opponent rack through
`state` and canonical through `get_live_game_snapshot`. After all four migrations:
A and B load/reconnect via safe projection; those old reads and writes are denied;
new next moves return 409; live Replay returns 404; state/revision are unchanged;
no completion/History is fabricated. A Chromium gate additionally loads v2/v3
fixtures, refreshes, disconnects/reconnects, checks the read-only notice, and tests
both seats and old RPC refusal.

Implemented choice: backend ACL/publication cutover first, authorized projection,
explicit legacy freeze notice, and new frontend refresh. No fallback decodes a
canonical live state in the new page. An old cached bundle cannot receive new
insecure backend payloads, but already-downloaded secrets cannot be withdrawn.
The old client can break after rollout and may render its stale cache; security
wins over continuation. The service worker uses network-first navigation and
cached assets, so rollout must test a real old installed PWA and online refresh.
Do not delete users' historical local game files as a “fix.”

Evaluated alternatives: a projection alone cannot teach an old full-state writer
new typed commands; a client-only refresh gate cannot revoke backend leaks;
unbounded drain leaves secrecy broken; replaying/importing old canonical history
requires trusted inventory/provenance checks and cannot certify past honesty.
A trusted migration of supported automatic games may be designed later. Current
freeze is safest, but operational resolution is still a release blocker.

Requested old-game → next move → opponent move → finish → Replay is **not passed**:
the next move is intentionally refused and the later steps cannot occur. Secure
freeze evidence is not substituted for seamless legacy continuation evidence.

## 10. Offline behavior

Online authority remains mandatory. Offline live actions cannot advance the
stored revision, and there is no canonical localStorage/IndexedDB/worker/session
fallback. Reconnect obtains the latest authorized projection. Historical local
files are preserved. This does not restore the old offline physical/Pass & Play
product promise, nor retain unsubmitted drafts across every navigation.

## 11. Security adversarial results

Two independent human browser contexts plus host/spectator inspect HTTP, actual
Realtime frames, own/opponent Turn Log fields, historical live revisions, reload,
second tab, stale recovery, Storage writes, IndexedDB writes and worker traffic.
Raw table/column/RPC paths and private bot observation/callback forgery are denied.
Realtime exposes game ID/revision invalidation, not private inventory or command
payloads. Opponent logs reveal exchange count only. Completed live aliases are
blocked across object/plain JSON/c1/Compact representations. Failed terminal
persistence leaves live state and Replay unavailable. No new secret cache is added.

## 12. Economy and authority

Real Edge gates cover Free credit refusal/grant, Plus/Pro allowance, concurrent
idempotent creation, funding conflicts/no fallback, active-board limits, rollback
of a refused charged creation, lowered limit during an existing game, waiting
cancel, safe reads and retried requests. Recovery has one charge/one bot command;
Stage is uncharged. Thirteen real Ranked DB cases add stake freshness, refusal
codes, busy/legacy matches, board limit, approval/authentication, viewer forgery
and completion. The older SQL creation/terminal harnesses remain incompatible;
this is explicitly recorded rather than granting client access again.

## 13. Terminal and Replay

Normal, Ranked, Hosted automatic/administrative finish, Authur and Stage persist
before their hidden history becomes accessible. Hosted finish creates two seated
participant History rows and removes the live room. Replay has `finalRacks.A/B`
and both racks on every captured authoritative position (the public DTO is not
named `rackA/rackB`). Recent/Saved concurrent retention and safe archive policy
pass. Free/Plus/Pro accounts with full Saved capacity finish normally, retain
History/Recent/Replay, and receive no unsolicited new Saved item. Legacy imported
sources preserve only available history; no genesis/rack state is invented.

## 14. Exact changes and introduced dependencies

Four candidate migrations:

- `20261001103000_live_hidden_information_boundary.sql`: protocol discriminator;
  raw live/archive column and RPC revocation; safe metadata grants; removal of
  private tables from Realtime; ID/revision-only broadcast; trusted creation,
  Stage admin/start and CAS; completion provenance/persistence requirements;
  stable completed reader and live-alias guard; idempotent creation memo.
- `20261001103100_trusted_live_bot_jobs.sql`: private durable jobs, unique room/
  revision, service-only enqueue/claim, frozen bot-owner commit authorization.
- `20261001103200_live_bot_recovery.sql`: atomic queue trigger, migration-time
  reconciliation, attempt/backoff fields, failed/expired lease reclaim, committed
  receipt reconciliation and stale/paused/legacy cancellation.
- `20261001103300_hosted_public_administration.sql`: owner-only Hosted normal
  commit path; Direct, Stage and bot ownership do not grant host powers.

New/changed private RPCs: `trusted_create_live_game`, `trusted_create_stage`,
`trusted_admin_stage`, `trusted_commit_live_game`, `enqueue_live_bot`,
`claim_live_bot_job`, `read_completed_replay_sources`, and the trigger function
`queue_authoritative_bot_turn`. Browser EXECUTE is denied. Existing terminal
captures are service-only. Raw legacy readers/writers stay revoked; safe metadata,
join/Ready/cancel paths retain their intended authentication/RLS checks.

Edge: `live-game` authenticated settings/typed commands, public admin, private
`bot-observation`/`bot-result`, secure read, creation controls; updated Ranked and
archive projection boundaries; retired normal-terminal/stage-terminal reject old
finished-state uploads. Worker: pinned Strong/models, Docker/Compose/health,
private observer/runtime and durable callback. Frontend: online safe routing,
own-rack analysis, safe Room/Stage metadata/start, Hosted controls, pause handling,
legacy freeze notice and cache-free recovery. Full manifest follows the appendix;
previously accepted changes are retained, not silently treated as this round's
new edits. All credentials and test artifacts remain outside the repository.

## 15. Commit

**No candidate commit.** Material blockers remain, so the conditional commit
requirement is not satisfied. HEAD remains the production base SHA stated above.
No main merge or push. A complete release review/commit must follow blocker closure.

## 16. Proposed production rollout — NOT EXECUTED

1. Resolve physical/other-mode compatibility scope and the operational disposition
   of every existing legacy live game. Record live inventory/owners/protocols,
   back up production, and verify restoration/read access without restoring leaks.
2. Verify target baseline migration history, exact expected function definitions,
   explicit-table Realtime publication, current grants, existing room-code secret,
   approved Stage catalog and production JWT/key mode. Fail closed on mismatch.
3. Prepare immutable worker image and private supervisor/network/secrets. Keep
   public creation closed during the coordinated maintenance window. Set
   `LIVE_GAME_CREATION_ENABLED=false` and `STAGE_CREATION_ENABLED=false` in Edge.
   These flags do not affect the old backend: maintenance must cover its creation
   paths until the revocation migration lands.
4. Apply 103000 → 103100 → 103200 → 103300 through the migration runner. Each is
   transactional; stop on any definition/publication assertion. Do not patch around
   a failed assertion or temporarily restore raw grants. Existing legacy games freeze.
5. Install the exact live-game, Ranked, archive-replay and retired terminal bundles
   with the repository config (live-game JWT verification enabled). Keep existing
   Saved/migration endpoints compatible and verify their current artifacts.
6. Start the pinned supervised private worker with matching secret and service JWT.
   Verify readiness/health, claims, actual legal commits, failure backoff and restart.
   Use a maintenance test account to exercise candidate creation in a controlled
   window, or the staged equivalent; do not expose public funding before readiness.
7. Publish the safe frontend and PWA assets together. Verify an old installed PWA
   online reload and old API refusal, plus a clean client. Never roll back to an
   old full-state writer while reopening private grants.
8. After all mandatory Normal/Ranked/Hosted/Authur/security/economy smokes pass,
   enable general creation. Keep Stage disabled until its separate production
   approval/seal/start/bot/natural completion/progression/Replay smoke passes.
9. Monitor job age/attempts/failed/expired leases, revision conflicts, terminal
   errors, funding receipts and legacy freeze/resolution outcomes. No performance
   benchmarking or optimization is part of this release gate.

The sequence remains a proposal because the release is NO-GO. The two opt-out
creation flags are verified controls, not proof that a production maintenance
policy or admin-only testing window already exists.

## 17. Rollback constraints

- Additive protocol/memo/job/backoff fields and trigger must be retained while
  candidate-created games/jobs exist. Dropping them loses recovery/idempotency
  evidence. Stop new creation and dispatch before changing a worker.
- ACL, archive guard and Realtime removals are **security cutover constraints**.
  Do not reverse them to revive an old browser. A safe rollback is read-only,
  closed creation and preserved private records/jobs, with a compatible projection
  reader; not a raw canonical frontend/backend rollback.
- Completion provenance includes `server_reduced` and immutable completed records.
  Do not relabel/delete them, truncate outbox data, or loosen persistence checks.
  Existing previously cached/served secrets cannot be undone by rollback.
- A failed migration transaction rolls itself back, but several successful
  migrations/Edge/frontend releases are not one distributed transaction. Keep
  creation closed and follow the reviewed stop/resume plan for partial rollout.
- Reverting Hosted controls may remove administration UI; it must not grant secret
  access. Paused rooms and leases must remain durable and recoverable.
- Database backups are recovery evidence, not authorization to restore obsolete
  public private-data grants or overwrite users' subsequent authoritative games.

## 18. Mandatory production smokes

Verify actual target schema/functions/ACLs and publication; two authenticated
players and spectator attack raw reads/RPCs and inspect Realtime/log/cache traffic;
reload/reconnect/second tab/stale revision; old installed bundle/PWA refusal and
new refresh; actual legacy inventory and documented frozen-session resolution;
Normal friend/private, Ranked, Hosted automatic plus host pause/correction/resume/
finish; supported physical/manual workflow once implemented; Authur charge once,
worker crash/restart/expired lease/retry and actual legal move; active-board
refusal/rollback; terminal persistence failure and successful two-sided Replay;
Recent/Saved policy and full-capacity compatibility; Stage catalog approval/seal,
trusted turn, natural terminal, owned progression and owner-only Replay before
Stage enablement. Confirm no browser-accessible service key or bot secret.

Stop after review. Do not deploy, merge, start Live Sync optimization, or commit
this incomplete candidate.

## Appendix A — every default-suite skipped test

A default environment skip is not evidence of a pass. This inventory contains
39 individual cases, including their explicit enabled result or remaining gap.

| #   | Test file and exact test                                                                                                                                                 | Classification            | Evidence / disposition                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `archbot-storage-local.test.ts` — finishes a production ArchBot room through Compact, History, Recent and safe replay                                                    | intentionally unsupported | Enabled: FAIL at revoked create_bot_game. Secure live ArchBot adapter remains a compatibility blocker; parity alone is insufficient.                                                                                                                     |
| 2   | `archive-replay-local.test.ts` — serves only safe replay through a real local archive endpoint                                                                           | environment unavailable   | Explicit production-grant local gate passes; environment skip closed.                                                                                                                                                                                    |
| 3   | `completed-game-benchmark.test.ts` — reports reproducible compact-record measurements                                                                                    | intentionally unsupported | Measurement/benchmark gate explicitly outside this security-only round; no benchmark environment enabled.                                                                                                                                                |
| 4   | `completed-game-benchmark.test.ts` — profiles representative legal events and repeated local replay timings                                                              | intentionally unsupported | Measurement/benchmark gate explicitly outside this security-only round; no benchmark environment enabled.                                                                                                                                                |
| 5   | `full-super-parity.test.ts` — the bundled engine runs the full 160-sample schedule and matches the native reference exactly                                              | redundant coverage        | Optional full native-reference 160-sample parity is not enabled; shipped WASM calibration/browser own-rack analysis and Authur canonical artifact checks pass. Native/threaded rebuild remains baseline build-source debt.                               |
| 6   | `game-history-local.test.ts` — creates one History entry per seated user under concurrent terminal callbacks                                                             | intentionally unsupported | Enabled: FAIL through retired client creation/state/terminal contracts. Current equivalent cases pass in trusted Normal/Stage/browser/capacity/Storage gates. Legacy completion remains blocked; not every historical harness branch is claimed covered. |
| 7   | `live-creation-controls-local.test.ts` — rollout switches close Normal and Stage creation without charges or disabling existing projections                              | environment unavailable   | Explicit local gate passes with all creation closed and with Stage-only closed.                                                                                                                                                                          |
| 8   | `live-hidden-local.test.ts` — enforces every live access path and commits Replay only with successful persistence                                                        | environment unavailable   | Explicit production-grant local gate passes; environment skip closed.                                                                                                                                                                                    |
| 9   | `live-release-recovery-local.test.ts` — recovers initialization failure, crash, expired lease and lost acknowledgement without a browser or charge                       | environment unavailable   | Explicit local gate passes (4 cases across these 3 files); environment skip closed.                                                                                                                                                                      |
| 10  | `live-release-recovery-local.test.ts` — queues a bot turn atomically with its stored revision even when Edge never enqueues, and retries transient failures              | environment unavailable   | Explicit local gate passes (4 cases across these 3 files); environment skip closed.                                                                                                                                                                      |
| 11  | `live-stage-progression-local.test.ts` — plays a repository Stage candidate to a natural win with trusted Authur, persisted progression and two-sided Replay             | environment unavailable   | Explicit local gate passes (4 cases across these 3 files); environment skip closed.                                                                                                                                                                      |
| 12  | `live-storage-capacity-local.test.ts` — authoritative private completion keeps History/Recent/Replay available when Free/Plus/Pro Saved is full                          | environment unavailable   | Explicit local gate passes (4 cases across these 3 files); environment skip closed.                                                                                                                                                                      |
| 13  | `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority previews the database's stakes, win, draw and loss, with a basis                                 | environment unavailable   | Explicit local DB gate: all 13 pass; environment skip closed.                                                                                                                                                                                            |
| 14  | `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority joins with a fresh basis, and the draw stake is what a draw applies                              | environment unavailable   | Explicit local DB gate: all 13 pass; environment skip closed.                                                                                                                                                                                            |
| 15  | `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority refuses a join without a basis, and never claims on its own                                      | environment unavailable   | Explicit local DB gate: all 13 pass; environment skip closed.                                                                                                                                                                                            |
| 16  | `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority refuses stale stakes with ranked_stakes_changed and the new preview, and claims nothing          | environment unavailable   | Explicit local DB gate: all 13 pass; environment skip closed.                                                                                                                                                                                            |
| 17  | `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority refuses a claimant already in a Ranked match                                                     | environment unavailable   | Explicit local DB gate: all 13 pass; environment skip closed.                                                                                                                                                                                            |
| 18  | `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority keeps a busy creator's room, refuses it from a stale list, and opens it again once they are free | environment unavailable   | Explicit local DB gate: all 13 pass; environment skip closed.                                                                                                                                                                                            |
| 19  | `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority tells the claimant it is their own board limit                                                   | environment unavailable   | Explicit local DB gate: all 13 pass; environment skip closed.                                                                                                                                                                                            |
| 20  | `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority refuses a room already taken, your own room, an expired room and a missing one                   | environment unavailable   | Explicit local DB gate: all 13 pass; environment skip closed.                                                                                                                                                                                            |
| 21  | `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority keeps the approval gate and refuses unauthenticated requests                                     | environment unavailable   | Explicit local DB gate: all 13 pass; environment skip closed.                                                                                                                                                                                            |
| 22  | `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority never lets the body name the viewer                                                              | environment unavailable   | Explicit local DB gate: all 13 pass; environment skip closed.                                                                                                                                                                                            |
| 23  | `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority resumes a match you already hold, and plays it to the end                                        | environment unavailable   | Explicit local DB gate: all 13 pass; environment skip closed.                                                                                                                                                                                            |
| 24  | `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority lets a player with several legacy matches finish them, but not acquire another                   | environment unavailable   | Explicit local DB gate: all 13 pass; environment skip closed.                                                                                                                                                                                            |
| 25  | `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority carries each database refusal code through Edge and client unchanged                             | environment unavailable   | Explicit local DB gate: all 13 pass; environment skip closed.                                                                                                                                                                                            |
| 26  | `recent-games-local.test.ts` — concurrent retention converges per participant and opens only a safe retained replay                                                      | environment unavailable   | Explicit production-grant local gate passes; environment skip closed.                                                                                                                                                                                    |
| 27  | `recent-storage-benchmark.test.ts` — measures shared Compact retention and safe replay response                                                                          | intentionally unsupported | Measurement/benchmark gate explicitly outside this security-only round; no benchmark environment enabled.                                                                                                                                                |
| 28  | `saved-full-finish-local.test.ts` — Free, Plus and Pro full accounts finish without a new Saved item                                                                     | intentionally unsupported | Enabled: FAIL through retired client creation/state/terminal contracts. Current equivalent cases pass in trusted Normal/Stage/browser/capacity/Storage gates. Legacy completion remains blocked; not every historical harness branch is claimed covered. |
| 29  | `saved-games-local.test.ts` — explicit Save survives Recent eviction and enforces concurrent capacity at the database                                                    | environment unavailable   | Explicit production-grant local gate passes; environment skip closed.                                                                                                                                                                                    |
| 30  | `saved-lifecycle-local.test.ts` — new private games finish with Compact Recent while Saved is full                                                                       | intentionally unsupported | Enabled: FAIL through retired client creation/state/terminal contracts. Current equivalent cases pass in trusted Normal/Stage/browser/capacity/Storage gates. Legacy completion remains blocked; not every historical harness branch is claimed covered. |
| 31  | `stage-terminal-local.test.ts` — captures a sealed Stage atomically, once, through the trusted endpoint                                                                  | intentionally unsupported | Enabled: FAIL through retired client creation/state/terminal contracts. Current equivalent cases pass in trusted Normal/Stage/browser/capacity/Storage gates. Legacy completion remains blocked; not every historical harness branch is claimed covered. |
| 32  | `storage-cost-corpus.test.ts` — measures finished bot, edit, and branch records                                                                                          | intentionally unsupported | Measurement/benchmark gate explicitly outside this security-only round; no benchmark environment enabled.                                                                                                                                                |
| 33  | `sync-performance-local.test.ts` — measures authenticated metadata, replay and Save paths at scale                                                                       | intentionally unsupported | Measurement/benchmark gate explicitly outside this security-only round; no benchmark environment enabled.                                                                                                                                                |
| 34  | `sync-performance-local.test.ts` — measures old-compatible and new terminal requests for the same legal traces                                                           | intentionally unsupported | Measurement/benchmark gate explicitly outside this security-only round; no benchmark environment enabled.                                                                                                                                                |
| 35  | `sync-performance-local.test.ts` — keeps create, several live commits, reload and the next commit operational                                                            | redundant coverage        | Old full-state operational fixture; new secure create/commit/reload/next-move/reconnect browser gate passes. The surrounding benchmark suite remains out of scope.                                                                                       |
| 36  | `terminal-routing-local.test.ts` — finishes through the real frontend when raw room purpose is denied                                                                    | intentionally unsupported | Enabled: FAIL through retired client creation/state/terminal contracts. Current equivalent cases pass in trusted Normal/Stage/browser/capacity/Storage gates. Legacy completion remains blocked; not every historical harness branch is claimed covered. |
| 37  | `terminal-routing-local.test.ts` — keeps completion/reconnect retries exactly once and exposes only owned safe replay                                                    | intentionally unsupported | Enabled: FAIL through retired client creation/state/terminal contracts. Current equivalent cases pass in trusted Normal/Stage/browser/capacity/Storage gates. Legacy completion remains blocked; not every historical harness branch is claimed covered. |
| 38  | `terminal-routing-local.test.ts` — routes a non-admin Stage and its lost-response retry without trusting the game name                                                   | intentionally unsupported | Enabled: FAIL through retired client creation/state/terminal contracts. Current equivalent cases pass in trusted Normal/Stage/browser/capacity/Storage gates. Legacy completion remains blocked; not every historical harness branch is claimed covered. |
| 39  | `terminal-routing-local.test.ts` — reveals no terminal route to spectators, pending users, anonymous clients or Ranked callers                                           | intentionally unsupported | Enabled: FAIL through retired client creation/state/terminal contracts. Current equivalent cases pass in trusted Normal/Stage/browser/capacity/Storage gates. Legacy completion remains blocked; not every historical harness branch is claimed covered. |

The nine failing opt-in historical integrations are not part of the default
pass count. Their failed activation log is retained as evidence. This table
classifies their retired protocol, without pretending that unfinished legacy
games or secure ArchBot/physical workflows have been fixed. The known full-suite
Makefile failure remains a failure. One additional Ranked UI selection race was
observed during a concurrent sweep; its initial-effect synchronization was fixed
without weakening the opponent hidden-rack assertion. The final rerun follows
that change; the earlier failed sweep remains retained.

## Appendix B — evidence and reproducibility

All paths below are local disposable evidence, not hosted production logs. Private
credentials, generated test sessions and secret env files are intentionally not
linked. Earlier failing harness executions are retained, not erased.

- [eq-release-full-verified.log](/private/tmp/eq-release-full-verified.log)
- [eq-release-browser-last.log](/private/tmp/eq-release-browser-last.log)
- [eq-release-recovery-stage-capacity-final.log](/private/tmp/eq-release-recovery-stage-capacity-final.log)
- [eq-release-live-storage-final.log](/private/tmp/eq-release-live-storage-final.log)
- [eq-release-ranked-db-final.log](/private/tmp/eq-release-ranked-db-final.log)
- [eq-release-creation-controls.log](/private/tmp/eq-release-creation-controls.log)
- [eq-release-stage-only-controls.log](/private/tmp/eq-release-stage-only-controls.log)
- [eq-release-archbot-parity-final.log](/private/tmp/eq-release-archbot-parity-final.log)
- [eq-release-archive-acl-sql.log](/private/tmp/eq-release-archive-acl-sql.log)
- [eq-release-ranked-private-sql.log](/private/tmp/eq-release-ranked-private-sql.log)
- [eq-release-plan-sql.log](/private/tmp/eq-release-plan-sql.log)
- [eq-release-baseline-bootstrap.log](/private/tmp/eq-release-baseline-bootstrap.log)
- [eq-release-candidate-migrations-bootstrap.log](/private/tmp/eq-release-candidate-migrations-bootstrap.log)
- [eq-release-legacy-before5.log](/private/tmp/eq-release-legacy-before5.log)
- [eq-release-legacy-after-final.log](/private/tmp/eq-release-legacy-after-final.log)
- [eq-release-worker-image-final2.log](/private/tmp/eq-release-worker-image-final2.log)
- [eq-release-container-health.log](/private/tmp/eq-release-container-health.log)
- [eq-release-lint-last.log](/private/tmp/eq-release-lint-last.log)
- [eq-release-format-final-final.log](/private/tmp/eq-release-format-final-final.log)
- [eq-release-build-last.log](/private/tmp/eq-release-build-last.log)
- [eq-release-ranked-ui-stable.log](/private/tmp/eq-release-ranked-ui-stable.log)
- [eq-live-blockers-engine-baseline.log](/private/tmp/eq-live-blockers-engine-baseline.log)

Explicit gate setup: disposable project `eq_live_hidden_security_20261001`,
API port 54521, DB port 54522; gateway verification enabled; exact source Edge
bundles; private server/worker secret wiring; Vite 4478 and Chromium. Integration
tests require the named local WORKDIR/status/env variables; none may target a
hosted database. Worker crash tests and Stage progression tests supervise their
own process, so run them with one test worker and no competing persistent bot
worker. Browser gates run against the built Compose container. The creation
control test runs in a separate disabled configuration, then creation switches
are restored only for the final disposable browser gate.

## Appendix C — complete candidate file manifest

- ` M` [.gitignore](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/.gitignore)
- ` M` [eslint.config.js](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/eslint.config.js)
- ` M` [package.json](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/package.json)
- ` M` [src/app/AppRoot.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/app/AppRoot.tsx)
- ` M` [src/app/NonPlayApplication.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/app/NonPlayApplication.tsx)
- ` M` [src/bot/authur/request.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/bot/authur/request.ts)
- ` M` [src/completedGame/adapters.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/completedGame/adapters.ts)
- ` M` [src/completedGame/archiveRead.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/completedGame/archiveRead.ts)
- ` M` [src/completedGame/projection.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/completedGame/projection.ts)
- ` M` [src/completedGame/stageTerminal.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/completedGame/stageTerminal.ts)
- ` M` [src/components/admin/SurvivalAdminPanel.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/components/admin/SurvivalAdminPanel.tsx)
- ` M` [src/components/pages/ArchiveReplayPage.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/components/pages/ArchiveReplayPage.tsx)
- ` M` [src/components/pages/lobby/CreateRoomPanel.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/components/pages/lobby/CreateRoomPanel.tsx)
- ` M` [src/components/pages/pregame/CreateRoomPage.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/components/pages/pregame/CreateRoomPage.tsx)
- ` M` [src/components/pages/ranked/RankedMatchPage.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/components/pages/ranked/RankedMatchPage.tsx)
- ` M` [src/features/ranked/publicView.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/features/ranked/publicView.ts)
- ` M` [src/features/ranked/rules.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/features/ranked/rules.ts)
- ` M` [src/features/survival/repository.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/features/survival/repository.ts)
- ` M` [src/remoteRooms.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/remoteRooms.ts)
- ` M` [supabase/config.toml](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/config.toml)
- ` M` [supabase/functions/archive-replay/index.js](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/archive-replay/index.js)
- ` M` [supabase/functions/archive-replay/index.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/archive-replay/index.ts)
- ` M` [supabase/functions/normal-terminal/index.js](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/normal-terminal/index.js)
- ` M` [supabase/functions/normal-terminal/index.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/normal-terminal/index.ts)
- ` M` [supabase/functions/ranked/index.js](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/ranked/index.js)
- ` M` [supabase/functions/stage-terminal/index.js](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/stage-terminal/index.js)
- ` M` [supabase/functions/stage-terminal/index.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/stage-terminal/index.ts)
- ` M` [tests/archive-route.test.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/archive-route.test.tsx)
- ` M` [tests/authur-request.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/authur-request.test.ts)
- ` M` [tests/completed-game-benchmark.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/completed-game-benchmark.test.ts)
- ` M` [tests/completed-game-blocker-closure.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/completed-game-blocker-closure.test.ts)
- ` M` [tests/completed-game-boundaries.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/completed-game-boundaries.test.ts)
- ` M` [tests/create-experience.test.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/create-experience.test.tsx)
- ` M` [tests/phase3-economy.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/phase3-economy.test.ts)
- ` M` [tests/ranked-play-ui.test.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/ranked-play-ui.test.tsx)
- ` M` [tests/remote-room-creation.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/remote-room-creation.test.ts)
- ` M` [tests/stage-repository.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/stage-repository.test.ts)
- ` M` [tests/stage-terminal-local.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/stage-terminal-local.test.ts)
- ` M` [tests/stage-terminal.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/stage-terminal.test.ts)
- ` M` [tests/terminal-routing-local.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/terminal-routing-local.test.ts)
- `??` [docs/live-hidden-information-security-review-2026-10-01.md](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/docs/live-hidden-information-security-review-2026-10-01.md)
- `??` [docs/live-security-blocker-review-2026-10-01.md](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/docs/live-security-blocker-review-2026-10-01.md)
- `??` [docs/live-security-release-readiness-2026-10-01.md](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/docs/live-security-release-readiness-2026-10-01.md)
- `??` [playwright.live-security.config.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/playwright.live-security.config.ts)
- `??` [services/trusted-bot/Dockerfile](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/services/trusted-bot/Dockerfile)
- `??` [services/trusted-bot/README.md](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/services/trusted-bot/README.md)
- `??` [services/trusted-bot/compose.yml](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/services/trusted-bot/compose.yml)
- `??` [services/trusted-bot/health.mjs](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/services/trusted-bot/health.mjs)
- `??` [services/trusted-bot/models/next-turn.json](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/services/trusted-bot/models/next-turn.json)
- `??` [services/trusted-bot/models/reply-opponent.json](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/services/trusted-bot/models/reply-opponent.json)
- `??` [services/trusted-bot/models/reply-self.json](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/services/trusted-bot/models/reply-self.json)
- `??` [services/trusted-bot/runtime.mjs](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/services/trusted-bot/runtime.mjs)
- `??` [services/trusted-bot/worker.mjs](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/services/trusted-bot/worker.mjs)
- `??` [src/features/survival/sealedStart.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/features/survival/sealedStart.ts)
- `??` [src/gameplay/publicTiles.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/gameplay/publicTiles.ts)
- `??` [src/liveGame/HostedControls.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/liveGame/HostedControls.tsx)
- `??` [src/liveGame/LivePage.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/liveGame/LivePage.tsx)
- `??` [src/liveGame/analysis.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/liveGame/analysis.ts)
- `??` [src/liveGame/botAction.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/liveGame/botAction.ts)
- `??` [src/liveGame/client.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/liveGame/client.ts)
- `??` [src/liveGame/hostedAdmin.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/liveGame/hostedAdmin.ts)
- `??` [src/liveGame/projection.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/src/liveGame/projection.ts)
- `??` [supabase/functions/live-game/handler.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/live-game/handler.ts)
- `??` [supabase/functions/live-game/index.js](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/live-game/index.js)
- `??` [supabase/functions/live-game/index.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/functions/live-game/index.ts)
- `??` [supabase/migrations/20261001103000_live_hidden_information_boundary.sql](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/migrations/20261001103000_live_hidden_information_boundary.sql)
- `??` [supabase/migrations/20261001103100_trusted_live_bot_jobs.sql](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/migrations/20261001103100_trusted_live_bot_jobs.sql)
- `??` [supabase/migrations/20261001103200_live_bot_recovery.sql](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/migrations/20261001103200_live_bot_recovery.sql)
- `??` [supabase/migrations/20261001103300_hosted_public_administration.sql](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/supabase/migrations/20261001103300_hosted_public_administration.sql)
- `??` [tests/live-creation-controls-local.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-creation-controls-local.test.ts)
- `??` [tests/live-hidden-boundary.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-hidden-boundary.test.ts)
- `??` [tests/live-hidden-information-repro.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-hidden-information-repro.test.ts)
- `??` [tests/live-hidden-local.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-hidden-local.test.ts)
- `??` [tests/live-hosted-administration.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-hosted-administration.test.ts)
- `??` [tests/live-offline-boundary.test.tsx](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-offline-boundary.test.tsx)
- `??` [tests/live-own-analysis.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-own-analysis.test.ts)
- `??` [tests/live-projection-client.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-projection-client.test.ts)
- `??` [tests/live-release-recovery-local.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-release-recovery-local.test.ts)
- `??` [tests/live-security-browser/economy.spec.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-security-browser/economy.spec.ts)
- `??` [tests/live-security-browser/fixtures.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-security-browser/fixtures.ts)
- `??` [tests/live-security-browser/release.spec.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-security-browser/release.spec.ts)
- `??` [tests/live-security-browser/security.spec.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-security-browser/security.spec.ts)
- `??` [tests/live-stage-progression-local.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-stage-progression-local.test.ts)
- `??` [tests/live-storage-capacity-local.test.ts](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tests/live-storage-capacity-local.test.ts)
- `??` [tools/live-security/README.md](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tools/live-security/README.md)
- `??` [tools/live-security/legacy-cutover.mjs](/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync/tools/live-security/legacy-cutover.mjs)

## Appendix D — workspace protection and stop state

The primary checkout retains its 89 changed tracked files and 284 untracked files.
Its final status listing matches the protection snapshot. The sibling engine
retains 22 tracked changes and 45 untracked files. All 12 registered worktrees
remain; no Storage/Authur/release worktree was removed or synchronized. Only the
dedicated security worktree was edited. Final remote main and candidate HEAD both
remain `34d5ae676fc460bfff02fe142b5d76354206b903`.

All 86 candidate files were scanned for private-key/JWT/service-key credential
patterns with no findings; generated sessions, env files, fixtures and execution
artifacts stay outside Git. This scan complements the source review and does not
turn missing product compatibility into release approval.

The supervised test worker container/network, disposable Edge server, and local
frontend were stopped. Supabase stopped only project
`eq_live_hidden_security_20261001`, with backup retained. Other local stacks were
not stopped. Evidence: [stack stop](/private/tmp/eq-release-stack-stop.log),
[container stop](/private/tmp/eq-release-container-stop.log), and
[final runtime byte comparison](/private/tmp/eq-release-container-code-sha256.txt).
No commit, merge, deployment, performance benchmark, or optimization followed.
