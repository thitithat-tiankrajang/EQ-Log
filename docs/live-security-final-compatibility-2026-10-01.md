> Current milestone status and the locked client-side ArchBot practice decision
> are recorded in [live-security-milestone-s-2026-10-01.md](live-security-milestone-s-2026-10-01.md).
> That report supersedes older compatibility status and server-ArchBot requirements
> below. This document is retained as historical scope/evidence; the 58 classes
> and ordinary competitive secrecy contract remain the established basis.

> Superseded for revised Host authorization and current workflow results by
> [capability closure](live-security-capability-closure-2026-10-01.md).
> This earlier report is historical evidence, not the final verdict for the revised request.

NO-GO FOR SECURITY RELEASE

# Final compatibility closure — 2026-10-01

This is the current verdict. It supersedes the readiness/blocker reports' old
counts, abstract legacy-policy blocker, and Solo-start findings. Those reports
remain historical evidence. No deployment, merge, push, or performance work was
performed. The candidate remains uncommitted because required workflows fail.

Workspace: `/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync`.
Branch: `codex/live-sync-optimization-phase1`. Base and current HEAD:
`34d5ae676fc460bfff02fe142b5d76354206b903`. A final remote metadata check still
returns that exact SHA for main. There is **no candidate commit SHA**.

## Finite inventory and this round's closures

The accompanying [58-row source inventory](live-security-compatibility-inventory-2026-10-01.md)
is the exhaustive feature matrix, with entry points, reads, writes, hidden-state
requirements, security classification, criticality, and exact action required.
It was completed against canonical baseline source **before this round's code
mutation**. Enumeration included routes, old App callbacks/effects, creation and
waiting forms, room access, gameplay/domain reducers, tool catalogs, bots, Ranked,
Stage, all six baseline Edge functions, and SQL/RPC transports. Unused functions
were distinguished from actual UI paths. Its statuses now include closure results.

Closed this round:

- Automatic self-directed Solo and Hosted Solo start from their one Ready seat.
  Same-side pass, public owner pause/resume/finish, reconciliation, stale and
  duplicate commands, terminal persistence and full Replay pass real local DB
  and two-browser gates. An unseated Hosted Solo host receives no rack.
- Active authoritative games cannot be deleted through the old lobby cancel
  RPC. They must finish through trusted persistence. Waiting cancellation remains.
- Legacy cutover now has an implemented freeze/fresh-restart policy, service-only
  preservation, old join/Ready refusal, frozen-seat protection, and exclusion of
  frozen legacy sessions from playable-board quota. Old expiry cleanup skips them.
- The security shell cache version changes to v5; the new page explains frozen
  legacy games. Backend ACL/protocol gates protect against old writers independently
  of whether a browser has refreshed.
- Nine old integration cases have deliberate secure replacement/retirement.
  ArchBot remains a failing required-behavior test, rather than an obsolete raw-RPC
  failure. Physical Hosted and Pass & Play now also have required-behavior failures.
- Production schema, existing Edge metadata, secret **names**, raw function grants
  and explicit Realtime publication were inspected read-only. Row configuration
  reads denied by the production read-only role remain unknown.

The original Authur strength/model fingerprints, Stage approval rules, Ranked
rules, funding policy, and Saved capacities were not weakened to pass a gate.

## Remaining concrete release blockers

| Feature IDs                      | Exact path / missing behavior                                                                                                             | Reason release cannot proceed                                                                                                                                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F10/F27–F29, also F08            | Physical Hosted Versus, physical Hosted Solo, physical Pass & Play: creation, named draw intake, return/replace intake, refill correction | Required Hosted creation returns 400. There is no secure intake authority; downstream physical placement/exchange/pass, reconcile and completion cannot be exercised. True-bag palette or guessed-token validation leaks opponent inventory.                                   |
| F07                              | Automatic Pass & Play second-player handoff                                                                                               | Creation silently produces `online_versus` with only A; required `local_versus` assertion fails. No authenticated B handoff or previous-player access boundary exists.                                                                                                         |
| F50                              | ArchBot `stage5b_standard` secure create/turn/finish/Storage                                                                              | Baseline explicitly enables it; candidate returns 400. The pinned Stage5B64 trusted worker adapter and full live Storage lifecycle are absent. Engine parity is not that adapter.                                                                                              |
| F11                              | Waiting configuration: game name, players, clocks, start side                                                                             | New safe page has no typed configure command/UI; old full-state replacement is revoked.                                                                                                                                                                                        |
| F12                              | Unready and leaving a waiting room                                                                                                        | Ready works; the corresponding new UI/command behavior is absent. Must preserve start/seat concurrency rules.                                                                                                                                                                  |
| F13                              | Hosted launch and launch countdown                                                                                                        | Immediate Ready start replaces the baseline host-triggered launch/countdown. The explicit baseline behavior has not been secured or otherwise resolved.                                                                                                                        |
| F16                              | Lobby live rename                                                                                                                         | Existing rename reads the revoked full state and fails. Needs owner metadata command.                                                                                                                                                                                          |
| F19/F20/F21/F22                  | Own-rack reorder/holes; keyboard numbers/cursor/drag; pending placement swap/face assignment parity; per-placement undo                   | Click placement/clear and trusted validation exist, but these precise baseline input interactions have no complete secure UI parity gate; reorder and per-placement undo are absent.                                                                                           |
| F30                              | Normal/Hosted/Solo asymmetric clocks, overtime and timeout                                                                                | Server rules/default tests exist, but the current real browser gates mostly use untimed games. Exact asymmetric/timed lifecycle and terminal/reconnect gates are missing.                                                                                                      |
| F32/F33/F34                      | Direct pause request, accept, decline, block for five minutes, acknowledgement, resume                                                    | All named participant negotiation behaviors are absent from the typed transport/UI. Hosted/Solo immediate lifecycle controls do not replace them.                                                                                                                              |
| F35                              | Non-email Save & Exit pause; Coffee Break and Return bookmark                                                                             | Navigation no longer carries the baseline pause semantics or return UI. A room-ID-only bookmark is safe, but not implemented.                                                                                                                                                  |
| F36/F37                          | Committed undo and redo                                                                                                                   | No trusted history-reference command. Restoring a snapshot must account for tiles already revealed, not permit hidden-state redistribution or client uploads.                                                                                                                  |
| F38                              | Turn notes and stars                                                                                                                      | Safe log IDs exist, but annotation fields/commands/UI are absent.                                                                                                                                                                                                              |
| F42                              | Continue from here, restore alternate line, follow parked twin                                                                            | Full timeline reads/writes revoked; no trusted branch-reference operation and recipient projection. Applies to local/Hosted Versus and catalog-enabled bot rooms, including production Stage's inherited catalog.                                                              |
| F43                              | Prune alternate line, conflict/retry                                                                                                      | No trusted prune command or safe public line tree. Same catalog scope as F42.                                                                                                                                                                                                  |
| F44/F46                          | Live before/after Replay navigator, practice drafts, authorized own-history analysis                                                      | Public boards and own log rack fields are projected; the old full historical UI is not replaced by a usable recipient-safe navigator/practice/analysis flow. Full completed Replay does not close live tools.                                                                  |
| F02/F03                          | Public open-seat and region waiting-claim/code membership lifecycle                                                                       | Late vacancy claims now refused by SQL; the exact waiting claim, region outsider, private/code/link refusal, second-tab, stale and finish/Replay browser matrix is missing. Invited public/private two-seat gates do not prove these configurations.                           |
| F49                              | Authur with bot A / human B                                                                                                               | Real full-strength bot B executes and completes; the inverted-seat complete live gate has not been run. Authorization, turn/Ready and own-rack historical behavior must be proven for that exact configuration.                                                                |
| F52/F53 with F36–F38/F42–F44/F46 | Production sealed Stage's inherited owner/catalog editing tools                                                                           | Natural win/progression passes. Baseline production Stage uses generic App and `authur_strong` tools, unlike the fixed-tool development playtest. Missing undo/redo/notes/stars/branch/prune/live Replay/own-history controls cannot be excused as a Stage availability issue. |

No product waiver is inferred for these useful behaviors. The refusal tests prove
containment, not functional compatibility. The table is the finite remaining
closure list; further work must reference its feature IDs.

## Every editing/tool disposition

| Baseline operation                                                                | Candidate disposition                                                                                     | Security/product rationale                                                                                                                                                                                |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F18 full-live canonical file export, rack visibility option                       | **Retire while live**; no opponent/bag export or visibility override                                      | User's secrecy requirement authorizes removing those disclosures. Room link/public facts and authorized completed Replay remain; a clear user-visible live-export disposition is required before release. |
| F17 duplicate/import live helpers                                                 | Historical declaration-only helpers, no baseline UI caller found; do not restore arbitrary live snapshots | Not an active production UI blocker. Completed/local document import policy remains distinct; old files preserved.                                                                                        |
| F19 own rack reorder/holes                                                        | Secure local recipient UI replacement required                                                            | Own tiles alone suffice; no server rack/bag disclosure needed.                                                                                                                                            |
| F20/F21 draft click/drag/cursor/typing, pending tile moves/swaps, face assignment | Existing click/assignment/validator retained; full exact input parity incomplete                          | Local draft references own IDs/public positions. Server independently validates the final command.                                                                                                        |
| F22 clear and individual pending-placement undo                                   | Clear works; individual undo missing                                                                      | Return only caller's draft tile to its local slot; no committed hidden snapshot needed.                                                                                                                   |
| F27/F28/F29 manual draw/type/delete/replace/edit-refill                           | **Functional blocker**                                                                                    | Needs verified physical intake and scoped receipts; no true-bag palette or adaptive membership oracle.                                                                                                    |
| F31/F34 Hosted/Solo pause/resume                                                  | Implemented, DB/browser pass                                                                              | Stored owner, normal purpose, Hosted or Solo, no bot; public lifecycle only. Being owner of Direct/Stage/bot gives no host power.                                                                         |
| F32/F33/F34 Direct pause negotiation/resume                                       | Named commands/UI missing                                                                                 | Opposite seat and request identity/CAS/cooldown must be enforced.                                                                                                                                         |
| F35 Save & Exit/Coffee Break/Return                                               | Missing safe pause/bookmark replacement                                                                   | Navigation alone does not preserve original behavior.                                                                                                                                                     |
| F36/F37 committed undo/redo                                                       | Missing trusted history-reference replacement                                                             | Server keeps hidden history and disclosure constraints; browser never submits a replacement canonical snapshot.                                                                                           |
| F38 notes/stars                                                                   | Missing bounded public annotation replacement                                                             | Safe text/numeric metadata tied to a public log ID.                                                                                                                                                       |
| F39 score correction                                                              | New owner-only paused public score correction works                                                       | No baseline standalone UI caller of `updateLogScore` found; this added support is not evidence of some invented missing editor.                                                                           |
| F40/F41 committed-board correction/arbitrary turn setting                         | No standalone baseline board/turn setter existed                                                          | Baseline correction was undo/branch; turn change was pass/refill/undo/branch. Close F25/F29/F36/F42 instead of adding a guessed arbitrary setter. No during-play arbitrary timer setter found.            |
| F42/F43 alternate-line continue/restore/twin/prune/conflict/retry                 | Missing trusted branch commands/public tree                                                               | Catalog modes listed below; no old full timeline fallback.                                                                                                                                                |
| F44 Turn Log                                                                      | Redacted public actions/scores/boards and exchange counts work                                            | Own log rack fields may be shown; other-seat historical rack fields are omitted. Full live before/after navigator/practice remains missing.                                                               |
| F45 own current-turn analysis                                                     | Secure own observation; actual browser worker pass                                                        | Public board/counts plus own rack and anonymous unseen pool. Ranked analysis stays closed. Catalog-level and input parity must retain baseline policy.                                                    |
| F46 own historical analysis                                                       | Required safe UI replacement missing                                                                      | Own historical rack is lawful; no opponent historical view or full canonical engine-context RPC.                                                                                                          |
| F47 live bot insight/why/private candidates                                       | **Retire live private insight**; public bot status only                                                   | Private proposals explain/reveal the bot rack and future choice. Post-completion insight, if retained, needs its own authorized completed source. No strength downgrade.                                  |
| F48 human bot takeover/return-to-bot                                              | **Retire live human bot-rack takeover**                                                                   | Trusted retry/backoff/lease recovery replaces operational recovery. It must never reveal the bot rack for a human move.                                                                                   |
| F11–F16 waiting/config/launch/rename/delete                                       | Ready and waiting cancel work; active deletion blocked; listed controls missing                           | Active finish captures authoritative history. Frozen legacy abandon preserves evidence without a fabricated result.                                                                                       |
| F57 old full-state session broadcast/cache/offline fallback                       | **Retire**; online authority, invalidation/refetch                                                        | No new private state in browser storage. Historical local files preserved. Standalone offline physical/Pass & Play usefulness remains a documented regression, not a restored workflow.                   |
| F58 Study puzzle preview / Survival development playtest                          | Development route regression, separate debt                                                               | AppRoot intercepts those special IDs; restore separate recipient-safe dev routes. These are not proof of production sealed Stage failure.                                                                 |

Baseline tool keys are finite: `turn_log`, `replay`, `analysis`, `multiverse`,
`bot_insight`. Defaults: online Versus and Solo use the first three; local Versus,
Hosted Versus and ArchBot also use multiverse; Authur and each Aether mode use all
five. Production Stage inherits Authur's catalog through generic App. Development
Survival playtest fixes only Turn Log/Replay; Study preview fixes no tools.
Production catalog row overrides could not be read and remain a deploy-time check.
Security-driven retirement above does not require restoring unsafe behavior to
satisfy those catalog entries.

## Physical/manual authorization and actual result

The baseline host entered **actual rack tiles selected from the true bag palette**.
That is different from recording a public equation. Host role is never rack/bag
authority. Ordinary player authority covers their frozen seat's own action, not
the other player's rack. Public referee lifecycle/score capability is separate.

A safe physical replacement needs authority for an observed draw and correction,
player/referee confirmation of public placement, conservation/scoring/clock rules,
hidden exchange processing, and reference-only history correction. Accepting
guessed tokens and returning valid/invalid is an adaptive membership probe: even
generic errors can reveal what is left after the opponent's draw. Moving that
palette into Edge does not solve this issue. No such endpoint was introduced.

The required physical Hosted test expects create 200 and gets **400**. Therefore
initial/refill draw, typed/delete/return correction, host-recorded placement,
exchange/pass, revision reconciliation, duplicates, reconnect, physical finish
and two-sided full Replay are **blocked by this specific creation/intake path**.
Physical Hosted Solo and physical Pass & Play inherit that blocker. The browser
manual-refusal assertion passes only as a secrecy check; it is not a physical
workflow pass. Public automatic Hosted pause/score/resume/finish all pass.

## Per-mode lifecycle gate matrix

**P** = that actual runtime path passed (Edge/DB and/or browser as specified);
**S** = shared implementation evidence, insufficient to close this exact mode;
**B** = concrete broken path above; **G** = an explicitly missing required gate;
**F** = deliberately frozen pre-security session; **—** = not applicable.
P does not mean every creation form/input variant was visually exercised. Special
controls are enumerated by feature ID, never implied by one normal action.

| Mode/configuration               | Create                    | Join/identity                                 | Initial load                | Normal action                             | Specials                                                     | Realtime            | Reconnect              | Reload          | Second tab         | Stale/duplicate | Recovery                                     | Finish               | Completed Replay                   |
| -------------------------------- | ------------------------- | --------------------------------------------- | --------------------------- | ----------------------------------------- | ------------------------------------------------------------ | ------------------- | ---------------------- | --------------- | ------------------ | --------------- | -------------------------------------------- | -------------------- | ---------------------------------- |
| Normal public invited/friend     | P                         | P seats                                       | P                           | P pass/exchange                           | B F32–F34/F44/F46                                            | P                   | P                      | P               | P                  | P               | P lost response                              | P                    | P                                  |
| Normal private invited/friend    | P                         | P seats; outsider denied                      | P                           | P pass/exchange                           | B F32–F34/F44/F46                                            | P                   | P                      | P               | P                  | P               | P lost response                              | P                    | P                                  |
| Normal public open-seat          | S                         | G waiting claim/code; late claims SQL-blocked | S                           | S                                         | B Direct controls                                            | S                   | G exact scope          | G exact scope   | G exact scope      | S               | S                                            | S                    | S                                  |
| Normal region (invite/open/code) | S                         | G region/member/outsider/code gate            | S                           | S                                         | B Direct controls                                            | S                   | G region               | G region        | G region           | S               | S                                            | S                    | S                                  |
| Hosted Versus automatic          | P                         | P two seats + separate host                   | P                           | P pass                                    | P pause/score/resume; B F11–F13/F36–F38/F42–F46              | P                   | S host reconnect       | P host          | S                  | P stale         | S shared transport                           | P host finish        | P both seats                       |
| Hosted Versus physical           | B create400               | B intake path                                 | B                           | B                                         | B F27–F29                                                    | B                   | B                      | B               | B                  | B               | B                                            | B                    | B                                  |
| Hosted Solo automatic            | P                         | P one seat + separate host                    | P                           | P same-side pass                          | P pause/resume; B named waiting/editing tools                | P                   | P offline/online cycle | P               | P                  | P               | S shared transport                           | P host               | P one seat                         |
| Hosted Solo physical             | B create400               | B intake path                                 | B                           | B                                         | B F27–F29                                                    | B                   | B                      | B               | B                  | B               | B                                            | B                    | B                                  |
| Self-directed Solo automatic     | P                         | P owner/seat                                  | P                           | P same-side pass                          | P pause/resume; B named draft/exit/editing/live Replay tools | P                   | P offline/online cycle | P               | P                  | P               | S shared transport                           | P owner              | P                                  |
| Pass & Play automatic            | B wrong mode              | B B handoff                                   | B A-only waiting            | B                                         | B F07                                                        | B                   | B                      | B               | B                  | B               | B                                            | B                    | B                                  |
| Pass & Play physical             | B create400               | B intake/handoff                              | B                           | B                                         | B F08/F27–F29                                                | B                   | B                      | B               | B                  | B               | B                                            | B                    | B                                  |
| Authur Strong bot B              | P                         | P human/owner                                 | P                           | P legal human + actual bot                | B F36–F38/F42–F44/F46; F47/F48 retired                       | P                   | P                      | P               | P human            | P               | P crash/lease/retry/offline owner            | P                    | P                                  |
| Authur Strong bot A              | S                         | G inverted-seat gate                          | S                           | G bot-first/human-B lifecycle             | B same catalog tools                                         | S                   | G inverted seat        | G inverted seat | G inverted seat    | S               | S worker                                     | G inverted seat      | G inverted seat                    |
| ArchBot stage5b_standard         | B create400               | B                                             | B                           | B trusted engine absent                   | B F50/catalog tools                                          | B                   | B                      | B               | B                  | B               | B                                            | B                    | B                                  |
| Stage approved sealed Authur     | P local approved fixture  | P nonadmin owner; outsider denied             | P                           | P natural human win + actual Strong       | B inherited F36–F38/F42–F44/F46                              | P                   | S common transport     | P               | S common transport | P               | S worker mechanism                           | P natural and resign | P owner only                       |
| Ranked                           | P                         | P join/Ready/auth/limits                      | P                           | P pass/resign; place/exchange rule suites | P stakes/refusals; no pause/analysis/edit added              | P two clients       | S common page          | S common page   | S common page      | P               | P lost-response DB; exact browser recovery G | P rating/result      | P                                  |
| Aether Easy old session          | — retired new on baseline | F                                             | P safe/fail closed by codec | F                                         | F; insight/takeover retired                                  | S invalidation only | S frozen read          | S frozen read   | S frozen read      | F writes denied | F restart fresh                              | F no fake result     | only pre-existing completed source |
| Aether Medium old session        | —                         | F                                             | same frozen boundary        | F                                         | F                                                            | S                   | S                      | S               | S                  | F               | F                                            | F                    | same completed policy              |
| Aether Hard old session          | —                         | F                                             | same frozen boundary        | F                                         | F                                                            | S                   | S                      | S               | S                  | F               | F                                            | F                    | same completed policy              |
| Aether Max old session           | —                         | F                                             | same frozen boundary        | F                                         | F                                                            | S                   | S                      | S               | S                  | F               | F                                            | F                    | same completed policy              |
| Aether Super old session         | —                         | F                                             | same frozen boundary        | F                                         | F                                                            | S                   | S                      | S               | S                  | F               | F                                            | F                    | same completed policy              |

Scope/seat/timer-specific S/G cells are **not approved release gates**. Exact
missing runtime coverage is listed above: open-seat/region/code lifecycle;
Authur bot A; asymmetric/overtime/timeout; Hosted transport's independent
reconnect/second-tab/lost-response; Stage second-tab/worker recovery tied to its
attempt; Ranked reload/reconnect/second-tab/recovery browser lifecycle. Shared
tests reduce risk but do not justify an exhaustive per-mode pass claim.

## Per-mode live secrecy matrix

**Own** means a seated recipient's own rack only, never an unseated owner/host.
**Denied** concerns actual hidden contents, not public counts or deduction from
public play. Own historical log rack fields are lawful; other-seat history,
private timeline, ordered bag, true bag membership, future draws and RNG remain
server-only. **Refusal** is containment without a functional workflow.

| Mode/configuration            | Own rack                            | Opponent rack                   | Bag                              | Historical hidden state          | Future draws | Turn Log            | RNG/seed                              | Evidence limit                                              |
| ----------------------------- | ----------------------------------- | ------------------------------- | -------------------------------- | -------------------------------- | ------------ | ------------------- | ------------------------------------- | ----------------------------------------------------------- |
| Normal public invited/friend  | own                                 | denied                          | count only                       | own-log fields only              | denied       | public + self       | denied                                | actual two-client/browser and raw-access gate               |
| Normal private invited/friend | own                                 | denied                          | count only                       | own-log fields only              | denied       | public + self       | denied                                | participant reader; outsider404                             |
| Public open-seat              | own after frozen seat               | denied by shared allowlist      | count only                       | self only                        | denied       | redacted            | denied                                | exact waiting claim lifecycle G                             |
| Region invite/open/code       | same projection                     | denied                          | count only                       | self only                        | denied       | redacted            | denied                                | actual production region rows/membership gate G             |
| Hosted Versus automatic       | player own; host empty              | denied, including host/admin    | count only                       | player self; host no rack fields | denied       | public; player self | denied                                | three actual browsers                                       |
| Hosted Versus physical        | refusal                             | no payload                      | no palette                       | no payload                       | no payload   | unavailable         | no payload                            | no functional manual intake                                 |
| Hosted Solo automatic         | player own; host empty              | denied                          | count only                       | player self; host none           | denied       | public/self         | denied                                | actual two-browser lifecycle                                |
| Hosted Solo physical          | refusal                             | no payload                      | no palette                       | no payload                       | no payload   | unavailable         | no payload                            | no functional manual intake                                 |
| Self Solo automatic           | own only                            | no second seat or borrowed rack | count only                       | self log fields                  | denied       | public/self         | denied                                | actual two-browser/tab gate                                 |
| Pass & Play automatic         | A-only projection                   | no B handoff                    | shared count-only reader         | self only                        | denied       | redacted            | denied                                | wrong mode, functional fail                                 |
| Pass & Play physical          | refusal                             | no payload                      | no palette                       | no payload                       | no payload   | unavailable         | no payload                            | no functional handoff/intake                                |
| Authur Strong bot B           | human own                           | bot denied                      | count/anonymous unseen pool only | human self only                  | denied       | public/self         | denied                                | HTTP/Realtime/browser Storage/worker capture; actual Strong |
| Authur Strong bot A           | shared allowlist                    | denied                          | same boundary                    | human self only                  | denied       | same boundary       | denied                                | inverted-seat lifecycle G                                   |
| ArchBot                       | refusal                             | no payload                      | no payload                       | no payload                       | no payload   | unavailable         | no payload                            | no trusted live adapter                                     |
| Stage sealed Authur           | human own                           | bot denied                      | count only                       | human self only                  | denied       | public/self         | seed/start/winning Replay denied live | actual local fixture; production catalog unknown            |
| Ranked                        | human own                           | denied                          | count only                       | recipient allowlist              | denied       | redacted            | denied                                | actual two clients + DB/private-revision gates              |
| Aether Easy legacy            | frozen self projection if decodable | denied now                      | count only                       | self only                        | denied       | redacted            | denied                                | cannot retract pre-cutover downloads                        |
| Aether Medium legacy          | same frozen boundary                | denied now                      | count only                       | self only                        | denied       | redacted            | denied                                | no continuation                                             |
| Aether Hard legacy            | same frozen boundary                | denied now                      | count only                       | self only                        | denied       | redacted            | denied                                | no continuation                                             |
| Aether Max legacy             | same frozen boundary                | denied now                      | count only                       | self only                        | denied       | redacted            | denied                                | no continuation                                             |
| Aether Super legacy           | same frozen boundary                | denied now                      | count only                       | self only                        | denied       | redacted            | denied                                | no continuation                                             |

Adversarial gates inspect actual HTTP responses, Realtime frames, Turn Log fields,
local/session Storage, intercepted IndexedDB writes and Worker messages. Raw
state/canonical/session, event/timeline, seed/sealed Stage data and private bot
observation/callback access are denied to humans. Live aliases into archives are
blocked across object/plain JSON/c1/Compact forms. Spectators/pending/anonymous
callers cannot obtain a Normal terminal route or private completion. A failed or
held terminal transaction exposes neither full Replay nor a committed finish;
after successful persistence, authorized completed Replay legitimately contains
both racks. These are local adversarial results, not an assertion about the
unchanged production backend.

## Legacy cutover: exact operational decision

**Freeze every `legacy-client` room; restart a new game with a fresh deal. Do not
continue or migrate its hidden position. Preserve private evidence and do not
manufacture a result, History entry or completed Replay.** Existing authoritative
Ranked matches can continue through their existing trusted handler.

There are **16 pre-security room workflow families**, plus the separately secure
Ranked family. These are category definitions, not production row counts:

| #   | Family                                                 | Continue / migrate                        | Freeze / restart / preservation                                                              |
| --- | ------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Direct Normal/friend, public/region/private, automatic | no / no                                   | freeze; fresh automatic game; same membership policy                                         |
| 2   | Pass & Play automatic                                  | no / no                                   | freeze; safe replacement must exist before offering restart in this mode                     |
| 3   | Pass & Play physical                                   | no / no                                   | freeze; intake/handoff blocker prevents candidate restart                                    |
| 4   | Self Solo automatic                                    | no / no                                   | freeze; fresh automatic Solo now works                                                       |
| 5   | Hosted Versus automatic                                | no / no                                   | freeze; fresh automatic two-seat game                                                        |
| 6   | Hosted Versus physical                                 | no / no                                   | freeze; physical replacement blocker                                                         |
| 7   | Hosted Solo automatic                                  | no / no                                   | freeze; fresh single-seat game works                                                         |
| 8   | Hosted Solo physical                                   | no / no                                   | freeze; physical replacement blocker                                                         |
| 9   | Authur Strong, either bot seat                         | no / no                                   | freeze; fresh trusted bot game subject to seat gate                                          |
| 10  | ArchBot stage5b_standard                               | no / no                                   | freeze; trusted adapter blocker prevents candidate restart                                   |
| 11  | Aether Easy                                            | no / no                                   | frozen; already retired new creation on baseline                                             |
| 12  | Aether Medium                                          | no / no                                   | frozen; same retirement                                                                      |
| 13  | Aether Hard                                            | no / no                                   | frozen; same retirement                                                                      |
| 14  | Aether Max                                             | no / no                                   | frozen; same retirement                                                                      |
| 15  | Aether Super                                           | no / no                                   | frozen; same retirement                                                                      |
| 16  | Sealed Stage attempt                                   | no / no                                   | preserve attempt/evidence; no fabricated win/progression; fresh approved/sealed attempt only |
| 17  | Ranked authoritative match                             | yes through existing Ranked / unnecessary | preserve trusted revision/rating/settlement semantics; no insecure Normal path               |

Apply dimensions to each legacy family: waiting; playing; paused/draft;
expired; a finished raw live row without trusted capture. All remain frozen.
Existing completed Archives/Recent/Saved sources are a separate retention category:
continue validated authorized reads and preserve original provenance. A raw live
row marked finished is not permission to expose a full completed Replay. Decode
failure is an exception category: generic unavailable view, preserve privately,
restart; never loosen ACLs to inspect it in a browser.

Formats: raw GameState JSON, `c1:` JSON, compact face-only v1/v2, ordinal-preserving
v3, canonical/session and event/timeline documents. Genuine baseline v3 and v2/v3
browser fixtures pass cutover; v1 has codec coverage. Raw/c1 live-row decode is
not universally proven. Protocol detection, private copy and write refusal do
not depend on decoding these payloads.

103400 copies every existing `legacy-client` room, timeline and ordered events
into `private.live_legacy_quarantine`, with a digest, before voluntary abandonment.
Only service SELECT/INSERT is granted. No deletion cascade from a visible room.
The copy is taken after 103000's boundary changes (which sanitize public Stage
names); original gameplay state/revision is retained. No public retrieval endpoint
for the quarantine was introduced. Cleanup skips frozen legacy rows. Frozen rows
no longer consume playable-board quota. Owner-authorized legacy cancellation
requires its private preservation copy and does not create a false completion.
Production backup and category totals remain an operator precondition.

Funding/ledger history is retained without automatic refunds or reversal. Fresh
bot creation follows existing funding rules; no old request is replayed to consume
a second charge. The candidate makes no automatic compensation claim and does
not reinterpret a consumed paid session as a validated result. Any later credit
adjustment uses the established administrative economy, with a separate policy.

Actual fixture result: both original actors can load/reconnect safe projections;
old full reads/snapshot/writes revoked; next action409; live Replay404; private
state/revision unchanged; no fabricated History. New gate test verifies private
copy equality, legacy join/Ready refusal, old-helper ACLs, and active-delete refusal.
Owner-abandon UI/production operation still needs smoke; preservation is tested.

## Old client / version behavior

The operational protocol gate is the stored `legacy-client` / `server-v1`
discriminator, frozen authenticated seat identity, typed commands, UUID receipt
and revision CAS, and raw grants. **No new required request-version header/body
field was added.** A body claiming to be a newer client cannot restore raw access.
Revocation covers all existing overloads of snapshot/engine-context/event readers,
command/timeline/state/session writers, raw Normal/bot/Stage creators, finalizer
and raw Stage sealing. Trusted replacements and bot claim/observation/callback
remain service-only. 103400 also revokes auth access to renamed join/Ready/cancel
helpers and rejects old metadata writes into legacy rooms.

An old tab can retain previously downloaded secrets; neither cutover nor cache
cleanup can retract them. It cannot obtain new raw reads, continue those rooms,
or submit a finished client snapshot. Retired normal-terminal/stage-terminal
uploads return409. A current reader explains: legacy game is read-only, prior
record is privately preserved, no result/completed Replay, refresh and start fresh.
`eq-lab-shell-v5-security` deletes older `eq-lab-` caches on activation and uses
network-first navigation. Online refresh obtains the safe shell. Old local files
are not deleted; no remote live canonical fallback is loaded offline. The exact
installed **production PWA update/refresh smoke remains pending**, not inferred
from a record-format browser test.

## Worker recovery, economy and persistence

Real recovery tests pass initialization refusal before claim; kill after actual
lease claim; restart; expiry reclaim; stale lease refusal; real full-strength
Authur computation/commit; bounded retry/backoff; lost acknowledgement and
idempotent callback. Tests advance lease time only in the disposable DB rather
than change the production ten-minute lease. Atomic SQL outbox trigger queues a
revision-only job with its stored room revision, even when Edge never enqueues
or a browser never reads. Paused/stale/frozen/removed rooms do not replay jobs.
Recovery records one bot command and one funding consumption. Observation is
private, limited to the bot's own rack/public facts, not the human rack or true
ordered bag. No browser proposal, fallback bot or smaller search was used.

Local container is non-root/read-only, supervised, no published port, all
capabilities dropped, private tmpfs, health/heartbeat. Actual legal commits were
verified as well as health. Built image:
`sha256:1ddbc955ebdc6766bd970bafc9202ecfc6ec10cb823d7d9bee007c919b9c5a92`.
Production registry/supervisor/secret/key wiring is not verified. Canonical assets:

| Asset     | SHA-256                                                            |
| --------- | ------------------------------------------------------------------ |
| Strong    | `1bfe583051812453cd047894243ebe9b44ad0569ce977bcf28bd7ee2b533ee49` |
| next      | `e5af04452ede84e16aea6a52cdc582363b9b2efc90708966dcfc754b8c9be966` |
| replyopp  | `6f502bf133ee2769a966ddc1b0cb219a54c0f7ac622aaba44c6aed5ac9632f7f` |
| replyself | `b2ea60519c4566825250809a832557ac2e92f92256684b850e7219eec34b331a` |

Free/Plus/Pro exactly-once creation, funding conflicts/no fallback, charge rollback,
board limits, lowered limits while a game exists, waiting cancel and safe retries
pass real Edge/browser tests. Stage has zero bot charge. Ranked's thirteen DB
tests pass actual stake basis, refusal propagation, busy/legacy matches, auth,
approval, identity and completion. New Solo/legacy guard preserves those paths.

Supported Normal, Ranked, automatic Hosted, both automatic Solo variants, Authur
and Stage retain terminal state **before** revealing full completed Replay.
History per participant, immutable `server_reduced` Normal/Stage provenance,
Recent retention, explicit Save/trash/restore, capacity and ACL pass. Free100 and
Plus/Pro1000 full Saved accounts still finish and retain History/Recent/Replay
without a new Saved item. Terminal transaction failure rolls back; failed/held
capture does not expose secrets. Completed Replay has both `finalRacks.A/B` and
both racks in captured authoritative positions. Completed legacy imports retain
available history/provenance; no missing genesis is invented. Physical/PassPlay/
ArchBot completion is not proved by these shared retention successes.

## Production preflight matrix — read-only facts

Existing protected-checkout project metadata was read and copied to a private
isolated preflight directory. No primary file changed. CLI function/secrets
metadata and schema dump, plus read-only SQL with read-only transactions and
timeouts, were used. No production row, function, migration, secret or worker
was changed; no production gameplay/session impersonation was attempted.

| Requirement                     | VERIFIED NOW                                                                                                                                                                                                                                | REQUIRES DEPLOY-TIME VERIFICATION                                                                                                                               | REQUIRES POST-DEPLOY SMOKE                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Main revision                   | remote main equals stated34d5ae…; dedicated HEAD same                                                                                                                                                                                       | approved candidate SHA/artifact manifest after closure                                                                                                          | client asset version matches candidate                                                        |
| Baseline schema/migrations      | schema dump431,023 bytes,46 tables; raw functions present; `authority_protocol` absent                                                                                                                                                      | migration history query denied; validate canonical history/definitions, backup/restore, all prerequisites                                                       | five migrations installed and ACL/constraints correct                                         |
| New migrations                  | local first four previously bootstrapped; fifth applied this round; amended103300 Solo function reinstalled locally                                                                                                                         | **fresh canonical DB plus all five final migration files in order must be rerun**; final revised all-five fresh sequence not claimed tested                     | final source definitions/trigger/quarantine totals match                                      |
| Current RPC grants              | authenticated EXECUTE true for raw create_live_game/create_bot_game/create_stage_attempt/commit_live_game_command/get_live_game_snapshot/get_live_game_engine_context/get_game_terminal_route; anon false; terminal capture auth/anon false | all raw overloads and renamed helpers revoked; trusted wrappers service-only; safe metadata columns only                                                        | approved/player/admin/spectator/pending/anon adversarial reads/writes denied                  |
| Edge functions                  | Ranked ACTIVEv2; archive-replay, stage-terminal, save-completed-game, normal-terminal, migrate-saved-legacy ACTIVEv1; all JWT=true; **live-game absent**                                                                                    | exact bundles, gateway/JWKS/service JWT mode, repository verify_jwt config                                                                                      | lawful human read/action, forged actor refusal, retired upload409, callback401/valid receipt  |
| Secret names                    | SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY, DB_URL, JWKS, PUBLISHABLE_KEYS, SECRET_KEYS names exist; values neither reported nor used as proof                                                                                                | candidate `LIVE_BOT_SECRET` and both creation-control names absent in current list; set matching server-only secret and explicit closed flags                   | no service/bot secret in frontend/response/log; valid private callback works                  |
| Worker                          | pinned local image/runtime/health/actual moves/recovery pass                                                                                                                                                                                | production platform/image digest/supervision/network, `SUPABASE_URL`, gateway-valid service JWT, matching `LIVE_BOT_SECRET`, outbox monitoring; no public ports | real trusted bot turn, crash/restart/lease/ack, no duplicate command/charge                   |
| Existing room-code prerequisite | canonical SQL requires private room-code secret; local setup used repository example                                                                                                                                                        | validate production prerequisite without printing its value                                                                                                     | create/join/code works; no membership leak                                                    |
| Realtime                        | explicit publication currently has `members` and raw `room_live`                                                                                                                                                                            | remove private tables via103000; assert not FOR ALL TABLES; retain metadata-independent invalidation                                                            | actual browser frames contain only game ID/revision, no private row/command                   |
| Frontend/PWA                    | safe source/build and v5 shell implemented locally                                                                                                                                                                                          | coordinated HTML/assets/SW, public Supabase URL/key only, no legacy live App import/canonical cache                                                             | clean and old-installed clients, refresh/reload/tab/offline/reconnect/refusal                 |
| Stage                           | local approved sealed POC natural win/progression/full Replay pass; production survival_levels row read **permission denied**                                                                                                               | legitimately approved/sealed catalog count/config, seed/start ACL, existing approval rules/admin access; flag stays closed                                      | actual allowed level natural finish/progression/owner Replay before enable                    |
| Mode/tools catalog              | baseline defaults/source inventoried; production bot_catalog row read **permission denied**                                                                                                                                                 | active ArchBot/Authur/Aether and tool row settings; secure adapters match approved product surface                                                              | every supported mode/tool in finite inventory                                                 |
| Plan/limits/settings            | local plan/economy/capacity tests pass; production system_settings read **permission denied**                                                                                                                                               | actual board/storage/funding settings, existing paid ledger policy                                                                                              | Free/Plus/Pro and Stage exactly-once/no fallback/capacity                                     |
| Existing live sessions          | protocol/count/category row read **permission denied**                                                                                                                                                                                      | authorized operator counts all 17 families, status/format exceptions, backups; quarantine completeness/size and owner preservation                              | frozen notice/read, writer refusal, no false History, safe owner abandon/restart              |
| Cron/jobs                       | production cron schema read **permission denied**                                                                                                                                                                                           | existing expiry/cleanup schedules and privileges; frozen rows skipped; completed cleanup retention; worker continuously supervises outbox                       | expiry/cleanup cannot delete quarantine or completed retained payload; queue age/retry alerts |

Denied row reads mean **unknown**, never zero/absent. Production schemas and
function metadata describe the current vulnerable baseline, not candidate success.
No plugin installation or new production credential flow is required by this
report. Private connection/status/secret-response files remain outside Git and
are not deliverable artifacts.

## Stage disposition

Candidate seed 5117 is a repository POC with status `awaiting_admin_approval`.
Only the disposable local database seals/approves it using the actual repository
evidence; production approval was not invented or changed. A nonadmin human uses
lawful own-rack/public observation; canonical Strong bot runs privately. Natural
win persists one immutable authoritative Stage completion, owned-win progression,
History/full two-sided owner Replay; stranger404. Reseal during use is refused.
Typed concurrent resign capture and lost-response frontend retry also pass.

Stage availability in actual production is **unverified configuration**, not an
established empty catalog and not an algorithmic availability blocker proved by
local failure. Production approved/sealed play is a bounded **post-deploy,
pre-enable smoke**, only if `STAGE_CREATION_ENABLED=false` remains set. Immediate
Stage enablement requires that gate first. Stage's named inherited-tool regressions
above are independent **security-release compatibility blockers**.

When an actually approved playable level exists: inspect approved/sealed status
and legitimate rules through an authorized operator; use a nonadmin member to
create via trusted Stage Edge; verify no seed/sealed start/winning Replay in
browser; play actual human/Strong turns, reload/reconnect/second-tab/stale/duplicate;
reach natural terminal; verify one server-reduced result, owned progression,
zero charge, History and owner-only complete Replay; verify opponent/outsider/raw
reads denied. If operator confirms no approved levels, record that exact fact and
keep Stage creation disabled. Do not approve a dummy level, change thresholds,
or relabel old advisory results to pass a release.

## Nine retired client-write integration cases

The obsolete transport is retired, not the required product contract. Current
tests call the real authenticated authority, not raw canonical creation/upload.

| #   | Original test / exact behavior                                                    | Classification and deliberate change                                                                                                                                                                | Final enabled result                                           |
| --- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | archbot-storage-local: production ArchBot through Compact/History/Recent/Replay   | **STILL REQUIRED**; replaced transport with secure create, actual worker and authoritative finish expectations; no raw grant restored                                                               | **FAIL** create400; later worker/Storage assertions unexecuted |
| 2   | game-history-local: one entry per seated user under concurrent terminal callbacks | **REPLACED BY SERVER-AUTHORITY TEST**; real Ready and concurrent typed UUID resign, immutable provenance/Recent/Replay and outsider denial                                                          | PASS1                                                          |
| 3   | saved-full-finish-local: Free/Plus/Pro finish at full Saved without new Saved     | **REPLACED BY SERVER-AUTHORITY TEST**; old raw-writer file deliberately removed; live-storage-capacity-local checks all100/1000/1000 capacities, full retention and no unsolicited Save             | PASS1 replacement                                              |
| 4   | saved-lifecycle-local: private finish with Compact Recent while Saved full        | **REPLACED BY SERVER-AUTHORITY TEST** for live prefix; retained finished-legacy migration/classification/paging/overflow/cleanup/validation coverage                                                | PASS1                                                          |
| 5   | stage-terminal-local: sealed Stage atomic capture once                            | **REPLACED BY SERVER-AUTHORITY TEST**; actual approved/sealed repository fixture, nonadmin typed resign/concurrency, immutable result/full Replay, ACL for real overloads, retired endpoint refusal | PASS1; tighter real-overload ACL rerun PASS1 same case         |
| 6   | terminal-routing: real frontend with raw purpose denied                           | **REPLACED BY SERVER-AUTHORITY TEST**; actual liveGameClient/Supabase trusted finish                                                                                                                | PASS1                                                          |
| 7   | terminal-routing: exactly-once completion/reconnect and owned Replay              | **REPLACED BY SERVER-AUTHORITY TEST**; stale refusal, lost response/read recovery, exactly-one payload/History, actual Save/trash/restore/outsider denial                                           | PASS1                                                          |
| 8   | terminal-routing: nonadmin Stage/lost response without game-name trust            | **REPLACED BY SERVER-AUTHORITY TEST**; typed trusted Stage finish and immutable provenance                                                                                                          | PASS1                                                          |
| 9   | terminal-routing: no terminal route for spectator/pending/anon/Ranked             | **REPLACED BY SERVER-AUTHORITY TEST**; no mutation, raw path denial                                                                                                                                 | PASS1                                                          |

Retained files now contain **8 cases:7 pass/1 required ArchBot fail**. Deleted
Saved-full case has one separately passing replacement. Old raw terminal upload,
client-authoritative incomplete/advisory finish, and automatic live legacy save
assertions are **OBSOLETE BY SECURE ARCHITECTURE**; atomic trusted full capture
and frozen legacy policy replace them. Finished-legacy document handling remains
tested. No permanently misleading nine old ACL failures are carried as the new
architecture's expected suite outcome.

## Final gates and actual counts

These are separate executions; overlapping reruns are not added to one inflated
total. Opt-in results matter even though default Vitest skips them.

| Gate                                                                          | Pass / fail / skip                                                  | Evidence under `/private/tmp/`                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Full default Vitest,168 files (148pass/1fail/19skip)                          | **1,349 /1 baseline /43**                                           | eq-compat-full.log and .json                                                               |
| Current authority + mode compatibility,6 files13 tests                        | **10 /3 /0**                                                        | eq-compat-authority-final.log                                                              |
| Required physical Hosted / PassPlay / ArchBot within that run                 | **0 /3 /0**                                                         | create400 / wrong mode / create400                                                         |
| Chromium existing release gates                                               | **6 /0 /0**                                                         | eq-compat-browser.log                                                                      |
| Chromium self/Hosted Solo gates                                               | **2 /0 /0**                                                         | eq-compat-solo-browser.log                                                                 |
| Worker recovery2 + natural Stage1 + Saved-full capacity1                      | **4 /0 /0**                                                         | eq-compat-recovery-stage-storage.log                                                       |
| Actual JWT/RLS/Realtime/terminal rollback + Recent/Saved/archive              | **4 /0 /0**                                                         | eq-compat-boundary-storage.log                                                             |
| Actual Ranked Edge/DB                                                         | **13 /0 /0**                                                        | eq-compat-ranked-db.log                                                                    |
| Genuine canonical baseline create/commit cutover fixture                      | PASS probe, not a Vitest count                                      | eq-compat-genuine-legacy-final.log                                                         |
| Stage real-overload ACL tightening rerun                                      | **1 /0 /0**, overlaps authority run                                 | eq-compat-stage-acl-final.log                                                              |
| Archive ACL / Ranked private revisions / plan timeline SQL                    | **3 suites PASS**                                                   | eq-compat-archive-acl.log / ranked-acl.log / plan.log                                      |
| Typecheck / lint / standard+extra format / production build / diff whitespace | PASS                                                                | eq-compat-typecheck.log / lint-final.log / format.log / extra-format-final.log / build.log |
| Creation flags all closed, separately Stage-only closed                       | prior unchanged-code evidence: **1pass each**; not rerun this round | eq-release-creation-controls.log / stage-only-controls.log                                 |
| ArchBot native parity                                                         | prior **101pass**, not a secure-live test                           | eq-release-archbot-parity-final.log                                                        |

The 34 default-skipped release opt-ins exercised this round have **31pass/3fail**
across authority13, Ranked13, boundary4, recovery/Stage/capacity4. The remaining
default skip is creation controls with previous evidence, plus eight explicitly
opt-in performance/extended-native cases outside this security/performance scope.
All 43 default skips are listed individually below. Browser total is eight
distinct passes in two executions, not a claim of one all-eight run.

TypeScript bundle source, committed-to-be formatted bundle and locally served
bundle normalize to identical esbuild output:
`3f7552f3639892211dee7b64b440a73badac479d62c9eef9d7bee9c07bd58ceb`.
This proves formatting did not change tested live-game code; it is not a deployed
artifact SHA. The fifth migration applied successfully to the existing disposable
baseline/candidate stack; final fresh all-five order remains explicitly unrun.

## Known baseline and harness debt

The only default failure is engine-in-browser's “keeps a wasm build target that
deploys into the bundled source tree”: protected sibling Makefile lacks required
`wasm-mt:` target/recipe. Exact production archive in the same environment already
reproduces13pass/1fail (`eq-live-blockers-engine-baseline.log`). No assertion was
weakened and no sibling file changed. Shipped bundle/build/browser own-rack
analysis works; rebuilding native multithread WASM from that sibling is unverified.

Older Pro-Bot economy/active-board SQL harnesses still call retired raw creation
RPCs; prior failures are recorded, not rerun or fixed by reinstating grants. Real
current-authority economy/browser/board-limit tests pass. Optional generator
research lacked its ignored corpus in prior work; that research does not replace
sealed Stage evidence. F58's exact dev-route regression is candidate tooling debt.
No performance benchmark environment was enabled.

## Deployment sequence — proposal only, forbidden while NO-GO

1. Close every named compatibility/runtime gate above, review full diff, repeat
   final source gates and a **fresh canonical baseline + all five final migrations**,
   remove debug/generated private artifacts, scan secrets, then commit on the
   dedicated branch and record exact candidate/source/bundle/image hashes. No merge
   or deployment is authorized by this document.
2. Authorized production operator inventories the 16 legacy room families plus
   Ranked, statuses/formats/owners, paid ledger and approved Stage/catalog/settings/
   cron; verifies migration history/function definitions, explicit publication,
   room-code prerequisite and restoration-capable private backup. Current row
   access denial must be resolved by that operator, never guessed around.
3. Prepare immutable private worker and coordinated maintenance of **old creation
   and old writers**. Candidate opt-out flags do not close the old backend. Drain
   in-flight old requests before copying/quarantining state. Set explicit
   `LIVE_GAME_CREATION_ENABLED=false` and `STAGE_CREATION_ENABLED=false` for the
   new Edge. Absent flags default enabled and are not safe maintenance settings.
4. Apply ordered additive103000 boundary →103100 jobs →103200 recovery →103300
   Hosted/Solo public administration →103400 legacy quarantine/metadata gates.
   Stop on definition/publication assertions; no insecure permission workaround.
   Verify private copies and totals before permitting owner abandonment. Existing
   legacy rooms freeze; their state is not migrated into fresh deals.
5. Install matching `live-game`, Ranked, archive-replay and retired terminal
   bundles using repository JWT configuration. Verify Saved/migrate-saved-legacy
   endpoints match the retained completion contract. Do not expose public creation.
6. Start pinned private worker with gateway-compatible service JWT, matching
   server-only secret, durable outbox, supervision and age/failure/lease alerts.
   Verify ready/claim/real legal commit/retry. A health probe alone is insufficient.
7. Publish safe frontend, assets and v5 PWA together. Verify clean client and
   already-installed old tab/PWA raw refusal, refresh, frozen notice/restart,
   no cached canonical fallback. Preserve user documents and quarantine.
8. Perform mandatory production smokes below in an approved maintenance/test
   window. There is **no candidate admin-only creation flag**; a safe restricted
   testing window must be operationally arranged. Open general creation only
   after every supported mode/security/economy gate passes. Stage stays separately
   disabled until approved production Stage smoke passes.
9. Monitor failed/aged/expired bot jobs, revision conflicts, terminal rollbacks,
   funding receipts, live/archive access denials and legacy preservation. Keep
   raw grants revoked. Do not begin Live Sync performance work as part of rollout.

## Rollback constraints

- Close creation and worker dispatch first; preserve protocol/memo/outbox/lease/
  retry/quarantine data while candidate games exist. Do not drop private evidence,
  truncate jobs, lose idempotency receipts or delete completed records.
- Raw ACL revocation, completed live-alias guard and private Realtime removal are
  security cutover constraints. Never reopen them for an old browser. Safe rollback
  uses closed creation/read-only recipient views and compatible archive access.
- Preserve immutable `server_reduced` provenance and original old provenance.
  Never relabel client-reported history or frozen rows as trusted completion.
- Individual migration transactions are atomic, but five migrations + Edge +
  frontend + worker are not one distributed transaction. Stop on partial rollout,
  keep maintenance/closed creation and repair forward within the safe boundary.
- Backup recovery must preserve subsequent authoritative work and keep secure
  grants; restoring an old full-state frontend/backend is not a safe rollback.
  Already downloaded pre-cutover secrets cannot be erased.

## Mandatory production smoke checklist

- Exact schema/history/migration/function overloads, safe column grants, service
  wrappers, explicit Realtime publication, quarantine counts/digests/privileges,
  old metadata-helper denial, waiting cancellation and active-delete refusal.
- Two authenticated seats plus independent host/admin/spectator, pending and
  anonymous attackers: HTTP, Realtime, logs, Storage/IndexedDB/Worker captures;
  no opponent rack/bag order/membership/seed/future draws/private timeline; archive
  aliases refused while live. Host remains rackless unless independently seated.
- Normal public/private friend, public waiting open-seat and region membership/
  private code/link cases; create/join/Ready/config/launch, pass/place/exchange,
  Direct pause responses/resume, all named draft/edit/Replay tools, asymmetric
  clocks/overtime/timeout, reconnect/reload/tab/stale/duplicate and terminal Replay.
- Hosted automatic two seats + separate host and Hosted Solo; physical Hosted
  Versus/Solo actual draw/intake/correction/placement/exchange/pass/finish after
  secure replacement exists; automatic/physical Pass & Play actual authenticated
  handoff and prior-user denial. No membership oracle from guessed draw tokens.
- Authur bot A and B, real pinned fullStrong, ArchBot trusted pinnedStage5B64
  turn/Storage after adapter exists; owner offline, process crash, expired lease,
  callback forgery/retry/lost acknowledgement, one move/charge, no weaker fallback.
- Ranked join/Ready/stakes/refusals, legal actions/timeouts, reconnect/reload/tab/
  recovery, immutable settlement/rating, full authorized completed Replay; no
  analysis/pause/editor expansion of Ranked rules.
- Genuine pre-cutover session and installed old PWA: raw reader/writer refusal,
  freeze notice, refresh/current shell, safe owner abandon after private copy,
  fresh deal, no invented legacy result, unchanged funding ledger/quota policy.
- Free/Plus/Pro actual settings: funding once/no fallback/rollback/board limit;
  completion transaction fault/hold and recovery; History/Recent/Saved/Save/trash/
  restore/full capacity; full two-sided post-commit Replay and outsider denial.
- Stage only on legitimately approved/sealed production level: no seed/start/
  winning answer disclosure, actual Strong turn, natural finish/progression,
  zero charge, full owner Replay, outsider/raw refusal, preserved approval rules
  and named inherited controls. Keep flag closed when this cannot be exercised.
- Frontend/service-worker version, old install refresh, new tab/reload/offline/
  reconnect; no browser service/bot secret. Cron retains frozen evidence and
  retained completed sources; outbox health reflects actual legal commits.

## Protected local state and stop

Primary `/Users/thitithat_tiankrajang/Desktop/EQ-Lab` remains at
`55352e205082b7f0fc6e30c5a54b891c864555ba`,89 tracked changes/284 full untracked
files. Sibling `/Users/thitithat_tiankrajang/Desktop/amath-engine` remains at
`b53749ef0c0bdfa766cbe3269661e409f7874b43`,22 tracked changes/45 full untracked
files. All 12 EQ-Log worktrees remain. No protected checkout was pulled, merged,
reset, stashed, cleaned, deleted or overwritten. Private credentials/fixture/logs
stay outside Git. The changed/untracked-file scan covered 96 files and found no
known private credential values, private-key/token signatures, or unexpected
temporary evidence files. Final diff whitespace and inventory completeness pass:
58 feature rows and all 43 default-skip dispositions.

Only this task's local worker, frontend, Edge and disposable Supabase were stopped.
Supabase confirmed backup retention. Both unrelated local Supabase stacks and
other running containers remain untouched; private test evidence is retained.

**No candidate commit, merge or deployment. No performance optimization. Stop.**

## Appendix — all 43 default skips

The generated list below records every skipped test from the final default JSON.
Enabled results are the separate gates above; an environment skip alone is not a pass.

| #   | File / exact test                                                                                                                                                              | Disposition                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | `tests/archbot-storage-local.test.ts` — finishes a production ArchBot room through server authority, Compact, History, Recent and safe Replay                                  | Required-behavior FAIL: secure create400 (authority run).                                                                     |
| 2   | `tests/archive-replay-local.test.ts` — serves only safe replay through a real local archive endpoint                                                                           | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 3   | `tests/completed-game-benchmark.test.ts` — reports reproducible compact-record measurements                                                                                    | Explicit performance opt-in outside this authorized security round; not run.                                                  |
| 4   | `tests/completed-game-benchmark.test.ts` — profiles representative legal events and repeated local replay timings                                                              | Explicit performance opt-in outside this authorized security round; not run.                                                  |
| 5   | `tests/full-super-parity.test.ts` — the bundled engine runs the full 160-sample schedule and matches the native reference exactly                                              | Extended160-sample native comparison opt-in; not run. Actual fullStrong worker/browser gates passed; no reduced runtime used. |
| 6   | `tests/game-history-local.test.ts` — creates one History entry per seated user under concurrent authoritative terminal commands                                                | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 7   | `tests/live-compatibility-local.test.ts` — secure self-directed Solo starts from one Ready seat and preserves lifecycle/Replay                                                 | PASS enabled current-authority run.                                                                                           |
| 8   | `tests/live-compatibility-local.test.ts` — secure Hosted Solo starts from one Ready seat and preserves lifecycle/Replay                                                        | PASS enabled current-authority run.                                                                                           |
| 9   | `tests/live-compatibility-local.test.ts` — F10/F27: physical Hosted creation must support the required recording workflow                                                      | Required-behavior FAIL: physical create400.                                                                                   |
| 10  | `tests/live-compatibility-local.test.ts` — F07: Pass & Play retains its mode identity and supports a second-player handoff                                                     | Required-behavior FAIL: wrong mode/no B handoff.                                                                              |
| 11  | `tests/live-compatibility-local.test.ts` — legacy cutover preserves private evidence, gates old metadata writers, and protects active completion                               | PASS enabled current-authority run.                                                                                           |
| 12  | `tests/live-creation-controls-local.test.ts` — rollout switches close Normal and Stage creation without charges or disabling existing projections                              | Prior PASS in closed and Stage-only configurations; unchanged controls, not rerun this round.                                 |
| 13  | `tests/live-hidden-local.test.ts` — enforces every live access path and commits Replay only with successful persistence                                                        | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 14  | `tests/live-release-recovery-local.test.ts` — recovers initialization failure, crash, expired lease and lost acknowledgement without a browser or charge                       | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 15  | `tests/live-release-recovery-local.test.ts` — queues a bot turn atomically with its stored revision even when Edge never enqueues, and retries transient failures              | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 16  | `tests/live-stage-progression-local.test.ts` — plays a repository Stage candidate to a natural win with trusted Authur, persisted progression and two-sided Replay             | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 17  | `tests/live-storage-capacity-local.test.ts` — authoritative private completion keeps History/Recent/Replay available when Free/Plus/Pro Saved is full                          | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 18  | `tests/ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority previews the database's stakes, win, draw and loss, with a basis                                 | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 19  | `tests/ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority joins with a fresh basis, and the draw stake is what a draw applies                              | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 20  | `tests/ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority refuses a join without a basis, and never claims on its own                                      | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 21  | `tests/ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority refuses stale stakes with ranked_stakes_changed and the new preview, and claims nothing          | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 22  | `tests/ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority refuses a claimant already in a Ranked match                                                     | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 23  | `tests/ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority keeps a busy creator's room, refuses it from a stale list, and opens it again once they are free | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 24  | `tests/ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority tells the claimant it is their own board limit                                                   | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 25  | `tests/ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority refuses a room already taken, your own room, an expired room and a missing one                   | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 26  | `tests/ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority keeps the approval gate and refuses unauthenticated requests                                     | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 27  | `tests/ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority never lets the body name the viewer                                                              | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 28  | `tests/ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority resumes a match you already hold, and plays it to the end                                        | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 29  | `tests/ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority lets a player with several legacy matches finish them, but not acquire another                   | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 30  | `tests/ranked-edge-db.test.ts` — the Ranked Edge Function on the C7 authority carries each database refusal code through Edge and client unchanged                             | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 31  | `tests/recent-games-local.test.ts` — concurrent retention converges per participant and opens only a safe retained replay                                                      | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 32  | `tests/recent-storage-benchmark.test.ts` — measures shared Compact retention and safe replay response                                                                          | Explicit performance opt-in outside this authorized security round; not run.                                                  |
| 33  | `tests/saved-games-local.test.ts` — explicit Save survives Recent eviction and enforces concurrent capacity at the database                                                    | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 34  | `tests/saved-lifecycle-local.test.ts` — new private games finish with Compact Recent while Saved is full                                                                       | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 35  | `tests/stage-terminal-local.test.ts` — captures a sealed Stage atomically, once, through server-authoritative live commands                                                    | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 36  | `tests/storage-cost-corpus.test.ts` — measures finished bot, edit, and branch records                                                                                          | Explicit performance opt-in outside this authorized security round; not run.                                                  |
| 37  | `tests/sync-performance-local.test.ts` — measures authenticated metadata, replay and Save paths at scale                                                                       | Explicit performance opt-in outside this authorized security round; not run.                                                  |
| 38  | `tests/sync-performance-local.test.ts` — measures old-compatible and new terminal requests for the same legal traces                                                           | Explicit performance opt-in outside this authorized security round; not run.                                                  |
| 39  | `tests/sync-performance-local.test.ts` — keeps create, several live commits, reload and the next commit operational                                                            | Explicit performance opt-in outside this authorized security round; not run.                                                  |
| 40  | `tests/terminal-routing-local.test.ts` — finishes through the real frontend when raw room purpose is denied                                                                    | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 41  | `tests/terminal-routing-local.test.ts` — keeps completion/reconnect retries exactly once and exposes only owned safe Replay                                                    | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 42  | `tests/terminal-routing-local.test.ts` — routes a non-admin Stage and its lost-response retry without trusting the game name                                                   | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
| 43  | `tests/terminal-routing-local.test.ts` — reveals no terminal route to spectators, pending users, anonymous clients or Ranked callers                                           | PASS in separately enabled real local authority/Storage/Ranked/recovery/Stage gate (see counts above).                        |
