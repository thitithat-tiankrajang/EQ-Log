> Current milestone status and the locked client-side ArchBot practice decision
> are recorded in [live-security-milestone-s-2026-10-01.md](live-security-milestone-s-2026-10-01.md).
> That report supersedes older compatibility status and server-ArchBot requirements
> below. This document is retained as historical scope/evidence; the 58 classes
> and ordinary competitive secrecy contract remain the established basis.

# Live capability architecture — revised authorization, 2026-10-01

This matrix was completed before broad implementation in this round. It uses the
accepted 58-feature inventory as closed scope. The user's revised Physical Host
rule supersedes the previous reports' prohibition on Host access to both current
racks. Current ordinary-player secrecy, full authoritative completed history,
legacy freeze/restart, no deploy/merge, and no performance optimization remain.

## One trusted authorization module

Authenticate → read authorized room metadata → resolve capabilities from stored
owner/frozen seats/mode/protocol → validate command and CAS/UUID → reduce private
state → atomic commit/terminal capture → recipient allowlist projection.
Request role/host/seat claims never confer privileges. All grant combinations are
additive, so a Physical Host seated as either player retains both-current-rack
read and physical-controller commands. Automatic Hosted does not inherit that
private privilege. Administrator role alone does not imply Physical Host.

The narrow interface consists of capability resolution, recipient projection,
and typed command execution. Authur and ArchBot are two private runtime adapters
behind the existing durable job interface; clients never choose a private runtime
position. Ranked keeps its existing independent trusted handler.

## Capability vocabulary

- A PUBLIC COMMAND: public metadata/lifecycle/annotations. Mutation may still
  require trusted transaction validation; the command itself carries public facts.
- B PLAYER-PRIVATE COMMAND: own draft/current/history view/analysis, under server
  seat authorization. Public spectators get no private rack.
- C HOST-PRIVILEGED COMMAND / VIEW: stored Physical Host only, both **current**
  racks and physical intake/correction/recording. No bag order, future state, RNG
  or other-seat historical rack. Seated Host privileges are additive.
- D TRUSTED AUTHORITATIVE COMMAND: private canonical state/history, rules,
  inventory, funding and persistence remain inside trusted execution.
- E LOCAL HANDOFF MODE: authenticated owner controls one shared device. Server
  returns only the confirmed active side; confirmation expires on revision change.
  Interstitial hides/clears outgoing rack/draft/history before the next confirmation.
  No claim of cryptographic isolation from unrestricted same-device DevTools.
- F POST-GAME ONLY: full two-sided history only after atomic successful retention.
- G RETIRED / INTENTIONALLY UNSUPPORTED: explicit product removal listed below.

Every feature has exactly one primary class. A composite feature's primary class
is its highest-authority operation; its implementation can call the same trusted
reducer without granting extra browser permissions. A class assignment is not a
passing implementation/workflow claim. Current pre-round findings are carried
below and will be updated only with actual closure evidence.

## Recipient grants and typed commands

Physical Host authorization is derived from stored owner + Hosted + manual draw

- normal purpose + server-v1, never a request flag. Host-only/A+Host/B+Host all
  receive both current racks; ordinary A/B only receive own. All roles receive a
  public board/log allowlist. Own historical log fields are separately seat-scoped.
  No canonical/session/private timeline/bag array/predictive seed is projected.
  Manual token validation is available only to the explicit Physical Host or the
  confirmed local physical player. It selects unordered available physical tiles
  internally and never returns their order or future automatic draw sequence.

Local Versus is preserved as local_versus, not converted to direct online play.
A private server handoff claim ties owner, room, active side and revision to a
rotating token. Public read before confirmation; previous token is invalid after
turn/revision transition. New tab/reload must confirm as needed. This capability
cannot be obtained in Direct/Hosted/bot/Stage/Ranked rooms.

Commands refer to IDs, sides, public settings and action facts. Private history
restore/branch works by trusted indices/line references, not uploaded canonical
snapshots. Manual rack correction preserves tile conservation and public board.
Public score/notes/stars/lifecycle share actor authorization and CAS/idempotency.
Unsupported transitions fail closed with generic errors, never private payloads.

## All 58 features — exactly one class each

| ID / feature                                                                   | Class | Pre-round finding                                                                                                                               | Required disposition / implementation                                                                                           |
| ------------------------------------------------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| F01 create Direct/Normal/friend                                                | D     | P                                                                                                                                               | retain typed settings; test scope/seat variants                                                                                 |
| F02 public/region open-seat join                                               | A     | P: 103400 prohibits new vacancy claims after waiting; exact public/region waiting-join lifecycle gate absent                                    | prove waiting claim, outsider/code/region refusal, then full lifecycle                                                          |
| F03 invite-only/private seats/code/link                                        | A     | P private participant access; scope matrix incomplete                                                                                           | prove region/nonmember/code refusals                                                                                            |
| F04 spectator load / owner / admin load                                        | B     | P; owner/admin receives neither rack unless seated                                                                                              | retain frozen-seat check                                                                                                        |
| F05 Solo self-directed creation/start                                          | D     | P: one-seat start, same-side pass, pause/resume/finish and full Replay pass DB/browser                                                          | retain owner lifecycle and remaining named tools below                                                                          |
| F06 Hosted Solo creation/start                                                 | D     | P: one-seat start/lifecycle, host neither rack, full Replay pass DB/browser                                                                     | F11–F13 waiting/configuration behavior still needs closure                                                                      |
| F07 Pass & Play automatic                                                      | E     | B: only A seated; no B handoff                                                                                                                  | Explicit local owner handoff, concealed projection until active-player confirmation; no simultaneous rack view.                 |
| F08 Pass & Play physical                                                       | E     | B: create 400                                                                                                                                   | Same local handoff; physical intake scoped to confirmed active local player, no both-rack privilege.                            |
| F09 Hosted automatic creation/start                                            | D     | P                                                                                                                                               | preserve host-separated seats                                                                                                   |
| F10 Hosted physical/manual creation                                            | C     | B: create 400, manual option disabled                                                                                                           | Physical owner host may also occupy A or B; additive current-rack privilege. Manual creation/intake/recording required.         |
| F11 waiting configuration/name/players/timers/start side                       | D     | B: secure page has no configure command/UI                                                                                                      | typed waiting settings; seat/funding immutability, redeal only before Ready                                                     |
| F12 Ready, Unready, leave waiting                                              | A     | P Ready; B Unready/leave absent in new UI                                                                                                       | explicit Unready with start CAS boundary                                                                                        |
| F13 host start / launch countdown                                              | A     | B: replaced by immediate Ready start                                                                                                            | preserve host launch/countdown or explicitly resolve the product change                                                         |
| F14 cancel waiting                                                             | A     | P                                                                                                                                               | constrain deletion to waiting; make repeated cancellation deterministic                                                         |
| F15 delete playing/draft room                                                  | D     | P: 103400 refuses active server-v1 deletion; legacy abandon requires quarantine                                                                 | retain waiting cancel, trusted active finish, private legacy preservation                                                       |
| F16 rename live                                                                | A     | B: raw reader now throws                                                                                                                        | typed owner metadata command                                                                                                    |
| F17 duplicate/import live position helpers                                     | G     | N/R: no baseline UI caller found for either live helper; new creation never accepts a position                                                  | No active baseline UI caller; retire arbitrary client-position creation helpers.                                                |
| F18 export live canonical file                                                 | F     | R: no secure full-live export                                                                                                                   | Full-fidelity export only from persisted completed Replay; no full canonical live export.                                       |
| F19 select/reorder rack and empty-slot layout                                  | B     | B: candidate selection works, rack reorder/holes absent                                                                                         | port draft-only reorder without authority writes                                                                                |
| F20 select place / board cursor / keyboard / drag / move pending               | B     | P basic board placement; B full keyboard/cursor/drag parity absent                                                                              | explicit interaction coverage, no broadcast of draft racks                                                                      |
| F21 blank/choice assignment, reassignment, swapping pending                    | B     | P validation; UI parity needs proof                                                                                                             | prove multi-token assignment and swapping                                                                                       |
| F22 cancel action / remove pending / undo last draft placement                 | B     | P clear draft; B per-placement undo missing                                                                                                     | port local-only undo and return slots                                                                                           |
| F23 place equation / validate / score / natural endings                        | D     | P normal typed actions + Stage natural win                                                                                                      | retain conservation/scoring/end rules                                                                                           |
| F24 select exchange, count, return delay, reserve, refill                      | D     | P                                                                                                                                               | retain no immediate redraw and exchange restrictions                                                                            |
| F25 pass / turn handoff / solo repeat                                          | D     | P Versus and automatic Solo same-side progression                                                                                               | physical/handoff prerequisites F07/F08/F10 still block those modes                                                              |
| F26 automatic initial/replacement draw                                         | D     | P Versus/Authur/Stage                                                                                                                           | prohibit client draw seed/order                                                                                                 |
| F27 manual named draw from palette / typed rack                                | C     | B: no typed safe intake                                                                                                                         | Host selects physical draw tokens through trusted unordered inventory mutation; no ordered bag or RNG response.                 |
| F28 return newly drawn tile / keyboard replace/delete                          | C     | B: manual intake absent                                                                                                                         | Host may return/correct known current tiles through revision-checked command; no historical rack projection.                    |
| F29 edit completed refill before action                                        | C     | B: no secure command                                                                                                                            | Host current-rack correction behind trusted conservation validation; no predictive queue shortcut.                              |
| F30 clock ticking, asymmetric/untimed/overtime/timeout                         | D     | P server normal/Ranked settle; scope coverage partial                                                                                           | prove asymmetric + timeout behavior; no arbitrary clock edit UI existed                                                         |
| F31 Hosted/Solo immediate pause                                                | A     | P Hosted automatic and both automatic Solo variants                                                                                             | retain public lifecycle authorization                                                                                           |
| F32 Direct request pause                                                       | A     | B absent typed command/UI                                                                                                                       | persist request UUID by seated sender                                                                                           |
| F33 Direct accept/decline/block 5m/acknowledge                                 | A     | B all four responses absent                                                                                                                     | enforce opposite seat + request identity; retain cooldown                                                                       |
| F34 resume drafted game                                                        | A     | P Hosted/Solo; B Direct pause/resume negotiation absent                                                                                         | restore Direct participant negotiation separately                                                                               |
| F35 Save & Exit (non-email pauses), Coffee Break/Return                        | A     | B pause-on-exit and coffee UI removed                                                                                                           | typed pause semantics and room-ID return bookmark                                                                               |
| F36 undo committed state                                                       | D     | B absent                                                                                                                                        | Private history-index restore; authorized actor only; no opponent-history DTO. Disclosure/distribution policy must be explicit. |
| F37 redo committed state                                                       | D     | B absent                                                                                                                                        | Private history-index redo with CAS; no client snapshot.                                                                        |
| F38 notes and stars                                                            | A     | B command/UI/projection fields absent                                                                                                           | bounded public annotation command, no snapshot response                                                                         |
| F39 score correction                                                           | A     | P new host paused score edit                                                                                                                    | don't invent a baseline arbitrary-score/timer editor                                                                            |
| F40 public-board correction/remove/move committed tile                         | D     | Covered by F36/F42 blockers                                                                                                                     | Derived history correction, not an invented arbitrary board setter.                                                             |
| F41 arbitrary turn change                                                      | D     | Covered F25/F29/F36/F42                                                                                                                         | Derived pass/refill/history turn change, not an invented arbitrary turn setter.                                                 |
| F42 Continue from here / restore alternate line / follow parked twin           | D     | B raw timeline revoked, secure feature absent                                                                                                   | server reference-only branch/correction design                                                                                  |
| F43 prune alternate line / timeline conflict/retry                             | D     | B absent secure API                                                                                                                             | server prune by line ID; safe public tree projection                                                                            |
| F44 turn log / live before-after Replay / practice drafts                      | B     | P redacted live log; B live Replay/practice navigator absent                                                                                    | Public board before/after plus self historical rack only; Physical Host current-rack privilege does not extend to history.      |
| F45 own current-turn move aid / analysis levels                                | B     | P secure own-current analysis                                                                                                                   | catalog permissions + all applicable levels; Ranked stays closed                                                                |
| F46 own historical/replay analysis                                             | B     | B absent                                                                                                                                        | Authorized self history only; do not infer opponent history from current Physical Host role.                                    |
| F47 bot insight/why/reasoning/progress                                         | G     | R live insight leaks unrevealed bot rack/future proposals                                                                                       | Retire live private bot reasoning/why/candidates; completed full Replay remains.                                                |
| F48 wedged bot Retry / Take over / Return to bot                               | D     | P worker recovery; R browser takeover                                                                                                           | Trusted recovery/retry retained; human takeover of private bot rack retired.                                                    |
| F49 Authur create / server think / bot action                                  | D     | P pinned full Strong                                                                                                                            | retain model/budget and crash/restart gate                                                                                      |
| F50 ArchBot create / client think / bot action                                 | D     | B secure create refuses stage5b                                                                                                                 | Exact Stage5B64 adapter in private worker; preserve budgets/model/tie behavior and catalog economy.                             |
| F51 Aether Easy/Medium/Hard/Max/Super legacy turns                             | G     | R baseline already retired new rooms; legacy frozen                                                                                             | Already retired new Aether rooms; frozen pre-security evidence/restart policy retained.                                         |
| F52 Stage create/sealed start/catalog/admin import/seal/approve                | D     | P local approved sealed fixture                                                                                                                 | production catalog/config preflight; retain approval rules                                                                      |
| F53 Stage action/natural win/progression/finish                                | D     | P natural local win, owner progression, Replay; inherited generic owner/catalog tools still F36–F38/F42–F44/F46 blockers                        | resolve those named tool regressions; approved production level smoke before enable                                             |
| F54 Ranked list/create/stakes/join/Ready/cancel                                | D     | P DB + browser                                                                                                                                  | preserve preview-basis refusal and existing multi-match handling                                                                |
| F55 Ranked action/timeouts/rating/terminal/recovery                            | D     | P representative browser/DB; action matrix must be explicit                                                                                     | no pause/analysis/edit product rules added                                                                                      |
| F56 all-mode terminal capture/History/Recent/Saved/full Replay                 | D     | P supported-mode retention; active-delete guard closed; physical/PassPlay/ArchBot cannot reach supported lifecycle                              | no client terminal uploads or auto Saved growth; close concrete mode prerequisites                                              |
| F57 realtime/session/reconnect/reload/second tab/stale/duplicate/offline cache | A     | P I/refetch, server-v1/legacy DB gate, private quarantine, old writer denial; v5 security shell; installed production PWA upgrade smoke pending | Revision-only invalidation/refetch; old canonical session/offline fallback retired.                                             |
| F58 local Study puzzle preview / Survival playtest                             | B     | N production endpoint absent; B candidate AppRoot routes these to archive                                                                       | Development recipient DTO route; no legacy full-live App fallback. Concrete dev debt if not ported.                             |

Class totals: A=14, B=9, C=4, D=25, E=2, F=1, G=3; total=58. No UNKNOWN class.

## Explicit product dispositions

Full-live canonical export, live private bot insight, human private-bot takeover,
old full-canonical offline/session fallback and unused arbitrary live import helpers
stay retired. Existing completed/local documents are preserved. Aether new-room
retirement predates this candidate. No useful Physical Hosted, Pass & Play,
ArchBot or named editing tool is silently waived; incomplete supported operations
remain NO-GO with their exact IDs and reasons. Stage rules are unchanged.

## Verification contract

Test capability combinations first, then actual end-to-end workflows. Physical
Host alone and seated A/B must see A+B current racks; ordinary A/B, spectator,
forged Host and unrelated admin must not obtain them. All deny bag order/future
seed. Local handoff must conceal A before B confirms and never return both racks.
ArchBot must execute canonical pinned Stage5B64 privately, conserve revision/charge
and recover leases. Complete retention must preserve both-side historical racks.
Production unknowns are separately classified PRE-DEPLOY REQUIRED, DEPLOY-TIME
REQUIRED or POST-DEPLOY SMOKE; secrecy-affecting ACL/role/config cannot be deferred
past exposing clients. No GO/commit while a supported critical workflow is broken.
