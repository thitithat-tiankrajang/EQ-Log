#!/usr/bin/env bash
# Local-only concurrency test for 20260927120000_bot_catalog.sql. Needs separate
# sessions, so it cannot live in a single rolled-back .sql file. It COMMITS its
# own throwaway users and rooms and deletes them at the end.
#
#   LOCAL_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
#     bash supabase/tests/bot_catalog_race.sh
#
# Never point LOCAL_DB_URL at a hosted project.
set -euo pipefail
DB="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
case "$DB" in *127.0.0.1*|*localhost*) ;; *) echo "refusing: not a local database" >&2; exit 2 ;; esac

PLAYER=00000000-0000-4000-8000-0000000000c1
ADMIN=00000000-0000-4000-8000-0000000000c2
REQ=00000000-0000-4000-8000-00000000c0de
q() { psql "$DB" -v ON_ERROR_STOP=1 -Atq "$@"; }
as_user() { # $1 = uid; rest = SQL run inside one transaction as that user
  local uid=$1; shift
  printf "begin;\nselect set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true);\nset local role authenticated;\n%s\ncommit;\n" "$uid" "$*" \
    | psql "$DB" -v ON_ERROR_STOP=1 -Atq 2>&1 | grep -v '^{' || true
}
cleanup() {
  q -c "update public.bot_catalog set enabled = true where bot_key = 'authur_strong'" >/dev/null
  q -c "delete from public.room_live where owner_id in ('$PLAYER','$ADMIN')" >/dev/null
  q -c "delete from auth.users where id in ('$PLAYER','$ADMIN')" >/dev/null
}
trap cleanup EXIT
cleanup

q -c "insert into private.runtime_secrets (key, value) values ('room_code_secret', repeat('s', 40)) on conflict (key) do nothing" >/dev/null
q -c "insert into auth.users (id, email, aud, role) values ('$PLAYER','race-player@example.test','authenticated','authenticated'), ('$ADMIN','race-admin@example.test','authenticated','authenticated')" >/dev/null
q -c "update public.profiles set status = 'approved' where id in ('$PLAYER','$ADMIN'); update public.profiles set is_admin = true where id = '$ADMIN'" >/dev/null

STATE="'{\"name\":\"race\",\"gameMode\":\"versus\",\"players\":{\"A\":\"P\",\"B\":\"Authur\"},\"botSide\":\"B\"}'::jsonb"
CREATE="select room_id || ' replayed=' || replayed from public.create_bot_game('$REQ', 'authur_strong', 'B', $STATE, 'public', 'public', null, 'invite_only', null);"

echo "── 1. Two sessions, same request id, at the same time"
as_user $PLAYER "$CREATE select pg_sleep(2);" > /tmp/race_a.$$ &
sleep 0.5
start=$(date +%s)
as_user $PLAYER "$CREATE" > /tmp/race_b.$$
waited=$(( $(date +%s) - start ))
wait
A=$(grep replayed /tmp/race_a.$$); B=$(grep replayed /tmp/race_b.$$); rm -f /tmp/race_a.$$ /tmp/race_b.$$
echo "   A: $A"; echo "   B: $B (waited ~${waited}s for A's lock)"
ROOMS=$(q -c "select count(*) from public.room_live where owner_id = '$PLAYER'")
[[ "$A" == *"replayed=false"* && "$B" == *"replayed=true"* && "${A%% *}" == "${B%% *}" && "$ROOMS" == 1 ]] \
  || { echo "FAIL: concurrent same-request creation made $ROOMS rooms"; exit 1; }
echo "   ok: one room, second request replayed it"

ROOM=${A%% *}
# Put the room on the bot's turn.
as_user $PLAYER "select outcome from public.commit_live_game_command('$ROOM', 0, 'race-human-1', 'A', '{\"kind\":\"place\"}', '{\"activeSide\":\"B\",\"turnNumber\":2,\"phase\":\"play\"}', 'r1', null, null);" >/dev/null

echo "── 2. Admin disables WHILE a bot commit is in flight"
as_user $PLAYER "select outcome from public.commit_live_game_command('$ROOM', 1, 'race-bot-1', 'B', '{\"kind\":\"place\"}', '{\"activeSide\":\"B\",\"turnNumber\":3,\"phase\":\"play\"}', 'r2', null, null); select pg_sleep(2);" > /tmp/race_c.$$ &
sleep 0.5
start=$(date +%s)
as_user $ADMIN "select public.admin_set_bot_enabled('authur_strong', false, 'race');" >/dev/null
waited=$(( $(date +%s) - start ))
wait
echo "   in-flight bot commit: $(grep -E 'committed|bot_disabled' /tmp/race_c.$$ | head -1); disable waited ~${waited}s"; rm -f /tmp/race_c.$$
(( waited >= 1 )) || { echo "FAIL: disable did not wait for the in-flight bot commit"; exit 1; }
OUT=$(as_user $PLAYER "select outcome from public.commit_live_game_command('$ROOM', 2, 'race-bot-2', 'B', '{\"kind\":\"place\"}', '{\"activeSide\":\"A\",\"turnNumber\":4,\"phase\":\"play\"}', 'r3', null, null);")
echo "   next bot commit after disable returned: $OUT"
[[ "$OUT" == *"bot_disabled:"* ]] || { echo "FAIL: bot commit after disable was not refused"; exit 1; }
echo "   ok: in-flight commit finished first; every later bot commit refused"

echo "── 3. A bot commit that STARTS while a disable is in flight"
q -c "update public.bot_catalog set enabled = true where bot_key = 'authur_strong'" >/dev/null
as_user $ADMIN "select public.admin_set_bot_enabled('authur_strong', false, 'race-2'); select pg_sleep(2);" >/dev/null &
sleep 0.5
OUT=$(as_user $PLAYER "select outcome from public.commit_live_game_command('$ROOM', 2, 'race-bot-3', 'B', '{\"kind\":\"place\"}', '{\"activeSide\":\"A\",\"turnNumber\":4,\"phase\":\"play\"}', 'r4', null, null);")
wait
echo "   bot commit racing the disable: $OUT"
[[ "$OUT" == *"bot_disabled:"* ]] || { echo "FAIL: commit racing a disable was not refused"; exit 1; }
REV=$(q -c "select revision from public.room_live where room_id = '$ROOM'")
[[ "$REV" == 2 ]] || { echo "FAIL: revision is $REV, expected 2"; exit 1; }
echo "   ok: it waited for the disable and was refused; revision still $REV"
echo "bot catalog race test passed"
