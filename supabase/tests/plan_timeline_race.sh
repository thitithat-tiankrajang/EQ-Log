#!/usr/bin/env bash
# Local-only concurrency test for 20260928120000_plan_timeline.sql. Separate
# sessions are required, so it COMMITS throwaway users and passes and removes
# them at the end (the pass-protection trigger is paused only for that cleanup).
#
#   LOCAL_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
#     bash supabase/tests/plan_timeline_race.sh
#
# Never point LOCAL_DB_URL at a hosted project.
set -euo pipefail
DB="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
case "$DB" in *127.0.0.1*|*localhost*) ;; *) echo "refusing: not a local database" >&2; exit 2 ;; esac

ADMIN=00000000-0000-4000-8000-0000000004a1
USER_ID=00000000-0000-4000-8000-0000000004a2
USER2=00000000-0000-4000-8000-0000000004a3
REQ=00000000-0000-4000-8000-00000000fa11
q() { psql "$DB" -v ON_ERROR_STOP=1 -Atq "$@"; }
as_admin() {
  printf "begin;\nselect set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true);\nset local role authenticated;\n%s\ncommit;\n" "$ADMIN" "$*" \
    | psql "$DB" -v ON_ERROR_STOP=1 -Atq 2>&1 | grep -v '^{' || true
}
cleanup() {
  q -c "begin; alter table public.plan_passes disable trigger plan_pass_protected;
        delete from public.plan_segments where user_id in ('$USER_ID','$USER2');
        delete from public.plan_passes where user_id in ('$USER_ID','$USER2');
        alter table public.plan_passes enable trigger plan_pass_protected; commit;" >/dev/null
  q -c "delete from auth.users where id in ('$ADMIN','$USER_ID','$USER2')" >/dev/null
}
trap cleanup EXIT
cleanup
q -c "insert into auth.users (id, email, aud, role) values ('$ADMIN','plan-race-admin@example.test','authenticated','authenticated'), ('$USER_ID','plan-race-user@example.test','authenticated','authenticated'), ('$USER2','plan-race-user2@example.test','authenticated','authenticated')" >/dev/null
q -c "update public.profiles set status = 'approved' where id in ('$ADMIN','$USER_ID','$USER2'); update public.profiles set is_admin = true where id = '$ADMIN'" >/dev/null

GRANT="select pass_id || ' replayed=' || replayed from public.admin_grant_plan('$USER_ID', 'plus', 3, 'race', '$REQ');"

echo "── 1. The same grant request from two sessions at once"
as_admin "$GRANT select pg_sleep(2);" > /tmp/plan_race_a.$$ &
sleep 0.5
as_admin "$GRANT" > /tmp/plan_race_b.$$
wait
A=$(grep replayed /tmp/plan_race_a.$$); B=$(grep replayed /tmp/plan_race_b.$$); rm -f /tmp/plan_race_a.$$ /tmp/plan_race_b.$$
echo "   A: $A"; echo "   B: $B"
N=$(q -c "select count(*) from public.plan_passes where user_id = '$USER_ID'")
MONTHS=$(q -c "select chain_months from public.plan_segments where user_id = '$USER_ID'")
[[ "$A" == *"replayed=false"* && "$B" == *"replayed=true"* && "${A%% *}" == "${B%% *}" && "$N" == 1 && "$MONTHS" == 3 ]] \
  || { echo "FAIL: $N passes, $MONTHS months"; exit 1; }
echo "   ok: one pass, 3 months, the second request replayed it"

echo "── 2. Two different grants from two sessions at once"
as_admin "select pass_id from public.admin_grant_plan('$USER_ID', 'plus', 1, 'race', gen_random_uuid()); select pg_sleep(1);" >/dev/null &
sleep 0.3
as_admin "select pass_id from public.admin_grant_plan('$USER_ID', 'plus', 2, 'race', gen_random_uuid());" >/dev/null
wait
MONTHS=$(q -c "select string_agg(chain_months::text, ',') from public.plan_segments where user_id = '$USER_ID'")
[[ "$MONTHS" == 6 ]] || { echo "FAIL: expected one 6-month chain, got $MONTHS"; exit 1; }
echo "   ok: both applied to one chain (6 months), none lost"
conflict_race() { # $1 label, $2 second target user, $3 second months
  local key; key=$(uuidgen | tr 'A-Z' 'a-z')
  as_admin "select pass_id from public.admin_grant_plan('$USER_ID', 'pro', 1, 'race-conflict', '$key'); select pg_sleep(1.5);" > /tmp/plan_race_c.$$ &
  sleep 0.4
  local out; out=$(as_admin "select pass_id from public.admin_grant_plan('$2', 'pro', $3, 'race-conflict', '$key');")
  wait
  rm -f /tmp/plan_race_c.$$
  local count; count=$(q -c "select count(*) from public.plan_passes where idempotency_key = 'admin:$key'")
  echo "   $1: second request -> $(echo "$out" | grep -oE 'idempotency_conflict[^.]*' | head -1)"
  [[ "$out" == *"idempotency_conflict:"* && "$count" == 1 ]] || { echo "FAIL: $1 ($count passes)"; exit 1; }
}
echo "── 3. The same request id with a conflicting payload, concurrently"
q -c "begin; alter table public.plan_passes disable trigger plan_pass_protected; delete from public.plan_segments where user_id in ('$USER_ID','$USER2'); delete from public.plan_passes where user_id in ('$USER_ID','$USER2'); alter table public.plan_passes enable trigger plan_pass_protected; commit;" >/dev/null
conflict_race "same account, other months" "$USER_ID" 2
conflict_race "other account (other lock)" "$USER2" 1
echo "   ok: exactly one pass per key; the conflicting request is refused, not replayed"
echo "plan timeline race test passed"
