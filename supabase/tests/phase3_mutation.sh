#!/usr/bin/env bash
# Local-only: prove the Phase 3 suites can fail. Each mutation breaks one
# guard inside a transaction, then runs a suite in that same transaction; the
# suite must FAIL. The suite's own ROLLBACK discards the mutation.
#   LOCAL_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres bash supabase/tests/phase3_mutation.sh
set -uo pipefail
DB="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
case "$DB" in *127.0.0.1*|*localhost*) ;; *) echo "refusing: not a local database" >&2; exit 2 ;; esac
cd "$(dirname "$0")"
failed=0
mutant() { # mutant <label> <suite.sql> <mutation sql>
  local out
  out=$(printf 'begin;\n%s\n\\i %s\n' "$3" "$2" | psql "$DB" -v ON_ERROR_STOP=1 -q 2>&1)
  if grep -q "test passed\|exactly as designed" <<<"$out"; then
    echo "SURVIVED: $1 ($2)"; failed=1
  else
    echo "killed:   $1 — $(grep -m1 -o 'ERROR:.*' <<<"$out" | cut -c1-110)"
  fi
}
mutant "no room board-limit trigger" active_boards_smoke.sql \
  "drop trigger room_live_board_limit on public.room_live;"
mutant "no Ranked board-limit trigger" active_boards_smoke.sql \
  "drop trigger ranked_matches_board_limit on public.ranked_matches;"
mutant "bot-room seats not frozen" stage_attempt_smoke.sql \
  "drop trigger room_live_bot_seats_frozen on public.room_live;"
mutant "Stage commits unchecked" stage_attempt_smoke.sql \
  "create or replace function public.check_stage_commit(live public.room_live, target_canonical jsonb) returns void language sql as 'select';"
mutant "ledger mutable" probot_economy_smoke.sql \
  "drop trigger economy_entries_immutable on public.economy_entries;"
mutant "Authur free" probot_economy_smoke.sql \
  "update public.bot_catalog set access_tier = 'free' where bot_key = 'authur_strong';"
mutant "Plus weekly cap raised" probot_economy_smoke.sql \
  "update public.plan_capabilities set value = '31' where plan_key = 'plus' and capability_key = 'probot_weekly_allowance_cap';"
mutant "balances readable" plan_bot_privileges_smoke.sql \
  "grant select on public.economy_balances to authenticated;"
mutant "service_role can insert rooms" phase3_adversarial_smoke.sql \
  "grant insert on public.room_live to service_role;"
mutant "survival_attempts insertable" stage_attempt_smoke.sql \
  "grant insert on public.survival_attempts to authenticated; create policy mut on public.survival_attempts for insert to authenticated with check (true);"
exit $failed
