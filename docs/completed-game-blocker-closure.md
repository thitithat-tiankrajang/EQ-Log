# Compact completed-game v1: blocker closure audit

Worktree `~/.codex/worktrees/compact-completed-game/EQ-Lab`, branch
`codex/compact-completed-game`, base and HEAD
`840ef0e24a558e4392c3399bd2dd487fadb94a95`. This remains an uncommitted
prototype. No production deployment, Phase 4 storage integration, or live
protocol change occurred.

## Verdict

**CONDITIONAL PASS for the compact representation; FAIL for canonical archive
adoption today.** The representation reconstructs the legal corpus and the
allowlisted projection omits secrets. That projection is not a deployed read
boundary. Authenticated clients currently have column-level permission to
select the complete `snapshot` from approved Public/Region archive rows, and
owners can select their full Private snapshots. Applying a new compact write
format without an atomic read cutover would expose its ordered bag and physical
identities. A UI filter or an RLS row policy does not prevent this.

## Disclosure audit

| Surface                                              | Actor                         | Current data available                                                                                                                                   | Intended data                                                    | Risk                                                                   | Cutover requirement                                                                                    |
| ---------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `public_game_snapshots`                              | Approved user/admin           | Full `snapshot` column (`production_baseline.sql` grant at 4773), including ordered bag, IDs, historic logs and parked lines; RLS permits approved users | Listing fields plus safe replay projection                       | **Hard blocker**                                                       | Revoke authenticated `SELECT(snapshot)` atomically with safe replay endpoint and client switch         |
| `region_game_snapshots`                              | Approved user in region/admin | Same full `snapshot` (grant at 4861); region RLS limits rows, not columns                                                                                | Region-authorized safe replay                                    | **Hard blocker**                                                       | Same cutover, with server-checked region membership                                                    |
| `private_library_items`                              | Owner                         | Table-level authenticated `SELECT` (grant at 4673), including full `snapshot`; owner RLS                                                                 | Listing plus safe replay, even for a saved Public/Region copy    | **Hard blocker**                                                       | Replace table-level read grant with explicit listing columns and revoke payload read for browser roles |
| Archive listing                                      | Eligible client               | `listArchiveGames` and `listPrivateLibrary` select metadata only                                                                                         | Metadata only                                                    | Query itself is safe, but raw API permissions are not                  | Preserve listing grants/queries while closing payload columns                                          |
| `readRoom` archive fallback                          | Eligible client               | Public, then Region, then Private direct full-snapshot reads; `payloadFromArchive` decodes the whole game and `snapshot.timeline`                        | Authorized safe replay                                           | **Hard blocker**                                                       | Route archived reads through trusted projection endpoint; keep live path separate                      |
| `save_archive_to_private` / `copy_private_game_item` | Eligible saver/owner          | RPC returns an ID, but copies full internal `snapshot` to a Private row the owner can read                                                               | Copy/reference metadata and safe replay                          | Indirect full-payload escape after only Public/Region grant revocation | Close Private payload SELECT in same cutover; retain server-only copy access                           |
| `game_timelines`                                     | Eligible live reader          | Full parked lines while live; finalizer folds them into archive `snapshot`                                                                               | Future live design separate; completed branches safely projected | Archive inherits branch secrets                                        | Project archived branches; review live access in separate live-protocol work                           |
| `room_live.state`                                    | Eligible live reader          | Full live state, by current live design                                                                                                                  | Future server-authoritative live protocol                        | Existing live exposure outside this phase                              | Do not reuse the live grant for completed immutable records                                            |
| Ranked matches and new private revisions             | Service role only             | Full server state, including hidden positions                                                                                                            | Trusted reducer and safe published/participant replay            | New capture grants are private; SQL smoke unrun                        | Keep direct client access revoked; authorize projection by server result/participant policy            |
| Stage attempts                                       | Attempt owner/admin           | Client-reported result fields; no completed snapshot (`archive_policy = 'none'`)                                                                         | Safe published Stage replay after authoritative capture          | No durable full attempt to project; terminal score authority absent    | Add authoritative Stage completion/capture before publishing replay                                    |
| Archive finalization and migration                   | Trusted server/service role   | Internal payload needed to validate, preserve and migrate                                                                                                | Internal payload                                                 | Legitimate access                                                      | Retain service-only access; never return it through client RPC/view                                    |

The direct snapshot grants and `readRoom` fallback are the only source-code
archive read path found. History/Recent-style listing calls use metadata-only
queries; opening an item calls `readRoom`. `save_archive_to_private` and
`copy_private_game_item` return IDs rather than payloads but preserve the
copy path. The current full-payload access can be exercised through the raw
database API even if the app hides a field. Thus there is **no proof that bag
order is unavailable to ordinary clients today**; the opposite is established
by the grants.

## Minimum atomic archive cutover contract

This is an archive read migration, wider than the compact format prototype.
Do it as one guarded release, before any Compact canonical write:

1. Keep one internal immutable payload for Public, Region, Private, Ranked and
   Stage where eligible. A trusted server reads it with service credentials.
   Storage/listing/ownership metadata remains outside the game payload.
2. Introduce one versioned `readCompletedReplay(gameId, scope)` server endpoint.
   Resolve the row, owner, publication state, participant IDs and region from
   trusted database facts. Authenticate the viewer and check authorization
   **before** reading/decoding or returning content. Never accept a
   client-supplied access descriptor as authority.
3. Dispatch both Compact v1 and supported legacy v1–v3 through internal
   decoders. Preserve original legacy records; project the safe allowlist even
   when a legacy record is readable but cannot be losslessly promoted. Do not
   fabricate missing physical identity or branch positions.
4. Return only board faces/actions, final rack **face multisets**, allowed
   scores/clocks, safe bot provenance and Stage level identity. No tile IDs,
   ordered bag/draws, RNG/validation metadata, retired notes, private Host
   fields or internal digest. Use a separate explicit projection version when
   the public contract changes.
5. Switch archived `readRoom`/Replay/Study/Analysis callers to the endpoint.
   They must consume the projected replay contract and never decode an
   internal archive in the browser. Keep live room reading and writes separate.
6. In the same release, revoke browser `SELECT(snapshot)` on Public and Region
   tables, replace Private table-level `SELECT` with exact listing-column
   grants, and inspect all browser-executable functions/views for payload
   returns. Retain service-role internal access. Treat the grant changes and
   client switch as one migration; revocation alone breaks existing replay.
7. Acceptance tests must use actual `authenticated`/`anon` roles: approved
   Public viewer, matching/mismatching Region viewer, Private owner/other,
   Ranked participant/other, Stage published/unpublished, and saved archive
   copy. Verify raw `snapshot` SELECT is denied for all browser roles while
   metadata listing and authorized replay work. Search returned JSON for
   physical IDs, bag/order, secret bot fields and old notes. Test old v1–v3
   archives and parked lines as well as Compact v1.

`projectCompletedGame` is a pure prototype for step 4. It accepts an access
descriptor and therefore **must run only in a trusted process** after step 2;
calling it in a browser cannot enforce the boundary. No grant revocation or
partial archive endpoint was added here because the existing app would lose
replay and old archives would lack a safe decoder path.

## Stage score and authority

The existing Stage genesis has scores 481–500 for seed 5093. App turn commit
and surrender now use `calculateGameTotals`, which adds logged results to the
first history position's seeded baseline. A regression covers passes,
surrender, exact final replay and the safe projection; a legal corpus fixture
checks both sides' earned points add to seeded scores. The adapter compares the
exact first canonical position with the server seal and rejects score drift.
The SQL `check_stage_commit` change rejects nonterminal canonical scores below
the seal. This is only a floor, not a score reducer or a terminal guard:
`commitRoomState` sends finished games directly to `finalize_live_game`, which
does not call `check_stage_commit`. Stage's archive policy is `none`, so the
full attempt is then discarded and `survival_attempts` stores client-reported
result fields. Authoritative Stage completion and durable replay capture remain
hard blockers for making Stage a canonical source. No progression/economy was
changed.

## Ranked revision capture

The new migration captures every `ranked_matches.state` update whose new row
is `playing` or `finished`, keyed by `(match_id, revision)`. The readiness
transition yields the zero-log playing genesis; subsequent
`ranked_commit_match` calls use a locked compare-and-set and increment the
revision. The trigger writes in that same SQL transaction as match/rating/
result updates. A failed SQL statement rolls back its capture; a stale CAS
returns false and performs no update. Authenticated/anonymous roles have no
table grant or RLS policy; service role reads private capture rows. The
service-side adapter requires one match, contiguous revisions and exact
action progression. Existing old matches have only the latest state and cannot
be reconstructed losslessly.

The SQL smoke fixture covers readiness genesis, successful action capture,
stale CAS, a deliberately failing terminal transaction **after** the trigger,
and successful terminal capture. It is unexecuted because local Supabase
could not connect to Docker. The migration is therefore design-reviewed and
unit-adapter-tested, but not database-verified.

## Other representation gates

- **Physical facts:** Compact internal genesis/deltas retain 100-tile
  identities, rack order and ordered bag exactly. The safe projection emits
  face-only boards and sorted final rack faces. Reversing internal rack and
  bag order changes the internal digest but leaves the client projection
  identical in the test. This proves the pure projection's allowlist, not
  deployed secrecy.
- **Clocks:** recorded starting/final/per-turn clocks and timestamps survive
  replay and are allowed in the safe view. Ordinary live Play clocks use the
  client timer/commit path; Ranked uses Edge/server timestamps. Clock replay
  fidelity does not establish live clock authority. Handle that separately.
- **Notes:** new Compact trunk and branch records omit `note`/`stars`; old
  annotated records stay readable in original legacy form. Operational
  stop/surrender facts remain. The compact decoder does not erase old source.
- **Historic rules:** format/rules/manifest checks reject unknown values;
  recorded scores and physical outcomes replay without rerunning RNG or the
  current scorer. `historicRulesFor` has a current-version entry only. Before
  rules change, preserve a maintained historical validator/interpretation
  implementation for Study legality; a version label alone is insufficient.
- **Branches:** suffix-based branch data reconstructs exactly on current
  fixtures; incomplete legacy branch positions remain readable but not
  continuable. Heavy branches are expensive and are not represented as a
  normal unbranched game.
- **Authority marker:** provenance distinguishes `client-reported` from
  `server-reduced`, but a string inside client-submitted data proves nothing.
  Only a trusted server may stamp/verify it during a canonical write.

## Measurements and validation

Raw UTF-8 JSON; current `encodeGame` baseline and Compact record. These are
fixture measurements, not production timing guarantees.

| Validator-legal fixture       | Current bytes | Compact bytes | Saved |     Build | Read/decode | Full replay | Final seek |
| ----------------------------- | ------------: | ------------: | ----: | --------: | ----------: | ----------: | ---------: |
| 40 actions                    |       218,772 |        39,991 | 81.7% | 125.86 ms |    19.80 ms |     9.13 ms |    5.10 ms |
| 60 actions + finish (61 logs) |       368,382 |        54,818 | 85.1% | 241.65 ms |    23.08 ms |    11.29 ms |    7.81 ms |
| Natural rack-out, 39 actions  |       250,138 |        49,649 | 80.2% | 101.54 ms |    14.42 ms |     7.41 ms |    3.89 ms |

The +40-byte change against the previous gate is the explicit
`completionAuthority` field. The 60-action legal fixture is 4,818 bytes above
the provisional 50 KB target because its 61 exact logs and physical outcomes
are retained. Checkpoints remain zero: no-cache replay/seek is milliseconds
on this host; periodic checkpoints add bytes without demonstrated need.
The 40-action verbose `GameState` stringifies to ~8.7 MB versus 39,991 B for
the record, a serialized graph proxy rather than a measured heap reduction.

Full `npm run check`: format **PASS**, lint **PASS**, typecheck **PASS**,
unit tests **PASS** (985 passed, 4 skipped), production build **PASS**.
Focused Compact/Stage/Ranked/access and opt-in benchmark tests passed.
The SQL migration/smoke tests are **NOT RUN** because `supabase status` could
not reach the Docker daemon; no security grant was deployed or exercised.
`src/App.tsx` is outside the repository's formatter target and had existing
Prettier differences at the base commit. The new completed-game modules pass
a separate Prettier check. No unrelated formatting was applied.
