# Milestone S — minimum operator preflight

**LOCAL SECURITY CANDIDATE: GO** for the documented finite local scope.
**PRODUCTION PREFLIGHT: PASS** (2026-10-02, Milestone S §32) — Authur deployment
decided (private Render build), legacy freeze accepted, no PRE-DEPLOY blocker.
Production rollout requires separate authorization and the DEPLOY-TIME/POST gates below.

No deployment, configuration change, credential transfer, new infrastructure or
production write is requested by this checklist. Return sanitized metadata only.
Do not send secrets, credentials, connection strings, JWTs, Stage seeds/canonical,
winning replays, racks, draw state, player identifiers or raw cron commands.

## Independent preflight verification — 2026-10-02 10:40 Asia/Bangkok (03:40 UTC)

**PRODUCTION PREFLIGHT: BLOCK** (one PRE-DEPLOY blocker: Authur worker placement).
**LOCAL SECURITY CANDIDATE: GO** is unchanged. This section supersedes the
"Final three-blocker closure" PASS below on item B only; its A and C findings are
re-verified and retained. Read-only only: no code change, test rerun, production
write, provider setting change, push, merge or deployment. Tools used: Render CLI
service list, Vercel CLI project GET, Supabase CLI Management-API SELECTs and
backup listing (no MCP integrations were available in this session).

### A. Legacy rooms — re-verified; one operator decision outstanding

Fresh SELECT-only aggregate at 2026-10-02 03:40 UTC: **same 26 Normal rooms**
(0 created since the 2026-10-01 19:15 UTC snapshot); 12 playing / 7 paused /
7 waiting. Migration ledger still 36 (`20261001102600`), one active pg_cron job,
database 56192147 bytes (+73.7 KB since prior snapshot).

| Category | Rooms | Unexpired | Last touch | Cutover consequence |
| --- | ---: | ---: | --- | --- |
| Retired Aether bot games (`aether_*`) | 11 (7 playing, 1 paused, 3 waiting) | 1 | ≤ 2026-09-30 | Frozen privately; Aether is retired for new rooms; fresh game with Authur/ArchBot. |
| Local versus (`local_versus`) | 10 (2 playing, 5 paused, 3 waiting) | 0 | ≤ 2026-09-30 | Frozen privately; start a fresh local game. |
| Solo practice | 3 (2 playing, 1 paused) | 0 | ≤ 2026-08-23 | Frozen privately; start fresh. |
| Online versus (waiting) | 1 | 0 | 2026-08-12 | Never started; start a fresh room. |
| **ArchBot practice (`stage5b_standard`)** | 1 playing | 1 | **2026-10-02 03:37 UTC** | **Actively played ~3 min before observation.** Frozen privately mid-game; player must start a fresh ArchBot game. Free practice: no rating/EXP/credit/progression loss. |

No Authur, Ranked or Stage room is live, so no paid or competitive game is
interrupted and no Authur job needs reconciliation at this snapshot. Policy
coverage is complete: every category is non-terminal and maps to
freeze → private preservation → restart fresh; no fabricated completion.

Headroom: preservation input ≈ 2.7 MiB against a 56 MB database. Even at 4×
for index/TOAST/WAL overhead (~11 MiB) this is ≈ 2% of the smallest Supabase
plan database quota (500 MB). Not a blocker; re-measure under maintenance.

Recovery: `supabase backups list` returns `backups: null`, `pitr_enabled:
false` — the project has **no provider backups**. The Storage release's verified
logical snapshot (2026-09-30T17:12:35Z, 35 migrations, isolated restore exit 0,
archive SHA-256 `17ee5ce3…a89cbf`) proves the **procedure**, not current
coverage. Taking a fresh logical dump with that same procedure immediately
before the migrations is a **DEPLOY-TIME gate** (it cannot be current any
earlier). No duplicate restore drill is needed.

Remaining A item is a business decision, not a technical blocker:
**operator acceptance of the freeze** (question in the summary below).
If declined, the cutover design (not just the rollout) must be revisited, so
it should be answered before the candidate is frozen.

### B. Authur — engine identity and capacity PASS; **worker placement BLOCK**

Verified PASS:
- Render `math-engine-algo` (`srv-d9tge0740ujc73e9jcn0`): web service, repo
  `engine-algo` branch `main`, autoDeploy **no**, plan `1c-2g`, Singapore,
  1 instance, not suspended (fresh CLI read).
- Byte identity independently recomputed: the candidate's
  `src/bot/authur/strong.mjs` and three `services/trusted-bot/models/*.json`
  SHA-256 equal `service/authur/strong.mjs` and `service/authur/models/*` at the
  deployed engine commit `4157839b2b23…` (`1bfe5830…`, `e5af0445…`, `6f502bf1…`,
  `b2ea6051…`). Full-strength capacity evidence from the production Authur
  release (three Strong turns, 1 CPU / 2 GiB, concurrency 1) therefore applies to
  any **same-sized** placement running one search at a time. No new load test.

New finding — **PRE-DEPLOY BLOCKER**:
- In the candidate, Authur moves are produced **only** by the private worker
  claiming `live_bot_jobs` (`20261001103200_live_bot_recovery.sql`). The old
  browser → engine `bot-move` path is no longer imported by any live page. With
  no running worker, every Authur game stalls at its first bot turn.
- The worker is a **no-port** Node process built from this repository
  (`services/trusted-bot/Dockerfile`). The only EQ-Lab Render service is the
  `engine-algo` **web service** (different repository, must bind a port, still
  serves Analysis/Study via `VITE_ENGINE_API_URL`). Neither its deployed commit
  nor its local working tree contains any worker/`LIVE_BOT`/claim integration.
  Render has no background-worker or cron service for EQ-Lab.
- So "the existing Render placement" cannot run the candidate worker as-is. The
  two real options:
  1. **New Render Background Worker** from `EQ-Log` `services/trusted-bot/Dockerfile`,
     Standard 1 CPU / 2 GB (same envelope as the proven capacity), Singapore
     (Supabase is `ap-southeast-1`), autoDeploy off. **No EQ-Lab code change.**
     Adds one paid service.
  2. **Co-locate inside `math-engine-algo`.** Requires new `engine-algo` code
     (a second repo enters the release) **and** shares the single CPU with
     Analysis/Study, so two expensive searches could run at once — outside the
     proven concurrency-1 envelope. Not recommended.
- This is an infrastructure/cost choice only the operator can make; it decides
  which artifacts the release contains. Hence PRE-DEPLOY, not DEPLOY-TIME.

DEPLOY-TIME once placement is chosen (option 1): record image digest; set
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`LIVE_BOT_SECRET` (configured yes/no
only); `LIVE_BOT_SECRET` identical in Edge; Render background workers cap
graceful shutdown at 300 s (< candidate 360 s child timeout / 370 s compose
grace) — an in-flight search killed by a worker redeploy is reclaimed after the
10-minute lease, so pause dispatch before worker redeploys; Render restarts on
crash (supervision); job age/attempt/failure monitoring owner named.
`math-engine-algo` stays unchanged for Analysis/Study.

### C. Schedulers + Vercel — re-verified PASS

- Vercel `eq-log` (`prj_kivE4ulotuxx7gMxnQrcFcih0KRO`) → GitHub
  `thitithat-tiankrajang/EQ-Log`, **Production Branch `main`,
  `createDeployments: enabled`, no deploy hooks, no ignored-build-step command**,
  `crons.definitions: []`; production `dpl_GMsdDApHiujRfrnWm9jJiu4xrVCV` READY at
  `34d5ae6…` = worktree HEAD (fresh read).
- **Pushing or merging to `main` deploys the frontend to production
  automatically.** Release order must push only after SQL + Edge + worker gates.
- Render: 4 web services, no cron/background worker (two unrelated CTWE services
  suspended, `be-namfon` unrelated). GitHub `quality.yml` has no schedule.
  Database cron: 1 active job (completed-payload cleanup, previously reviewed).
- No manual operator lookup is needed.

### Summary

PRE-DEPLOY BLOCKERS: none (Milestone S §32). Authur worker = Render Background Worker
built from the private Authur repository; history replay leaks corrected (§31).
DEPLOY-TIME GATES: fresh logical backup by the proven procedure; maintenance
window stopping old writers; refreshed cohort/size re-check; nine migrations +
strict `production-deploy-check.sql`; Edge with `LIVE_GAME_CREATION_ENABLED=false`,
`STAGE_CREATION_ENABLED=false`; worker image digest/secrets/startup; frontend via
controlled push to `main` last.
POST-DEPLOY SMOKE: unchanged from the closure below (private Authur A/B turns,
exactly-once funding, lost-ack and worker crash/lease recovery, old clients fail
closed, frozen-room restart UX, §29 recipient and History/Replay smoke).
OPERATOR DECISIONS: closed (legacy freeze accepted; Authur deployment B).
CANDIDATE: frozen as one local commit after the §33 freeze review; not pushed.

## Final three-blocker closure — 2026-10-02 (Asia/Bangkok) — superseded on item B by the section above

**PRODUCTION PREFLIGHT: PASS for local candidate preparation.**
**LOCAL SECURITY CANDIDATE: GO. Production rollout is not authorized.**
This supersedes the three PRE blockers in the earlier read-only packet.
No broad suite, implementation change, production mutation, push, merge or
deployment was performed. Pending approval is not inferred from elapsed time.

### A. PRE-DEPLOY BLOCKERS

**None.** No unresolved fact requires changing the accepted candidate before
local freeze/review/commit preparation. Backup freshness, actual private-worker
installation and player-impact approval belong at the controlled mutation
boundary. They remain mandatory gates before rollout/opening clients.

### Legacy 26-room safety — PASS for preparation

Fresh read-only snapshot through 2026-10-01 19:15 UTC: 26 Normal rooms, no active
Stage or unfinished Ranked cohort. There are 13 Private, 12 Region and 1 Public
rooms; 12 retain the Storage legacy-private-autosave marker. No room or committed
live event changed in the last hour. This does not prove that nobody has an open
browser: the two unexpired playing rooms must be treated as potentially active.

| Lifecycle | Rooms | Expired / unexpired | Cutover consequence |
| --- | ---: | --- | --- |
| Playing | 12 | 10 / 2 | Private preservation; continuation and client commit denied; fresh game required. |
| Paused | 7 | 7 / 0 | Private preservation; old paused position cannot resume; fresh game required. |
| Waiting | 7 | 7 / 0 | Private preservation; old seats/Ready/join cannot start it; fresh room required. |

The existing migration copies the complete room row, timeline and ordered events
with a source digest to `private.live_legacy_quarantine`. Browser roles are
revoked; service-only preservation is not a playable trusted result or replay.
Visible legacy rows may be abandoned without deleting the preservation copy.
Legacy rows cease consuming playable-board quota, and expiry cleanup is restricted
to server-v1. Existing completed Storage/History/Saved records are preserved.
No automatic refund, fabricated completion or canonical export is proposed.

Observed quarantine input is **2826459 bytes (~2.70 MiB)**: room rows 2544968,
timelines 25738, events 255753. State/canonical alone is 488363 bytes and is not
the complete preservation budget. Database size remains 56118419 bytes.
Physical free space was not exposed: allocation must cover this payload **plus**
table/index/TOAST/WAL and backup overhead. Recheck actual provider disk headroom
and the refreshed cohort before migrations; abort rather than omit rows or purge
data. No invented physical-space guarantee is used to pass preparation.

One precise operator decision has been requested: accept that all 26 preserved
rooms become permanently non-resumable and players start fresh, including the
two potentially active rooms. **Status: pending. This is a DEPLOY-TIME approval,
not permission to mutate production and not a blocker to local preparation.**
If declined, do not cut over this candidate; revisit the rollout scope with the
operator. No denial or acceptance is assumed.

### Storage recovery evidence reuse — PASS

Reuse the completed Storage release's later checkpoint, not the older
19-migration backup:

- Snapshot **2026-09-30T17:12:35.141198Z**, full 35-migration database; all 93 table
  fingerprints, eight sequences, roles, ledger and application security matched
  in a fresh network-isolated restore. Both restore/verification exit codes 0;
  measured local time 8.784s. No production restore was performed.
- Retained archive exists, 5293701 bytes; its hash was freshly recomputed and
  matches `17ee5ce3e49df34ef20e2dcf44f545c11fccae2a93e754c6e02677db31a89cbf`.
- The later 36th migration only adds terminal routing; the current ledger is
  accounted for. The established recovery mechanism/runbook remains applicable.
  No duplicate restore exercise is required merely because another release is
  being prepared.
- PITR was disabled in the verified release record. The retained snapshot omits
  later writes. At the approved mutation boundary, capture/verify a current
  consistent recovery point or explicitly preserve/reconcile later writes.
  Do not treat the old snapshot as current coverage. Cloud RTO is unmeasured;
  retain the existing incident/forward-repair procedure and private records.

Sources: [completed Storage release](</Users/thitithat_tiankrajang/Desktop/Compact-Storage-Production-Release-Complete.md>),
[recovery runbook](</Users/thitithat_tiankrajang/Desktop/Compact-Storage-Recovery-Runbook.md>).
Exact parity/manifest receipts are under
`/Users/thitithat_tiankrajang/.codex/release-evidence/terminal-routing-rollout`.
Only sanitized recovery metadata was carried into these reports.

### Authur readiness — PASS for preparation

Existing production placement remains Render `math-engine-algo`
(`srv-d9tge0740ujc73e9jcn0`), Singapore Docker web service,
`engine-algo/main`, automatic deployment off. Live deployment
`dep-daueppdg1s2s73clnckg` runs exact engine commit
`4157839b2b230d47381e7388c4055bdf8362ea0f`.
One instance: **1 CPU, 2 GiB, expensive-search concurrency 1**; queue bound 8,
queue wait 120000 ms.

The accepted Authur production release demonstrated three genuine Strong replies
with reload/reconnect/deduplication on this exact capacity. The completed Storage
release subsequently demonstrated another full-strength turn on the same service.
The candidate's Strong module and three models match that production source
lineage byte for byte:

| Artifact | SHA-256 |
| --- | --- |
| Strong module | `1bfe583051812453cd047894243ebe9b44ad0569ce977bcf28bd7ee2b533ee49` |
| next-turn | `e5af04452ede84e16aea6a52cdc582363b9b2efc90708966dcfc754b8c9be966` |
| reply-opponent | `6f502bf133ee2769a966ddc1b0cb219a54c0f7ac622aaba44c6aed5ac9632f7f` |
| reply-self | `b2ea60519c4566825250809a832557ac2e92f92256684b850e7219eec34b331a` |

No duplicate load test is required for this demonstrated single-search capacity.
Finite production sampling is not an arbitrary-load or worst-case memory proof.
The old service Authur runner has a 30s deadline; the candidate wrapper uses a
360s child timeout. Preserve one expensive search and verify production runtime/
admission integration during rollout; do not claim the wrappers are identical.

Candidate worker source inventory (Dockerfile, compose, worker/runtime/health,
models, Strong module and package manifests) has deterministic manifest SHA-256
`c58e91a0ab0e8a2405baa09130d66e14a7bd94c483d64250342192b7930c4d49`.
The accepted local image is
`sha256:fe4207bb5740be8d3f2645e5099ecb94a1a1c33c49ab6a0f0a1c2388d173a6b4`,
arm64; it is local evidence, not a production registry/platform identity.
Finalization must record the release commit and production-target image digest.

Secure wiring is server-only SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
LIVE_BOT_SECRET; the private live-game gateway requires both service JWT and
X-Live-Bot-Secret. No secret value is requested or recorded. Accepted local
JWT/observer/commit/lease/recovery evidence is reused. The production old
web-service deployment does not prove that candidate private-worker wiring is
already installed. Verify compatible startup/health on the existing placement:
**do not replace a port-serving Render web service with the no-port worker image
without a compatible process/service integration.**

Candidate supervision is documented: Compose unless-stopped, heartbeat health
checks, 370s graceful stop, one child search, database revision outbox, 10m lease,
expired-lease reclaim and capped 60s retry backoff. Production supervision,
gateway acceptance and actual private commits are DEPLOY/POST gates. Stop
creation/dispatch on failure, retain jobs and privacy, then repair forward.
ArchBot remains client Stage5B64; no server-capacity requirement is introduced.

Sources: [Authur production release](</Users/thitithat_tiankrajang/Desktop/Authur-Engine-Production-Release-Report.md>),
[Storage continued-turn evidence](</Users/thitithat_tiankrajang/Desktop/Compact-Storage-Production-Release-Complete.md>),
`services/trusted-bot/README.md` and retained Milestone S recovery gates.

### Provider schedulers and main linkage — PASS

MCP read-only inventory was exhausted for relevant service/project facts.
The already-authenticated installed Vercel CLI supplies the omitted fields via
a read-only project GET, without printing environment or credential values:

- Project `prj_kivE4ulotuxx7gMxnQrcFcih0KRO` (`eq-log`) links to
  `thitithat-tiankrajang/EQ-Log`, Production Branch **main**,
  `gitProviderOptions.createDeployments=enabled`, no deploy hooks.
- Provider `crons.definitions=[]` at current production deployment
  `dpl_GMsdDApHiujRfrnWm9jJiu4xrVCV`. No Vercel production cron is configured.
- Render's complete service read including previews contains four web services,
  no cron service; the workflow CLI read returns no workflow records.
  The relevant Authur service remains autoDeploy no/off.
- The source has no Vercel queue/schedule consumer or repository cron declaration;
  its quality workflow has no scheduled trigger. Additional Vercel schedules
  reads were attempted: CLI project retrieval failed and its installed-command
  schedules GET endpoint returned 404. That unavailable beta API is not treated
  as an empty list; no corresponding scheduler path exists in the deployed app.
  Database cron remains the separately verified safe completed-payload cleanup.

**Pushing or merging this candidate to main can automatically mutate production.**
Both prior release receipts and current provider Git settings confirm it.
Local commit preparation is safe; no incidental remote push/merge is permitted.
No manual provider lookup is needed for the relevant cron/main facts retrieved
here. Refresh provider settings at rollout because future edits can change them.

### B. DEPLOY-TIME GATES — required before mutation/opening clients

1. Obtain explicit freeze/maintenance authorization; stop old-client writers
   across the SQL/Edge/frontend/worker cutover. New Edge flags alone cannot stop
   old deployed endpoints. Keep Stage creation disabled.
2. Refresh aggregate counts and private preservation sizing under maintenance;
   verify disk/WAL/backup headroom and a current recovery point using the proven
   procedure. Apply exactly nine pending migrations and run strict
   `production-deploy-check.sql`; missing preservation/grant/publication/service
   checks abort. Preserve room/timeline/events and compare the signed snapshot.
3. Control Vercel's enabled main deployment trigger through the approved release
   order; no push/merge before authorization and SQL/Edge prerequisites.
4. Verify production-target worker/image/platform identity, compatible service
   startup/health and public-service continuity, single expensive-search admission,
   private JWT/secret wiring, supervision, and named alert/rollback ownership.
   Actual candidate configuration is installed only during authorized rollout.

### C. POST-DEPLOY SMOKE — before opening affected creation paths

- Actual private Authur A/B turns, exactly-once move/funding, lost acknowledgement
  and worker crash/lease recovery; inspect queue age, attempts and failure events.
- Old installed clients fail closed/reload; frozen rooms show restart behavior;
  fresh secure creation works; no fake result or raw/quarantine disclosure.
- Retain the finite §29 recipient, Normal/Hosted/Solo/Direct/Ranked and
  History/Recent/Saved/terminal/Replay smoke. Playable Stage smoke remains NOT
  APPLICABLE while unavailable; draft/admin secrecy/refusal checks still apply.
- Observe health/RSS/OOM/restarts, queues, terminal errors and cleanup jobs.
  Failure stops creation/dispatch while preserving privacy and completed records.

**Exact next step:** freeze the candidate file inventory in this existing
security worktree, review the retained changes, create the local Security release
commit and record its SHA plus frontend/Edge/worker artifact identities.
Do not push, merge or deploy. This analysis reports that next step; it has not
created a commit or authorized the cutover.

## Earlier read-only packet — superseded by final closure above

**PRODUCTION PREFLIGHT: BLOCK. LOCAL SECURITY CANDIDATE: GO remains accepted.**
This fresh-session read-only evidence supersedes the previous session's
unavailable-MCP findings. Observation window: 2026-10-01 18:27–18:39 UTC
(2026-10-02 01:27–01:39 Asia/Bangkok). No implementation change, broad suite,
production mutation, migration, deployment, restart, environment/configuration
change, Stage approval, push, merge or Live Sync optimization was performed.

### Integration callability and scope — PASS

- Supabase: actual `execute_sql` succeeds; project URL is
  `https://ilhtcsnndlcsyfdznoow.supabase.co`; transaction read-only is `on`.
  The transport also identifies `project_ref=ilhtcsnndlcsyfdznoow&read_only=true`.
  Only SELECT/catalog reads were issued; no function with write effects was invoked.
- Render: workspace/service/deploy/event/metric/log reads succeed. No workspace
  selection or production configuration was changed.
- Vercel: project, deployment and encrypted environment-name inventory reads
  succeed using the connection's default scope. Explicit team-scoped project
  access returned 403; retry in the existing connection scope succeeded.
  Deployment source-tree retrieval returned 404 and file-content retrieval 401.
  These are operation-specific limits, not an unavailable integration.
- Transient Supabase Edge-list and Render-log transport failures recovered on
  safe read retries. No credentials, environment values, player/room IDs,
  canonical payloads, Stage seeds or raw cron commands are retained here.

### Current classifications

| Evidence group | Classification | Retrieved facts / disposition |
| --- | --- | --- |
| Migration ledger | PASS | All 36 baseline versions through `20261001102600` match repository filenames; exactly nine candidate `103000`–`103800` versions remain pending. No partial candidate application. |
| Bot catalog | PASS | ArchBot `stage5b/stage5b/stage5b64/stage5b_standard/CLIENT/free`, active, enabled, new rooms allowed, v1. Authur `authur_strong/authur/super/authur_strong/SERVER/pro`, active, enabled, new rooms allowed, v2. Five Aether entries retired and disallowed for new rooms; enabled flags retain historical compatibility. No ArchBot server infrastructure is required. |
| Relevant settings | PASS | Active boards 3; private-board limit 1000; folder depth 8, folders 200; public archive 100000, region archive 1000. Saved capacities Free/Plus/Pro 100/1000/1000; Pro inherits Plus. Stage ceilings 20/40/50. Allowance capacities 0/3/10; weekly caps 0/30/300; Plus/Pro regen 30 minutes. Free regen is intentionally undecided with zero allowance; deployed `probot_allowance_at` has the Free/zero-capacity guard, so it is not an unresolved required behavior. |
| Mode/tool mappings | PASS | 48 mappings retrieved. Authur and retired Aether: analysis, bot_insight, multiverse, replay, turn_log. ArchBot, Local and Hosted: analysis, multiverse, replay, turn_log. Online and Solo: analysis, replay, turn_log. No Ranked mapping grants assistance. These product mappings do not override the candidate's recipient security gates. |
| Live counts and cutover impact | NEEDS MORE EVIDENCE | 26 Normal legacy rooms: 12 playing, 7 paused, 7 waiting; 0 Stage rooms; 0 unfinished Ranked matches. State/canonical size 488363 bytes. Full quarantine input aggregates: room rows 2544968 + timelines 25738 + events 255753 = 2826459 bytes, excluding indexes/TOAST/WAL and backup overhead. Database size 56118419 bytes. The candidate freezes all 26 legacy rooms and preserves their private room/timeline/events; it does not certify their client history or create trusted results. Snapshot must be refreshed under maintenance. Acceptance of restart/freeze impact and backup/restore coverage remain unverified. |
| PostgreSQL cron | PASS | One active job, `eq-completed-payload-cleanup`, every 5 minutes, postgres/database-owner execution. Exact command equality against the repository baseline verified without returning command text; digest `19af5a11409c9bd9e14b629e1186b10b`. Deployed function body reviewed: 10000-item batch, 10-minute grace, advisory locks, deletes only unreferenced Normal Recent/Saved legacy payloads; no live/quarantine writes. anon/authenticated/service-role EXECUTE all false. 288 successful runs and no failed-status group in the last 24 hours. |
| External scheduled jobs | NEEDS MORE EVIDENCE | Render returned four non-preview services and no cron service. Deployed frontend SHA's `vercel.json` has headers only and no repository-declared cron. Vercel project/deployment summaries omit provider cron configuration; deployment file reads were denied/unavailable. No exposed tool inventories Vercel cron state or other external schedulers. Absence is not proved by these partial provider reads. |
| Production Stage exposure/sessions | PASS | Fresh 10 draft / 0 sealed / 0 approved. RLS enabled on levels, attempts and completed attempts. Level SELECT is approved-or-admin; modifications admin-only; attempts SELECT owner-or-admin. Deployed `create_stage_attempt` locks the level and delegates to `create_stage_attempt_before_start_freeze`; delegated definition confirms approval-or-admin and rejects null sealed canonical. 3 historical attempts, all finished; 0 unfinished attempts, 0 Stage rooms, 0 Stage creation-request rows, 0 authoritative completed-attempt rows. No preservation of active Stage sessions is needed at this snapshot. |
| Playable Stage production smoke | NOT APPLICABLE | Catalog is unavailable, including to admin launch because every draft lacks sealed canonical. Keep Stage closed with candidate `STAGE_CREATION_ENABLED=false`; retain accepted local Stage security evidence. No approval/publication is requested. |
| Existing Authur placement/deployment/health | PASS | Existing Render `math-engine-algo`, service `srv-d9tge0740ujc73e9jcn0`, Singapore, Docker web service, `service/Dockerfile`, main branch, auto-deploy off, one instance, plan `1c-2g`, /health, not suspended. Live deploy `dep-daueppdg1s2s73clnckg`, engine-algo SHA `4157839b2b230d47381e7388c4055bdf8362ea0f`, completed 2026-09-30 11:05:52 UTC. Startup logs confirm native engine process and concurrency 1. This is evidence of the existing execution service; not a claim that it already runs the candidate private worker. |
| Authur capacity/private-worker rollout readiness | NEEDS MORE EVIDENCE | Live health GET: ok, running/waiting 0/0, concurrency 1, queue max 8, wait max 120000 ms; cgroup CPU 1. Authur budget room_authorized, per-account in-flight 1, requests/minute 120; clientSuper super-v11/v1, adaptive budget off. Render confirms CPU limit 1 and memory limit 2147483600 bytes. Hourly sampled memory 49061890–54001664 bytes; sampled CPU max 0.006596744 cores, single instance. These mostly-idle/hourly samples do not prove full Strong worst-case worker headroom. Immutable image/model fingerprint verification, worker runtime ceiling, candidate wiring presence and gateway acceptance, supervision and alert owner/plan are not exposed by available read tools. Render has no environment-variable read tool; no values were requested. Candidate configuration/deployment and actual private commits remain later DEPLOY/POST checks once the placement/configuration plan is verified. |
| Authur recent operational evidence | PASS (bounded window) | All 274 app-log entries retrieved in 3 pages for 2026-09-30 11:05–2026-10-01 18:35 UTC. Request statuses: 146x200, 101x204, 7x401, 3x404, 2x409; 20 bot-move-route requests including preflight/auth checks, not proof of 20 completed bot turns. No 5xx in returned request entries. Separate failure/restart/hardware/image-pull event read after latest deployment returns empty. Prior user suspend/resume events and deployment SIGTERM are recorded, not misclassified as candidate-worker recovery proof. |
| Vercel production deployment facts | PASS | `eq-log`, project `prj_kivE4ulotuxx7gMxnQrcFcih0KRO`, Vite, Node 24.x. Current/latest production `dpl_GMsdDApHiujRfrnWm9jJiu4xrVCV`, READY, git/main SHA `34d5ae676fc460bfff02fe142b5d76354206b903`, equal to worktree HEAD. Aliases include `eq-log.vercel.app`; region iad1, no alias error. Password protection off; SSO all_except_custom_domains. Production env names only: VITE_ENGINE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY. Main source deployment is verified; current auto-deploy controls/cron configuration are omitted by the tool response. Treat push to main as potentially deploying until controlled rollout plan confirms suppression/order. |
| Edge baseline / Realtime | PASS for baseline inventory; corrections remain DEPLOY | Six ACTIVE JWT-verified functions: ranked v2; archive-replay, stage-terminal, normal-terminal, save-completed-game, migrate-saved-legacy v1. `live-game` absent as expected before release. Realtime still publishes members and raw room_live; removing the latter is an expected candidate migration correction, not a fresh local code blocker. |
| Backup/maintenance/restore readiness | NEEDS MORE EVIDENCE | SQL supplies storage aggregates, not backup/PITR status, latest coverage, provider free space or tested restore readiness. Supabase's exposed tool set has no project-backup/PITR read. A concrete maintenance boundary that stops old writers, restart-impact acceptance, restore evidence and accountable cutover/rollback owners remain required by the existing release criteria. |

### Genuine remaining blockers

1. Backup/PITR coverage, tested restore readiness, preservation headroom and the
   controlled maintenance plan accepting the 26-room legacy freeze/restart impact.
2. Verified Authur candidate rollout on the existing placement: immutable
   engine/model artifact identity, full-strength resource/runtime headroom,
   private wiring/configuration plan, supervision and monitoring ownership.
   No absent service or new-host requirement is inferred; actual candidate
   deployment/JWT/commit smoke remains DEPLOY/POST work.
3. Provider-only scheduler inventory and controlled Vercel rollout controls:
   confirm provider cron state/any external writers and main auto-deploy handling.
   Database cron and deployed source configuration are already accounted for.

No manual SQL copy is needed. All available database evidence was collected
directly. The remaining items are provider metadata and operator release-plan
facts that the callable integrations do not expose; unknown is not failure,
absence or a passed gate. No fresh production evidence requires compatibility
code work. After these PRE items close, the next Security release step is §27
step 2: review the complete existing candidate, create the authorized release
commit and record immutable artifact identities, then obtain controlled rollout
authorization. That step was not executed.

### Stage release-scope determination

**B is the supported architecture choice:** an unavailable Stage catalog does
not require publishing a level merely to release a security boundary. Live Stage
launch/progression smoke can be **NOT APPLICABLE while Stage remains unavailable**;
local sealed/approved authority, secrecy, editing, progression and terminal
security evidence stays mandatory and remains valid. The earlier availability
BLOCK applies to enabling Stage, rather than automatically to the entire security
rollout.

Trace: `src/components/pages/survival/SurvivalPage.tsx:58` lists approved entries only and `:74` renders the
empty state; `:80` withholds launch for an unsealed entry, and `:110` restricts
playtest levels to development. `supabase/migrations/20260924180000_survival_levels.sql:38` restricts ordinary
reads to approved entries. `supabase/migrations/20260929140000_room_creation_charging.sql:686` requires an approved
level (admin exception) and `:691` refuses a missing sealed canonical even for
admins. Candidate `supabase/functions/live-game/index.ts:199` independently closes Stage creation
with `STAGE_CREATION_ENABLED=false`; `:210` checks the actor's RLS before reading
private inputs, then calls service-only `trusted_create_stage`. No client
canonical fallback or unsealed production fixture is needed.

Fresh production RLS/function metadata and counts now verify this scope:
10 unsealed drafts, no approved level, no Stage rooms or unfinished attempts.
Playable-level smoke is NOT APPLICABLE while Stage remains unavailable. Keep
Stage closed in the controlled rollout; refresh these counts under maintenance.
Three finished historical attempts remain retained and are not active sessions. Stage
catalog/admin metadata denial and draft-launch refusal remain production
security smoke even when a real playable-level smoke is N/A. Actual Stage
launch is BLOCK until an approved sealed eligible level and trusted execution
are verified in a separately authorized enablement; never approve/publish one
as a preflight workaround.

## Read-only collection order when integrations are available

Use the connected read-only Supabase MCP for the SQL packet below, Render for
existing Authur/service/scheduler metadata, and Vercel for production project,
deployment and scheduler metadata. Return only sanitized evidence. Operator SQL
Editor actions below are fallbacks if usable integration access remains absent.

## One read-only database action supplies items 1–6

An operator with read access opens **Supabase Dashboard → project
`ilhtcsnndlcsyfdznoow` → SQL Editor** and runs the entire
[production-preflight.sql](../tools/live-security/production-preflight.sql).
It opens a read-only transaction, selects only the fields listed below, then
rolls back. Alternatively the operator uses their already-configured private
read-only connection with `psql -X -v ON_ERROR_STOP=1 -f
tools/live-security/production-preflight.sql`; do not share that connection.
No credential is needed by this chat. Keep the observation time and project
identity with each result. Permission errors remain BLOCK; they are not empty
tables. The script has been checked against the local canonical schema.

### 1. Migration ledger

- **Exact query:** the script's `SELECT version FROM
supabase_migrations.schema_migrations ORDER BY version`.
- **Output:** version numbers only. No migration bodies, database dumps or
  credentials. Compare with the repository's canonical migration filenames.
- **PASS:** production baseline ledger is accounted for through
  `20261001102600`, no unexplained additional/missing migrations, and the nine
  candidate `103000`–`103800` versions are pending before this release.
- **BLOCK:** denied access, missing/drifted versions, or a partially applied
  candidate without an audited recovery plan. Do not push or reset to resolve it.

### 2. Stage

- **Exact queries:** the two `public.survival_levels` queries in the script:
  status counts/sealed/approved counts, then approved identifiers and eligibility.
- **Output:** `id, season_key, level_no, status, sealed, approved,
winning_replay_count, immediate_winning_moves,
shortest_winning_replay_turns`, plus aggregate counts. ID/season/level are public
  level identity; approval actor ID, generation seed, sealed canonical and replay
  bodies are never selected.
- **PASS:** the intended production Stage has an approved, sealed eligible entry
  available within plan/progression ceilings. Entries intended for launch have
  approval metadata, at least three winning replays, no immediate winning move
  and minimum winning replay length at least five, matching existing approval
  rules. Identify which public level will be used for post-deploy smoke.
- **Conditional N/A:** for a security rollout that keeps Stage unavailable, an
  empty approved/sealed catalog does not itself block the whole release. Verify
  production exposure and existing-session preservation, retain all local Stage
  security evidence, and record deferred playable-level smoke as described above.
- **BLOCK for Stage enablement:** no usable level, an unsealed/unapproved intended
  entry or eligibility mismatch. Unknown deployed exposure or a required Stage
  launch without evidence also blocks the corresponding release scope. Do not
  seal/approve/import as part of this read-only action.

### 3. Bot catalog

- **Exact query:** the `public.bot_catalog` query in the script.
- **Output:** `bot_key, engine_family, difficulty, mode_key, execution_type,
access_tier, lifecycle, enabled, new_rooms_allowed, config_version`.
  These are product metadata; no account records or engine observations.
- **PASS:** normal ArchBot is `stage5b` / `stage5b` / `stage5b64` /
  `stage5b_standard` / `CLIENT` / `free`, current active configuration and
  enabled/new-room flags agree with the locked product decision. Authur is
  `authur_strong` / `authur` / `super` / `authur_strong` / `SERVER` / `pro`, with
  the intended current flags/version. Legacy Aether remains retired for new
  rooms. Reconcile any operator overrides explicitly.
- **BLOCK:** unknown/denied identity/version/flags, weaker ArchBot strength,
  ArchBot server requirement or paid tier, mismatched Authur identity/tier, or
  unintentionally enabled unsupported/retired bot. No catalog write is requested.

### 4. Relevant settings and tool permissions

- **Exact queries:** `system_settings(key,value_int)`, the filtered
  `plan_capabilities` query, and the `game_mode_tools` → `game_modes` /
  `game_tools` join in the script.
- **Output:** system key/integer value; per Free/Plus/Pro `plan_key,
capability_key, status, value, same_as_plan` for `stage_plan_ceiling`,
  `private_drive_limit`, `probot_allowance_capacity`, `probot_regen_minutes`,
  `probot_weekly_allowance_cap`; enabled tool mappings as `mode_key,tool_key`.
  Do not include subscriptions, balances, emails, account IDs or grant notes.
- **PASS:** expected active/private-board limits, Stage ceilings, Saved capacities
  and Authur allowance/regen/weekly policy are accounted for and valid; inheritance
  resolves; enabled per-mode Replay/analysis/branch permissions match intended
  product settings; Ranked does not gain prohibited assistance/editing. ArchBot
  remains free with no material reward dependency. Record actual values, not
  assumed defaults.
- **BLOCK:** denied/missing required setting, unexplained override, unresolved
  capability inheritance/undecided required behavior, or incompatible tool/tier
  policy. These queries do not request changing settings.

### 5. Active live-game counts and freeze impact

- **Exact query:** the `public.room_live GROUP BY room_purpose,mode_key,status`
  aggregate in the script.
- **Output:** grouped purpose/mode/status/count and summed private bytes only.
  No room/owner/player IDs, names, racks or payloads. Separately retain aggregate
  snapshot time for comparison during cutover.
- **PASS:** all live categories/counts and private retention size are known;
  operator accepts which legacy sessions must freeze/restart and confirms backup/
  preservation capacity. Counts after maintenance must reconcile with this
  snapshot, allowing only explicitly recorded intervening activity.
- **BLOCK:** unknown/denied counts, unexplained unsupported live categories,
  unacceptable/unplanned restart impact, insufficient preservation/backup space
  or unaccounted count drift. Do not export canonical data into this chat.

### 6. Scheduled jobs / cron and publication

- **Exact queries:** `cron.job` metadata/digest/review flag and
  `pg_publication_tables` for `supabase_realtime` in the script.
- **Output:** `jobid, jobname, schedule, active, command_digest,
needs_authority_review`, and publication schema/table names. The operator reads
  every active job's command **privately** in the same SQL Editor or existing
  cron administration screen, then reports its purpose, whether it reads/writes
  canonical data, caller role/endpoint and compatible-authority disposition.
  A digest/regex flag alone cannot prove an unflagged command safe.
- **Redact:** complete cron SQL, embedded headers/tokens/URLs with credentials,
  private function arguments, room/account IDs. Return the digest and sanitized
  determination, not the command. Also inventory any external scheduler in the
  application's hosting provider; PostgreSQL cron is not proof none exists.
- **PASS:** every active job is explained; unsafe client/legacy writers can be
  held under an approved maintenance plan; cleanup/expiry preserves quarantine
  and completed retention; compatible jobs use trusted authority. Explicit
  Realtime table inventory supports the planned removal of raw live relations.
- **BLOCK:** unreadable/unknown job, undisclosed external scheduler, unreviewed
  command body, canonical exposure or incompatible writer without a cutover plan.
  Existing raw `room_live` publication is a known DEPLOY correction, not a PRE
  security pass. This checklist does not pause/delete jobs or publications.

## 7. Authur placement and capacity — one operator metadata record

The operator confirms Authur already has an **existing trusted server-side
production execution path**. Verify that existing placement first through the
read-only Render integration and the production frontend/Edge wiring. Do not
assume the service is absent, choose a replacement host, move Authur, or provision
infrastructure to satisfy this checklist. The previous public analysis-endpoint
record alone did not identify the trusted path; actual service/artifact/wiring
metadata and health/capacity evidence are still required. If read access cannot
identify it, ask only for the provider/service name or dashboard location, never
credentials. Any candidate worker/callback compatibility deployment remains a
later authorized rollout action, not part of preflight.

Provide only:

- Provider, region, service type/name, existing versus proposed, registry/image
  digest and supported Node/container/runtime limits; pinned Strong engine and
  three model fingerprint verification status.
- CPU/RAM allocation and process/runtime ceilings; replicas; one turn per worker
  concurrency; expected Authur + Stage demand from §5; documented capacity margin
  for unchanged Strong search; restart supervision and durable-outbox location.
  The obsolete ArchBot memory sample is not Authur capacity evidence.
- Outbound Supabase connectivity, private service-JWT acceptance by the enabled
  gateway, and presence/wiring status of `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `LIVE_BOT_SECRET` as **configured yes/no** only;
  no values. Existing deployment status/health, monitoring owner and queue/lease/
  failure alert plan. New-candidate wiring/actual commits are DEPLOY/POST checks
  if no production worker exists yet.

If the selected host already runs Docker, these exact read-only commands provide
image/resources/restart metadata without dumping environment variables:

```sh
docker inspect --format '{{.Config.Image}} {{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.RestartPolicy.Name}} {{.State.Status}}' <verified-Authur-container-name>
docker image inspect --format '{{json .RepoDigests}}' <verified-Authur-image>
```

Use the actual operator-identified names, not guesses. Zero Docker limits mean
unbounded in Docker, not zero consumption or proved provider capacity; supply
the host/provider allocation. On another provider, read the equivalent actual
service's image/resource/replica/runtime/restart settings and report the same
fields. Redact registry account/hostname if necessary, preserving the digest;
omit environment dumps and logs containing private observations/credentials.

**PASS:** verified existing placement and explicit resource/runtime limits support the pinned
full-strength Authur process and workload with documented margin; private
deployment/JWT/secret wiring, durable jobs, restart and monitoring have an
accountable rollout plan. **BLOCK:** unspecified host/provider, unavailable
limits/demand/margin, unsupported runtime/strength, only public analysis endpoint
evidence, or absent supervision/private wiring/owner plan. No ArchBot worker,
capacity reservation or server-cost evidence is required.

## 8. Backup, maintenance and release wiring

Minimum read-only operator evidence: Supabase project database backup/PITR status,
latest backup time/coverage and documented tested restore procedure; planned
ingress/database maintenance boundary for old clients; existing Vercel EQ-Log
production project's source branch/artifact release procedure; new Edge creation
flags and private Authur secret **names/configured status only**. Redact backup
download URLs, database connection strings, keys and account IDs. Do not download
or send a database dump. PASS requires preservation/restore and coordinated
SQL/Edge/frontend/worker cutover/rollback owners. Unknown coverage or a plan that
only sets new flags while old endpoints remain writable is BLOCK.

## Decision and next step

Collect this sanitized PRE evidence packet through the available integrations. The candidate remains locally
GO and production NO-GO until it is reviewed. DEPLOY queries/abort conditions,
rollout order and mandatory production smoke are in
[the 29-topic Milestone S report](live-security-milestone-s-2026-10-01.md).
This checklist grants no deployment or production write authorization.
