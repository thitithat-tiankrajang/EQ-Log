# Milestone 7: existing completion and listing sources

This audit precedes the History schema. History is a permanent participation
index, not another archive or result authority.

| Path                      | Terminal/result authority today                                                                                                                                       | Replay payload                                                                            | Existing listing                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Normal, Solo, bot, Hosted | `finalize_live_game` accepts the finished client state, updates player stats, and freezes room metadata; bot stats use frozen bot columns                             | Public/Region/Private `snapshot` for retained archives; none when `archive_policy = none` | Public/Region archive listings and Private library; `user_mode_stats` is aggregate only |
| Ranked                    | Service-only `ranked_commit_match` inserts `ranked_results` and updates ratings in one transaction                                                                    | Private `ranked_matches.state` and revision rows, with no post-game archive reader        | Ranked match UI and aggregate ratings/results, no permanent per-player History          |
| Stage                     | Service-only `capture_stage_terminal` binds a Compact record to the attempt and updates `survival_attempts`; result remains `captured_client_state` / client-reported | Owner-only `stage_completed_attempts.record`; old advisory attempts have no proven replay | Survival attempts/level progress, not Me History                                        |

`room_live` is removed at normal/Stage terminal capture. Public and Region
archives are pruned, Private items can be trashed/deleted, and a game can be
completed with no archive. Therefore none of these payload tables can serve as
permanent History. `user_mode_stats` cannot recover individual games. The
Public/Region “History” tabs list shared archives, not a user's participation.

The stored participation relation will have one small row per seated user and
game, unique on `(source_kind, source_id, participant_id)`. Two rows for a
two-player game duplicate only display metadata, avoid a join for the primary
Me query, and never duplicate replay. A non-playing Host, spectator, or room
owner without a seat gets no row. Results are copied from the existing terminal
authority, never decided by the History reader. Replay availability is derived
from current eligible storage at list time, so pruning or deleting a replay
does not delete or mislabel the History row.

Legacy backfill may use Public/Region frozen seat columns, `ranked_results`,
and finished Stage attempts. Private legacy library rows do not retain trusted
seat columns and may belong to a non-playing Host or be copied from elsewhere;
they are not inferred into participation. Aggregate stats and missing archive
rows cannot be expanded into individual games. Backfill must be service-only,
keyset batched, idempotent, and separately activated after local measurement.
