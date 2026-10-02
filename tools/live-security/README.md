# Disposable release gates

These tools target only the isolated API on `127.0.0.1:54521`. Do not point them
at production. No credential file or generated private fixture belongs in Git.

Before any migration/reset, run `assert-local-stack.mjs` with the explicit
`LIVE_SECURITY_TEST_WORKDIR=/private/tmp/eq-live-hidden-security-20261001`.
It checks project identity and configured/running API54521/DB54522 without
printing credentials. Preserve this complete isolated config; do not replace it
with the repository's function-only `supabase/config.toml`, which has no ports.
The migration CLI can otherwise reach the default local database.

For the genuine legacy cutover probe, first provision the disposable database
with canonical baseline migrations through `20261001102600`. Initialize the
existing private room-code-secret prerequisite using the documented repository
setup. Set `LIVE_SECURITY_STATUS_FILE` to a private CLI status JSON and
`LIVE_SECURITY_LEGACY_FILE` to a private file under `/private/tmp/`.

Run `node tools/live-security/legacy-cutover.mjs before`. This creates approved
throwaway actors and a real game through the old authenticated creation/commit
RPCs, verifies the old state/snapshot disclosure, and saves its comparison data
and temporary sessions only in the private fixture file. Apply the nine candidate
103000–103800 migrations with the normal migration runner, install the candidate
Edge bundles with JWT verification enabled, and then run the helper with `after`.
It checks both actors, old RPC denial, safe reconnect reads, frozen continuation,
unchanged private state/revision, and unavailable live Replay. It does not finish
or relabel the legacy game. The 103400 cutover copies legacy room/timeline/events
into a service-only quarantine, gates old Ready/join paths, removes frozen rooms
from playable-board quota, and prevents active authoritative games being deleted
through the old cancellation path. Legacy owners may abandon their frozen room
after preservation; they start a fresh game rather than resume the old state.

Current-authority integration tests live in `tests/live-*-local.test.ts` and the
existing Storage/Ranked integration files. Recovery/Stage tests supervise their
own private worker and require `LIVE_SECURITY_WORKER_ENV_FILE`; run those with
one test worker and without a competing persistent worker. The browser gate uses
`playwright.live-security.config.ts`, the same private status file, a configured
local frontend on port 4478, and the built Compose worker. Worker credentials
must never be passed into a browser.

The opt-in creation-control test additionally uses
`LIVE_SECURITY_CREATION_CONTROLS=closed` with both Edge creation flags false, or
`stage-only` with general creation true and Stage creation false. Restore the
local flags and restart Edge before running gameplay gates. No performance
benchmark variables are needed or authorized for this security gate.

Read `docs/live-security-milestone-s-2026-10-01.md` for the current 29-topic
verdict, final 58-feature disposition, exact skipped-case evidence, PRE facts and
proposed rollout/rollback. `live-security-milestone-s-evidence-2026-10-01.json`
records sanitized counts and every default skip. Earlier reports retain historical
scope/evidence; their compatibility statuses and server-ArchBot requirement are
superseded. The candidate remains uncommitted while material PRE blockers remain.

Keep all nine migrations in ledger order. Physical Host current-rack grants are
additive, ordinary opposite historical racks stay private, and Pass & Play uses
explicit memory-only handoff. Live history edits reconstruct positions privately.
Waiting Ready/Unready/Launch/Start now use revisioned typed commands; old Ready RPC
and canonical client-write fixtures are retired/replaced.

The locked product decision keeps normal ArchBot FREE practice in the browser,
with unchanged full Stage5B64/model. Its owner may inspect the current bot search
rack; bag order/draw RNG/unrelated history remain withheld. Its chosen proposal
commits through service-only authority. No ArchBot worker/image/cost/capacity
preflight is required. Only Authur/Stage use the private worker, which must be
present for the corresponding browser gate. Production Authur placement/wiring
is still required and unverified. This exception never applies to competition.

`production-preflight.sql` is PRE-DEPLOY read-only operator evidence (counts and
metadata, no canonical/seed/cron bodies). Unknown/denied facts block release.
`production-deploy-check.sql` is DEPLOY-TIME read-only inspection plus assertions:
unsafe grants, missing service functions, private Realtime membership, incomplete
legacy quarantine or active ArchBot jobs abort the command. Run with ON_ERROR_STOP.
The disposable DB intentionally retains four after-cutover synthetic legacy
fixtures, so its global preservation assertion refuses those; the genuine
pre-cutover fixture remains preserved. Never delete evidence to obtain a pass.
Neither script was run against production by this task.
