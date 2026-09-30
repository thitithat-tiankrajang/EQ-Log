# Milestone 13 — Final Game Storage & Sync Gate

**Verdict: GAME STORAGE & SYNC READY TO COMMIT**

This is a review verdict for the uncommitted worktree, not a production release approval. Branch `codex/compact-completed-game` is based on exact production main `4b6179d305287187d0633c793de8d87f8c19c5a4`; the Storage work originally began at `840ef0e24a558e4392c3399bd2dd487fadb94a95`. The main checkout was not modified. Nothing was committed, pushed, merged to main, deployed, or run against production. All database evidence below came from disposable loopback Supabase stacks.

## Closure of the independent review blockers

**B1 — production integration and migration collision: closed.** The dirty Storage tree was captured in an external patch and verified tar backup, stashed with untracked files, fast-forwarded to exact `4b6179d`, and reapplied without textual conflict. The safety stash remains. Production's 19 migrations, including the three `20260930` versions, remain byte-for-byte tracked at main. All 16 Storage migrations are now unique, ordered `20261001101000` through `20261001102500`, and later than production. A disposable production-only stack applied 19 migrations; a normal `db push --dry-run --db-url` listed exactly the 16 Storage files; a normal push without `--include-all` reached 35; a second dry run reported no pending files. A pre-cutover private archive and in-progress private room survived, with the room marked `legacy_private_autosave = true`. ArchBot remained enabled, Free and CLIENT. Fresh zero-to-35 migration application also passed.

**B2 — default privilege and SQL harness: closed.** An independent local privilege experiment showed that `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public REVOKE` cannot subtract PostgreSQL's global PUBLIC EXECUTE default: a newly created public function remained executable by `authenticated`. Therefore the global revoke in `archive_payload_read_cutover` is required to keep future sensitive public functions closed. The migration comment now explains this. Six existing SQL smoke files explicitly grant EXECUTE only on their transaction-local `pg_temp` helpers to the roles each exercise; there is no permanent shim or browser grant on product functions. The exact ACL guard now expects the intentional server-only Stage table SELECT, removal of service-role `create_live_game` EXECUTE, and removal of old authenticated Stage result-column writes. The archive privilege adversarial smoke passes.

**B3 — production ArchBot integration: closed.** `tests/archbot-storage-local.test.ts` uses the enabled production catalog row (`stage5b`, Free, CLIENT, `stage5b_standard`) to create a real normal bot room. It constructs human and bot turns with the legal action reducer, finishes through `normal-terminal`, and proves Compact reconstruction, History, Recent, and safe replay. It observes no ProBot consumption/Credit entry and no Stage attempt. Durable provenance keeps the internal bot key, catalog version and difficulty and explicitly says `client-reported`; it does not claim a server-verified competitive win. Replay displays “ArchBot” and does not expose the internal strength/model level, model weights, reasoning, seed, bag/order or physical IDs. Internal Stage5B engine and Study terminology are unchanged. The production ArchBot parity suite passed all 101 tests.

The cleanup race shell test is intentionally unignored in `.gitignore`. A scan of ignored files under `docs`, `src`, `tests` and `supabase` found only the CLI's `supabase/.temp/cli-latest` cache. Six Edge bundles were rebuilt from current sources; rebuilding again produced identical SHA-256 digests. No bundle was deployed.

## Exact migration sequence

Production retains these final three of its **19 unchanged** versions: `20260930100000_archbot_display_identity`, `20260930110000_ranked_match_authority`, `20260930120000_archbot_enable`. The **16 new** Storage files are:

| Order | Migration | Main effect |
|---:|---|---|
| 1 | `20261001101000_ranked_private_revisions.sql` | Ranked private revision capture |
| 2 | `20261001101100_stage_seeded_score_floor.sql` | Stage seeded-score validation |
| 3 | `20261001101200_archive_payload_read_cutover.sql` | Browser payload isolation and future-function defaults |
| 4 | `20261001101300_stage_terminal_capture.sql` | Sealed Stage terminal capture and result write denial |
| 5 | `20261001101400_game_history.sql` | History index and explicit manual backfill API |
| 6 | `20261001101500_recent_completed_games.sql` | Recent relations and immutable shared payload |
| 7 | `20261001101600_saved_completed_games.sql` | Explicit Saved ownership |
| 8 | `20261001101700_saved_legacy_validation.sql` | Legacy validation boundary |
| 9 | `20261001101800_saved_source_eligibility.sql` | Source eligibility |
| 10 | `20261001101900_saved_lifecycle.sql` | Trash, Overflow, Restore and Activate |
| 11 | `20261001102000_private_autosave_cutover.sql` | Existing-room marker and new-room cutover |
| 12 | `20261001102100_normal_terminal_retention.sql` | Atomic normal terminal capture |
| 13 | `20261001102200_saved_legacy_migration.sql` | Manual, dry-run-default legacy migrator |
| 14 | `20261001102300_completed_source_identity.sql` | Source identity |
| 15 | `20261001102400_saved_capacity_reconcile_performance.sql` | Capacity reconciliation fast path |
| 16 | `20261001102500_completed_payload_cleanup.sql` | Deferred cleanup queue, worker and pg_cron job |

The merged tree contains 35 migration files and 35 distinct versions. The true-production upgrade ledger reached exactly 35. It created no History, Recent, Saved or manual migration-ledger rows automatically. The only intended new recurring behavior is `eq-completed-payload-cleanup` (every five minutes, as `postgres`, after a ten-minute grace period). The private-room marker update and initial orphan-queue population are explicit one-time migration operations. Neither History backfill nor Saved legacy conversion runs automatically. `--include-all` is neither needed nor safe for this release.

## Rerun gates on the integrated tree

| Gate | Final result |
|---|---|
| Fresh local schema from zero | PASS, 35 migrations in order |
| Exact production `4b6179d` → Storage | PASS, 19 → 35; archive, room and ArchBot preserved |
| Normal dry-run migration inventory | PASS, exactly 16; then zero pending |
| Full Vitest, bounded sequential | PASS, 1,301 passed / 30 skipped (opt-in local/benchmark suites) |
| ArchBot parity | PASS, 101 tests |
| Production build | PASS |
| Format, lint, typecheck, `git diff --check` | PASS |
| Full SQL smoke directory | 23/24 original files PASS; one unchanged production fixture failure described below |
| Fixture-corrected diagnostic of that SQL test | PASS; original file remains unchanged |
| Ranked authority smoke and race | PASS; race enforces one active match |
| Seven Storage endpoint suites | PASS, 7/7 (archive, Stage, History, Recent, Saved, lifecycle, full-capacity finish) |
| ArchBot terminal → Compact → History → Recent → replay | PASS |
| Cleanup retention and Save/worker race | PASS |
| Cleanup scheduler/job | PASS; job deleted an aged orphan; run detail `succeeded`; five-minute schedule restored |
| Full-capacity finish with cleanup disabled | PASS for Free, Plus and Pro; scheduler restored active |
| Edge bundles vs sources | PASS, all six stable across a second rebuild |

The only original SQL failure is `canonical_revision_smoke.sql`: it updates three test profiles to the same `Revision Tester` display name, violating the unique display-name constraint before the tested protocol runs. Both that file and the constraint are unchanged from production main; this is a fixture-only pre-existing failure, not a Storage regression. Running an otherwise identical disposable copy of the SQL with three distinct fixture names passed through `DO` and rolled back. The other two fixture-dependent SQL smokes passed after two approved disposable profiles were supplied. No product permission was widened to make a test green.

The established Milestone 12 measurements remain the cost evidence; the integration did not change the measured Storage architecture, so the expensive historical benchmark was not rerun. The earlier spot check was: 1,000 Compact payloads 20,275,200 bytes, 2,000 Recent references 491,520 bytes, and 1,000 Saved references 622,592 bytes. The 1,000-item listing performance fix remains in migration 15.

## Authority, privacy and retention boundaries

Normal and ArchBot gameplay remains client-submitted between terminal events. The server controls bot catalog identity at creation and normal terminal capture/retention, but does not independently validate every intermediate move, score or bot turn. Such results are `client_reported`. Stage creation, sealed opening and terminal capture are server controlled, while its intermediate gameplay state remains client derived; its record says `captured_client_state`. Ranked remains a separate server-authoritative path with private revisions and no client-reported normal completion.

The immutable Compact payload is kept behind server-only storage and projected through `archive-replay`. History is permanent participation metadata; Recent is at most 20 per participant; Saved is explicit ownership and has independent capacity. The cleanup worker removes a normal payload only after no participant's Recent or Saved reference remains, including Trash and Overflow. History alone does not retain a replay. Public/Region v3 archives and permanent Stage records are outside this cleanup worker. Legacy v1–v3 games remain readable through adapters; incomplete old history stays legacy, without fabricated Compact moves. Existing in-progress private rooms keep the legacy save behavior; new private rooms use explicit Saved and Compact Recent. Full Saved capacity never blocks terminal completion.

The server owns disclosure. Public, Region, Private and Recent share the Compact internal format but receive scope-specific safe projections. Browser roles cannot read raw archive payload tables or invoke sensitive storage functions. The record and replay do not expose model weights, private draw order, physical tile IDs or reasoning. A future public-function grant must be made explicitly. A stable digest supports integrity, not cross-user deduplication.

## Proposed commit boundaries (do not commit in this review)

1. Compact format, legal corpus, replay projection and codec tests.
2. Ranked private revisions and Stage score floor.
3. Archive read security, safe replay and the scoped SQL helper/ACL regression updates.
4. Stage terminal authority and Stage SQL tests.
5. History schema, UI, API and tests.
6. Recent schema, retention and tests.
7. Saved schema, explicit Save endpoint and tests.
8. Trash/Overflow lifecycle, private autosave cutover and normal terminal capture.
9. Manual legacy migration, source identity and capacity reconciliation fix.
10. Deferred cleanup migration, scheduler, retention and race tests.
11. Production ArchBot integration regression, bundle rebuilds, benchmark/report updates and final gate.

Several tracked files mix these concerns (`.gitignore`, `package.json`, `supabase/config.toml`, `src/App.tsx`, `src/remoteRooms.ts`); stage by hunk. Every new migration, SQL smoke, endpoint, Compact module, fixture, document and cleanup race script is visible as untracked and ready for deliberate staging. The backup patch/tar and safety stash remain outside the proposed commits. No temporary simulation artifacts, secrets or local database material are present in the worktree.

## Later release order (requires a separate Product Owner decision)

1. Back up production and perform read-only preflight: exact 19-version ledger, Postgres/`pg_cron` availability, cleanup job-name availability and private-room cohort size.
2. Dry-run production migration push and confirm exactly the 16 filenames above.
3. Deploy the five new Edge endpoints and the rebuilt Ranked bundle if its source digest changed; do not expose new web calls yet.
4. Apply the 16 migrations in order with normal push semantics.
5. Verify the cleanup job's owner, schedule and successful runs; monitor the initial queue.
6. Deploy the web, refresh service workers, and smoke Friend, Authur, ArchBot, Stage, History, Recent, Save, Trash/Restore and full-capacity finish. Keep Ranked on its separate authority path.
7. Monitor terminal errors, replay opens, queue age, cron failures, storage growth and capacity reconciliation latency.
8. Run History backfill and Saved legacy migration only as later explicit operator actions, after their own dry runs.

Before migrations, stop freely. After new History/Recent/Saved rows exist, use forward fixes; do not drop or truncate their tables. The cleanup job can be paused without losing payloads. Do not restore broad browser snapshot grants.

## Remaining limitations

* Normal, ArchBot and Stage intermediate gameplay authority is still client trusted. Competitive move authority belongs to the separate Competitive Security track; it does not block Storage & Sync's truthful capture and disclosure boundary.
* The old canonical-revision SQL fixture still needs its unique-name correction in its own maintenance change; its corrected diagnostic passes.
* Production `pg_cron`, version, ledger and job-name preflight is required immediately before any release. No production access occurred in this milestone.
* The actual release sequencing above must be approved separately. This worktree is ready for hunk-level commits and Product Owner review only.

**GAME STORAGE & SYNC READY TO COMMIT**
