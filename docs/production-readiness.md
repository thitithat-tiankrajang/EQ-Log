# EQ Lab release readiness

Updated: 2026-09-24

## Launch policy

New accounts must be approved by an admin before they can play. Public games and replays are for approved members.

## Verified locally

- The app builds for production, passes type checking and linting, and has no reported production dependency vulnerabilities.
- Public, Region, History, Create, Private, room, and Play now carry the intended return destination through the route. Browser Back, waiting-room start, Break, and Exit are covered by unit and browser checks.
- The browser suite covers desktop, mobile, and 320 px screens, including navigation, accessibility, overflow, and the private-game return path. It runs in local mode without Supabase.
- GitHub Actions now runs formatting, linting, types, build, unit tests, dependency audit, and browser tests on pushes and pull requests.

## Required before a public announcement

1. Run the browser journeys against a separate Supabase staging project with an admin, a pending account, two approved members, and members in different regions. Verify approval, revocation, invites, private isolation, region boundaries, archive access, refresh, and reconnection on desktop and mobile. Include a room with many simultaneous spectators and confirm all viewers receive the same turn, log, and clocks after reconnecting.
2. Apply the production migrations to staging in release order, including `multiverse_timeline_migration.sql` before `play_mode_tools_migration.sql`. Deploy the matching engine service after the tool catalog exists, then confirm a mode without analysis rejects direct analysis requests. Verify row access policies and a backup restore before applying migrations to production.
3. Connect the app's `eq-lab:error` event and failed requests to an error monitoring service with an alert owner. The current error boundary displays a recovery screen, but has no production error receiver.
4. Resolve the threaded WebAssembly rebuild check in the sibling `amath-engine` project. Its current Makefile has no `wasm-mt` target, so the local full unit suite reports one failure even though the bundled engine runs.
5. Confirm the new GitHub quality gate passes from a clean checkout and run a smoke test on the final HTTPS URL, including account approval and a two-account game.

Do not announce the public launch until these checks have named owners and recorded passing results.
