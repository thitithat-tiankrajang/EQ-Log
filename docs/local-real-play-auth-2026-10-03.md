# Real local play: authentication and security follow-up

Worktree: `/Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync`. Inherited clean HEAD: `ed40e61e2bfe999e6a32e5c661b8cc89ff686d25`, branch `codex/live-sync-optimization-phase1`. No other checkout, production, deployment, feature flag or Phase-B work was changed.

## A. Why local play worked before security

The immediate pre-Milestone-S tree is `34d5ae6`, parent of security candidate `4e1fcdc95b6305ee3ae017c2fdd8118f16088ca0`. Two different workflows existed:

| Historical source                                   | Actual mechanism                                                                                                                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `34d5ae6:src/supabaseClient.ts`                     | No URL/key meant no Supabase client; configured clients persisted genuine Auth sessions.                                                                                                     |
| `34d5ae6:src/auth.tsx:208` (`AuthGate`)             | `if (!configured) return children`; configured signed-out visitors saw Login, then name/approval checks.                                                                                     |
| `34d5ae6:src/app/NonPlayApplication.tsx:68,399–415` | Unconfigured mode allowed creation, generated a waiting GameState in the browser and saved it with `localRooms.createRoom`.                                                                  |
| `34d5ae6:src/rooms.ts`                              | Room index and full GameState, including both racks/bag/history, lived in that browser's localStorage. Names/member selections and the local controller were not authenticated server seats. |
| `34d5ae6:src/App.tsx:882–916`                       | Local mode let the browser manage/control the game. Configured play derived an account side from `userId` and invite IDs/email.                                                              |
| `34d5ae6:src/app/AppRoot.tsx:56`                    | With no Supabase client, play used the legacy local application.                                                                                                                             |

Thus standalone local creation/play could work **without any Supabase Auth session**. It did not access a genuine shared backend live game. The current unconfigured AuthGate still allows frontend/local development routes, but secured creation now requires a configured approved account ([NonPlayApplication](../src/app/NonPlayApplication.tsx:68)) and real live routes require the backend ([AppRoot](../src/app/AppRoot.tsx:74)).

Configured online play already required authentication before Milestone S. The pre-existing database `can_read_live_game` required approved/admin public membership, region membership, or authenticated private ownership/seat; `create_live_game` required approved/admin membership. See [baseline SQL](../supabase/migrations/20260901000000_production_baseline.sql:142) and its `create_live_game` at line 627. A grant to the `anon` role on a function did not override those checks.

Old configured clients nevertheless received canonical private game data and supplied replacement state: `34d5ae6:src/remoteRooms.ts:175,268–282,410–464,609–619` selected `state,revision,session`, submitted `target_state` at creation and submitted `target_canonical`, `target_state`, `target_session` and `target_issued_by` at commit. The old RPC still checked `can_write_live_game`, revision and idempotency and replaced session actor identity with `auth.uid()` ([baseline commit](../supabase/migrations/20260901000000_production_baseline.sql:341)). It was not unrestricted JWT impersonation; it was excessive browser access to hidden data and trust in browser-supplied gameplay state.

Classification: **B and C**. The old standalone workflow is useful for frontend/local simulation, but is not security-equivalent to genuine secured multiplayer. Restoring its auth/state bypass **for real live gameplay would be D: unsafe**.

Reproduce the historical audit without changing the checkout:

```sh
git show 34d5ae6:src/auth.tsx
git show 34d5ae6:src/app/NonPlayApplication.tsx
git show 34d5ae6:src/App.tsx
git show 34d5ae6:src/remoteRooms.ts
git diff 34d5ae6 4e1fcdc -- src/auth.tsx src/supabaseClient.ts
git show 4e1fcdc -- src/app/AppRoot.tsx src/app/NonPlayApplication.tsx src/remoteRooms.ts
```

The auth/client diff in that command is empty: Milestone S did not introduce Google Login or the unconfigured AuthGate behavior.

## B. What Milestone S changed

1. **Identity and membership:** the Edge verifies the caller's token using Supabase `auth.getUser`, obtains the trusted UUID and performs the metadata visibility check with that caller's JWT. Only then does its service client read canonical state. [Edge authentication/read](../supabase/functions/live-game/index.ts:374), [creation authentication](../supabase/functions/live-game/index.ts:131).
2. **Seats/capabilities:** stored owner and seat UUIDs drive capabilities. A request cannot select its acting seat by naming a user/side; the handler replaces GameState seat facts with the stored seats. [Handler](../supabase/functions/live-game/handler.ts:66), [capabilities](../src/liveGame/capabilities.ts:27). Waiting seat changes increment the authoritative revision; claims after play starts are rejected. [Seat revision migration](../supabase/migrations/20261001103800_live_waiting_seat_revision.sql).
3. **Projection:** the server produces a recipient allowlist from the resolved seat. Ordinary humans receive their own rack, public board/logs and counts. Authorized Physical Hosted hosts can receive both current racks. Ordered bag, RNG and hidden history remain private. [Projection](../src/liveGame/projection.ts:50).
4. **Commands:** browsers send intent, expected revision and command ID. The trusted handler applies/validates gameplay; service-only commit wrappers enforce stored seats and CAS. The legacy replacement-state RPCs/raw columns are revoked from browser roles. [Boundary migration](../supabase/migrations/20261001103000_live_hidden_information_boundary.sql:5), [trusted commit](../supabase/migrations/20261001103000_live_hidden_information_boundary.sql:83).
5. **Realtime:** the authenticated private topic policy already existed ([baseline policy](../supabase/migrations/20260901000100_baseline_outside_public.sql:29)). Milestone S removed sensitive tables from raw Postgres replication and narrowed private commit broadcasts to `gameId` and `revision`; recipients then fetch their own projection. [Migration](../supabase/migrations/20261001103000_live_hidden_information_boundary.sql:55), [client subscription](../src/liveGame/client.ts:87).
6. **Authur:** service-only revision jobs and the trusted worker replace browser execution. The worker receives a fair-player observation and commits through the trusted authority. [Worker contract](../services/trusted-bot/README.md).

No authority, projection, capability, database or worker code was changed in this follow-up.

## C. Is this problem related to security?

**Partly, with two separate causes.** Losing unconfigured standalone access to _real live creation/play_ is an intentional Milestone-S boundary. The specific Google error is a local auth-provider/UI mismatch, not a security requirement or Phase-A regression.

On the inspected running app, the frontend URL/key pointed at the correct disposable stack. `/auth/v1/settings` returned email enabled and Google disabled. Calling `/auth/v1/authorize?provider=google` reproduced HTTP 400 with `Unsupported provider: provider is not enabled`. This rules out a wrong frontend backend and confirms why the Google button fails locally. No OAuth configuration was changed.

The absence of Login on an earlier **unconfigured** run is explained by the historical local-only branch. On a **configured** origin, a persisted genuine session can also skip Login. No owner browser/session/storage was cleared or inspected through automation; fresh verification used isolated contexts.

## D. Does security require Google?

**No.** The ordinary human path is:

`Supabase Auth session → verified user UUID → membership/stored seat → capability → recipient projection`.

Those checks do not branch on Google vs email/password. Genuine local password Auth issues a session for a real `auth.users` row, and the same `auth.getUser`, `auth.uid()`, profile approval, seat, RLS, command and projection checks apply. The real UI and existing security browser gates exercised that boundary with local password users.

## E. Chosen approach

A small password form uses `supabase.auth.signInWithPassword`, and the unchanged AuthProvider observes the resulting session. The unchanged AuthGate still checks account/name/approval. The form is loaded only when `import.meta.env.DEV`, the API is exactly `http://127.0.0.1:54521`, and the frontend hostname is loopback.

The `accounts` helper asks for a hidden disposable password and creates two fresh confirmed local Auth users with approved local profiles. It prints their emails/display names, not passwords/tokens. It refuses any API/database except the inspected disposable stack and never changes an existing account. It opens no browser, creates no room, and injects no session. Google credentials/infrastructure are unnecessary.

## F. Changed files

- [AuthGate login presentation](../src/auth.tsx): guarded development-only lazy import.
- [LocalPasswordSignIn](../src/dev/LocalPasswordSignIn.tsx): genuine password login, errors, duplicate-submit guard, password clearing after submission.
- [Application styles](../src/styles/application.css): form spacing using existing styles.
- [Local runner](../tools/phase-a/local.mjs) and [account helper](../tools/phase-a/local-accounts.mjs): `accounts` command with hidden terminal input and disposable provisioning.
- [Production isolation check](../tools/phase-a/local-production-check.mjs): build/artifact scan and real production Login check.
- [Form tests](../tests/local-password-sign-in.test.tsx), [real manual-flow browser tests](../tests/local-realplay/manual.spec.ts), [focused browser config](../playwright.local-realplay.config.ts).
- [Updated local guide](phase-a-local-run-2026-10-03.md), this report and [evidence directory](evidence/local-real-play).

## G. Real local verification

Fresh independent contexts entered credentials through the local form; no session injection, auth mocks, fixture routes or fake GameState were used. A and B reached Home. A used Create → Play another player, selected B and created a real room. B used the normal Join form with A's link; the test observed the successful `join_live_game` RPC. Both clicked Ready; A clicked Launch.

The test exchanges one tile as A, passes as B, refreshes A, passes as A, disconnects/reconnects and refreshes B, then passes as B in the **same game**. After each turn it compares both recipient racks/seats with the trusted database state in the Node test process. Neither browser receives the opponent's unrevealed rack or unknown future bag identities; no canonical/bag/history/RNG/private-host rack field appears. Own exchanged tiles can remain in lawful own logs after returning to the bag; those previously known identities are distinguished from future hidden draws.

It also verifies authenticated private topic joins and decodes actual Supabase binary commit broadcasts with the installed SDK. Application commit fields are `gameId` and `revision`; the installed Supabase `realtime.send` function adds a generated transport UUID `id`. Its database definition was inspected to confirm this. The test allowlists exactly those three fields and checks the transport UUID. Both UIs observe the authoritative changes without manual refresh between turns. Resize at 1280×560 and 390×844 has no horizontal overflow. Login passes axe.

Evidence: [verification JSON](evidence/local-real-play/verification.json), [login](evidence/local-real-play/local-sign-in.png), [real ACTIVE short desktop](evidence/local-real-play/real-live-short-desktop.png), [real THINKING mobile](evidence/local-real-play/real-live-thinking-mobile.png). Passwords, tokens, full private state and raw traffic are not saved in this evidence.

The negative browser test proves wrong passwords fail, a genuine unapproved account remains at Approval pending after choosing its name, and an anonymous authority request returns 401.

## H. Authur local status

The existing `eq-milestone-s-authur-trusted-bot-1` container works with the disposable stack. The focused existing full-strength Authur browser gate completed real trusted moves, concurrent retries, refresh and terminal Replay. Its existing Stage subcase was tested on the disposable stack; this does not approve Stage or change flags.

With Terminal 1's Edge functions running, start the optional worker:

```sh
docker start eq-milestone-s-authur-trusted-bot-1
```

Use **Play Authur** in the normal app with an eligible local account and its normal plan/credit funding. The helper's new accounts are Free, not admins; it does not grant Pro or credits. The existing Authur gate provisions its own eligible disposable test account. A running worker does not bypass account eligibility. No browser execution, model/worker redesign or production worker configuration was introduced.

If you started that worker for your run, stop it with:

```sh
docker stop --time 10 eq-milestone-s-authur-trusted-bot-1
```

## I. Production isolation

`npm run build` passed with the disposable public Vite configuration, deliberately testing the stronger case where local API variables are present in a production build. The `DEV` branch and lazy form module are eliminated. A fresh production preview shows the existing Google Login and zero local password forms/buttons.

The scan inspected 42 files: zero local auth module/marker/helper hits, private secret values, Authur engine/model artifacts, fixture/executor code or source maps. [Machine-readable proof](evidence/local-real-play/production-isolation.json). Public Supabase URL/anon key are normal frontend configuration; service keys and worker secrets stay outside frontend variables. Generic password support inside the existing Supabase SDK is not a local login UI.

The production auth flow and the frozen security boundary files have no changes. No push, deployment, production access/configuration, flag changes or Phase B occurred.

## J. Tests

- Affected Prettier, ESLint and TypeScript checks; production build.
- 43 focused unit/component tests: local login, AuthGate, token-refresh mount continuity, hidden boundary, capabilities and offline boundary.
- 2 new real-app browser tests: fresh normal manual workflow and rejected auth/approval/anonymous requests.
- 2 existing security browser specs, unchanged: human public/private exchange/reconnect/stale/completion; full-strength trusted Authur/Stage retry/reload/Replay.
- Interactive pseudo-terminal helper test: two fresh accounts, password confirmation, no password echo.
- Production preview and 42-file isolation/artifact scan.

Only relevant gates were run. The expensive full Phase-A suite and unrelated sibling-engine suite were not repeated. New test scaffolding was corrected for custom select controls, waiting `/room` routes, exact exchange wording, and Supabase binary frames/Vite's separate development socket; existing security assertions were unchanged.

Re-run the focused manual browser gate with the normal app/Edge running:

```sh
LIVE_SECURITY_STATUS_FILE=/private/tmp/eq-live-hidden-security-20261001/status.private.json \
  npx playwright test -c playwright.local-realplay.config.ts
```

## K. Local commit

One focused local commit follows `ed40e61`; the final chat report records its SHA. No history rewrite or push.

## L. How to play locally for real

Prerequisites: Node 22.12+, this worktree's npm dependencies, Docker Desktop, Supabase CLI, `psql`, and the existing disposable directory/protected files. If dependencies are absent, run `npm ci` **in this worktree**. No Playwright browser is required for manual play. No `.env` creation or secret copying is required; the runner supplies only the verified public frontend variables.

**Terminal 1 — backend** (reuse the existing function server if already running):

```sh
cd /Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync
supabase start --workdir /private/tmp/eq-live-hidden-security-20261001 >/dev/null
supabase functions serve --workdir /private/tmp/eq-live-hidden-security-20261001 --env-file /private/tmp/eq-live-hidden-security-20261001/private.env
```

Expected: Edge functions listed under `http://127.0.0.1:54521/functions/v1/`. The startup summary is suppressed because it can contain local credentials.

**Terminal 2 — normal app** (reuse an existing 5192 app server):

```sh
cd /Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync
node tools/phase-a/local.mjs app
```

Expected: Vite ready and `Local: http://127.0.0.1:5192/`.

**Terminal 3 — accounts, once**:

```sh
cd /Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync
node tools/phase-a/local.mjs accounts
```

Choose/confirm a disposable password, hidden while typing. Keep the two printed emails/display names. Every invocation creates a new pair; reuse your saved credentials rather than running it again when returning to the same game.

1. Open **http://127.0.0.1:5192/** yourself in Chrome/Safari. Sign in locally with A's email and your password.
2. Open that URL in incognito/private browsing or a second browser/profile. Sign in as B.
3. A: **Create game → Play another player → Opponent username: B → Create room & get invite link**. Keep Public for the basic test.
4. A: **Copy game link**. B: **Create game → Have a code? Join a game → paste link → Join room**.
5. A: **Ready**. Wait for B to see A ready. B: **Ready**. A: **Launch game**. Play, freely resize/maximize/fullscreen and refresh the same link.
6. Stop your own app/function server using Ctrl+C in Terminals 2/1. Terminal 3 already exits. Stop the optional worker only if you started it. Leave the shared disposable stack and inherited processes running; do not reset it or clear browser storage.

**How I can tell I ran the right thing:** the exact 5192 root shows local Login on a fresh session, then Home; the game has a genuine UUID (`/room` while waiting, `/play` during play). A and B use separate genuine local accounts, and Ready/turns update between them. Refresh resumes the same server game. There is no `live-shell-fixture` route or automatically opened fixed demo browser. An existing session can legitimately open Home first; use the normal account Sign out control to switch users.

The fixture remains a separate development sandbox documented in the [Phase-A guide](phase-a-local-run-2026-10-03.md). It is not the recommended real-play workflow.

## M. Product visual approval: STILL WAITING

Functional local verification does not grant product visual approval. Phase B remains deferred.
