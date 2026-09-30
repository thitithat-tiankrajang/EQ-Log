# Authur runtime continuation — baseline proof and final review

September 30, 2026. No production data writes, deployment, merge, newly introduced test skips,
expectation weakening, missing-target fabrication or unrelated implementation.

## Exact baseline proof

Two detached, unmodified worktrees were created under
`/tmp/eq-authur-baseline-proof`:

- EQ-Lab: `4b6179d305287187d0633c793de8d87f8c19c5a4`.
- Sibling amath-engine: `dd9fb0e1d34baa4a6cd573675259cb3d14820ccb`.

Both remained clean before/after dependency installation, build and tests.
Environment matched patch gates: macOS, Node v26.6.0, npm 11.18.0,
Vitest 3.2.7 and the unchanged production package lock. Engine Makefile in
the isolated baseline matches the engine bug-fix worktree byte-for-byte.

SHA-256 evidence:

| Artifact | SHA-256 |
| --- | --- |
| Unchanged engine-in-browser.test.ts, baseline and patch | acd077a5a7dd58f3a8ae4925f3e874cb62f02fc62f74a2a982ef23de0c94cde8 |
| Unchanged frontend package-lock.json | b831b8a85dfc7c899620998ef7a2e2dccf4fd4097c19ade04f97e45506d08d8a |
| Exact dd9fb0e Makefile, baseline and engine patch | 2c1ef579eeb39d45827bcfa8dd36d02314bda88b1628eb2684825cd849e2f102 |

Commands, from the isolated baseline frontend:

```sh
npm ci
npm run build
npm test -- tests/engine-in-browser.test.ts --maxWorkers=2
npm test -- --maxWorkers=2
```

Built focused result: 13 passed, 1 failed, no skips. Identical failure:

```text
tests/engine-in-browser.test.ts:239:20
expect(source).toMatch(/^wasm-mt:/m);
```

Full baseline result: 132 files passed, 1 failed, 1 skipped; 1246 tests passed,
1 failed, 15 skipped (1262 total), 56.40s. Only wasm-mt failed.
The initial focused run without a bundle also failed that same assertion,
but skipped three bundle checks; the built run above removes that ambiguity.
No missing sibling directory was used to take the test's early return.

Classification: PRE-EXISTING BASELINE / ENVIRONMENT FAILURE. This patch does
not change the assertion or engine build configuration. The production
frontend/engine source lineages already disagree on the sibling target.

## Final patch gates

- Engine `make cli`: passed; unchanged native production CLI rebuilt.
- Engine service complete test suite: 13 files, 264 tests passed, no skips,
  including 15 real native-process tests and actual Stage5B.
- Engine lint, forced typecheck and service build: passed.
- Frontend seven focused runtime/economy/reconnect suites: 89 tests passed.
- Frontend format, lint, typecheck and production build: passed.
- ArchBot parity/determinism: 2 files, 101 tests passed.
- Real isolated economy smoke, adversarial SQL and race suites: passed.
- Real browser/Supabase/engine suite: 3 tests passed, 49.1s. Actual four-turn
  Authur commits, reload/two tabs, valid old room without a consumption row,
  Analysis cancellation/read/budget separation and real Study-induced overload
  followed by one browser retry after at least 10s. No relevant engine mock.
- Final full frontend suite using existing CI policy:
  `npm test -- --maxWorkers=1 --testTimeout=15000`: 132 files passed, 1 failed,
  1 skipped; 1258 passed, 1 failed, 15 skipped (1274 total), 134.52s. The only
  failure is the proven baseline wasm-mt assertion.
- Both diff whitespace checks passed. No engine format script exists.

PATCH REGRESSIONS: 0.
PRE-EXISTING BASELINE FAILURES: 1 deterministic failure.

An earlier continuation two-worker full patch run had 1257 passed, 2 failed,
15 skipped. Besides wasm-mt, Ranked replay failed to find its hidden-rack label.
This observation is retained rather than silently discarded. The test,
RankedMatchPage and Rack are identical to production. Isolated baseline and
patch runs each passed all six Ranked tests. Twenty focused baseline repetitions
and ten baseline repetitions paired with Study all passed; both final full
baseline and patch CI runs passed Ranked. Its unchanged revision-reset effect
and early DOM wait are timing-sensitive, but that is a source-based hypothesis,
not a conclusively reproduced root cause. No Ranked test/source was modified.
This remains an intermittent test-environment observation, not an established
new Authur regression or a claimed proven baseline failure.

## Production read-only evidence

At approximately 09:21 UTC, production health returned 200. OPTIONS returned
204 for jobs, analysis with stage5b64, analysis/cancel and bot-move; each
contained ACAO `https://eq-log.vercel.app`, explicit methods and headers.
Synthetic unauthenticated GETs returned 401 for jobs/analysis/bot-move and
404 for GET analysis/cancel (POST is the contract), all with correct ACAO.
Sample fresh request IDs: jobs OPTIONS
`3b28d494-cd8b-4b6d-aa96-15cfba82a9ec`; analysis OPTIONS
`9c80e91f-8636-4845-96d7-68416ca9f02d`; cancel OPTIONS
`a0387936-ce59-476c-ba39-17248e8144b4`. These are fresh probe IDs and cannot
identify the historical failure.

HISTORICAL CORS FAILURE: UNREPRODUCED / ROOT CAUSE UNKNOWN.
Keep exact origins and Retry-After exposure; platform-generated failures remain
a monitoring risk. Capture original status/body/request IDs upon recurrence.

DEPLOYED ENGINE SHA: UNVERIFIED.

Checked public health and response headers (no revision), tracked server and
Dockerfile (no build-revision exposure), absence of a tracked Render blueprint,
GitHub engine deployment records (empty), workflows (empty), check runs (empty),
commit statuses (empty), webhooks (empty), no Render CLI executable/config,
no Render environment variables in this local session, and no connected
authenticated Render browser surface. No authenticated Render API capability
was available. Current remote main is not evidence of the deployed SHA.

Future proposal only: expose a validated build revision in health and boot logs,
from Render's documented RENDER_GIT_COMMIT or immutable build metadata; expose
no arbitrary environment values. Not implemented in this track.
[Render documentation](https://render.com/docs/environment-variables).

## Complete diff review

| Claim traced | Evidence and result |
| --- | --- |
| Authur-only separation | app.ts authenticates/loads authoritative context, validates turn/control/revision, then modeKey selects exemption. Other bot budget calls remain. Exhausted-meter multi-revision regression passes. |
| Analysis/Study unchanged | Room Analysis retains conditional charge; Study retains its existing charge and account slots. Real Analysis exhaustion does not block the next Authur commit. |
| Infrastructure remains | runQueued uses existing queue/registry, synchronous inspect/acquire/submit, promise-lifetime slot release, timeout and queue-start revalidation. Duplicate/failure/account-slot and throttle regressions pass. |
| Exactly-once economy | No economy SQL or mutations added to engine/move paths. Actual creation RPC and consumption counts across retry/reload/legacy play pass. |
| Bounded frontend retries | App per-room/revision failure state and controller scheduler cap at three; permanent/stale/cancel stop; cleanup clears timer and ignores late completion. Fake timers pass. |
| Timing preserved | HTTP header/body, SSE error detail and session status reach scheduler; real overloaded browser waits at least 10s and sends exactly two attempts before commit. |
| Origin trust unchanged | Only central exposed Retry-After added; origin/method/allowed-header/credential policy unchanged. Preflight, successes and representative error tests plus real browser pass. |
| Strength and scope unchanged | No C++ source, Authur runtime/model, Stage5B runtime/model, search parameters, Makefile, migration/economy or Storage & Sync file changed. |

Intent: let authorized Authur games continue while admission protects shared
resources. Global budget disablement would alter Analysis/Study policy; raising
the quota would preserve the erroneous second gate. The existing queue/registry
and limiter primitives provide the narrow separation without strength changes.

## Commit and push safety

Both dedicated branches are codex/authur-runtime-fix. Origins match the expected
EQ-Log and engine-algo repositories. Remote main SHAs remained the requested
bases. Dedicated remote branch refs were absent. No active local Git hooks.
Only the enumerated source/tests/docs were staged. Scans found no environment
files, literal credentials, logs, dumps or generated traces. Separate local
commits were created after these gates. Final response supplies exact local SHAs.

Pushes withheld: EQ-Log deployment records show automatic Vercel Preview
deployments; engine linked-branch/autodeploy metadata is not accessible. A push
cannot be certified to satisfy the no-deploy constraint. No deploy settings
were changed. No remote branch commit SHA exists for this patch.

Verdict: ready for Product Owner review with one visible proven baseline failure,
the intermittent observation and the two explicit production-observability
limitations. Release approval, merge and deployment are separate future steps.
