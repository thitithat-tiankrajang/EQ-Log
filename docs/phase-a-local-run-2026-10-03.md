# Phase A local run and manual test guide

Verified 2026-10-03, Asia/Bangkok. Work only in:

```sh
cd /Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync
```

## Why an earlier local run may not have shown Login

This worktree has **no `.env` file**, and the inspected shell had neither frontend Supabase variable set. `src/supabaseClient.ts` creates no client when either variable is absent; the existing `AuthGate` then allows local-only mode. This behavior predates Phase A. Plain `npm run dev` under that configuration opens the local application without accounts. It does not exercise real online play.

The Vite-served environment of both inherited servers, **5173 and 5191**, was also inspected without printing keys: both have neither Supabase frontend variable set. Their missing Login is therefore explained by unconfigured local-only mode.

The configured normal app now offers **Sign in locally** in development when both the frontend and the disposable API are on loopback. It uses genuine Supabase password authentication. Google remains disabled on this stack; the production Google flow is unchanged. See [the security/auth investigation](local-real-play-auth-2026-10-03.md) for the historical evidence and verification.

A previously authenticated session on the exact browser origin can also legitimately skip Login. No existing browser storage/session was cleared. The normal workflow below uses your own browser, with normal resize/maximize/fullscreen controls.

## A. NORMAL LOCAL APP

### Prerequisites and local services

- Node 22.12+ and npm; this checkout was verified with Node 26.6.0.
- Dependencies in this worktree's own `node_modules` (already present). If missing, run `npm ci` here.
- Docker Desktop running; Supabase CLI and `psql` on PATH.
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

Use **Sign in locally**, not the Google button, with the disposable accounts from Terminal 3. The password form is absent from production builds. If this exact origin already has a local session, Home can appear first; use the account Sign out control if you want to switch users.

### Terminal 3 — create your manual local accounts (once)

```sh
cd /Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync
node tools/phase-a/local.mjs accounts
```

Choose a **disposable password of at least 12 characters**, then confirm it. Input is hidden. This password is for both new local accounts; do not reuse a production password. The helper prints two **emails and display names**, never the password, service credentials or sessions. Keep those emails and the password you chose. Each run creates a new pair; it never changes an existing user.

1. In normal Chrome/Safari/etc., open **http://127.0.0.1:5192/**. Enter Player A's printed email and your chosen password under **Local email / Local password**, then **Sign in locally**.
2. In incognito/private browsing or another browser/profile, open the same URL and sign in as Player B with B's email and the same disposable password. Two tabs in one profile share one auth session; use separate profiles.
3. In A, click **Create game → Play another player**. Keep the normal online/direct mode. Choose B's printed display name under **Opponent username**. Keep Public for this basic test, then click **Create room & get invite link**.
4. In A's waiting room, click **Copy game link**. In B, click **Create game → Have a code? Join a game**, paste that link into **Room code or link**, then **Join room**.
5. A clicks **Ready**. When B shows **A ready · B not ready**, B clicks **Ready**. A clicks **Launch game**. The countdown starts the Phase-A shell.
6. Resize/maximize/fullscreen freely. Place rack tiles on the board, then **Commit**. **Pass → Confirm pass** and **Exchange → choose rack tiles → Exchange N tiles** are real authoritative turns. Refresh/reopen the same game link to continue; sessions and server state persist.

Direct human games need no Authur worker. Authur uses the existing trusted local worker; see the investigation for startup and account eligibility. No demo/fixture browser is required for this workflow. The older `demo` helper remains for automated inspection only.

### Authur (Pro) — make one account Pro, and start the trusted worker

Disposable accounts are Free, and Authur is a Pro-Bot. Make Player A Pro through the real admin grants (Player B stays Free, so the refusal can be checked too):

```sh
node tools/phase-a/local.mjs pro <Player A email>
```

It prints the plan, allowance and credits (Pro: allowance 10, 200 credits, 3 active Pro boards). Running it again changes nothing. Authur moves come from the trusted worker container; start it before an Authur or Stage game and stop it afterwards:

```sh
docker start eq-milestone-s-authur-trusted-bot-1
docker stop eq-milestone-s-authur-trusted-bot-1
```

Every mode, what to click and what to expect: [mode matrix](mode-matrix-2026-10-03.md).

### Stop only this run

- Terminal 3 exits after account creation; there is no browser/process to stop there.
- Terminal 2: Ctrl+C stops its Vite child at 5192.
- Terminal 1: Ctrl+C stops the function server you started there. Reuse an existing server rather than competing with it, and leave inherited servers alone.
- Keep the shared disposable Supabase/Docker stack running. Do not use broad process/container stop commands or reset/clear browser storage. Local accounts and unfinished games remain available for the next run.

## A2. REAL PHONE ON THE SAME WI-FI (DEV ONLY)

Use this instead of Terminal 2 when reviewing from a physical phone. Terminal 1 (local Edge functions) is still required.

```sh
cd /Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync
node tools/phase-a/local.mjs phone
```

It prints the exact address, e.g. `Open on your phone (same Wi-Fi):  http://192.168.1.36:5196/`. Type it into the phone's browser, then use **Sign in locally** with the accounts from Terminal 3 (one account per device; a desktop browser on `http://127.0.0.1:5192/` or the same LAN address can be the other player).

How it works: the dev server binds only the Mac's private LAN address (port 5196) and reverse-proxies `/auth/v1`, `/rest/v1`, `/functions/v1`, `/storage/v1` and `/realtime/v1` (websockets) to the disposable stack on the Mac's loopback. The phone talks to one origin and never to `127.0.0.1`. Authentication, RLS, Edge authority and Realtime policies are the stack's own. Plain `http` on a LAN address is not a browser "secure context", so phone mode supplies `crypto.randomUUID` from `crypto.getRandomValues` (dev-only); Copy link is unavailable there — paste or type the room link/code instead. Nothing of phone mode is in a production build.

Ctrl+C stops it. The desktop `app` command is unchanged and can run at the same time.

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
