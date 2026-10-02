> Current milestone status and the locked client-side ArchBot practice decision
> are recorded in [live-security-milestone-s-2026-10-01.md](live-security-milestone-s-2026-10-01.md).
> That report supersedes older compatibility status and server-ArchBot requirements
> below. This document is retained as historical scope/evidence; the 58 classes
> and ordinary competitive secrecy contract remain the established basis.

NO-GO FOR SECURITY RELEASE

This report supersedes the earlier final-compatibility report's universal Host
rack prohibition and its Physical Hosted/Pass & Play/ArchBot creation findings.
The accepted 58-feature inventory remains closed scope. This is a local candidate,
not a deployment, merge, push or Live Sync performance change.

Workspace: `/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync`, branch
`codex/live-sync-optimization-phase1`. HEAD/base is
`34d5ae676fc460bfff02fe142b5d76354206b903`; origin/main was verified with read-only
remote metadata at that same SHA. All candidate changes remain uncommitted.
Protected primary/engine files and all existing worktrees remain retained.
The local database setup incident below is explicitly separate from that file/Git claim.

## 1. Closed 58-feature capability/disposition matrix

The architecture matrix was written before broad implementation:
`live-security-capability-architecture-2026-10-01.md`. Each feature has exactly
one primary class: A14, B9, C4, D25, E2, F1, G3 = 58. A core PASS does not waive
its explicitly named shared-tool dependencies. There is no UNKNOWN feature class.

| ID / feature                                                                   | Primary class | Final disposition and practical limit                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 create Direct/Normal/friend                                                | D             | Core PASS: trusted create and ordinary Direct/Normal/friend/private lifecycle. Direct negotiation remains F32–F34.                                                                                                                     |
| F02 public/region open-seat join                                               | A             | BLOCK / coverage gap: public/region waiting open-seat claim, outsider/region/code refusal and frozen-seat lifecycle are not fully gated. No playing-seat replacement is added.                                                         |
| F03 invite-only/private seats/code/link                                        | A             | Private participant/outsider isolation PASS. Region/private-parent/code/link combinations remain a named coverage gap with F02.                                                                                                        |
| F04 spectator load / owner / admin load                                        | B             | PASS: frozen seat projection; non-seated owner/admin/spectator gets no rack. Physical Host is the explicit current-rack exception.                                                                                                     |
| F05 Solo self-directed creation/start                                          | D             | Core PASS: one Ready seat, same-side pass, pause/resume/finish, reconnect and Replay. Named waiting/editing tools below remain blocked.                                                                                                |
| F06 Hosted Solo creation/start                                                 | D             | Core PASS: Hosted Solo lifecycle in DB/two browsers; automatic host has no player rack. F11–F13/F16/F35–F38/F44/F46 remain blocked.                                                                                                    |
| F07 Pass & Play automatic                                                      | E             | Core PASS: automatic local lifecycle, A/B rotating confirmation, repeat turns, completion and two-sided Replay. Shared editing/Return omissions are named below.                                                                       |
| F08 Pass & Play physical                                                       | E             | Core PASS: manual local lifecycle; only confirmed active side may refill; duplicate receipt and handoff after revision; completed Replay. Palette/draft parity F19–F22/F28 remains incomplete.                                         |
| F09 Hosted automatic creation/start                                            | D             | Core PASS: Hosted automatic maintains separate host; public administration and two-player terminal lifecycle. F11–F13 and editing tools below block full compatibility.                                                                |
| F10 Hosted physical/manual creation                                            | C             | Core PASS: physical create; host-only/Host+A/Host+B recording, exchange, correction, pause/resume, score, pass/turn advance, finish/Replay. Committed turn/board correction still depends on blocked F36/F42.                          |
| F11 waiting configuration/name/players/timers/start side                       | D             | BLOCK: no typed waiting configure command/UI. Name/players/timers/start-side reconfiguration and trusted redeal before Ready are not restored.                                                                                         |
| F12 Ready, Unready, leave waiting                                              | A             | Ready PASS. BLOCK: Unready and leave-waiting transition/UI are absent.                                                                                                                                                                 |
| F13 host start / launch countdown                                              | A             | BLOCK: last Ready immediately starts; explicit host launch/countdown baseline has not been restored or approved as a product change.                                                                                                   |
| F14 cancel waiting                                                             | A             | PASS: authenticated waiting cancellation; browser physical-create smoke cancels its waiting fixture. No active deletion.                                                                                                               |
| F15 delete playing/draft room                                                  | D             | PASS: active server-v1 deletion refused. Legacy abandon requires privately preserved quarantine; authoritative finish is retained.                                                                                                     |
| F16 rename live                                                                | A             | BLOCK: typed live rename absent; legacy full-state read/write rename cannot be restored.                                                                                                                                               |
| F17 duplicate/import live position helpers                                     | G             | RETIRED: arbitrary client position import/duplicate helpers have no active baseline UI caller. New live creation accepts settings only.                                                                                                |
| F18 export live canonical file                                                 | F             | POST-GAME ONLY: full live canonical export removed. Persisted completed full-fidelity Replay remains the allowed source; no Host bag export.                                                                                           |
| F19 select/reorder rack and empty-slot layout                                  | B             | PARTIAL/BLOCK: selection/staged empty slots work. Rack reorder and complete empty-slot layout parity are missing.                                                                                                                      |
| F20 select place / board cursor / keyboard / drag / move pending               | B             | PARTIAL/BLOCK: cursor/keyboard placement and pending move paths are present and tested. Full drag/drop and interaction parity is not proven/restored.                                                                                  |
| F21 blank/choice assignment, reassignment, swapping pending                    | B             | PARTIAL/BLOCK: validation, choice/blank and Backspace are tested; full reassignment/swap interaction parity is not gated.                                                                                                              |
| F22 cancel action / remove pending / undo last draft placement                 | B             | PARTIAL/BLOCK: cancel/Backspace/delete/per-placement undo callback exist. Complete return-slot/mobile/draft parity is not fully exercised; prior inventory statement that all per-placement undo is absent is superseded.              |
| F23 place equation / validate / score / natural endings                        | D             | PASS core: trusted place validation/scoring/conservation; legal physical equation and Stage natural ending exercised. No client score/state upload.                                                                                    |
| F24 select exchange, count, return delay, reserve, refill                      | D             | PASS core: exchange selection/reserve checks and delayed outgoing return. Physical exchange is refilled before handoff; codec conservation unit gate passes.                                                                           |
| F25 pass / turn handoff / solo repeat                                          | D             | PASS: Versus pass/turn handoff, Solo same-side repeat, local handoff and physical closing-refill turn advance.                                                                                                                         |
| F26 automatic initial/replacement draw                                         | D             | PASS: trusted automatic deal/replacement; no browser ordered queue or draw RNG.                                                                                                                                                        |
| F27 manual named draw from palette / typed rack                                | C             | PASS core: physical Host or confirmed local player records named tokens through unordered inventory selection. No bag/order response. UI uses typed tiles rather than the complete legacy palette.                                     |
| F28 return newly drawn tile / keyboard replace/delete                          | C             | PARTIAL/BLOCK: trusted current-tile return while opening refill or paused; paused return UI works. Complete keyboard/palette replace/delete parity is missing.                                                                         |
| F29 edit completed refill before action                                        | C             | PASS core: paused authorized current-rack correction conserves physical inventory; subsequent projection reflects the current rack. No other-seat historical rack grant.                                                               |
| F30 clock ticking, asymmetric/untimed/overtime/timeout                         | D             | PARTIAL/BLOCK: untimed/overtime clock policy and Ranked zero-time endings remain. Full asymmetric creation/live ticking and all timeout/seat combinations lack a complete release gate.                                                |
| F31 Hosted/Solo immediate pause                                                | A             | PASS: Hosted/automatic Solo immediate pause/resume and physical lifecycle. Local owner lifecycle executes privately; no Direct immediate-host privilege.                                                                               |
| F32 Direct request pause                                                       | A             | BLOCK: Direct pause-request typed command/UI absent.                                                                                                                                                                                   |
| F33 Direct accept/decline/block 5m/acknowledge                                 | A             | BLOCK: Direct accept, decline, five-minute block and acknowledgement typed commands/UI absent.                                                                                                                                         |
| F34 resume drafted game                                                        | A             | PARTIAL/BLOCK: Hosted/Solo/local owner resume works; Direct negotiation/resume remains absent with F32/F33.                                                                                                                            |
| F35 Save & Exit (non-email pauses), Coffee Break/Return                        | A             | BLOCK: Save & Exit pause-on-leave, Coffee Break and room-ID Return bookmark/UI are not restored. Ordinary reconnect by retained room ID works.                                                                                         |
| F36 undo committed state                                                       | D             | BLOCK: committed undo history-index restore absent. This is trusted owner control in applicable non-Direct modes, not a new Direct editing entitlement.                                                                                |
| F37 redo committed state                                                       | D             | BLOCK: committed redo and preserved redo cursor absent; no uploaded snapshot fallback.                                                                                                                                                 |
| F38 notes and stars                                                            | A             | BLOCK: bounded notes/stars command, projection fields and editing UI absent.                                                                                                                                                           |
| F39 score correction                                                           | A             | PASS core: authorized paused public-log score correction; ordinary player cannot call host administration. Physical full-game test verifies corrected completed score.                                                                 |
| F40 public-board correction/remove/move committed tile                         | D             | BLOCK by F36/F42: committed board correction is derived from history/branch restore. No separate arbitrary-board setter existed in baseline.                                                                                           |
| F41 arbitrary turn change                                                      | D             | PASS derived pass/refill advance; BLOCK by F36/F42 for committed turn correction. No invented arbitrary-turn setter.                                                                                                                   |
| F42 Continue from here / restore alternate line / follow parked twin           | D             | BLOCK: private reference-only alternate-line/Continue/restore/follow-twin command and safe public tree are not implemented.                                                                                                            |
| F43 prune alternate line / timeline conflict/retry                             | D             | BLOCK: reference-only alternate-line prune and transactional timeline conflict/retry are not implemented.                                                                                                                              |
| F44 turn log / live before-after Replay / practice drafts                      | B             | PARTIAL/BLOCK: public after-board and own historical log-rack viewing work; full before/after navigator and local practice drafts are missing. Opponent historical racks stay closed live.                                             |
| F45 own current-turn move aid / analysis levels                                | B             | PARTIAL/BLOCK: authorized own-current-turn analysis noninterference passes. Full catalog analysis-level parity and Host current-rack analysis support are not closed; unseated Host currently cannot use the own-seat analysis helper. |
| F46 own historical/replay analysis                                             | B             | BLOCK: own-history/replay analysis entry points are absent. Current Physical Host privilege cannot substitute for historical hidden-rack authorization.                                                                                |
| F47 bot insight/why/reasoning/progress                                         | G             | RETIRED: private live bot reasoning/why/candidates/proposals removed. Completed full Replay remains; private worker telemetry is not a browser insight feature.                                                                        |
| F48 wedged bot Retry / Take over / Return to bot                               | D             | PASS trusted retry/crash/lease/lost-ack recovery for Authur and ArchBot. RETIRED suboperation: human takeover/return-to-bot using the private bot rack.                                                                                |
| F49 Authur create / server think / bot action                                  | D             | Core PASS: exact pinned Strong trusted turns and recovery, economy/terminal/Replay. Authur-as-A plus human-as-B initial-start coverage remains a named seat gap.                                                                       |
| F50 ArchBot create / client think / bot action                                 | D             | Core PASS: exact Stage5B64 trusted adapter, real turn, crash/retry, persistence/Replay and container browser secrecy. Catalog remains free, normal purpose, distinct from Stage.                                                       |
| F51 Aether Easy/Medium/Hard/Max/Super legacy turns                             | G             | RETIRED: no new Aether legacy rooms; incompatible old games frozen and privately preserved. Baseline retirement predates this candidate.                                                                                               |
| F52 Stage create/sealed start/catalog/admin import/seal/approve                | D             | Local PASS: sealed approved Stage create/catalog/admin import/seal/approve path. PRE-DEPLOY: production approved level availability/config must be verified before enabling Stage.                                                     |
| F53 Stage action/natural win/progression/finish                                | D             | Core PASS: real trusted Stage turn, natural win, progression and full Replay. BLOCK: inherited F36–F38/F42–F44/F46 editing tools remain missing.                                                                                       |
| F54 Ranked list/create/stakes/join/Ready/cancel                                | D             | PASS: Ranked create/list/stakes/preview-basis join/Ready/cancel and real DB/browser authority. No new live editing permissions.                                                                                                        |
| F55 Ranked action/timeouts/rating/terminal/recovery                            | D             | PASS representative Ranked action/timeout/rating/terminal/multi-match DB gates and two browsers. Additional exhaustive timer/seat variants remain F30 coverage gap.                                                                    |
| F56 all-mode terminal capture/History/Recent/Saved/full Replay                 | D             | PASS tested mode cores: atomic capture plus History/Recent/Saved/full Replay; failed persistence rollback and Saved-full behavior. Material shared-tool gaps still block complete release compatibility.                               |
| F57 realtime/session/reconnect/reload/second tab/stale/duplicate/offline cache | A             | PASS: notification/refetch, stale revision, stable UUID/duplicate, reconnect/reload/tab, v5 boundary and legacy freeze. PRE/POST production installed-PWA upgrade smoke remains required.                                              |
| F58 local Study puzzle preview / Survival playtest                             | B             | BLOCK dev debt: Study puzzle preview and Survival playtest routes still enter archive rather than a development recipient DTO route. No legacy full-live App fallback is allowed.                                                      |

## 2. Final authorization architecture

Authenticate → caller-authorized metadata → stored owner/frozen seats/mode/protocol
capabilities → typed intent with revision/UUID → trusted private reducer → atomic
commit/terminal retention → explicit recipient projection. `capabilities.ts` is
shared by handler/projection. Browser role/side/Host claims do not grant permission.
The DB commit gate separately checks owner/seat/local claim/private worker lease.
Ranked retains its existing separate trusted authority. `configure` and
`editHistory` capability facts define the intended seam, but their missing typed
commands are not represented as implemented.

Physical Host is stored owner + Hosted + manual + normal + server-v1. Host role
adds to A/B seat grants. Automatic Host/admin does not gain private racks. DTOs
never spread canonical state, session, private timeline, bag order or predictive
RNG. Analysis uses a public room/revision decision seed, not the draw RNG.

## 3. Physical Hosted result

Creation succeeds. For all three Host combinations the local gate starts a game,
records both initial physical racks, records legal `1+2=3`, performs closing refill,
exchanges with delayed return, pauses, returns/corrects current tiles, corrects a
public score, resumes, records pass/turn advance and finishes through authoritative
retention. Full Replay opens only after that persistence. Browser controls work.
Shared committed undo/alternate-line board/turn correction remains F36/F42 and
therefore the entire editing-compatible physical product is not release-ready.
Physical inputs select available tokens internally without returning bag order.

## 4. Required Host authorization tests

| Contract                                                 | Evidence/result                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A only cannot read B; B only cannot read A               | PASS unit, real API and browser payload inspection                                        |
| Host only receives A+B current                           | PASS unit + full lifecycle + browser                                                      |
| A+Host receives A+B current                              | PASS same three layers                                                                    |
| B+Host receives A+B current                              | PASS same three layers                                                                    |
| Non-host cannot call/impersonate physical Host           | PASS forbidden command + request role/Host/side claims                                    |
| Request-supplied Host claims cannot confer projection    | PASS handler/API/browser                                                                  |
| Host does not receive ordered bag/future/RNG             | PASS allowlist, hidden-world noninterference, actual traffic/private-ID checks            |
| Host privilege does not extend to other historical racks | PASS log allowlist; separately seated Host keeps only its own historical rack entitlement |

## 5. Pass & Play result and same-device limit

Both automatic and manual local games preserve `local_versus`. Before confirmation
only the public view is returned. A service-only rotating token binds stored owner,
room, active side and revision. A new confirmation invalidates the old claim; any
revision clears it. Actions conceal the outgoing rack and clear transient draft,
selection/history/analysis before showing the handoff interstitial. Claims stay in
memory, never local/session storage. Stale in-flight reads are concealed by a local
epoch. Lost responses retain the same intent/token for exactly-once retry. Leaving
the view clears its in-memory claim. Another tab/reload needs confirmation.

Real automatic/manual turn loops, completion and two-sided Replay pass. Browser
A→conceal→B→conceal, reload/second-tab confirmation and owner/outsider denial pass.
The shared device cannot cryptographically isolate people with unrestricted
DevTools/device access; accumulated prior authorized views may be inspected there.
This does not change ordinary online seat isolation. Manual palette/draft tools
and shared Return/editing omissions remain named in the matrix.

## 6. ArchBot trusted runtime and infrastructure impact

The smallest adapter reuses the exact browser `decideArchBot`, deterministic shim,
pinned model loader and Stage5B64 `deepTop:64` budget behind the existing durable
private worker. It receives the bot's own rack/public board/counts; it does not
receive the actual opponent rack, draw order or draw seed. Edge re-reads stored
revision/engine and validates the chosen move. One disposable child per turn
recycles search memory and reloads the pinned model; no weaker fallback is used.
The model is 4,005,988 bytes with the unchanged pinned metadata/weights digests.
The Docker image includes it and uses the pinned Node22 base. Image ID is
`sha256:e987668bd1ea3a6bf2553e6f6002a014d6fdd4c316243cdebba85e833d36f407`,
165,279,992 bytes (~157.6 MiB); this is a locally tested image, not a pushed registry release.

Evidence: 101 full-strength parity/determinism cases; exact adapter chosen-move
comparison on three legal positions; actual trusted turn then human resignation plus terminal
History/Recent/Replay; real crash/expired-lease/lost-ack recovery; healthy container
and an adversarial human browser against that container. ArchBot stays normal
purpose `stage5b_standard`, not Stage. Existing catalog CLIENT metadata is retained
for economy compatibility; server-v1 dispatch, not that legacy metadata, determines
actual trusted execution. The catalog still says free; funding is inapplicable,
and repeated recovery does not create ProBot consumption.

Measured host Node26 adapter samples (not a worst-case capacity claim):

| Position             | Whole child wall ms | Decision ms | CPU ms (user+system) | Peak MiB |
| -------------------- | ------------------: | ----------: | -------------------: | -------: |
| Opening sample       |               116.4 |        22.7 |                172.9 |     89.8 |
| Legal 12-turn sample |               186.7 |        98.0 |                383.3 |    133.9 |
| Legal 30-turn sample |               690.6 |       566.0 |               1065.5 |    162.2 |

Two observed container turns used depth64, 566/7,208 legal candidates,
500/923 ms decision time, ~1.78/4.63 CPU seconds and ~106.5/154.6 MiB peak child RSS.
Candidate counts are private telemetry; candidate moves are not logged or returned
as browser insight. Queue/network/model/startup costs add to decision time. Samples
are not worst-case sizing evidence. Moving computation from the human browser to
a hosted worker adds backend CPU, memory, model reload and idle/supervision costs.
Provider dollar cost and high-branching headroom remain PRE-DEPLOY REQUIRED before
enabling ArchBot; do not infer a monthly price from these samples. This targeted
runtime/cost work is expressly requested, not Live Sync optimization.

## 7. Remaining editing/waiting/seat dispositions — finite blockers

| Exact IDs           | Still required                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| F02/F03/F30/F49     | Full public/region/open-seat/private-parent/code combinations; asymmetric timer/timeout matrix; Authur A + human B initial-start seat gate        |
| F11/F12/F13/F16     | Typed waiting reconfiguration/redeal; Unready/leave; explicit launch/countdown; live rename                                                       |
| F19/F20/F21/F22/F28 | Rack reorder/full empty-slot layout; complete drag/drop, blank/reassignment/swap, mobile return/undo and physical palette/keyboard parity         |
| F32/F33/F34         | Direct pause request, opposite-seat accept/decline, five-minute block, acknowledgement and resume                                                 |
| F35                 | Save & Exit pause, Coffee Break and room-ID Return UX                                                                                             |
| F36/F37/F38         | Trusted committed undo/redo with stable history cursor; bounded notes/stars commands and UI                                                       |
| F40/F41/F42/F43     | History-derived board/turn correction; reference-only Continue/alternate-line restore/follow twin/prune; safe tree and conflict/retry transaction |
| F44/F45/F46         | Full live before/after Replay/practice navigator, analysis levels, authorized Host current analysis and own-history analysis                      |
| F53/F58             | Stage inherits the specifically named editing gaps; development Study preview/Survival playtest need recipient DTO routes                         |

These supported behaviors are not silently retired. F36/F42 are baseline
non-Direct owner controls; no new Direct undo entitlement is invented. Full live
canonical export, private live bot insight, human private-bot takeover, arbitrary
unused client position import and old full-state offline/session fallback remain
explicitly retired; Aether new-room retirement predates this candidate.

## 8. Online adversarial secrecy result

Normal/public/private, Ranked, automatic Hosted, Solo, Authur/Stage and ArchBot
browser checks inspect actual responses, notifications, local/session storage,
IndexedDB writes and worker messages. Raw live state/canonical/session/timeline,
private Stage generation data, private bot endpoints and forged role attempts stay
closed. Ordinary players receive only own rack/history and legitimate public
played information. Host current-rack visibility is an intentional grant, not a
reported leak. Host traffic still contains no private bag IDs/order/future state.
Current suites find no unauthorized live hidden-state payload on exercised paths;
this is not a waiver of the named compatibility and coverage gaps.

## 9. Legacy cutover result

Fresh isolated canonical baseline → genuine old authenticated two-actor create/
commit/read fixture → all six candidate migrations → new JWT-enabled Edge.
Before/after evidence passes: full old state/revision remains preserved privately,
old read/write/snapshot/Ready/join paths are gated, reconnect returns only a safe
projection, next move is refused409, live full Replay is unavailable and no fake
History/completion is created. Quarantine is service-only, legacy quota/expiry
exclusions remain, active server-v1 cancellation cannot delete completed evidence.
Browser legacy v2/v3 writer-forgery/reconnect tests also pass. Users see freeze and
fresh-deal restart instructions. Already downloaded old data cannot be remotely
erased; the boundary prevents continued unsafe access/play and must never reopen.

## 10. Production-only fact classification

The earlier read-only production preflight found raw authenticated RPC/grants and
raw room Realtime publication still present, no live-game function/protocol schema,
and no LIVE_BOT_SECRET/creation-control secret names. Those are expected pre-cutover
facts, not current candidate ACL results. Production rows/history/config queries
were denied; a denied query means unavailable, not zero. Only remote main SHA was
reverified this round; production schema/functions/secrets were not mutated.

| Classification                | Exact required fact/action                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRE-DEPLOY REQUIRED           | Operator verifies approved sealed Stage availability/approval requirements; bot catalog/version/settings/free-vs-pro economy; existing legacy counts/size; private autosave/expiry/crons; supported seat/scope/timer facts; hosting capacity and ArchBot cost; tested credential/JWT mode. Finish all named code/tool blockers and review before release.  |
| PRE-DEPLOY REQUIRED — secrecy | Verify complete grant/RLS/function/publication inventory and compatible role derivation; freeze/publication cutover plan; PWA/cache/old clients; private model/worker credentials and no VITE secrets; tested backup, maintenance gates and compatible frontend. Any uncertainty capable of exposing hidden state blocks opening clients.                  |
| DEPLOY-TIME REQUIRED          | Migrations/order/hash, quarantine reconciliation and grants/RLS/publication must match candidate; live-game and terminal Edge versions/JWT gate; secret names/values wired privately; immutable verified worker image; health plus real legal commit, retry/lease and exactly-once charge; Stage sealed start check. Creation stays closed until verified. |
| POST-DEPLOY SMOKE             | Mandatory actual account/role/browser workflows listed below, installed PWA upgrade, production Stage attempt/terminal, History/Recent/Saved/Replay, timer/seat variants and worker restart/monitoring. Failures re-close creation; no raw-state rollback.                                                                                                 |

## 11. Stage disposition

Stage remains its own approved, sealed, seeded attempt family with existing
Strong bot, score floor, natural end and progression rules. Local approved fixture,
real bot move/natural win, progression and full persisted Replay pass. Production
availability is unverified and requires the operator before Stage enablement.
Inherited undo/redo, notes/stars, alternate lines, practice navigator and historical
analysis are exactly F36–F38/F42–F44/F46; Stage is not fully compatible until those
are restored. Development playtest route debt is F58. ArchBot is not substituted
for Stage and Stage approval/economy rules are unchanged.

## 12. Economy/authority result and local setup incident

Actual Free/Plus/Pro browser funding gate passes exactly-once/no-fallback/conflicts/
board limits and rollback; Saved-full retention passes at 100/1000/1000 capacity.
Ranked real authority gates pass13. Authur retains its allowance/credit policy.
ArchBot retains free policy and refuses inappropriate funding; its recovery test
expects zero consumption. Worker/private claims and publication ACL probes pass.
No production economy/config changes were made.

**Local setup incident:** during test reset preparation, the repository's
function-only config was copied over the isolated config. A migration command then
used default DB54322, reaching the pre-existing local `EQ-Lab-phase1` test database.
It applied outstanding migrations beginning at 20260930100000 through all six
candidate security migrations (not merely the sixth). Two current room rows are
privately quarantined; comparison confirms their state/canonical remained equal
to preserved evidence. This was not authorized intentional work on that stack.
A private post-incident database backup is retained outside Git. It is not a
pre-incident recovery snapshot. No guessed schema rollback or reset was attempted.
The affected database stays migrated and may require operator recovery before an
older local application uses it. Its containers were not stopped/deleted.
Production was not involved. Primary/engine checkout files and worktrees were not
modified. The correct isolated config was restored from its existing bootstrap,
then all six migrations were applied successfully to DB54522. The new
`assert-local-stack.mjs` guard checks configured/running identity and ports before
future disposable setup. This incident is an additional reason to stop at NO-GO.

## 13. Storage and full completed Replay

Real terminal capture/failed persistence rollback, private/public retention,
per-participant History, Recent, explicit Saved lifecycle/capacity and authorized
archive endpoints pass. Physical Host role combinations, automatic/manual local,
Solo, normal/Hosted, Authur, ArchBot, Stage and Ranked exercise representative
completion/Replay. Both historical racks are retained privately and become
available only after authoritative completion with successful persistence.
Versus History has one row per participant; the physical test asserts that
per-participant identity, not a false global single-row expectation. Current
commands retain full canonical history inside the boundary, never truncate it to
solve live secrecy. Missing live history tools remain separately named blockers.

## 14. Final test counts and evidence

Final measured results follow the final run. Counts are per
suite/run and overlap; they are not summed into a unique coverage total.

| Gate                                                           | Pass / fail / skip         | Evidence under /private/tmp/                                                                     |
| -------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| Default final suite                                            | 1359 / 1 / 49              | eq-capability-release-final.json; sole failure is unchanged wasm-mt                              |
| Focused security/authorization/rules/adapter                   | 52 / 0 / 0                 | eq-capability-focused.json; these default cases also pass in the final suite                     |
| Creation/capability/client/adapter after automatic-default fix | 45 / 0 / 0                 | eq-capability-creation-focused.json                                                              |
| Real authority + lifecycle + Storage/capacity                  | 19 / 0 / 0                 | eq-capability-authority-final.json                                                               |
| Authur + ArchBot recovery and Stage natural progression        | 4 / 0 / 0                  | eq-capability-recovery-final.json                                                                |
| JWT/RLS/Realtime/terminal rollback + archive/Recent/Saved      | 4 / 0 / 0                  | eq-capability-boundary-storage.json                                                              |
| Real Ranked DB authority                                       | 13 / 0 / 0                 | eq-capability-ranked-db-final.json                                                               |
| Closed creation flags / Stage-only closed                      | 1 / 0 / 0 each             | eq-capability-creation-closed.json and creation-stage-only.json; same case in two configurations |
| Browser all existing + new physical/handoff gates              | 12 / 0 / 0                 | eq-capability-browser-all.log                                                                    |
| Additional ArchBot browser against pinned container            | 1 / 0 / 0                  | eq-capability-archbot-browser-container.log                                                      |
| Full-strength ArchBot parity/determinism                       | 101 / 0 / 0                | eq-capability-native-parity.log; run separately from timing-sensitive tests                      |
| Pinned adapter measured cost/chosen-move comparison            | 1 / 0 / 0                  | eq-capability-archbot-cost.log; repeated measurement, not extra unique coverage                  |
| Genuine pre-security cutover                                   | PASS                       | eq-capability-legacy-before.log / legacy-after.log                                               |
| SQL capability / archive / Ranked ACL + plan                   | 4 suites PASS              | eq-capability-acl.log / archive-acl.log / ranked-acl.log / plan-sql.log                          |
| Format, lint, typecheck, production build, worker image/health | PASS                       | final static logs and container image/health/runtime evidence                                    |
| Changed files + build credential scan; whitespace              | PASS; zero credential hits | eq-capability-secret-scan.json / diff-check.log                                                  |

All 49 default skips are individually accounted for. **41 release cases pass**
in separately enabled runs; **7 existing measurement/scale cases and 1 extended
160-sample Strong parity case remain opt-in**. No Live Sync benchmark was enabled.

| Default skipped case                                                                                                                                                     | Disposition / separate evidence                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `archbot-storage-local.test.ts` — finishes a production ArchBot room through server authority, Compact, History, Recent and safe Replay                                  | PASS separately: authority-final                                                                                              |
| `archive-replay-local.test.ts` — serves only safe replay through a real local archive endpoint                                                                           | PASS separately: boundary-storage                                                                                             |
| `completed-game-benchmark.test.ts` — reports reproducible compact-record measurements                                                                                    | Existing measurement/scale opt-in; not run during this security task. Corresponding basic lifecycle paths have release gates. |
| `completed-game-benchmark.test.ts` — profiles representative legal events and repeated local replay timings                                                              | Existing measurement/scale opt-in; not run during this security task. Corresponding basic lifecycle paths have release gates. |
| `full-super-parity.test.ts` — the bundled engine runs the full 160-sample schedule and matches the native reference exactly                                              | Existing extended 160-sample parity opt-in; pinned Strong runtime/real recovery exercised, no Strength change.                |
| `game-history-local.test.ts` — creates one History entry per seated user under concurrent authoritative terminal commands                                                | PASS separately: authority-final                                                                                              |
| `live-capabilities-local.test.ts` — Physical Hosted: host current racks, recording/correction/completion and full Replay                                                 | PASS separately: authority-final                                                                                              |
| `live-capabilities-local.test.ts` — Physical Hosted: A+host current racks, recording/correction/completion and full Replay                                               | PASS separately: authority-final                                                                                              |
| `live-capabilities-local.test.ts` — Physical Hosted: B+host current racks, recording/correction/completion and full Replay                                               | PASS separately: authority-final                                                                                              |
| `live-capabilities-local.test.ts` — Pass & Play play: rotating owner-only handoff, concealed turns and persisted full Replay                                             | PASS separately: authority-final                                                                                              |
| `live-capabilities-local.test.ts` — Pass & Play manual: rotating owner-only handoff, concealed turns and persisted full Replay                                           | PASS separately: authority-final                                                                                              |
| `live-compatibility-local.test.ts` — secure self-directed Solo starts from one Ready seat and preserves lifecycle/Replay                                                 | PASS separately: authority-final                                                                                              |
| `live-compatibility-local.test.ts` — secure Hosted Solo starts from one Ready seat and preserves lifecycle/Replay                                                        | PASS separately: authority-final                                                                                              |
| `live-compatibility-local.test.ts` — F10/F27: physical Hosted creation must support the required recording workflow                                                      | PASS separately: authority-final                                                                                              |
| `live-compatibility-local.test.ts` — F07: Pass & Play retains its mode identity and supports a second-player handoff                                                     | PASS separately: authority-final                                                                                              |
| `live-compatibility-local.test.ts` — legacy cutover preserves private evidence, gates old metadata writers, and protects active completion                               | PASS separately: authority-final                                                                                              |
| `live-creation-controls-local.test.ts` — rollout switches close Normal and Stage creation without charges or disabling existing projections                              | PASS separately: creation-stage-only                                                                                          |
| `live-hidden-local.test.ts` — enforces every live access path and commits Replay only with successful persistence                                                        | PASS separately: boundary-storage                                                                                             |
| `live-release-recovery-local.test.ts` — authur recovers initialization failure, crash, expired lease and lost acknowledgement without a browser or extra charge          | PASS separately: recovery-final                                                                                               |
| `live-release-recovery-local.test.ts` — stage5b recovers initialization failure, crash, expired lease and lost acknowledgement without a browser or extra charge         | PASS separately: recovery-final                                                                                               |
| `live-release-recovery-local.test.ts` — queues a bot turn atomically with its stored revision even when Edge never enqueues, and retries transient failures              | PASS separately: recovery-final                                                                                               |
| `live-stage-progression-local.test.ts` — plays a repository Stage candidate to a natural win with trusted Authur, persisted progression and two-sided Replay             | PASS separately: recovery-final                                                                                               |
| `live-storage-capacity-local.test.ts` — authoritative private completion keeps History/Recent/Replay available when Free/Plus/Pro Saved is full                          | PASS separately: authority-final                                                                                              |
| `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority previews the database's stakes, win, draw and loss, with a basis                                 | PASS separately: ranked-db-final                                                                                              |
| `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority joins with a fresh basis, and the draw stake is what a draw applies                              | PASS separately: ranked-db-final                                                                                              |
| `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority refuses a join without a basis, and never claims on its own                                      | PASS separately: ranked-db-final                                                                                              |
| `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority refuses stale stakes with ranked_stakes_changed and the new preview, and claims nothing          | PASS separately: ranked-db-final                                                                                              |
| `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority refuses a claimant already in a Ranked match                                                     | PASS separately: ranked-db-final                                                                                              |
| `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority keeps a busy creator's room, refuses it from a stale list, and opens it again once they are free | PASS separately: ranked-db-final                                                                                              |
| `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority tells the claimant it is their own board limit                                                   | PASS separately: ranked-db-final                                                                                              |
| `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority refuses a room already taken, your own room, an expired room and a missing one                   | PASS separately: ranked-db-final                                                                                              |
| `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority keeps the approval gate and refuses unauthenticated requests                                     | PASS separately: ranked-db-final                                                                                              |
| `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority never lets the body name the viewer                                                              | PASS separately: ranked-db-final                                                                                              |
| `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority resumes a match you already hold, and plays it to the end                                        | PASS separately: ranked-db-final                                                                                              |
| `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority lets a player with several legacy matches finish them, but not acquire another                   | PASS separately: ranked-db-final                                                                                              |
| `ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority carries each database refusal code through Edge and client unchanged                             | PASS separately: ranked-db-final                                                                                              |
| `recent-games-local.test.ts` — concurrent retention converges per participant and opens only a safe retained replay                                                      | PASS separately: boundary-storage                                                                                             |
| `recent-storage-benchmark.test.ts` — measures shared Compact retention and safe replay response                                                                          | Existing measurement/scale opt-in; not run during this security task. Corresponding basic lifecycle paths have release gates. |
| `saved-games-local.test.ts` — explicit Save survives Recent eviction and enforces concurrent capacity at the database                                                    | PASS separately: boundary-storage                                                                                             |
| `saved-lifecycle-local.test.ts` — new private games finish with Compact Recent while Saved is full                                                                       | PASS separately: authority-final                                                                                              |
| `stage-terminal-local.test.ts` — captures a sealed Stage atomically, once, through server-authoritative live commands                                                    | PASS separately: authority-final                                                                                              |
| `storage-cost-corpus.test.ts` — measures finished bot, edit, and branch records                                                                                          | Existing measurement/scale opt-in; not run during this security task. Corresponding basic lifecycle paths have release gates. |
| `sync-performance-local.test.ts` — measures authenticated metadata, replay and Save paths at scale                                                                       | Existing measurement/scale opt-in; not run during this security task. Corresponding basic lifecycle paths have release gates. |
| `sync-performance-local.test.ts` — measures old-compatible and new terminal requests for the same legal traces                                                           | Existing measurement/scale opt-in; not run during this security task. Corresponding basic lifecycle paths have release gates. |
| `sync-performance-local.test.ts` — keeps create, several live commits, reload and the next commit operational                                                            | Existing measurement/scale opt-in; not run during this security task. Corresponding basic lifecycle paths have release gates. |
| `terminal-routing-local.test.ts` — finishes through the real frontend when raw room purpose is denied                                                                    | PASS separately: authority-final                                                                                              |
| `terminal-routing-local.test.ts` — keeps completion/reconnect retries exactly once and exposes only owned safe Replay                                                    | PASS separately: authority-final                                                                                              |
| `terminal-routing-local.test.ts` — routes a non-admin Stage and its lost-response retry without trusting the game name                                                   | PASS separately: authority-final                                                                                              |
| `terminal-routing-local.test.ts` — reveals no terminal route to spectators, pending users, anonymous clients or Ranked callers                                           | PASS separately: authority-final                                                                                              |

Earlier harness failures are retained in outside-Git logs: body-size inequality
was intentionally retired as an inappropriate performance gate; a physical History
assertion was corrected to per-participant identity; ambiguous physical select
label was fixed; ArchBot free funding fixture was corrected. Overlapping full CPU
parity/browser/default runs caused timing-sensitive failures, and one authority
batch lost its worker during harness switching. Those gates were rerun with the
correct supervision/scheduling. Passing results do not reclassify any missing
editing feature as implemented. No insecurity assertion was weakened to accept
ordinary opponent racks or raw state. The old physical-create refusal browser
assertion now expects required success, with dedicated privilege/secrecy tests.

## 15. Known baseline debt

Only the independently reproduced `engine-in-browser.test.ts` missing `wasm-mt`
Makefile target is an allowed unchanged baseline failure. The independent exact
base archive previously reproduced 13pass/1fail. Engine source/Makefile was not
changed here. Supported waiting/editing/mode gaps in section7 are candidate
release blockers, not baseline waivers. F58 is concrete development route debt.

## 16. Commit status

No candidate commit; exact candidate SHA does not exist. Dedicated branch HEAD
remains the canonical base SHA stated above. All requested candidate work is
reviewable but uncommitted. No push, merge, production deployment or Live Sync
performance work. Final protected checkout verification matches the earlier
baseline: primary HEAD55352e2 with 89 tracked changes/284 untracked files;
engine HEADb53749e with 22/45. All 12 existing EQ-Log worktrees remain. The test
worker/container, Edge, frontend and explicitly isolated Supabase stack are
stopped after retaining a private full test database dump. The unrelated archive
and EQ-Lab-phase1 containers remain running; the DB54322 incident state is not
silently rolled back. GO's full-diff-review/commit gate is not reached. Whitespace,
static checks, built assets and changed source are scanned for actual local
service/worker credentials without printing credential values.

## 17. Exact production rollout order — proposed only, blocked by NO-GO

1. Finish every named blocker, final tests/diff/secret review and record the
   approved candidate Git SHA, Edge hashes and immutable worker image digest.
2. Operator completes PRE-DEPLOY facts/backup/restore plan; close creation and
   bot dispatch at maintenance/traffic boundary. Keep existing private records.
3. Apply in order, with no gap that reopens old public raw state:
   `20261001103000_live_hidden_information_boundary.sql` →
   `20261001103100_trusted_live_bot_jobs.sql` →
   `20261001103200_live_bot_recovery.sql` →
   `20261001103300_hosted_public_administration.sql` →
   `20261001103400_live_legacy_cutover.sql` →
   `20261001103500_live_capabilities.sql`.
4. Verify raw column/RPC/publication revocation, service-only claims/jobs,
   quarantined legacy evidence and revision/metadata gates before permitting any
   frontend or worker traffic. Stop on a partial migration.
5. Install compatible JWT-enabled live-game, ranked and terminal/archive/read/
   save/migration Edge bundles as required by the complete candidate. Wire
   LIVE_BOT_SECRET and both creation flags privately; flags remain closed.
6. Start verified private Authur/ArchBot worker image with service JWT + matching
   secret, no public ports/credentials, durable DB outbox and supervision. Verify
   health AND a real revision-correct legal commit, recovery and no extra charge.
7. Publish compatible frontend and v5 service worker; verify legacy freeze/restart,
   installed PWA upgrade and absence of full-state session/cache fallback.
8. Run controlled production capability/Storage/economy/Stage smoke accounts with
   creation closed to general users; operator verifies Stage sealed availability.
9. Open supported creation gradually only after all required gates pass; Stage
   remains separately closed if its preflight/smoke is incomplete. Monitor job age,
   failed leases, CAS/terminal rollback and economy. Do not start Live Sync work.

## 18. Rollback constraints

Close creation, pause worker dispatch and preserve private room/quarantine/outbox
and completed evidence. Keep restrictive grants, protocol and publication changes.
Rollback only to a compatible recipient-projection frontend/Edge/worker revision.
Never restore full-state browser readers/writers, old caches or unsafe old live
continuation. Freeze/restart incompatible legacy games; do not fabricate finish.
App/Edge/SQL/worker rollout is not a distributed transaction: stop on partial
application and preserve evidence. Restoring a pre-cutover DB can lose later
turns/results and requires a separately validated operator recovery plan. The
local DB54322 incident has no automatic rollback action in this candidate.

## 19. Mandatory production smoke plan

- Actual A-only/B-only/Host-only/A+Host/B+Host and non-host/spectator/admin/forged
  Host browsers; inspect responses, notifications, storage/worker traffic.
  Physical Host gets both current racks; everyone stays denied bag/future/RNG.
- Normal friend/private/public/region/code/open-seat/invite workflows, waiting
  configure/Ready/Unready/launch/cancel, asymmetric clocks and seat variants.
- Automatic Hosted and full physical creation/intake/return/correction/equation/
  exchange/pass/score/turn correction/pause/resume/finish and two-sided Replay.
- Automatic/manual Pass & Play A→conceal→handoff→B repeatedly; reload/tab/stale
  token/duplicate, transient clearing and full terminal Replay. State the same
  device trust limitation without weakening online isolation.
- Authur A/B seat variants and ArchBot real full-strength turns; private endpoint
  denial, worker initialization/crash/restart/expired lease/lost ack and no extra
  charge. Observe actual high-branching memory/time and queue supervision.
- Approved sealed production Stage create/natural end/progression/Replay plus
  restored inherited tools. Never substitute unapproved/no-level assumptions.
- Ranked preview-basis stale/refusal, multiple legacy matches, place/exchange/pass,
  timeout/rating/terminal; no new analysis/undo/pause permission.
- Every section7 waiting/editing/draft/Direct/Coffee/Return/annotation/history/
  alternate-line/Replay/practice/own-analysis item after restoration; verify no
  opponent historical rack appears in a live DTO, including for unseated Host.
- Atomic terminal success AND deliberate persistence failure rollback; per-user
  History/Recent/explicit Saved, Free/Plus/Pro full Saved capacity, eligible scope
  and complete authorized historical Replay only after retention.
- Genuine legacy v2/v3 and installed old-PWA reconnect/read/write attempts:
  frozen/private/no fabricated result and clear fresh-deal restart. New protocol
  must remain secure when an old client or wrong role sends commands.
- Free/Plus/Pro production settings, exactly-once funding/no fallback/rollback,
  board limits, private autosave/expiry/crons and secrets/ACL/publication inventory.
  Fail any secrecy gate closed and retain evidence; no merge/deploy is performed
  by this report.
