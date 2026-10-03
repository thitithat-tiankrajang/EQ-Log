# Future controlled deployment and rollback — NOT EXECUTED

These steps are for a separately authorized deployment task. Current production
is `4e1fcdc`; this audit did not push, deploy, promote, apply production migrations,
or set flags.
All commands start in the existing worktree. No new worktree or primary checkout
is required. Stop on a failed check or unexpected migration/deployment identity.

## 1. Freeze the exact candidate locally

Review the gate correction/evidence, then create one audit commit and an immutable
RC tag. This retains the full accumulated history, including `58667ce`.

```bash
cd /Users/thitithat_tiankrajang/Desktop/EQ-Lab-live-sync
test "$(git branch --show-current)" = codex/live-sync-optimization-phase1
test "$(git rev-parse HEAD)" = a76c8c0b0907a7c515552246f430d2c753af8278
git diff --check
git add tools/live-security/production-deploy-check.sql \
  tools/live-security/legacy-preservation-check.test.mjs \
  docs/evidence/release-readiness
git commit -m "release: verify live-game candidate and correct null preservation check"
git tag -a rc/live-game-phase-b-20261004 -m "Controlled live-game release; creation remains disabled"
RELEASE_SHA="$(git rev-parse 'rc/live-game-phase-b-20261004^{commit}')"
git diff --exit-code a76c8c0 "$RELEASE_SHA" -- src supabase public vite.config.ts \
  vercel.json package.json package-lock.json
git status --short
```

Require a clean worktree and no deployable-input diff. Do not push main: the
documented Git integration auto-deploys it. Record the RC SHA rather than releasing
a moving feature branch. Future main reconciliation requires its own ordered
deployment authorization; it is not part of this plan.

## 2. Refresh read-only preflight and preserve rollback inputs

```bash
supabase migration list --project-ref ilhtcsnndlcsyfdznoow --output-format json
supabase functions list --project-ref ilhtcsnndlcsyfdznoow -o json
supabase secrets list --project-ref ilhtcsnndlcsyfdznoow -o json
node tools/live-security/legacy-preservation-check.test.mjs
```

Secret-list values are digests, not decrypted secrets. Compare the two creation
flag digests to `sha256(false)` without retrieving other secret values. They must
remain false. Re-run the corrected production SQL gate using `psql` with a
privately supplied read-only connection, or `supabase db query --linked
--project-ref ... --file ...` after removing the initial psql-only `\set` line.
The complete SQL explicitly begins READ ONLY and rolls back.

Confirm Vercel alias still resolves to the audited deployment or re-audit any
changed revision. Confirm backup/recovery coverage and expected active-game
counts. Record current function version, source and SHA-256. The audit staged the
exact current live-game rollback bundle at
`test-results/release-readiness/rollback/supabase/functions/live-game/index.js`,
with JWT verification enabled in its accompanying config. Its hash must be
`e8b3305c76e8757737da4c04a6eb26817b4c3d2b683d7b448c77679ac4f50194`.

## 3. Install the single additive migration

```bash
supabase db push --linked --project-ref ilhtcsnndlcsyfdznoow --skip-vault --dry-run
# Proceed only if exactly 20261003120000_live_tentative_relay.sql is pending.
supabase db push --linked --project-ref ilhtcsnndlcsyfdznoow --skip-vault
```

Do not include seed/roles, repair historical migration versions, or apply any
unexpected migration. Verify ledger entry, RLS, `live_tentative_receive` SELECT,
helper definition/execute permissions, and continued absence of INSERT policies.
Existing `live_game_broadcast_read` must remain intact. Re-run the read-only
deployment gate. No browser needs the new policy yet.

## 4. Deploy only the new live-game bundle

```bash
npm run build:live-game
git diff --exit-code -- supabase/functions/live-game/index.js
supabase functions deploy live-game --project-ref ilhtcsnndlcsyfdznoow --use-api
supabase functions list --project-ref ilhtcsnndlcsyfdznoow -o json
```

Require ACTIVE and `verify_jwt=true`; never use `--no-verify-jwt`, `--prune`, or an
unnamed deploy-all command. Download into a fresh ignored staging directory and
compare deployed `index.js` to the candidate hash
`e00ce901ef1ee61a1855ce724b0db56cf35a77fae4cf4aa8a46e1ce3b5ff97be`.
Recheck existing recipient projections/committed actions and both creation flags.
Do not change worker/engine deployments or unrelated Edge bundles.

## 5. Build the frontend without promoting it

Export only the frozen Git source. This excludes local credentials, downloaded
production code, ignored test output and other working-copy files.

```bash
mkdir -p test-results/release-readiness/rc-source
test -z "$(ls -A test-results/release-readiness/rc-source)"
git archive "$RELEASE_SHA" | tar -x -C test-results/release-readiness/rc-source
vercel deploy test-results/release-readiness/rc-source \
  --project prj_kivE4ulotuxx7gMxnQrcFcih0KRO \
  --scope thitithats-projects --prod --skip-domain --yes \
  --meta "releaseSha=$RELEASE_SHA"
```

Record the returned deployment URL/ID; require READY and the correct source
identity/production environment. `--skip-domain` leaves production aliases on
Milestone S while building with production settings. Scan the actual deployment
output for maps, dev auth/fixture/test-network code, private credentials and
Authur executor/models. Verify unauthenticated Google-login entry and headers.
Do not assume Google OAuth will work on this unique URL: its redirect must already
be allowed, otherwise authenticated smoke uses the canonical domain after
promotion. Do not alter production Auth redirect configuration as a shortcut.

## 6. Promote and run controlled smoke; keep creation closed

After migration/function/output verification and explicit promotion approval:

```bash
vercel promote <recorded-candidate-deployment-id> --scope thitithats-projects --yes
```

Use real approved accounts on `https://eq-log.vercel.app`. Existing game owners
can resume the current Authur/ArchBot games without opening new creation. Finish
the inherited Authur placeholder/worker/terminal smoke and installed-PWA update
smoke. Verify refresh/reconnect and baseline hidden-information boundaries.

For the Online canary, obtain a separately approved backend maintenance/access
fence or exact operator test-room procedure. There are no current server-v1
Online games, and the existing global creation flag has no test-user allowlist.
Do not use a frontend-only fence, injected auth, legacy-room conversion, direct
browser broadcast, or a global flag flip as a substitute. If no safe production
canary procedure is approved, stop here with both creation flags false.

The canary must check A/B place → move → recall → committed move, stale packet,
exchange/pass, refresh/disconnect, wrong-seat publishing, sender/third-viewer
topic joins, strict public payloads, Ranked/other-mode refusal, and no persisted
tentative rows. A relay failure must leave local draft/committed play usable.

Only a **later explicit enablement decision** may set
`LIVE_GAME_CREATION_ENABLED=true` after the required production gates pass.
This runbook intentionally contains no enable command. Stage remains false until
its own approved/sealed catalog and production smoke are complete.

## 7. Rollback components independently

**Tentative sync / function: preferred first rollback.** Restore the staged,
byte-verified known production function; this removes the added capability and
rejects tentative operations while keeping the same committed-game protocol:

```bash
supabase functions deploy live-game --project-ref ilhtcsnndlcsyfdznoow --use-api \
  --workdir test-results/release-readiness/rollback
supabase functions list --project-ref ilhtcsnndlcsyfdznoow -o json
```

Verify ACTIVE/JWT and baseline source hash. Refresh recipient projections/new
clients so the absent capability hides the overlay; existing committed actions
continue. Allow already accepted/in-flight broadcasts to drain. Leaving the
receive policy installed is safe and inert after the relay is restored.

**Frontend:** restore the audited deployment aliases:

```bash
vercel rollback dpl_FmmU1c4rJnUCcpYN7n3hBFbcPBmu --scope thitithats-projects --yes
```

Verify alias identity and refresh/PWA upgrade behavior. Loaded tabs may retain
their current client until refresh; both clients are compatible with the baseline
function. Do not roll back to a frontend/server revision before Milestone S.

**Policy:** normally keep the additive migration. If removal is necessary, stop
the relay first, then apply an explicitly authorized forward rollback:

```sql
begin;
drop policy if exists live_tentative_receive on realtime.messages;
revoke execute on function public.can_receive_live_tentative(text) from authenticated;
commit;
```

Leave all game tables, the original commit policy and security grants unchanged.
Do not delete the migration ledger entry. To restore later, use a new forward
migration restoring the reviewed helper/grant/policy; `db push` will not rerun an
already recorded migration automatically. Policy revocation alone does not stop
already joined clients immediately because authorizations are cached; see
[Supabase authorization](https://supabase.com/docs/guides/realtime/authorization).
Function rollback is the traffic stop, then policy removal is defense in depth.

**Creation flags:** if a later task opened creation, explicitly restore the closed
values before further recovery work:

```bash
supabase secrets set LIVE_GAME_CREATION_ENABLED=false STAGE_CREATION_ENABLED=false \
  --project-ref ilhtcsnndlcsyfdznoow
```

Verify both digests again. These flags protect new creation; they do not disable
tentative sync in an already playing game and do not block its committed moves.
Never roll back the Milestone-S hidden-information architecture or fabricate
completion for preserved legacy games.
