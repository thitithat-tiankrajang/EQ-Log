# EQ Lab in production

The operator's reference: what runs where, how it is configured, how a release
goes out, and how to take it back. Written 2026-09-26 during the production
campaign; `docs/production-readiness.md` holds the launch policy and the checks
that still need named owners.

## 1. Architecture

```
 browser ──HTTPS──► Vercel (static SPA, this repository)
    │                  COOP/COEP headers from vercel.json (threaded WASM)
    │
    ├──HTTPS──► Supabase project (Postgres + Auth + Realtime + Edge Functions)
    │              RLS on every public table; the browser holds only the
    │              publishable (anon) key and the user's own JWT
    │              Edge Function `ranked` (service role, server-owned ranked state)
    │
    └──HTTPS/SSE─► engine service (engine-algo repo, service/Dockerfile)
                   Hono/Node + native amath_cli, Stage 5B runtime, Authur runtime
                   calls Postgres AS THE CALLING USER (no service-role key)
```

| Component                | Source                                                                | Hosting                                                  | Deployed from                                                                           |
| ------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Web client               | `EQ-Log` `main`                                                       | Vercel project `eq-log` (team `thitithats-projects`)     | Git push to `main` deploys Production automatically; any other branch deploys a Preview |
| Database, Auth, Realtime | `EQ-Log` `supabase/migrations`                                        | Supabase project `ilhtcsnndlcsyfdznoow` (ap-southeast-1) | `supabase db push` (by hand)                                                            |
| Edge Function `ranked`   | `EQ-Log` `supabase/functions/ranked`                                  | same Supabase project                                    | `supabase functions deploy ranked` (by hand)                                            |
| Engine service           | `engine-algo` `main`, `service/Dockerfile` (build context: repo root) | Render web service `math-engine-algo`                    | Render dashboard                                                                        |

Pushing to `EQ-Log` `main` **is** a production release of the web client.
Work goes on a branch until the release gate passes.

## 2. What is and is not part of the product

| Capability                                                  | Production               | Notes                                                                         |
| ----------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| Accounts (Google sign-in), approval, regions, invites       | yes                      | admin approval gates everything                                               |
| Live rooms, spectating, archive, private library            | yes                      | Supabase RPCs + RLS                                                           |
| Aether bot (medium/hard/max/super) and turn analysis        | yes                      | engine service; `super` may run in the browser when `CLIENT_SIDE_SUPER` is on |
| Authur bot                                                  | yes                      | browser worker (`src/bot/authur`); server runner for `authur_strong` rooms    |
| Study (board entry, Stage 5B answer)                        | yes                      | engine service `stage5b64`                                                    |
| Ranked                                                      | yes                      | Edge Function `ranked`, hidden racks, Elo                                     |
| Survival practice on approved levels                        | yes                      | levels are rows in `survival_levels`, played as ordinary rooms                |
| Board Vision photo import                                   | off by default           | build with `VITE_BOARD_IMPORT=1` to enable                                    |
| Study puzzle generator, admin archive, `#/play/study:…`     | **local developer tool** | Vite dev-server API over a local folder; absent from production builds        |
| Survival level generator and playtest (`#/play/survival:…`) | **local developer tool** | same                                                                          |

The two local tools need things that are not in git: the rules bundles in
`tools/survival-generator/.vendor/` (built by `build-vendor.mjs` from the private
`../amath-bot-lab` checkout) and a sibling `../amath-engine` with `make cli`.
Their filesystem APIs are mounted only by `npm run dev`; nothing of them is
reachable on the deployed site.

## 3. Environments

|             | Web client                                          | Database                                                   | Engine                                                 |
| ----------- | --------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| development | `npm run dev` on 127.0.0.1:5173                     | production project, or a local Supabase (`supabase start`) | `npm run dev:local` in `amath-engine/service` on :8788 |
| test / CI   | vitest, Playwright in local-only mode (no Supabase) | none                                                       | none                                                   |
| staging     | `vite build` + `vite preview`, or a Vercel Preview  | local Supabase built from `supabase/migrations`            | the service Docker image                               |
| production  | Vercel Production                                   | Supabase `ilhtcsnndlcsyfdznoow`                            | Render `math-engine-algo`                              |

There is no hosted staging project. Staging is a local Supabase stack built from
this repository's migrations (it reproduces production's schema and privileges
exactly; see §6), the real engine image, and the production web build.

## 4. Environment variables

Never commit values. `.env`, `.env.*` and `service/.env.local` are ignored.

### Web client (build time; Vercel → Project → Settings → Environment Variables)

| Name                     | Required                        | Secret           | Shape                                             | Effect                                                       |
| ------------------------ | ------------------------------- | ---------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| `VITE_SUPABASE_URL`      | yes for accounts                | no               | `https://<ref>.supabase.co`                       | blank = local-only mode (no accounts, rooms in localStorage) |
| `VITE_SUPABASE_ANON_KEY` | yes for accounts                | no (publishable) | `sb_publishable_…` or legacy anon JWT             |                                                              |
| `VITE_ENGINE_API_URL`    | for bots/analysis/Study answers | no               | `https://<engine-host>` origin, no trailing slash | blank = bots and Analyze hidden                              |
| `VITE_BOARD_IMPORT`      | no                              | no               | `1`                                               | enables photo import in production builds                    |

Everything prefixed `VITE_` is compiled into public JavaScript. Nothing secret may
ever use that prefix.

### Engine service (runtime; Render → Environment)

| Name                                                                                                                                                                                                                                         | Required    | Secret | Default                       | Notes                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----------------------------- | -------------------------------------------------------------------------------------- |
| `SUPABASE_URL`                                                                                                                                                                                                                               | yes         | no     | —                             | refuses to start without it                                                            |
| `SUPABASE_PUBLISHABLE_KEY`                                                                                                                                                                                                                   | yes         | no     | —                             | the same publishable key as the web client; the service never holds a service-role key |
| `ENGINE_ALLOWED_ORIGINS`                                                                                                                                                                                                                     | yes         | no     | —                             | exact origins, comma-separated, e.g. `https://eq-log.vercel.app`; `*` is refused       |
| `PORT`                                                                                                                                                                                                                                       | no          | no     | 8787                          | Render sets it                                                                         |
| `ENGINE_CONCURRENCY`                                                                                                                                                                                                                         | recommended | no     | derived from cgroup CPU quota | set explicitly on hosts that expose no quota                                           |
| `ENGINE_BUDGET_ENFORCED`                                                                                                                                                                                                                     | no          | no     | `true`                        | **never `false` on a shared deployment** (the service warns at boot)                   |
| `ENGINE_ANALYSIS_BUDGETED`                                                                                                                                                                                                                   | no          | no     | `false`                       | analysis is limited to 1 in flight per user; turn this on to meter it too              |
| `ENGINE_MAX_WAITING`, `ENGINE_MAX_QUEUE_WAIT_MS`, `ENGINE_MAX_BODY_BYTES`, `ENGINE_BUDGET_PER_WINDOW`, `ENGINE_BUDGET_WINDOW_MS`, `ENGINE_MAX_ANALYSIS_PER_USER`, `ENGINE_*_TTL_MS`, `ENGINE_JOB_CACHE_MAX`, `ENGINE_VALIDATION_CONCURRENCY` | no          | no     | see `service/src/config.ts`   |                                                                                        |
| `CLIENT_SIDE_SUPER`, `SUPER_ADAPTIVE_BUDGET`                                                                                                                                                                                                 | no          | no     | `false`                       | client-side Super rollout switches                                                     |

### Edge Function `ranked`

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: provided by
Supabase automatically. The service-role key exists only there.

### Database runtime secret

`private.runtime_secrets` row `room_code_secret` (≥ 32 random characters) must
exist before rooms can be created. Set it once per database with
`supabase/room_code_secret_setup.example.sql` (fill the value in the SQL editor;
do not save it to a file).

## 5. Build

```bash
npm ci
npm run check          # format, lint, typecheck, unit tests, production build
npm run build:ranked   # only when supabase/functions/ranked or its shared rules change
```

Engine image (from the engine-algo checkout, repository root):

```bash
docker build -f service/Dockerfile -t amath-engine-service:<sha> .
```

The image carries the native engine, the Stage 5B runtime and weights
(`service/stage5b`) and the Authur runtime and models (`service/authur`).

### Vendored engine artifacts in this repository

`src/bot/engine/amath_engine.mjs` (single-threaded) and `amath_engine_mt.mjs`
(threaded) are committed build outputs of engine-algo. The threaded one is built
from engine-algo `parallel-sample-loop` @ 9ab2a58, not from `main`: the parallel
sample loop and its `wasm-mt` Makefile target have not been merged to engine-algo
`main`. That is why `tests/engine-in-browser.test.ts` fails its `wasm-mt` check
when a sibling `../amath-engine` checkout of `main` is present (CI has no sibling
and skips it). Rebuilding the threaded artifact requires that branch.

## 6. Database

`supabase/migrations/` is the only build input for a database:

1. `20260901000000_production_baseline.sql`: production's schema as dumped on
   2026-09-26, with its exact privileges.
2. Later migrations, in timestamp order. Each is idempotent.

A fresh database: `supabase db reset` (local) or `supabase db push` (hosted),
then set the runtime secret (§4). The files directly under `supabase/` are the
history of how production got here; they are not applied any more.

Production's `supabase_migrations.schema_migrations` predates the baseline. The
first release after this change records what production already has, without
running it:

```bash
supabase migration repair --status applied 20260901000000 20260924180000
supabase db push --dry-run    # must list only the migrations that are really new
supabase db push
```

## 7. Release order

1. Database: `supabase db push` (additive migrations only; see §9 for anything else).
2. Edge Functions, if changed: `npm run build:ranked && supabase functions deploy ranked`.
3. Engine service: deploy the image built from engine-algo `main`; wait for
   `GET /health` to answer `{"ok":true}`.
4. Web client: merge to `EQ-Log` `main` (Vercel builds and promotes it).
5. Verify on the production URL (§8).

## 8. Post-release checks

- `https://eq-log.vercel.app` loads; deep links (`#/study`, `#/ranked`, a room URL) load on refresh.
- `curl https://<engine-host>/health` → `ok: true`; the boot log shows the CPU line and `budget: … per user`.
- Sign in, open a bot room, the bot moves; Analyze on your own turn returns a Stage 5B answer.
- Study: enter a board and rack, get an answer.
- Ranked: two approved accounts create → join → ready → move → finish → rating.

## 9. Rollback

| Component      | How                                                                                                | Notes                                                                                                                                                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web client     | Vercel → Deployments → previous Production deployment → _Promote_ (or revert the commit on `main`) | instant, no data involved                                                                                                                                                                                                                                                          |
| Engine service | Render → the service → _Rollback_ to the previous deploy                                           | stateless                                                                                                                                                                                                                                                                          |
| Edge Function  | redeploy the previous `index.js` from git                                                          |                                                                                                                                                                                                                                                                                    |
| Database       | forward-fix                                                                                        | Migrations here are additive (new tables, widened checks, revoked grants). A revoke is undone by the matching `grant`; widened checks can be narrowed again only if no row uses the new value. Take a backup (Supabase → Database → Backups) before any release that changes data. |
