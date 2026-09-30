# AUTHUR / ENGINE RUNTIME FIX READY FOR REVIEW

September 30, 2026. Implementation is available in isolated `codex/authur-runtime-fix` branches. Separate local commits are created after the classified gates; exact SHAs are provided in the delivery response. No merges, deployment or production data writes. Original dirty checkouts and Storage & Sync were left untouched.

## Classified validation and observability limitations

PATCH REGRESSIONS: 0. PRE-EXISTING BASELINE FAILURES: 1 deterministic failure.

- PRE-EXISTING BASELINE / ENVIRONMENT FAILURE: the untouched web base `4b6179d305287187d0633c793de8d87f8c19c5a4`, paired with untouched engine base `dd9fb0e1d34baa4a6cd573675259cb3d14820ccb`, reproduces the same `wasm-mt` assertion at tests/engine-in-browser.test.ts:239. After a real baseline production build, that file has 13 passing tests and one failure, no skips. Full baseline: 1246 passed, one failed, 15 skipped. Same Node/npm/Vitest, lockfile, test hash and engine Makefile lineage. No expectation, target or skip was changed. See authur-runtime-baseline-validation.md for exact commands and hashes.
- DEPLOYED ENGINE SHA: UNVERIFIED. Checked public health/headers, tracked server/Dockerfile/deployment configuration, GitHub deployment records/check runs/commit statuses/webhooks/workflows, available Render CLI/config/environment and connected browser surfaces. No accessible Render revision record was found; health policy is not SHA evidence. No contradiction was found, but absence of contradictory evidence does not establish lineage.
- HISTORICAL CORS FAILURE: UNREPRODUCED / ROOT CAUSE UNKNOWN. Fresh production OPTIONS probes for jobs, analysis, analysis/cancel and bot-move all returned 204 with exact production-origin headers; read-only unauthenticated GET responses returned readable 401/404 with the same CORS policy. Only public health and synthetic unauthenticated/preflight requests were used, without accessing real games or modifying production data. Original historical status/body/request IDs remain unavailable.
- One two-worker patch run also observed an intermittent Ranked replay UI assertion. The unchanged test/page/rack are byte-identical to baseline. Isolated baseline and patch suites each passed 6/6; full baseline and final patch CI-policy run passed that suite. Repetition evidence is recorded separately; no Ranked test or source was changed. Do not claim a conclusive historical root cause for that intermittent observation.

Future observability proposal, not implemented: expose only a validated build revision in health and log it at boot, sourced from Render's documented RENDER_GIT_COMMIT (or an immutable build artifact). Never expose arbitrary environment values or credentials. [Render default environment variables](https://render.com/docs/environment-variables).

Pushes are withheld: GitHub records show automatic Vercel Preview deployments, and Render's linked branch cannot be verified. No deployment configuration was altered merely to push. The dedicated remote branches were absent when checked; exact local commit SHAs are supplied in the delivery response.

## 1–3. Budget cause, old semantics and narrow separation

The engine charged Authur's already-authorized room searches as Super (36 units) before registry deduplication. This was a second entitlement-like gate after room funding. Default enforcement: 300 cost units per account per 600000ms, in memory per service instance. Despite 'rolling/sliding' terminology, implementation is a fixed window anchored at the first charge. Eight Authur turns spend 288; the ninth is refused. Weights represent configured potential work, not measured CPU or elapsed time. Rejected attempts cost nothing. Reused/cache jobs and engine/queue failures refund once. An oversized first charge is accepted by the existing implementation; this patch does not alter that legacy policy. GET jobs/reconnect/read and cancellation never charge.

The meter predates the September allowance/Credit economy (rate limiter originated August 27). Room Analysis shares it only under ENGINE_ANALYSIS_BUDGETED (default false). Study always uses its existing cost policy. Other legacy bot policies remain.

Only Authur bot-move skips that compute charge/refund. Mode identity comes from authoritative room context, not the request body. No consumption lookup, new room marker, migration, pricing, regeneration, weekly reset, earning or plan change. create_bot_game retains its account lock, idempotent request replay and one transactional probot_charge with room creation.

## 4. Remaining infrastructure protections

- Global expensive-search queue and running-process limit remain. Production health observed concurrency 1, maximum waiting 8, maximum wait 120s; those configuration values are not changed.
- New Authur per-account limit: one outstanding expensive search, including queue time. Registry duplicates/cache reads reuse work without another slot. Slot lifetime follows job completion/failure, not observer disconnect.
- Independent Authur request-volume protection: 120 valid POST attempts per account per fixed minute, counting retries and cache hits. No cumulative game quota. Maps are swept during subsequent admission activity.
- Distinct truthful errors: bot_in_progress and request_throttled (429), queue_full (503 or SSE terminal error), with retry hints. Both JSON and SSE encode the applicable safety condition.
- JWT asymmetric verification, approved/authorized room access, controller/turn checks, authoritative canonical state, stale-revision rejection, queue-start revision revalidation and keyed deduplication remain.
- Authur's existing 30s runner deadline remains; process termination escalates to SIGKILL after 2s. Request body bound is 8KiB as configured; engine response bound is 4MiB; completed cache is bounded (default 256, 30-minute TTL). Analysis slot and validation concurrency remain separate.
- There is no added guarantee against platform OOM or outage. Container memory remains an operational boundary; no explicit new per-child heap cap was added.

## 5–6. Retry cause and behavior

App's former loop deliberately retried indefinitely, including budget and policy errors, using 1500/4000/8000ms delays and falling back to short waits when a server wait exceeded 60s. Session failure translation discarded retry detail. HTTP Retry-After was neither read nor exposed for cross-origin browser reads; SSE overload timing was absent.

Now: at most three attempts (initial plus two retries) per unchanged mounted game/revision. Only classified transient errors retry. Budget, authentication/authorization, disabled policy, malformed state, cancellation and stale/turn-rule conditions stop. Stale/turn-rule waits for authoritative state. Network/queue/engine transient errors use bounded backoff. JSON body and HTTP Retry-After use the longer valid delay; SSE/session detail is preserved. Valid long waits are honored; unrepresentable timer waits stop instead of retrying early. Cleanup cancels pending timers; in-flight server jobs may finish and be reattached. Session dedup prevents concurrent requests for a turn within a tab; server registry and revision commits make reload/two-tab work safe. Automatic exhaustion leaves the turn intact and shows an honest stopped notice. No failure makes the bot pass.

## 7–9. CORS and cancellation

Historical CORS cause remains unknown. Central Hono CORS already passed production-origin jobs OPTIONS and baseline success/error tests before behavior changes. Fresh read-only production probes also retained CORS across the relevant families. The fix does not claim to repair an unidentified proxy response.

Allowed origins before/after: exact ENGINE_ALLOWED_ORIGINS list; no added trusted origins, wildcard or cookie credentials. GET/POST/OPTIONS and Authorization/Content-Type remain. Retry-After is now centrally exposed alongside Server-Timing/X-Request-Id. Tests prove representative GET/POST successes and 400, 401, 404, 409, 429, controlled 500, 502, overload 503 and cancelled 499 retain production-origin headers. Browser real local-origin calls/preflight also pass. Responses generated outside the application cannot be corrected by its middleware.

Application analysis/cancel 409 is stale_revision: the requested revision differs from current room state. An active matching job returns 200 cancelled:true; absent/completed work returns 200 cancelled:false; a caller lacking control gets 403. These states were retained. Frontend explicitly treats readable stale cancellation as false and makes no retry. Original production 409 body is unavailable, so attribution of that historical response remains conditional on its body/lineage.

## 10–12. Economy, gameplay, Analysis/Study regressions

Real isolated Supabase RPCs prove Free with no Credit is refused; Free with Credit spends exactly one; Plus and Pro eligible allowance each spend one. Repeating the same creation request returns the same room/consumption, with no second charge. Existing allowance/capacity/weekly/regeneration rules, rollback and concurrency are covered by the original SQL smoke/adversarial/race suites, all passing.

Real Chromium + frontend + Supabase + HTTP engine completed four human pass commits alternating with real scoring Authur moves, across revisions, including reload and two tabs. Consumption count remained one and Credit balance zero. A local pre-economy fixture with a valid authoritative Authur room, August creation date and no consumption row also obtained a real bot move with no new charge. No new marker excludes old valid rooms.

Active room Analysis quick search was started, discovered through jobs and cancelled (real process, 499 coded cancellation). Stage5B64 analysis then started/read from cache. Completed cancellation was false; stale cancellation was 409. Exhausting the retained Analysis budget returned readable budget_exhausted for Analysis, while the next Authur turn still committed. Three distinct real Study medium searches saturated the one-process/two-waiting local queue: browser Authur received queue_full, waited at least 10s, made exactly one retry, then committed. Exactly one original room consumption remained.

Policy unit tests cover duplicate Authur requests, account slot reuse/failure release, volume throttle, malformed/stale/forbidden states and both JSON/SSE errors. Fake-timer tests cover three-attempt ceiling, long waits, immediate permanent stop and pending timer cleanup. Native tests verify concurrency, cancellation and timeout against real compiled processes. No relevant engine boundary is replaced by a mock in the browser integration.

## 13. Security/resource review

Simpler alternatives were considered: globally disabling the meter would weaken unrelated policies; merely raising it would retain the second gameplay gate; removing it without account admission would permit queue monopolization. The chosen separation uses the existing limiter/registry mechanisms and applies only to Authur.

Authur permits sustained authorized sequential compute where the old ration stopped it. This is intentional and increases possible sustained utilization; parallel expensive work remains bounded globally and per account. No new unauthenticated or client-supplied-position path was added. Other endpoints retain their previous protection. Bearer verification/forwarding and origin trust are unchanged. Existing general authentication/database-read flood protection still depends on platform controls; the new volume limiter is not a global DDoS defense. Limits/cache are per-instance; horizontal scaling needs shared admission/sticky registry design, outside this track.

One unchanged local Authur midgame runner measured about 228MiB maximum RSS (203MiB peak footprint) and 1.72s wall time on macOS. This is a sample, not a worst-case or Render measurement. Keep Render concurrency at 1 and its current queue bounds; increasing concurrency multiplies search memory and CPU contention. Monitor real container RSS/OOM/queue wait during an approved release. No model, evaluation, algorithm, search-strength or Stage5B parameter files changed. Dependency installation reported existing audit vulnerabilities; no dependency upgrades were introduced.

## 14. Exact validation results

| Gate | Result |
| --- | --- |
| Engine `make cli` | PASS; native production binary built |
| Engine service `npm test` after review | PASS: 13 files, 264 tests; no skips, including all 15 native-engine tests and real Stage5B |
| Engine `npm run lint`, `typecheck`, `build` | PASS |
| Engine `git diff --check` | PASS; repository has no format-check script; changed API tests were formatted |
| Frontend focused seven-suite run | PASS: 7 files, 89 tests |
| Original-session frontend full, two workers | FAIL: 1258 passed, 1 failed, 15 skipped; unchanged wasm-mt assertion |
| Continuation frontend full, two workers | FAIL: 1257 passed, 2 failed, 15 skipped; wasm-mt plus intermittent unchanged Ranked replay assertion |
| Final frontend full, CI policy `--maxWorkers=1 --testTimeout=15000` | 132 files passed, 1 failed, 1 skipped; 1258 passed, 1 failed, 15 skipped (1274 total). Sole failure: proven pre-existing wasm-mt assertion |
| Untouched exact baseline, built failing test | 13 passed, 1 failed, no skips; identical wasm-mt assertion |
| Untouched exact baseline, full two-worker suite | 132 files passed, 1 failed, 1 skipped; 1246 passed, 1 failed, 15 skipped (1262 total). Sole failure: wasm-mt |
| Isolated unchanged Ranked suite, baseline and patch | Each PASS: 6/6 |
| Frontend initial `npm run check` | FAIL at tests: seven failures under default parallelism. Reduced-worker rerun resolved six timeouts, leaving the baseline wasm-mt assertion |
| Frontend `format:check`, `lint`, `typecheck` | PASS after latest changes |
| Frontend production `npm run build` | PASS |
| `npm run test:archbot-parity` | PASS: 2 files, 101 tests |
| Local probot_economy_smoke.sql | PASS; transaction rolled back |
| Local phase3_adversarial_smoke.sql | PASS; transaction rolled back |
| Local phase3_race.sh | PASS; exactly-once/race/rollback/board-limit checks |
| Latest local Playwright runtime suite | PASS: all 3 tests, 49.1s; real engines and database; includes legacy fixture |

Earlier browser attempts exposed fixture issues (nonunique display name, desktop clipping at 720px, Chromium SSE capture limitation, cached Study work, then an invalid cache-busting score outside the existing range). Those runs were failures, not counted as passes. Fixture names/viewports/capture were corrected; uncached scores remain within validation bounds. Latest suite above passed. Original UI clipping is unchanged and documented in the harness README.

## 15–16. Files, branches and commits

Web worktree: `/Users/thitithat_tiankrajang/Desktop/EQ-Lab-authur-runtime-fix`.
Modified: src/App.tsx, src/bot/botController.ts, src/bot/engineApi.ts, src/engineSessions.ts; tests/bot-catalog.test.ts, bot-retry-delay.test.ts, engine-queue-client.test.ts, engine-reconnect-client.test.ts, engine-sessions.test.ts.
Added: playwright.authur-runtime.config.ts; tests/authur-runtime-local/runtime.local.spec.ts and README.md; this report and authur-runtime-baseline-validation.md.

Engine worktree: `/Users/thitithat_tiankrajang/Desktop/amath-engine-authur-runtime-fix`.
Modified: service/src/app.ts, config.ts, rateLimit.ts; service/tests/api.test.ts; service/README.md.
Added: docs/authur-runtime-audit.md (written before behavioral modifications).

Both branches: codex/authur-runtime-fix. Separate local commits are created after all patch-specific gates pass and the unrelated failure is proven on baseline, as authorized in the continuation. Engine commit: `4157839b2b230d47381e7388c4055bdf8362ea0f`. The frontend commit includes this report; its exact SHA is provided in the final delivery response to avoid a self-referential hash. Dedicated remote branches were absent and remain unpushed under the deployment-safety condition. Base SHAs are listed above. No generated keys, env files, traces, logs, database dumps or temporary fixtures are part of the patch.

## 17–18. Remaining risks and proposed release order

The narrow patch is ready for review with the classifications above; it does not claim unknown production history is resolved. Before an approved release, verify Render deployment lineage/configuration, retain the baseline failure visibly, and plan to capture status/body/request IDs if missing CORS recurs. No unrelated build target is required for this patch. Existing desktop action clipping at 1280×720 is a separate UI issue. Render worst-case memory has not been measured. Per-instance limits and bounded automatic retry exhaustion require operational/user recovery during genuine prolonged outages.

After Product Owner release approval:

1. Review the separate local engine and web commits from these verified source lineages, verify the actual deployed engine lineage and push/release configuration, and authorize release. No database migration is proposed.
2. Release the engine first with current explicit production origin, concurrency 1, queue/wait limits and Analysis/Study environment policy preserved. Verify public health reports room-authorized Authur, allowed-origin preflight/errors, legacy-room continuation, duplicate requests and queue admission. Watch RSS/OOM and queue latency.
3. Release the frontend second. Verify production browser retry timing/ceiling, reconnect, actual multi-turn commits, Analysis cancel/read and one funding consumption on a disposable authorized validation account under an explicitly approved production validation plan.
4. Observe operational results before any further changes. No release or production validation was performed in this session.

Stopped for Product Owner review.
