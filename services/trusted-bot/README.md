# Private Live Authur worker

The worker runs the canonical EQ-Log Authur Strong bundle and three pinned models.
Startup verifies all four SHA-256 fingerprints. Its observer and default search
match `src/bot/authur/worker.ts`; there is no smaller budget or fallback bot.
The runtime receives its own rack, public board/scores/counts and own pending
returns. Its anonymous unseen pool contains neither the actual human rack nor
the authoritative ordered bag, draw RNG, or hidden history.

`20261001103200_live_bot_recovery.sql` queues a revision-only job in the same
transaction as the authoritative room update, including start/resume. A browser
read is never required to repair a commit/enqueue crash window. The migration
also reconciles already-active server-v1 Authur turns. One job exists per
room/revision. Jobs, leases, and claim RPCs remain service-only.

After claiming a ten-minute lease, the worker fetches its private observation
from `live-game` using both the service-role bearer JWT and `X-Live-Bot-Secret`.
The normal JWT gateway stays enabled. The chosen proposal returns through the
same private boundary. Edge re-reads stored state, maps physical bot tile IDs,
validates the move, and commits with revision CAS and the stable job UUID.
Only a receipt leaves the callback. Humans receive their authorized projection.

An interrupted process is reclaimed after lease expiry. Failed jobs retry
without a browser, with exponential delay capped at 60 seconds. The child has a
six-minute process ceiling; incomplete generation/timeout fails rather than
substituting a weaker bot. A lost acknowledgement is resolved from the existing
command event or terminal History, without another move or charge. Paused,
stale, legacy, and removed-room jobs cannot continue.

Server-only environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (a JWT
accepted by the configured gateway), and `LIVE_BOT_SECRET` (at least 32 random
characters, identical to the Edge secret). No credential may use a `VITE_`
variable. The Compose manifest additionally requires `LIVE_BOT_IMAGE`, an image
built from this source and preferably addressed by its immutable registry digest.
Edge rollout controls are `LIVE_GAME_CREATION_ENABLED=false` (all new rooms)
and `STAGE_CREATION_ENABLED=false` (Stage independently). Existing projection
reads continue during a creation pause. Explicitly set these during maintenance.

Build from the repository root with this directory's Dockerfile; the Node base
manifest and engine/model fingerprints are pinned and npm uses the lockfile.

## Production: private Authur build

The Authur files in this public tree are the historically disclosed version and
serve local gates. Production builds the worker from a private repository
(the Authur build origin, `amath-bot-lab`) so future Authur versions never enter
this repository, a frontend build or a public artifact. That private Dockerfile
takes this shell from a reviewed EQ-Log commit, overlays the private module and
models at the same paths, and bakes their pins:

```dockerfile
FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS shell
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates
ARG EQ_LOG_COMMIT=<reviewed EQ-Log commit SHA>
RUN git init /src && git -C /src fetch --depth 1 \
      https://github.com/thitithat-tiankrajang/EQ-Log.git "$EQ_LOG_COMMIT" && \
    git -C /src checkout --detach FETCH_HEAD

FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
WORKDIR /app
COPY --from=shell /src/package.json /src/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=shell /src/services/trusted-bot services/trusted-bot
COPY strong.mjs src/bot/authur/strong.mjs
COPY models/ services/trusted-bot/models/
COPY authur.manifest.json authur.manifest.json
ENV AUTHUR_MANIFEST=/app/authur.manifest.json
USER node
CMD ["node", "services/trusted-bot/worker.mjs"]
```

`authur.manifest.json` maps the four pinned paths used by `worker.mjs` to their
SHA-256; startup refuses a missing or mismatched pin. Pin `EQ_LOG_COMMIT` in the
version-controlled Dockerfile; never declare a secret as a build argument. Render builds this from
the private repository through its GitHub App and keeps the built image, so
restarts need no registry or artifact download.

`compose.yml` supplies restart supervision, a non-root/read-only container,
private temporary storage, no exposed ports, and a 370-second graceful shutdown
window. Its health probe requires a live PID and a recent heartbeat initialized
only after a successful database claim RPC. A heartbeat proves process liveness,
not successful moves: monitor queued/failed job age, attempts, expired leases,
and bot-committed/bot-failed events separately. Persist the database outbox;
container replacement must not discard jobs. Additional workers use SKIP LOCKED.

Local gates build and run this container against the disposable Supabase stack,
exercise the enabled JWT gateway, and separately kill/restart the real worker.
No production worker, registry, credentials, or deployment platform is provisioned
by this task. Production must verify its service JWT mode and secret wiring.

Logs contain generic readiness/claim/completion/failure events with IDs/revision.
Never log observations, rack tokens, search candidates, or credentials. Rollout
must install migrations and Edge before starting workers, then verify readiness
and actual commits before opening Authur/Stage creation. Rollback stops creation
and worker dispatch while preserving durable jobs, private grants, and completed
records. Never restore raw browser reads/writes or canonical caching.

ArchBot is a free, noncompetitive practice mode. The locked product decision
keeps the unchanged full Stage5B64 module worker and pinned model in the browser.
Only the owner of a stored normal `stage5b_standard` game receives the current
bot-side search observation when the bot must act. Its rack is intentionally
inspectable by that owner. The observation has public counts and a deterministic
search sampling seed, not canonical draw RNG, ordered bag, future draws or hidden
history. This exception never applies to human competition, Ranked, Direct,
Authur or Stage. Stage continues using trusted Authur execution.

The browser submits only the selected proposal. Edge resolves the current bot
rack privately, validates the move and commits with revision CAS and a stable
command UUID through service-only `trusted_commit_practice_bot`. Concurrent polls
share one calculation; retries reuse the proposal and UUID; reload restarts from
the latest authorized observation. There is no weaker fallback. Migration
`20261001103700_archbot_client_practice.sql` restores Authur-only queueing and
cancels obsolete ArchBot queue entries without deleting their records.

Normal ArchBot completion writes practice History and advisory mode/bot stats.
It does not award rating, EXP, credits, progression, unlocks or achievements.
Stage attempt/progression and Ranked rating authorities remain separate. New
reward features must secure their authority separately; client rack visibility
does not make competitive or economic rewards trustworthy. No server ArchBot
worker, memory/capacity reservation or compute-cost preflight is required.
