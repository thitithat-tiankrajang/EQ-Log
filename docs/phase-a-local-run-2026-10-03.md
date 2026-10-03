# Phase A local run and manual test guide

Verified 2026-10-03, Asia/Bangkok. Work only in:

```sh
cd /Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync
```

## Why an earlier local run may not have shown Login

This worktree has **no `.env` file**, and the inspected shell had neither frontend Supabase variable set. `src/supabaseClient.ts` creates no client when either variable is absent; the existing `AuthGate` then allows local-only mode. This behavior predates Phase A. Plain `npm run dev` under that configuration opens the local application without accounts. It does not exercise real online play.

The Vite-served environment of both inherited servers, **5173 and 5191**, was also inspected without printing keys: both have neither Supabase frontend variable set. Their missing Login is therefore explained by unconfigured local-only mode.

The configured normal app was tested in a fresh isolated Chromium context: its first screen was **Sign in required**, with **Sign in with Google**. Google OAuth is disabled on the disposable backend. The helper below authenticates generated disposable accounts against its real GoTrue password endpoint and installs those real sessions into separate browser contexts. It does not mock auth or change AuthGate.

Other possible explanations are a persisted session on that exact origin, a fixture URL, or environment variables inherited by a previously started server. The user's earlier browser/origin was not inspected, so its exact historical cause cannot be established. No existing browser storage/session was cleared. Servers inherited at ports 5173 and 5191 were left alone; neither is the canonical configured normal run below.

## A. NORMAL LOCAL APP

### Prerequisites and local services

- Node 22.12+ and npm; this checkout was verified with Node 26.6.0.
- Dependencies in this worktree's own `node_modules` (already present). If missing, run `npm ci` here.
- Docker Desktop running; Supabase CLI and `psql` on PATH.
- Playwright Chromium installed. If missing: `npx playwright install chromium`.
- The **already-provisioned disposable Milestone-S stack** at `/private/tmp/eq-live-hidden-security-20261001`, API `127.0.0.1:54521`, database `127.0.0.1:54522`, Studio `127.0.0.1:54523`. Its auth, database, REST, Realtime, storage and gateway containers were healthy during verification.
- Existing protected files `status.private.json` and `private.env` in that disposable directory. The first contains local backend connection material; the second supplies the server-only `LIVE_BOT_SECRET`. Do not print or commit either file.
- The compiled Edge bundles in that disposable stack are the existing Milestone-S bundles. This UI change does not require rebuilding or deploying Edge functions.

These are instructions for the inspected machine, not a bootstrap for an empty/new backend. If the disposable directory or protected files are gone, restore the existing local Milestone-S environment first. Do not substitute production URLs or run a database reset.

No `.env` is needed with the helper. It passes **only** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to Vite, read from the verified local status file, and refuses another API/database. Service credentials stay in Node/server processes, never in Vite variables.

### Terminal 1 — local Edge functions

```sh
cd /Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync
supabase functions serve \
  --workdir /private/tmp/eq-live-hidden-security-20261001 \
  --env-file /private/tmp/eq-live-hidden-security-20261001/private.env
```

Expected: local Edge runtime starts and lists function URLs under `http://127.0.0.1:54521/functions/v1/`. Leave this terminal running. If an existing local function server is already serving this stack, use that server; do not start a competing one.

The Docker stack was already running and is shared with other local tests. If it has since stopped, start **that existing disposable stack** before Terminal 1:

```sh
supabase start --workdir /private/tmp/eq-live-hidden-security-20261001 >/dev/null
```

Output is suppressed because Supabase's startup summary may contain connection credentials. Never use the primary checkout or reset command.

### Terminal 2 — configured normal frontend

```sh
cd /Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync
node tools/phase-a/local.mjs app
```

Expected terminal output:

```text
VITE ... ready in ... ms
Local: http://127.0.0.1:5192/
```

Open **http://127.0.0.1:5192/** in a fresh/private browser window. The first screen should be **Sign in required**. A previously authenticated session on this exact origin can legitimately skip that screen. Do not clear it automatically. The root route is the normal lobby; actual games use `/#/play/<real-game-UUID>`.

The local Google button is present but its provider is not configured. Do not use production Google/account configuration to get around that. Use Terminal 3 for safe local authentication.

### Terminal 3 — real disposable login and real live game

```sh
cd /Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync
node tools/phase-a/local.mjs demo
```

Expected: **Real local authentication succeeded in two isolated browser sessions**, a localhost game URL, and two headed Chromium windows. The helper creates two new `example.test` accounts, approves only those new disposable profiles, signs in through real local password authentication, creates a private real game, and opens its actual route. Credentials/tokens are not printed or written to a file. Each run creates fresh disposable accounts/game; they remain in the disposable database.

1. In **Local A**, click **Ready**.
2. Wait until **Local B** shows **A ready · B not ready**, then click **Ready** there.
3. In **Local A**, click **Launch game**. After the three-second countdown, both show the new shell. A is ACTIVE; B is THINKING.
4. Play by selecting/dragging tiles or typing on the board; use Recall/Commit after placement. Pass requires confirmation. Exchange uses the selected rack tiles.
5. Inspect Notes, Bag, Record and Tools. Resize the windows to inspect the responsive layouts. Reorder the rack on either turn, then refresh to check persistence.
6. Use Match controls for pause, Coffee Break and surrender. After completing a game, Notes remain on Result; opening Replay/leaving deletes them.

The helper's automated verification (`PHASE_A_HEADLESS=1 node tools/phase-a/local.mjs demo`) exercised the same real login, both Ready commands, launch and both shell views. The wait in step 2 matters: commands use the latest authoritative revision. A stale command is rejected and refreshed rather than silently applied.

Direct human games need no Authur worker. For existing local Authur/Stage tests only, the prebuilt `eq-milestone-s-authur-trusted-bot-1` worker container is available. This guide does not enable Stage, modify production flags, or provision Authur infrastructure. `security-gate.mjs` starts that exact local worker when running the gate and restores its previous running state.

### Stop only this run

- Terminal 3: Ctrl+C closes only the helper's isolated Chromium browsers. It does not change the user's browser/session or delete the local game.
- Terminal 2: Ctrl+C stops only its Vite child at 5192.
- Terminal 1: Ctrl+C stops the function server started there. Do not stop an inherited/shared function server.
- Leave the pre-existing Supabase/Docker stack and inherited 5173/5191 servers alone. Do not use broad `pkill`, `docker stop $(...)`, reset, clean or browser-storage clearing commands.

## B. PHASE-A VISUAL FIXTURE / SANDBOX

Use a separate terminal, independently of the normal app:

```sh
cd /Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync
VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm run dev -- --port 5193
```

Expected: Vite prints **http://127.0.0.1:5193/**. Open:

```text
http://127.0.0.1:5193/#/play/live-shell-fixture:active:a
```

Login is intentionally bypassed because this sandbox starts without Supabase configuration. The fixture route is development-only and its implementation is removed from production builds. No backend or Authur worker is required.

| State         | Route suffix                         | What it shows                                        |
| ------------- | ------------------------------------ | ---------------------------------------------------- |
| ACTIVE        | `live-shell-fixture:active:a`        | Your turn, previous placement and legal own rack     |
| THINKING      | `live-shell-fixture:thinking:a`      | Opponent turn, usable own rack and Pass as Last Move |
| Opposite seat | `live-shell-fixture:active:b`        | Player B's recipient perspective                     |
| Pause request | `live-shell-fixture:pause-request:a` | Non-blocking incoming request                        |
| Paused        | `live-shell-fixture:paused:a`        | Agreement pause and resume                           |
| Last exchange | `live-shell-fixture:exchanged:a`     | Exchanged 4 tiles                                    |
| Result        | `live-shell-fixture:finished:a`      | Completed Result and Notes                           |
| Physical host | `live-shell-fixture:physical:host`   | Physical Hosted current racks and recording console  |
| Spectator     | `live-shell-fixture:active:host`     | No rack, Notes or authoritative turn actions         |

Tentative state: in ACTIVE, click row 7/column 7, press Space, then type `7`, `5`, `p`, `2` to construct the fixture's valid `7=5+2` move. Commit or Recall is then available. On a phone, **More** opens Record/Bag/Tools/Notes; on desktop these use gutters or tabs. To inspect practice, open an own turn in Record, choose Before, then Practice this position.

Fixtures use the actual reducers and recipient projection, with synthetic actors/local state. They validate layout, board/rack interaction, keyboard access, local workspace storage, tile treatment and turn/pause presentation. Refresh reconstructs the initial fixture position; saved rack order/Notes remain local. Separate windows do **not** share an authoritative game.

Fixtures cannot validate real auth, backend permissions, Realtime/reconnect, CAS/idempotency, server hidden-information boundaries, Authur execution, Stage progression/economy, or future opponent tentative networking. Use the normal app and real security gate for those. Ctrl+C stops only this fixture Vite server.

## HOW I CAN TELL I RAN THE RIGHT THING

- **NORMAL APP:** port **5192**, real local auth/backend at **54521**, fresh origin shows Sign in required, actual UUID game route, two separately authenticated players. After a reload, the server retains the game state.
- **VISUAL FIXTURE:** port **5193**, URL contains **live-shell-fixture**, no Login by design, deterministic initial position, no backend/network game state. Reload resets the fixture's gameplay position.
- Plain unconfigured `npm run dev` on 5173 is local-only mode and does not demonstrate the online auth/live flow. A server's port alone is insufficient: check both the URL and backend configuration.
- Production creation and Stage remain disabled and unchanged. Nothing in either workflow deploys, pushes or contacts production.

## Reproduce the recorded gates

From this worktree, run these sequentially; they manage only their own local processes:

```sh
node tools/phase-a/security-gate.mjs
node tools/phase-a/final-checks.mjs
LIVE_SHELL_EVIDENCE=docs/evidence/phase-a-final \
  npx playwright test -c playwright.live-shell.config.ts --output=test-results/shell
node tools/phase-a/contact-sheets.mjs
```

The real security gate uses only the existing disposable API/database, builds a local frontend preview at 4478, preserves every existing security assertion, and restores its worker/server processes. The fixture gate uses 4479 with empty Supabase variables. Logs are in `test-results/phase-a-gate`; review artifacts are in `docs/evidence/phase-a-final`.
