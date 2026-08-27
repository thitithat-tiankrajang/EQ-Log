# Backend engine: architecture and deployment

The A-Math engine no longer runs in the browser. This document records the
architecture, the deployment steps a human must perform, and the limitations
that came with the change.

## 1. Shape of the system

```
Before:  React ──► Web Worker ──► WASM (amath_engine.mjs) ──► move
                   (engine shipped to every visitor, 252 KB)

After:   React ──► HTTPS/SSE ──► engine service (Node) ──► amath_cli (native C++)
                                        │
                                        └──► Postgres (as the CALLING USER)
                                             reads the authoritative position
```

The engine service is a small Hono/Node process that owns a queue and spawns the
compiled C++ binary, one OS process per request.

**There is one engine.** Bot play and turn analysis are the same search read out
at different depths — `topN` controls how much of the ranking is returned, and
`sampleCap` controls how much work is done. Neither adds a code path to the
engine's move generation or evaluation.

## 2. The rule the API is built around

**No endpoint accepts a position.** A caller names a game and the revision it
believes that game is at; the server reads `room_live.canonical` and refuses if
the two disagree.

An endpoint that evaluated a client-supplied board would be two bad things at
once: a free compute service with a strong engine attached, and an oracle that
leaks hidden information the moment someone describes a position they are not
entitled to know.

## 3. Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/games/:gameId/bot-move` | Compute the bot's move on its own turn |
| `GET` | `/v1/games/:gameId/bot-move?revision=N` | Reattach to a bot search already running (reconnect) |
| `GET` | `/v1/games/:gameId/bot-move/reasoning?revision=N&offset=O&limit=L` | Read the ranking behind a bot move already played, one page at a time |
| `POST` | `/v1/games/:gameId/analysis` | Analyse the human's own turn |
| `GET` | `/v1/games/:gameId/analysis?revision=N&level=L` | Reattach to a running analysis |
| `POST` | `/v1/games/:gameId/analysis/cancel` | Explicitly cancel your own analysis |
| `GET` | `/v1/games/:gameId/jobs?revision=N` | Discover what is already running for a position |
| `GET` | `/health` | Liveness and queue depth |

`POST` bodies are `{ expectedRevision, level? }`. With `Accept: text/event-stream`
the response streams `queued` → `running` → `progress`* → `result` | `error`.
`GET` may also answer `idle`, meaning "no job exists; start one if you want".

A `GET` never starts work and never spends budget.

### Why discovery is an endpoint

An analysis is identified partly by its **level**, and the level is not derivable
from the game row. So a client that lost its note about what it had started could
not find the search again — even though the registry still had it — and the only
way forward was to press Analyze and pay for it a second time. Losing that note
is ordinary: a second tab never had it, a reload can drop it, a mistimed reset
can erase it.

`GET /jobs` moves that question to the side that actually knows. It reports the
SHAPE of what exists (kind, level/difficulty, status, the engine's own progress),
never an answer: reading a result still goes through the attach endpoints, which
apply the same presentation and the same hidden-information rules. Each kind is
gated by exactly the rule its own attach endpoint applies, so discovery can never
reveal work the caller could not otherwise observe — a spectator sees an empty
list.

Responses carry `Server-Timing` with the pre-engine stages (`auth`, `context`,
`gates`) so a slow launch can be attributed to a stage rather than guessed at.
Durations only; no identifiers.

## 4. Authorization

The service holds **no service-role key** and grants itself nothing. It calls
Postgres with the *caller's* access token, so `auth.uid()` is the requesting
user and every existing policy applies unchanged. There is no second permission
model to keep in sync.

New SQL (in `supabase/engine_service_migration.sql`):

- `room_live.bot_side` / `bot_difficulty` — real columns, derived once on insert
  and **frozen** thereafter. Previously `botSide` lived only in the
  client-written `state` blob, which made "is it the bot's turn" a client
  opinion — and the analysis rule rests entirely on that answer.
- `controls_live_game_side(game, side)` — the SQL mirror of the client's
  `getRoomActorCapabilities`, composed with the existing `can_write_live_game`.
- `get_live_game_engine_context(game)` — one call returning the facts a compute
  decision needs, gated on the existing `can_read_live_game`.

### Analysis permission

Analysis assists a **human decision**, so both must hold:

1. the turn is controlled by a human — never the bot's turn; and
2. the caller is the one who controls that turn.

In a human-only room either player may analyse on their own turn. A spectator
may analyse on nobody's. Hiding the button is not one of these conditions: the
endpoint answers the same way whether or not a button was drawn.

## 5. Hidden information

Protection is **structural, not filtered**. `adapter.ts` builds the engine
request from canonical state and hands over exactly one rack — the analysed
side's. The opponent reaches the engine as an integer count, and the bag as an
integer count. No field on the wire *could* carry a tile the requester may not
see.

The bot MOVE endpoint returns **only the move**: the candidate report describes
the bot's own rack, so it is not shipped alongside an answer a client applies
mid-turn.

The report is read afterwards, by the one caller who controls that bot room, from
`GET /v1/games/:gameId/bot-move/reasoning` — **paged**, so opening the "why this
move" panel is a small request rather than a large one, and served out of the
completed search the registry already holds rather than by searching again. The
`revision` named is the one the move was COMPUTED for (one behind the board by
then), bounded to the last few revisions so it cannot be used to walk the result
cache backwards through a game. Retention is `ENGINE_BOT_RESULT_TTL_MS`; past it
the endpoint answers `reasoning_unavailable` and the panel says so rather than
printing zeros.

A spectator is refused exactly as they are on the move endpoint, and a
human-vs-human room has no engine player to explain.

> **Pre-existing property, unchanged by this work:** `get_live_game_snapshot`
> already returns the full 100-tile inventory — both racks and bag order — to
> anyone who can *read* the game, including spectators and the opposing player.
> That is load-bearing for spectator sync and was not touched. The new API does
> not depend on it and does not widen it, but it means the app's overall
> hidden-information posture is weaker than this service's. Worth a separate
> decision.

## 6. Compute protection

| Control | Value | Where |
|---|---|---|
| Concurrent engine processes | `cores − 1` | `queue.ts` |
| Queue depth before refusing | 64 | `QueueFullError` → 503 |
| Max wait in queue | 120s | `ENGINE_MAX_QUEUE_WAIT_MS` |
| Per-user budget | 60 cost units / 10 min | `rateLimit.ts` |
| Concurrent analyses per user | 1 | `ENGINE_MAX_ANALYSIS_PER_USER` |
| Request body | 8 KB | 413 |
| Per-run wall clock | per tier, up to 330s | killed from outside |

**Bot turns carry priority 0** — active gameplay is never queued behind a study
request. Identical requests are deduplicated onto one search.

Cancellation and timeout are the same operation — kill the process — which is
why one OS process per request was chosen over a long-lived worker.

## 7. Strength tiers

| Tier | How the search is bounded | Measured at an opening position |
|---|---|---|
| medium | 1s budget | ~3.4s |
| hard | 4s budget | ~3.4s |
| max | the engine's own ceilings (120s midgame / 300s endgame) | **108s, 122/160 samples** |
| super | **nothing** | **143s, 160/160 samples** |

> Measured: the simulation takes a **minimum of three opponent-rack samples**
> before any deadline can stop it, so medium and hard both land near **3.4s** at
> an opening position — they are not as fast as their budgets look.

`super` is the only tier with no wall-clock ceiling anywhere: not the mid-game
budget, not the end-game budget, not the 40s root-generation budget. It returns
when the search SCHEDULE is complete, which is why its progress line reaches a
true 100% instead of stopping wherever a deadline happened to fall — the numbers
above are the same position, and `max` gave up 38 samples short of it. The work
is finite (the sample schedule plus a node-bounded end-game proof), so it
terminates on its own; the service's `timeoutMs` for the tier is a reaper for a
wedged process, not a strength ceiling.

`easy` (200ms, static solver) is retired. Live rooms created against it keep
playing — the service resolves the stored value to `medium` when it reads them —
and finished games archived under `aether_easy` keep their record.

Analysis levels are player-chosen and independent of the room's bot, bounded by
**sample count** rather than wall clock so a level is reproducible:

| Level | Samples | Timeout | Cost |
|---|---|---|---|
| quick | 4 | 30s | 1 |
| normal | 12 | 60s | 3 |
| deep | 40 | 150s | 10 |
| max | 160 | 330s | 30 |

## 8. Deployment — steps you must perform

Nothing below has been done for you.

### 8.1 Apply the database migration

```bash
psql "$DATABASE_URL" -f supabase/engine_service_migration.sql
```

Or paste it into the Supabase SQL editor. It is a single transaction and is
safe to re-run. **Creating the file did not deploy it.**

Verify:

```sql
select bot_side, bot_difficulty, count(*) from room_live group by 1, 2;
```

Existing Aether rooms should show a side and a tier; human rooms should show
nulls.

### 8.2 Build and deploy the engine service

Build context is the **engine repository root**:

```bash
cd ../amath-engine && docker build -f service/Dockerfile -t amath-engine-service .
```

Deploy that image to Fly.io / Railway / a VPS. Give it a **real CPU limit** —
the queue sizes itself from the visible core count. One shared CPU is enough for
a few concurrent games; `max`-tier play wants two or more.

Required environment:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
ENGINE_ALLOWED_ORIGINS=https://your-app-domain
```

`ENGINE_ALLOWED_ORIGINS` is required and refuses `*`.

Check it is up: `curl https://<engine-host>/health`

### 8.3 Point the frontend at it

```
VITE_ENGINE_API_URL=https://<engine-host>
```

Rebuild and redeploy the static site. Leave it blank and the app still plays
human-vs-human; the bot and the Analyze button simply do not appear.

### 8.4 Verify

1. Open an Aether room → the bot moves, and the card shows queued/thinking.
2. On your own turn → Analyze → a recommendation with alternatives.
3. On the bot's turn → the Analyze button is disabled.
4. As a spectator → disabled, and `curl`ing the endpoint returns 403.

## 9. What happened to the WASM path

**It came back, for the `super` tier only.** This section used to say the
opposite, and the reasoning behind that has been superseded rather than
forgotten — see `../amath-engine/docs/client-side-super.md`.

A `super` move is a search that runs to completion rather than to a deadline:
a measured 180 CPU-seconds a move. Run centrally, that is **20 Super moves an
hour per core** against the dozen a game needs — roughly one to two concurrent
Super games per CPU, with everyone else queued behind a search that cannot be
interrupted. Moving it to the device removes that ceiling entirely.

So:

- `src/bot/engine/amath_engine.mjs` — the shipped artifact (`make deploy-ui`).
- `src/bot/engine/superWorker.ts` — the Web Worker that drives it.
- `src/bot/superEngine.ts` — the only module that constructs that worker.
- `tools/engine-wasm/parity.mjs` — the cross-check harness, still here, now
  pointed at the shipped artifact rather than a second copy.

Every other tier and every analysis level still goes to the backend service,
and `super` falls back to it whenever the device cannot or may not run the
search: the flag is off, the device measured too slow, the worker failed, or the
game is pinned to a weights version this deployment no longer carries.

The narrower invariant that replaced "not shipped" is asserted on every run by
`tests/engine-in-browser.test.ts`: the engine is not in the first load, it is
reached by dynamic import from one module, that module runs inside a worker, and
the backend path still exists.
