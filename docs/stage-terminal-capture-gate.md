# Stage terminal capture gate — local prototype

**Gate verdict: PASS for durable Stage completed-attempt capture; no claim of a server-verified competitive win.** The capture, retry, concurrency, sealed-start and disclosure checks pass on an isolated local Supabase stack. Ordinary Stage moves remain client-computed: the database does not independently rescore the full prior action sequence or prove that an Authur move delivered by the server was the move the browser committed. The durable record labels this boundary `captured_client_state` / `client-reported`. Competitive result authority belongs to the separate Competitive Security track. Phase 4 Storage & Sync may begin after Product Owner review of the coordinated archive cutover and these boundaries; this prototype itself changes no production data. No deployment, commit or push was made.

The code-path audit was written first in [stage-terminal-authority-audit.md](stage-terminal-authority-audit.md).

## New flow and actual authority

1. `create_stage_attempt` still creates one attempt and Stage room, tied to the authenticated member and approved/sealed level. The initial canonical commit must match the sealed 100-tile position, starting turn and **nonzero** scores. A Stage-only wrapper locks the level row from its seal read through attempt insertion; a database trigger then rejects any reseal, even to identical contents, once an attempt exists. This prevents an admin reseal from racing creation or changing the seal's metadata after use. A level losing approval or a plan changing after this valid start does not block completion.
2. A finished Stage state goes to `stage-terminal`. That authenticated Edge endpoint obtains owner, attempt, level seal, frozen bot version, latest live revision/state and parked lines with its service key. It rejects a different owner, missing attempt, unsealed opening, altered committed prefix, unfinished state and terminal-only physical/score change. For a natural finish, it checks the final placement/pass and automatic end reason against current rules; this does not validate all earlier moves.
3. The endpoint constructs Compact v1 with `buildStageCompletedGameRecord`, reads it back and compares final physical inventory, racks, score, side, turn, status, logs and history count. The record contains rules version, tile manifest digest, Stage seal digest/source version and frozen bot catalog version. Its provenance remains `completionAuthority: "client-reported"`.
4. Service-only `capture_stage_terminal` compares the revision and parked-line version, validates room/attempt/owner/level/bot identity, completion shape and seeded score plus log totals, then **in one transaction** inserts `stage_completed_attempts`, updates the advisory attempt result with `result_authority='captured_client_state'`, and deletes the live room. It does not call the ordinary player-result/stat path. A failure before this transaction leaves the room; a failure in it rolls all effects back.
5. A unique attempt ID and room ID prevent multiple captures. A retry after a lost response reads the immutable saved receipt. Concurrent submissions lock the live row; the waiter rechecks the completed row after the delete. A changed record digest or player identity conflicts instead of mutating an earlier result.
6. The old browser UPDATE grant on `survival_attempts` is revoked. The old `finalize_live_game` refuses Stage rooms; its previous implementation is private and still handles normal rooms. The browser cannot directly invoke the capture RPC or read its raw record. The normal, Ranked and Hosted paths were not rerouted.

## Completed record and replay

`stage_completed_attempts` is a server-only table keyed by real attempt and room identity. It stores the Compact v1 payload/digest, rules label, frozen provenance, source revision, terminal reason, observed score/outcome and completion time. No branch document is dropped: the Edge adapter reads `game_timelines`, includes it in the record and checks its version in the transaction. The exact Stage branch path remains covered by the shared Compact branch codec tests; a dedicated live Stage branch integration test is still needed before a PASS claim for branched Stage captures.

`archive-replay` now considers a Stage candidate for the owner only and calls the shared `projectCompletedGame` boundary with `scope:'stage'` and `published:false`. Browser output includes visible boards, scores, clocks and rack faces. It excludes physical tile IDs, ordered bag, seal digest and internal bot data. Stage publication was not invented. The level's sealed start remains separately readable under its existing policy; seed/RNG security is a later audit.

## Terminal semantics and limits

- The real client paths include natural `rack_out`, `no_score_streak`, and `perfect_game`; manual finish; and surrender where the direct-versus UI permits it. Stop/Save & Exit sets `draft` and cannot be submitted as a completed win. A manual or surrender terminal capture is recorded as a loss even if its reported score is higher.
- SQL verifies `final score = sealed opening score + recorded log effects`. The Edge adapter rejects a fabricated final score with no action and independently checks the **new terminal action** for a natural finish. **Earlier** ordinary Stage commits still accept browser-supplied logs, scores and physical states. The bot service result is applied and committed by the browser. This is the exact reason the final score and win are not fully server authoritative.
- Manual corrections and branch facts remain in Compact, but the current competitive validator is not a full historical Stage reducer. A natural completion after a manual score/board correction may be refused; a manual terminal loss can still be durably captured. A supported, explicit correction policy needs a future reducer before official wins.
- Historic `survival_attempts` rows retain `result_authority='advisory'`. No backfill or inferred Compact replay was made. An older advisory-finished attempt whose room still exists is not silently promoted; it requires separate product treatment. The current recorded-win UI still reads advisory wins; it must not be used as official progression.
- `cancel_live_game` and expiry can still remove a nonterminal room, leaving an unfinished attempt. That is an abort, not a completed win. An explicit aborted-attempt lifecycle could be added later if the product needs one.
- Replay uses current `eq-lab-840ef0e` historic rules interpretation. A new rules implementation must add/version its own validator before it may claim old Stage outcomes are newly validated. Current bot catalog version is pinned; exact historical bot decision verification is not implemented.

## Validation on isolated local Supabase

| Gate | Result |
| --- | --- |
| Clean migration/reset through `20261001101300_stage_terminal_capture.sql` | PASS |
| Authenticated endpoint: sealed start, 481–500 opening/final score for seed 17, manual loss, Compact replay | PASS |
| Direct result forgery, direct capture RPC, old Stage finalizer, wrong user, unfinished/fabricated final score | Rejected |
| Changing or identically resealing a start after attempt creation; original seal retained | Rejected |
| Two concurrent identical finishes, retry after completion, one stored record | PASS |
| Raw Stage record grants/RLS and owner-only safe replay; archive disclosure | PASS |
| Legacy advisory distinction and normal finalizer wrapper | PASS |
| Stage creation, archive payload, Ranked SQL smoke | PASS |
| Full Vitest suite with real Stage and archive endpoint tests | 1,000 passed, 4 skipped (122 files; one benchmark file skipped) |
| Format, lint, typecheck, production build | PASS |

The SQL freeze regression invokes the admin seal RPC after an attempt exists,
tries both a changed seal and an identical reseal, checks the original seal
remains, and checks that the prior creation function is no longer browser
executable. The creation wrapper's row lock prevents a reseal from overtaking
an in-flight attempt. The endpoint integration test exercises two simultaneous
identical terminal requests and a later retry, then checks one stored record.
The local end-to-end success case is manual completion; a fabricated natural
rack-out is rejected in the adapter tests. Positive natural, surrender, and
live branched-Stage captures remain separate follow-up integration cases.

The prior full-suite failure was a **new test mock failure** after the terminal route began reading frozen room purpose; the mock was updated and the complete suite passed. The existing Stage SQL smoke needed temporary helper EXECUTE grants under the archive privilege cutover and a new expectation that the old Stage finalizer is refused; it then passed. Neither required a production privilege relaxation.

## Decision before Phase 4

Keep this isolated prototype for Product Owner review. Compact v1 can be the internal payload for **complete, supported** captures behind the coordinated access cutover; retain legacy readers and do not auto-promote incomplete records. Phase 4 Storage & Sync can use that boundary after review without treating a Stage `win` as official competitive proof. A Stage-specific server command reducer, or equivalent complete independent rules replay with server-bound bot decisions, is needed on the separate Competitive Security track before authoritative win/progression claims. Decide whether the old advisory-win UI should continue to show legacy wins and how aborts should be listed. A dedicated live branched-Stage capture integration test and retained historic rules implementation remain follow-up work before claims about every Stage variant or a future rules-version cutover. No Stage progression, EXP, entitlement bands, Drive/History/Recent, billing or capacity work belongs to this gate.
