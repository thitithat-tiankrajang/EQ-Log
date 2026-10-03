# Accumulated live-game release readiness — 2026-10-04

**READY FOR CONTROLLED DEPLOYMENT, with public live creation and Stage creation
remaining OFF.** This is readiness to install the candidate under those controls,
not clearance to reopen creation. Production Authur/security/PWA smoke and a
production Online tentative canary remain enablement gates. No push, deployment,
product schema/data/policy/function change, or feature-flag change was performed.

Recommendation: **C — freeze a dedicated release candidate tag containing the
whole accumulated implementation.** Do not cherry-pick Phase B onto Milestone S.
Keep the existing branch history. Exact future deployment and rollback commands
are in [deploy-runbook.md](deploy-runbook.md); none were executed.

## 1. Exact release boundary

Worktree: `/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync`.
Branch: `codex/live-sync-optimization-phase1`.
HEAD: `a76c8c0b0907a7c515552246f430d2c753af8278`.
The inherited index/worktree was clean, including untracked release inputs.
Remote `main` and `release/milestone-s`, verified with `git ls-remote`, both point
to `4e1fcdc95b6305ee3ae017c2fdd8118f16088ca0`. Local `main` is older and must not
be used as the production baseline.

All eight commits form a linear chain after Milestone S:

| Commit    | Accumulated scope                    |
| --------- | ------------------------------------ |
| `58667ce` | Initial minimal live UI tools        |
| `ed40e61` | Phase A unified shell                |
| `7dbbae2` | Disposable development auth workflow |
| `d2c4249` | Owner mobile/gameplay feedback       |
| `3dc8ec7` | LAN phone development workflow       |
| `4ce7c0f` | Physical-phone follow-up UI          |
| `12b12ce` | Phase A.5 mode integration           |
| `a76c8c0` | Trusted Phase-B tentative relay      |

Ancestry from Milestone S through `4ce7c0f` → `12b12ce` → `a76c8c0` is verified.
The production-to-candidate diff is **233 files, 21,985 additions, 1,907 deletions**:
52 frontend/runtime, 4 Supabase deployable inputs, 29 tests, 10 tooling/config,
138 documentation/evidence paths. Full SHAs and exact paths are recorded in
[commits.txt](commits.txt), [files.tsv](files.tsv), and [diff-stat.txt](diff-stat.txt).

HEAD is self-contained as an accumulated checkout: relay source, reproducible
`index.js`, SQL migration, client integration and tests are committed. The Phase-B
commit alone depends on the earlier shell and mode work. It is not a smaller
standalone release onto production main.

Only these Supabase inputs change after production:

- `supabase/migrations/20261003120000_live_tentative_relay.sql`
- `supabase/functions/live-game/handler.ts`
- `supabase/functions/live-game/index.ts`
- `supabase/functions/live-game/index.js`

No other Edge bundle, worker, game codec or committed-game reducer changes in
this release. Milestone-S schema, grants, worker architecture and legacy freeze
already exist in production; do not redeploy or undo them as part of Phase B.

## 2. Actual production state, inspected read-only

| Component                 | Observed state                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend                  | Vercel `eq-log`, READY production deployment `dpl_FmmU1c4rJnUCcpYN7n3hBFbcPBmu`, main SHA `4e1fcdc…`, alias `eq-log.vercel.app`                             |
| Hosting configuration     | Vite, Node 24.x; repository COOP/COEP headers; documented main auto-deploy, so any push to main must be treated as deployment                               |
| Frontend environment      | Only `VITE_ENGINE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; production/preview targets; no values decrypted                                  |
| Supabase                  | Project `ilhtcsnndlcsyfdznoow`; all 45 pre-Phase-B local migration versions present remotely                                                                |
| Phase-B SQL               | **Absent** from migration ledger; helper and receive policy also absent                                                                                     |
| Edge functions            | All seven ACTIVE, JWT verification true; `live-game` v3, Ranked v7, archive/normal/stage terminal v6, retained save/migrate v5                              |
| Deployed live-game source | Downloaded into ignored audit staging; byte-identical to Milestone S and Phase A.5                                                                          |
| Creation controls         | `LIVE_GAME_CREATION_ENABLED=false`, `STAGE_CREATION_ENABLED=false`, confirmed by comparing secret digests to SHA-256 of `false`                             |
| Realtime                  | `realtime.messages` RLS enabled; only `live_game_broadcast_read` SELECT policy, no INSERT policy; public publication contains only `members`                |
| Hidden storage            | Authenticated table SELECT on `room_live` and `live_game_events` denied; complete deployment boundary assertions pass after the local gate correction below |
| Existing games            | 26 frozen legacy rooms; server-v1: two Authur rooms and one ArchBot room; **zero server-v1 Online rooms**                                                   |
| Authur smoke              | One waiting/draft Authur room, revision 0; one playing Authur room, revision 3, turn 1, no logged move. No bot jobs in the table                            |
| Stage catalog             | Ten drafts, no approved level; Stage remains closed                                                                                                         |

Evidence: [production-frontend.json](production-frontend.json),
[production-functions.json](production-functions.json),
[production-migrations.json](production-migrations.json),
[production-flags.json](production-flags.json),
[production-database.json](production-database.json).
The database evidence contains aggregate metadata, not racks, bag, RNG, canonical
documents, account IDs or user credentials. The current private Render worker
deployment identity was not available through the connected tools; successful
production Authur execution is still required, not inferred from local evidence.

## 3. Migration and mixed-version compatibility

The 39-line migration adds a SECURITY DEFINER boolean receive helper and one
SELECT policy on `realtime.messages`. It changes no game table, row, codec,
committed history or existing commit-channel policy. It grants no browser INSERT
or publish authority. Reapplication replaces only its own named policy and helper;
two applications in a disposable transaction succeeded and were rolled back.

The helper restricts the topic to the authenticated recipient's own seat in a
server-v1 Online room. The relay applies the stricter game/turn/revision/ownership
checks and sends only server-built public tile information to that opponent.
Old and new private topics coexist. The HTTP broadcast path is ephemeral rather
than a `realtime.send()` database write; the official
[Supabase broadcast documentation](https://supabase.com/docs/guides/realtime/broadcast)
confirms the HTTP/DB distinction and continued batch endpoint support.

| Combination                            | Result                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| New policy + old function/frontend     | Inert additional receive permission; existing committed games unchanged                                                   |
| New policy/function + old frontend     | Old UI ignores the added capability and never sends tentative proposals                                                   |
| New frontend + old function            | Missing capability is false; local drafts/commits work, tentative networking stays disabled                               |
| New frontend/function + missing policy | Private subscription fails closed; opponent overlays fail to arrive. Privacy safe but **not an acceptable rollout order** |
| All three installed                    | Online seated humans only; authoritative commits immediately replace obsolete overlays                                    |

Use **migration → live-game bundle → frontend promotion → explicitly approved
enablement**, with creation closed throughout installation. No migration or
function step should be omitted. Old browsers have no private-topic INSERT
policy and cannot publish into the trusted lane. Game seats/codecs/actions stay
compatible, and no active game needs conversion or restart.

There is **no dedicated tentative-sync kill flag** in this candidate. Creation
flags do not stop an existing game's tentative traffic. The prepared known-good
function rollback disables the capability and relay without changing committed
game authority. Keep the additive policy inert unless its removal is needed.

## 4. Focused verification and local correction

| Check                                          | Result / evidence                                                                                                                                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production-mode build + TypeScript             | PASS, [build.log](build.log); compiled with disposable public configuration and LAN dev flags deliberately set as a negative control                                                                           |
| Hidden boundary/capabilities/relay/convergence | **64/64 PASS**, four focused files, [focused-tests.log](focused-tests.log)                                                                                                                                     |
| Edge source/bundle compatibility               | Fresh esbuild output exactly matches committed candidate; deployed source exactly matches known rollback, [bundle-identities.json](bundle-identities.json)                                                     |
| Artifact isolation                             | 42 files; zero maps/sourceMappingURL, known local secret matches, credential patterns, dev auth, fixture/test-network markers, or Authur executor/model fingerprints, [artifact-scan.json](artifact-scan.json) |
| Production browser isolation                   | Fresh independent context shows Google sign-in, no disposable password form; fixture route cannot bypass auth or load fixture modules, [production-isolation.json](production-isolation.json)                  |
| Migration redeploy                             | Double-apply in disposable transaction passed, no INSERT policy, then rollback, [local-migration-reapply.log](local-migration-reapply.log)                                                                     |
| Actual production boundary gate                | Corrected read-only gate PASS, [production-boundary-gate-final.log](production-boundary-gate-final.log)                                                                                                        |
| Guard regression + targeted format/lint        | Seven SQL cases PASS; new test script passes Prettier/ESLint; diff whitespace clean                                                                                                                            |

The initial production gate failed on one canonical comparison. Diagnosis found
**no lost preservation**: all 26 snapshots and states match. One live canonical
column is SQL NULL; the preserved `to_jsonb(row)` has JSON null. The old comparison
treated them as different. The sole local correction normalizes the live null
representation in both the assertion and its summary in `tools/live-security/production-deploy-check.sql`.

`tools/live-security/legacy-preservation-check.test.mjs` extracts and exercises
the actual guard on temporary tables in the disposable database. It failed before
the correction and passes afterward, while still refusing changed state, changed
canonical data, missing copy, missing key and object-versus-null mismatches.
[legacy-guard-red.log](legacy-guard-red.log) and
[legacy-guard-green.log](legacy-guard-green.log) preserve the repro. No production
data or guard assertion was bypassed. The production gate was rerun successfully.

Existing committed evidence was retained rather than rerun broadly: Phase A's
16-spec real security browser gate; Phase A.5 genuine-auth mode matrix; Phase B's
two-client local/LAN convergence, impairment and real relay boundary runs. See
`../phase-a-final/security-browser-final.log`, `../modes/modes-verification.json`,
and `../phase-b/`. Phase-B boundary evidence shows stranger/sender topic spying
received zero messages, invalid proposals refused, and zero durable tentative
rows. Focused tests explicitly keep **Ranked tentativeSync OFF and spectator
tentativeSync OFF**; committed-game spectating retains its existing contract.

No auth/getUser optimization, Phase-B redesign, Ranked sync work or broad
historical suite was undertaken. The known sibling-repository engine test issue
was not rerun because it does not answer a release dependency question.

## 5. Remaining operator gates and final state

There is no remaining identified local implementation blocker to installation
with creation closed. There **are** unresolved public enablement gates:

1. Finish production Authur smoke using the approved owner's real account: launch
   the owned waiting game or resume the existing game, human turn → trusted bot
   move → committed projection → terminal persistence/Replay; verify worker
   identity and secrecy. Waiting-room UI is implemented and locally exercised in
   A.5, but that does not prove the old production placeholder problem is closed.
2. Complete the controlled production Online two-seat/third-viewer tentative
   canary and existing security/PWA upgrade smoke. With both flags closed and no
   server-v1 Online game, a new production canary cannot be created normally.
   Establish an explicitly approved backend maintenance/access restriction or
   operator test-room procedure first. **Do not globally reopen creation just to
   create a test room.** Frontend protection alone does not restrict API callers.
3. Keep Stage OFF. An approved/sealed production level and its separate smoke are
   prerequisites to a later Stage enablement task; this task approves no level.

Rollout and smoke decisions require the product owner's next deployment
instruction. No visual approval is granted by this audit. The later mode report
identifies `4ce7c0f` as the approved Phase-A base; the earlier Phase-A screenshot
report is historical evidence, not approval of every later change.

Raw `.log` files are local evidence and are intentionally excluded from Git.
The RC includes the gate, its regression script, documentation and sanitized
structured evidence; no credentials or raw command logs.

HEAD is unchanged at `a76c8c0`. Uncommitted takeover changes are the operator SQL
gate correction, its regression script, and this new evidence directory. No
frontend/relay implementation changed. Commit these audit changes before freezing
the dedicated RC; confirm deployable inputs remain identical to `a76c8c0`.

**Decision: READY FOR CONTROLLED DEPLOYMENT. Creation enablement remains gated.**
