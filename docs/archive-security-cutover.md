# Archive security cutover: pre-edit payload inventory

Inspected on branch `codex/compact-completed-game` at base `840ef0e`. This
inventory was completed before choosing or editing the cutover. Database
privileges below were derived from migrations before a local database was
available. Docker was started later and post-migration grants were measured.

| Object / owner                                                   | Internal contents                                                                                                           | Ordinary API privilege and RLS                                                                                                        | Trusted access / callers                                                           | Browser reads and exposure                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.public_game_snapshots` / `postgres`                      | `snapshot` JSONB: legacy full game, physical tile IDs, ordered bag, logs and folded `timeline`; could later hold Compact v1 | `authenticated` has per-column `SELECT(snapshot)` plus listing columns; RLS admits approved users/admin; `anon` has no selected grant | `service_role` ALL; finalizer, save/copy, public-to-region move                    | `remoteRooms.readRoom` selects raw snapshot; list uses metadata-only select                                                                                 |
| `public.region_game_snapshots` / `postgres`                      | Same full `snapshot`, folded branches, region ID                                                                            | `authenticated` has `SELECT(snapshot)`; RLS admits approved same-region user/admin                                                    | `service_role` ALL; finalizer, save/copy, moves                                    | `readRoom` raw fallback; list metadata-only                                                                                                                 |
| `public.private_library_items` / `postgres`                      | Owner's full `snapshot`, including copied Public/Region records                                                             | **Table-level** `SELECT` and `DELETE` to `authenticated`; owner-only RLS; explicit folder insert/update columns                       | `service_role` ALL; finalizer, `save_archive_to_private`, `copy_private_game_item` | `readRoom` raw fallback; list metadata-only. A saved copy bypasses a Public/Region-only revoke                                                              |
| `public.ranked_matches` / `postgres`                             | Latest authoritative Ranked `state`, both racks and bag                                                                     | No API grant or RLS policy for `anon`/`authenticated` after Ranked migration                                                          | `service_role` CRUD; Ranked Edge + `ranked_commit_match`                           | Browser receives only `rankedPublicView` from Edge                                                                                                          |
| `public.ranked_private_revisions` / `postgres` (draft migration) | Ordered private full Ranked states                                                                                          | Explicit revoke from `PUBLIC`, `anon`, `authenticated`; RLS enabled with no browser policy                                            | `service_role` `SELECT,INSERT`; transaction trigger and future trusted adapter     | No browser query                                                                                                                                            |
| `public.room_live` / `postgres`                                  | Full _live_ `state` and canonical physical inventory                                                                        | `authenticated` can select `state` and selected columns; live access RLS. No `anon` state grant                                       | `service_role` ALL; live RPCs                                                      | `readRoom` live path; deliberately outside completed archive cutover                                                                                        |
| `public.game_timelines` / `postgres`                             | Live parked branch document, including physical positions/bag                                                               | Table-level `SELECT` for `authenticated`, live access RLS                                                                             | `service_role` ALL; timeline RPCs; folded into archive snapshot on finalization    | `remoteRooms` reads live branches; finished archive inherits document in snapshot                                                                           |
| `public.live_game_events` / `postgres`                           | Live revision commands, potentially physical intent details                                                                 | Table-level `SELECT` for `authenticated`, live access RLS                                                                             | Live commit/list RPCs                                                              | Live event API, outside archive cutover                                                                                                                     |
| `public.survival_levels` / `postgres`                            | `start_canonical` sealed Stage physical inventory; seed and winning-replay evidence                                         | Latest migration grants **table-level SELECT** to `authenticated` with Stage RLS; browser `listSurvivalLevels` requests `*`           | Owner/admin seal/check functions                                                   | Existing Stage start is client-reconstructable from published seed; not a completed archive. Sealed metadata exposure needs separate Stage authority review |
| `public.survival_attempts` / `postgres`                          | Result metadata only; no durable completed game payload                                                                     | Owner/admin RLS; authenticated SELECT/result-column UPDATE                                                                            | Stage start/result paths                                                           | No replay payload exists (`archive_policy='none'`)                                                                                                          |
| `public.bot_stat_games` / `postgres`                             | Result summary only, no snapshot or bag                                                                                     | Approved-user read policy                                                                                                             | Finalizer/stat paths                                                               | No internal game payload                                                                                                                                    |

No archive payload view was found. Browser-executable archive functions
`save_archive_to_private`, `copy_private_game_item`, and
`move_public_snapshot(s)_to_region` return IDs/count/void rather than payload,
but they copy the complete snapshot internally. `get_public_archive_move_context`
returns metadata only. `get_live_game_snapshot` and `list_live_game_events`
return live canonical/event data, outside this completed read cutover. The
Ranked Edge function is the existing service-role caller for Ranked state.

The baseline grants `anon`, `authenticated`, and `service_role` ALL on
**future public tables and functions** through `ALTER DEFAULT PRIVILEGES`.
Every new payload object must override those defaults; the cutover should
remove broad future table defaults for browser roles. Effective privileges
must be inspected in PostgreSQL after applying a migration: migration text
alone cannot prove the final grant state.

## Local cutover implemented

The completed archive reader is `archive-replay`. Its request contains only a
UUID. It validates the bearer token with Supabase Auth, reads the viewer's
approval/admin/region state from `profiles`, then uses service access to find
Public, Region, or the viewer's own non-trashed Private game copy. The pure
`projectFirstAuthorizedArchive` policy selects the first eligible candidate;
`projectStoredCompletedGame` dispatches legacy and Compact v1 to the same
allowlisted replay response. An ineligible Region row does not mask an owned
Private saved copy. The browser sends no access assertion and receives no
canonical record, tile identity, ordered bag, RNG/validation metadata, or
private annotations. Final rack **faces** and recorded clocks are included as
approved by the Product Owner.

`remoteRooms.readRoom` now reads live rooms only. `#/room/:id` falls forward to
`#/play/:id` when no live row remains. The play route detects live versus
completed metadata and renders a projection-only viewer for the latter. A live
room's deletion hands a successfully fetched safe replay to that viewer;
ordinary live moves and transport remain unchanged. Public, Region, and
Private listing queries still select metadata only. No archive table is in the
`supabase_realtime` publication; `game_timelines` is a live-row child and its
parked lines are folded into the archive before that row is deleted.

The migration removes browser table-level `SELECT`, explicit `snapshot`
column grants, and broad future public table/function defaults. It regrants
only existing listing columns and folder DML. Service access remains. Future
SQL functions that browsers should call must now receive an explicit grant.
The archive Edge function, migration, and client switch must be released as
one coordinated cutover; none was deployed in this prototype.

## Security proof matrix on isolated local Supabase

A clean stack applied all migrations through
`20261001101200_archive_payload_read_cutover.sql`. The adversarial PostgreSQL
script and a real Auth + PostgREST + Edge endpoint test passed. The latter
created approved users in two regions and a pending user, tested both legacy
and Compact payloads, saved a Public game to Private, removed its Public
source, then replayed the saved copy as its owner. A non-owner request that
claimed `isOwner: true` was denied. All fixtures were cleaned up.

| Surface | Ordinary direct metadata | Ordinary direct payload | Safe endpoint | Service/internal payload |
| --- | --- | --- | --- | --- |
| Public | Approved/admin, RLS | Denied | Approved/admin, legacy and Compact passed | Allowed |
| Region | Approved member/admin, RLS | Denied | Member passed; outsider denied | Allowed |
| Private saved game | Owner, RLS | Denied, including copied Public/Region snapshot | Owner passed after Public source removal; outsider denied | Allowed |
| Ranked private revisions | None | Denied | No archive endpoint for Ranked in this cutover | Service-only; transaction smoke passed |
| Stage completed capture | No durable payload exists | Not applicable | Not applicable | Stage terminal capture remains a separate gate |

Actual `has_table_privilege` / `has_column_privilege` results after migration:

| Role | Public payload | Region payload | Private payload | Listing `name` | Table-level archive SELECT |
| --- | --- | --- | --- | --- | --- |
| `anon` | false | false | false | false | false |
| `authenticated` | false | false | false | true | false |
| `service_role` | true | true | true | true | true |

The SQL test also executed `SELECT snapshot` as an authenticated eligible
Public/Region viewer and Private owner, including both legacy and Compact
Public rows and the saved copy; all were rejected. The Ranked revision `state`
query was rejected. A newly created public table and function inherited no
browser read/execute grant. In the local HTTP test, direct PostgREST `snapshot`
selects returned errors for all three archive tables, while the projection
endpoint succeeded for eligible viewers. Effective Ranked revision grants
were checked in both SQL smoke scripts.

## Validation and remaining gates

- Archive SQL privilege smoke: pass against PostgreSQL.
- Ranked revision smoke: pass, including normal capture, stale CAS, failed
  terminal rollback, successful terminal capture, and client denial. The
  original test asserted a mutating function and its effects in one SQL
  expression; SQL did not guarantee evaluation order. Separating the call
  from its assertion made the test deterministic.
- Local endpoint integration: pass for Public legacy/Compact, Region,
  Private saved copy, raw-read denial, and forged client claims.
- Focused codec, projection, authorization, branch, and legacy tests: pass.
- Formatting, lint, typecheck, Edge bundle, and production build: pass.
- Final full unit suite with two workers: 992 passed, 5 skipped (including
  opt-in benchmark and local endpoint tests). The opt-in local endpoint test
  passed separately after a clean stack restart with the final migration and
  Edge bundle.
- The default parallel `npm run check` reached the unit suite twice and had
  unrelated timing/ordering failures: two UI timeouts in one run, and a Ranked
  UI label assertion in the next. Each affected file passed alone; the full
  suite passed with two workers. Its format/lint/typecheck stages passed.
- Run the persisted HTTP test with
  `ARCHIVE_TEST_SUPABASE_WORKDIR=/path/to/isolated/local/project npx vitest run tests/archive-replay-local.test.ts`.

This closes the **local archive disclosure gate**, not canonical Phase 4
adoption. Stage terminal authority/durable completed-attempt capture remains
unresolved. Historic rules remain fail-closed on format/rules/manifest drift;
a maintained historic validator registry is required before future rules
versions ship. Compact v1 must not yet be made canonical. No production data
was changed, migrated, or deployed.
