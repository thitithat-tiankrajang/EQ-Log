# Completed-game record v1: prototype and benchmark

Base: `840ef0e24a558e4392c3399bd2dd487fadb94a95`. Worktree: `~/.codex/worktrees/compact-completed-game/EQ-Lab`, branch `codex/compact-completed-game`. This document describes an isolated prototype. No production storage path uses it.

## Scope and result

`src/completedGame/record.ts` builds a versioned immutable JSON record from a `GameState` with complete active history. It stores one genesis, ordered event deltas, compact turn facts, optional parked branch suffixes, a SHA-256 record digest, and a final semantic-state digest. It reconstructs a `GameState` for existing replay, Study, and Analysis consumers. It neither changes the live protocol nor writes to any table.

**Qualification:** the 40/60-turn _legal_ fixture is pass-heavy. A separate 40/60-turn fixture with physical placements matches the old audit's size profile but does not validate equation legality. Therefore the measured 20–50 KB target is supported for these corpora, but **not yet proven for a representative legal 40–60-turn match**. The format is a working prototype, not a Phase 4 integration sign-off.

## Current model and information classification

The present `encodeGame` v3 stores full encoded logs, a second `historyLogs` catalog, and historical positions; every log has before/after board, rack, and bag. The live `GameState` carries even larger object snapshots. The room sends growing state on moves. The parked-lines document is separate; its 2 MiB validator ceiling is not a typical game size.

| Class              | Facts                                                                                                                                                | v1 treatment                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A canonical        | Game/mode/player identity, physical tile IDs and assignment, ordered initial inventory, board, racks, score, side, settings, turn action and outcome | Genesis + events                                                               |
| B nondeterministic | Initial shuffle, draws and exchange reshuffles, clock readings, manual transcription, bot output                                                     | Exact observed order/values and action details, never seed-only reconstruction |
| C audit/replay     | Timestamps, score override, notes/stars, Host correction effects, bot and Stage provenance                                                           | Turn core, metadata deltas, optional provenance                                |
| D derived          | Previous and next board/bag/rack copies in every log; repeated full history positions; score total where calculable                                  | Reconstructed from deltas (visible log facts remain available)                 |
| E optional cache   | Final/periodic position checkpoint                                                                                                                   | Omitted; measured replay is small                                              |
| F transient live   | Draft placement, lobby readiness/deadline, live commit/revision, timeline fetch pointer, pending network/bot jobs, last save timestamp               | Excluded                                                                       |
| G legacy           | v1/v2 face-only tile identity, v3 encoded GameState, plain JSON, old branch null positions                                                           | Read through adapter; original remains authoritative if genesis is absent      |

The immutable payload includes the game ID and name because they identify the game, but no Drive item ID, owner, folder, trash/overflow/capacity state, display order, visibility, or save-request ID. Those belong to a future storage envelope. User IDs and legacy emails are game player facts internally, **not public listing fields**.

## Genesis schema

`CompletedGameRecordV1` has `format: 1`, pinned `rules: "eq-lab-840ef0e"`, `tileManifestDigest`, `provenance`, `genesis`, `events`, optional `branches`, `finalStateDigest`, and `digest`.

Genesis is `meta` plus `physical`. `physical` uses the already frozen v3 manifest ordinal tile codes, sparse board cells, ordered rack A/B, ordered bag, and the two pending exchange-return queues. It records the **actual initial order**; a seed is insufficient because present shuffles use CSPRNG and algorithms may change. Board cells carry exact physical tile, placed turn, side, and assignment. `meta` explicitly selects game ID, name, game mode, players/member/account/legacy email identities, Hosted visibility setting, match control, game stage, starting side, bot side/engine/difficulty and Super pins, draw mode, face-down counts, turn/side/phase/status, board size, timers, scores, start time, and created time. These are either initial facts or values that a later event can change. `provenance` identifies standard, solo, hosted, bot, ranked, or stage origin; optional Stage level/seal/seed/source version and bot catalog/version pin are outside the old `GameState` and must be supplied by their source.

The Stage seed identifies a level but is **not used to reconstruct physical state**. The genesis does that. A historic bot move is saved as its actual action/outcome; replay never reruns a newer engine. `rules` identifies the v1 interpretation, not a request to apply whatever today's validator happens to do.

## Events and reconstruction

Each event has a strict 1-based `sequence` and `kind`:

| Kind         | Facts and use                                                                                                                                                                                                  | Approximate size in this corpus          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `turn`       | One or more complete place/exchange/pass/end-game log cores, action detail, exact intermediate board/rack/bag difference, and final position/metadata difference. Multiple logs cover automatic finish.        | About 485 B for a pass; placement varies |
| `annotation` | Revised visible log core for notes/stars/manual score with no position change.                                                                                                                                 | Depends on action detail                 |
| `edit`       | Explicit changed board cells, rack/bag splices, score/side/turn/clock/status/settings fields, and/or amended logs. Covers Host/manual corrections and final state changes the legacy history did not snapshot. | Depends on changed facts                 |

`boardSet`/`boardDrop` use sparse physical cells. Rack, bag and pending queues use `[start, removeCount, insertedTiles]` splices. This preserves exact ordered outcomes, including a full exchange reshuffle when necessary. No validator or RNG is rerun during replay. A log's before position is based on the preceding frame with explicit exceptions, and after facts are differences from that before position. Common log side/turn/start time/timer-before facts are omitted only when equal to the preceding frame. The visible `TurnLog` is fully rebuilt for existing consumers.

Some old Host operations do not carry an actor or semantic reason in `GameState`; v1 can preserve their **exact state effects** but cannot fabricate who performed them. Future capture should supply a typed actor/reason event at the source. The current `edit` delta remains deterministic and inspectable.

The builder requires a zero-log genesis, complete active history, and a tip history index. A game lacking those facts is not converted speculatively. Replay validates event order, valid turn actions, unique log IDs, board changes, the physical 100-tile partition at every position, branch parents, branch positions, record digest, and final state digest. Unknown completed-record versions, rules versions, or changed physical tile manifests fail closed. `semantic identity` excludes live commit/revision, lobby fields, save time and cache pointers; it includes exact board/tile IDs, racks, bag/order, scores, side, status, settings, clocks, visible log sequence/action details, notes, and Stage/bot provenance.

## Branches

`branches` embeds the existing `EncodedMultiverse` suffix model: each parked line has `from` parent turn ID, only its alternative logs, aligned after positions, and a tip. The main trunk is stored once. A legacy null `after` remains null: its turn is viewable but not branchable from that missing position. Parent existence and physical branch positions are checked. This prototype reuses the existing parked-line codec byte for byte; it does **not** claim a branch-size improvement beyond eliminating the live trunk duplication. For 30 lines × 12 turns, the branch suffix alone is 358,647 B. The current combined baseline is `encodeGame` **plus** its separately stored timeline document: 470,401 B versus 379,313 B (19.4% less). The 2 MiB document validator remains a separate ceiling.

## Checkpoint decision

No checkpoint is stored. In one warm local Vitest run, seeking to the end of a 40-turn legal pass-heavy record took 2.68 ms; 60 turns took 3.94 ms. Full replay took 3.96 and 5.92 ms. Candidate full-position cache sizes were 1,010 B final-only, 4,040/6,060 B every ten turns, and 2,020/3,030 B every twenty turns. For the placement stress fixture, a final position cache was 1,299 B. These are **measured byte costs, not implemented checkpoint variants**; checkpoint-based seek/open CPU was not benchmarked because this version has no checkpoint reader. An adaptive policy with a slow-seek trigger would add zero bytes on this corpus because no seek was slow, but would require a future policy and validator. Periodic and adaptive policies add format and invalidation complexity for a few milliseconds of work. Revisit only with measured slow real games or large branches.

## Compatibility, privacy, and future consumers

`readCompletedGame` accepts the new record, `c1:` v1/v2/v3 and plain JSON, plus an optional separately loaded legacy parked-lines document. Legacy v1/v2 face-only IDs are recovered by the existing identity allocator for reading, but their original physical identities were never stored: the adapter always returns them as readable legacy with `fullyBranchable: false`. A v3 or plain-JSON record lacking complete genesis/history likewise remains readable legacy with a reason and retains supplied parked lines. It does not rewrite old data. Existing legacy codec tests plus new adapter tests cover this boundary. Some such records can show logged turns but cannot reconstruct unknown opponent rack or original draw order at every turn; no invented positions are presented as canonical.

The full immutable record contains both racks, exact bag order, legacy emails, clocks, notes, and potentially private Hosted/bot/Stage information. It must remain an internal restricted payload. Public and region archives need an explicit post-game projection and access policy. Ranked and Stage currently enforce stronger hidden-information boundaries; the new record is **never directly a public response**. Product Owner decisions are needed on post-game rack/bag/draw/clock/annotation disclosure and whether bot reasoning is ever included (this record does not store bot reasoning). One internal payload can underlie Recent, Drive, public and region _storage references_ if access control and safe projections are built; identical public bytes must not be assumed. Cross-user deduplication is not implemented. A SHA-256 digest is useful for integrity/content identity, but a globally visible digest could leak that two users hold the same private game.

Existing Study/Analysis/replay consumers can receive reconstructed `GameState`/`GameSnapshot` from `readCompletedGameRecord`, `positionAt`, `finalPosition`, and `replayCompletedGame`; they need not know the JSON shape. `positionAt` and `replayCompletedGame` are synchronous helpers for a record already checked by `validateCompletedGameRecord`; callers should validate untrusted storage input first. `positionAt` is indexed by committed **event**, not displayed turn number, because Host edits and annotations can exist between turns. A future turn-to-event index should be added at the adapter seam before exposing a turn-number API. The completed event is an observed authoritative fact and could be adapted from future server-validated move events; today's client-trusting room path is unchanged.

## Phase 4 proposed API boundary

Use `buildCompletedGameRecord(game, branches?, provenance?)`, `validateCompletedGameRecord(raw)`, `readCompletedGameRecord(record)`, `digestCompletedGameRecord(record)`, `positionAt(record, eventIndex)`, `finalPosition(record)`, `replayCompletedGame(record)`, and `readCompletedGame(raw, legacyBranches?)` from `src/completedGame/record.ts`. All digest/build/read validation functions are async because Web Crypto SHA-256 is async. `CompletedGameRecordV1`, `CompletedEvent`, `CompletedTurn`, `CompletedProvenance`, and `CompletedRead` are exported types. Records with a bot side require an explicit catalog identity/version; older games without it stay readable through the legacy adapter. The future Phase 4 envelope owns owner, folder, visibility, capacity and listing metadata. Callers must establish finished status and disclosure authorization at that boundary; the prototype also accepts unfinished positions to benchmark new/early games.

## Corpus and measurement

Run `BENCHMARK_COMPLETED=1 npx vitest run tests/completed-game-benchmark.test.ts --reporter=dot`. Values below are raw UTF-8 JSON bytes, one warm local run, Node 26/Vitest on the worktree host. Times are milliseconds from `performance.now()`, single samples and therefore noisy. New encode includes hash and round-trip validation; decode includes integrity validation. `seek` is genesis-to-final with no checkpoint. Branch comparison in this table shows only `encodeGame` as current, so branch rows **exclude** the separate current timeline bytes; see the branch section above for combined comparison.

| Fixture                            | Current B |   New B |  Saved B |    Saved | New encode ms | New decode ms | Final seek ms | Branch B |
| ---------------------------------- | --------: | ------: | -------: | -------: | ------------: | ------------: | ------------: | -------: |
| New                                |     2,016 |   1,281 |      735 |    36.5% |          0.79 |          6.74 |          0.05 |        0 |
| Early legal equation               |     6,285 |   2,912 |    3,373 |    53.7% |          0.92 |          0.57 |          0.13 |        0 |
| Legal 20, pass-heavy               |    56,854 |  10,954 |   45,900 |    80.7% |         15.38 |          4.52 |          1.29 |        0 |
| Legal 40, pass-heavy               |   111,754 |  20,654 |   91,100 |    81.5% |         41.78 |          8.31 |          2.68 |        0 |
| Legal 60, pass-heavy               |   166,654 |  30,354 |  136,300 |    81.8% |         87.59 |         12.60 |          3.94 |        0 |
| Finished 61, resignation           |   169,621 |  31,013 |  138,608 |    81.7% |         88.32 |         12.51 |          4.00 |        0 |
| Solo start                         |     1,973 |   1,241 |      732 |    37.1% |          0.42 |          0.19 |          0.04 |        0 |
| Friend                             |     6,285 |   2,912 |    3,373 |    53.7% |          0.75 |          0.51 |          0.12 |        0 |
| Authur metadata                    |    59,604 |  11,159 |   48,445 |    81.3% |         12.62 |          4.31 |          1.26 |        0 |
| Hosted metadata                    |    58,328 |  11,019 |   47,309 |    81.1% |         12.06 |          4.50 |          1.27 |        0 |
| Draft Stage start                  |     4,147 |   2,475 |    1,672 |    40.3% |          0.93 |          0.44 |          0.09 |        0 |
| Manual edit                        |     3,008 |   1,385 |    1,623 |      54% |          0.73 |          0.46 |          0.09 |        0 |
| Clocked                            |    56,854 |  10,954 |   45,900 |    80.7% |         12.53 |          4.71 |          1.35 |        0 |
| One branch                         |    56,854 |  13,076 |   43,778 |      77% |         13.04 |          4.55 |          1.29 |    2,110 |
| Four branches                      |    56,854 |  23,256 |   33,598 |    59.1% |         13.01 |          5.75 |          1.28 |   12,290 |
| Thirty × twelve branches           |   111,754 | 379,313 | -267,559 | -239.4%* |         73.82 |         43.81 |          3.79 |  358,647 |
| Physical 20, equations unvalidated |    81,157 |  16,592 |   64,565 |    79.6% |         20.43 |         13.90 |          2.83 |        0 |
| Physical 40, equations unvalidated |   165,197 |  22,752 |  142,445 |    86.2% |         73.54 |         10.14 |          2.82 |        0 |
| Physical 60, equations unvalidated |   249,237 |  28,912 |  220,325 |    88.4% |        127.62 |         14.38 |          4.37 |        0 |

\*The current column omits its 358,647 B parked-line document. The combined current baseline is 470,401 B.

The long legal fixtures use the production ranked action transition but almost exclusively pass, so they are legal yet atypical. The physical stress fixtures have exact 100-tile conservation and deterministic seeded draw outcomes but deliberately bypass equation validation. They are **not** evidence that a typical game is legally representable at that byte size. The Stage row is the draft `createSurvivalTestGame` start, not the separate Stage5B playtest runtime. The Authur row checks pinned catalog metadata, not an engine-generated move. The Hosted row checks identity/settings, not a live Host session.

For the 40-turn legal fixture, plain `JSON.stringify(GameState)` is 6,831,956 B versus a 20,654 B record; 60 turns is 14,874,646 B versus 30,354 B. These are serialized object-graph proxies, **not measured heap retention or allocation counts**. The record greatly reduces retained data if consumers discard verbose history, but decoding back into `GameState` rebuilds the verbose view. Archive parsing alone was about 0.1–0.2 ms; full validated read was about 8.31 ms at 40 turns and 12.60 ms at 60. Turn 10/20/final seeks for 60 turns were about 0.65/1.27/3.94 ms. Full replay was about 5.92 ms. Dedicated heap/GC profiling and more repeated timing runs remain open.

## Validation and unresolved work

At the time of this report: 11 focused codec tests and the opt-in benchmark passed; the full existing Vitest suite (113 files passed, 1 benchmark file skipped; 966 tests passed, 3 skipped in one full run; later full runs intermittently failed one unrelated Ranked UI keyboard test), lint, formatting check, typecheck, and production build passed. That Ranked UI test passes in isolation, and the existing suite passes when the new tests are excluded; its source already labels a related click/reset race as a CI flake. Existing canvas warnings in jsdom are non-failing. No production file changed.

Before Phase 4 uses this as canonical storage, do all of the following:

1. Add a representative **legal** placement/exchange/draw corpus of complete 40–60-turn games, including normal finishes, and repeat benchmark/round-trip tests. The existing physical stress case is insufficient evidence.
2. Build an adapter from the actual Stage5B hidden-information runtime and a ranked completed-game source. Confirm their complete history, provenance, bot pin, and disclosure semantics. A ranked `GameState` with empty history currently falls back to readable legacy.
3. Decide public/region post-game disclosure for racks, bag/order, hidden draws, clocks, notes, and player identities; implement explicit safe projections and access controls before exposing any payload. Keep Ranked's stronger boundary.
4. Establish a durable rules-version implementation/registry; the pinned label alone cannot run old semantics if code is later removed. Add Stage sealed-start verification against its server source, and capture Host edit actor/reason on future events where audit requires them.
5. Exercise branch-heavy real games and older null-position branches end to end. Current suffix storage is exact but can dominate archive size. Assess whether heavy branch payloads should remain a separate referenced immutable object.
6. Gate Phase 4 writes on `status === "finished"`, complete history, validated digest, and a private envelope. Keep legacy fallback readable; never destructively convert or make missing replay facts up.

No capacity recommendation follows from these sizes. Free 100 / Plus 1000 / Pro 1000 active saved games remains the Product Owner direction. Do not change the live room protocol, Ranked authority, or plan limits in this phase.
