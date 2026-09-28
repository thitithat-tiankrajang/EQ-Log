#!/usr/bin/env bash
# Local-only concurrency test for Ranked match authority (Foundation C7): one
# active Ranked match per user, claims racing claims, results and the board
# limit. Needs separate sessions, so it cannot live in a single rolled-back
# .sql file. It COMMITS throwaway users and matches and deletes them at the end.
#
#   LOCAL_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
#     bash supabase/tests/ranked_authority_race.sh
#
# Every race releases all of its sessions at the same instant: each session
# first waits on a shared advisory lock that a gate session holds, then runs.
# Never point LOCAL_DB_URL at a hosted project.
set -euo pipefail
DB="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
case "$DB" in *127.0.0.1*|*localhost*) ;; *) echo "refusing: not a local database" >&2; exit 2 ;; esac

WORK=$(mktemp -d)
PREFIX=00000000-0000-4000-8000-0000000e
uid() { printf '%s%04d' "$PREFIX" "$1"; }
q() { psql "$DB" -v ON_ERROR_STOP=1 -Atq "$@"; }
fail() { echo "FAIL: $*"; exit 1; }

cleanup() {
  q -c "begin;
    delete from public.ranked_results where player_a_id::text like '${PREFIX}%' or player_b_id::text like '${PREFIX}%';
    delete from public.ranked_matches where player_a_id::text like '${PREFIX}%' or player_b_id::text like '${PREFIX}%';
    delete from public.ranked_ratings where player_id::text like '${PREFIX}%';
    delete from public.room_live where owner_id::text like '${PREFIX}%' or player_a_user_id::text like '${PREFIX}%'
      or player_b_user_id::text like '${PREFIX}%';
    update public.system_settings set value_int = 3 where key = 'max_active_boards_per_user';
    delete from auth.users where id::text like '${PREFIX}%';
    commit;" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
cleanup
WORK=$(mktemp -d)

# ── session helpers ─────────────────────────────────────────────────────────
GATE_KEY=424243
gate_close() { # hold the gate until $1 seconds pass
  psql "$DB" -Atq -c "select pg_advisory_lock($GATE_KEY); select pg_sleep(${1:-1.5});" >/dev/null &
  GATE_PID=$!
  sleep 0.4
}
# worker <who> <name> <sql>: who = owner | service | <user uuid>
worker() {
  local who=$1 name=$2 sql=$3 pre
  case $who in
    owner) pre="" ;;
    service) pre="select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true); set local role service_role;" ;;
    *) pre="select set_config('request.jwt.claims', '{\"sub\":\"$who\",\"role\":\"authenticated\"}', true); set local role authenticated;" ;;
  esac
  printf "begin;\nselect pg_advisory_xact_lock_shared(%s);\n%s\n%s\ncommit;\n" "$GATE_KEY" "$pre" "$sql" \
    | psql "$DB" -v ON_ERROR_STOP=1 -Atq > "$WORK/$name" 2>&1 &
}
settle() { wait; }
result() { # ok | the error code before the colon
  if grep -q 'ERROR' "$WORK/$1"; then
    sed -n 's/.*ERROR:  \([a-z_]*\).*/\1/p' "$WORK/$1" | head -1
  else
    echo ok
  fi
}
count_ok() { local n=0; for f in "$@"; do [[ $(result "$f") == ok ]] && n=$((n+1)); done; echo $n; }
no_deadlocks() { local f; for f in "$@"; do [[ $(result "$f") != deadlock ]] || fail "deadlock in $f: $(cat "$WORK/$f")"; done; }
active() { q -c "select count(*) from public.ranked_matches where '$1' in (player_a_id, player_b_id) and status in ('matched','playing')"; }
boards() { q -c "select public.active_board_count('$1', clock_timestamp(), null, null)"; }
waiting() { # waiting <creator> → match id, written as the Edge Function's create does
  q -c "insert into public.ranked_matches (player_a_id, status, minutes_a, minutes_b, state)
        values ('$1', 'waiting', 10, 10, jsonb_build_object('status', 'waiting',
          'lobbyReadyBySide', jsonb_build_object('A', false, 'B', false))) returning id" | head -1
}
basis() { q -c "select basis from public.ranked_stakes('$1', '$2')"; }
claim_v2() { # claim_v2 <match> <claimant> <basis>
  echo "select resumed from public.ranked_claim_match_v2('$1', '$2', 'Racer', '$3');"
}
claim_v1() { echo "select public.ranked_claim_match('$1', '$2', 'Racer', now());"; }
MAXA=0
check_one_active() {
  local m
  m=$(q -c "select coalesce(max(n), 0) from (
              select count(*) n from public.ranked_matches m, lateral (values (m.player_a_id), (m.player_b_id)) s(u)
               where s.u::text like '${PREFIX}%' and m.status in ('matched','playing') group by s.u) x")
  (( m <= 1 )) || fail "a user holds $m active Ranked matches"
  (( m > MAXA )) && MAXA=$m
  return 0
}

# ── fixtures ────────────────────────────────────────────────────────────────
q -c "insert into auth.users (id, email, aud, role)
      select ('${PREFIX}' || lpad(n::text, 4, '0'))::uuid, 'race7-' || n || '@example.test', 'authenticated', 'authenticated'
        from generate_series(1, 200) n" >/dev/null
q -c "update public.profiles set status = 'approved' where id::text like '${PREFIX}%'" >/dev/null
NEXT=1
fresh() { FRESH=$(uid $NEXT); NEXT=$((NEXT+1)); } # sets FRESH (no subshell, so the counter moves)

echo "══ 13 · Many claimants, one room: exactly one wins"
fresh; C=$FRESH; ROOM=$(waiting "$C"); names=()
gate_close 1.5
for i in $(seq 1 8); do
  fresh; P=$FRESH; B=$(basis "$ROOM" "$P")
  worker service "c13_$i" "$(claim_v2 "$ROOM" "$P" "$B")"; names+=("c13_$i")
done
settle; no_deadlocks "${names[@]}"; check_one_active
echo "   winners $(count_ok "${names[@]}") · losers: $(for n in "${names[@]}"; do result "$n"; done | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
[[ $(count_ok "${names[@]}") == 1 ]] || fail "one room claimed $(count_ok "${names[@]}") times"
for n in "${names[@]}"; do r=$(result "$n"); [[ $r == ok || $r == ranked_room_claimed ]] || fail "$n: $r"; done

echo "══ 14 · One claimant, many rooms: exactly one is acquired"
fresh; P=$FRESH; names=()
gate_close 1.5
for i in $(seq 1 8); do
  fresh; C=$FRESH; ROOM=$(waiting "$C"); B=$(basis "$ROOM" "$P")
  worker service "c14_$i" "$(claim_v2 "$ROOM" "$P" "$B")"; names+=("c14_$i")
done
settle; no_deadlocks "${names[@]}"; check_one_active
echo "   acquired $(count_ok "${names[@]}") · active $(active "$P")"
[[ $(count_ok "${names[@]}") == 1 && $(active "$P") == 1 ]] || fail "claimant acquired $(active "$P")"
for n in "${names[@]}"; do r=$(result "$n"); [[ $r == ok || $r == ranked_already_active ]] || fail "$n: $r"; done

echo "══ 14b · The same, mixing the v1 claim the current Edge Function calls"
fresh; P=$FRESH; names=()
gate_close 1.5
for i in $(seq 1 8); do
  fresh; C=$FRESH; ROOM=$(waiting "$C")
  if (( i % 2 )); then worker service "c14b_$i" "$(claim_v1 "$ROOM" "$P")"
  else B=$(basis "$ROOM" "$P"); worker service "c14b_$i" "$(claim_v2 "$ROOM" "$P" "$B")"; fi
  names+=("c14b_$i")
done
settle; no_deadlocks "${names[@]}"; check_one_active
echo "   acquired $(count_ok "${names[@]}") · active $(active "$P")"
[[ $(active "$P") == 1 ]] || fail "mixed claims left $(active "$P") active"

echo "══ 15 · Claims involving the same creator: their room, and their own claims"
fresh; X=$FRESH; WX=$(waiting "$X"); names=()
gate_close 1.5
for i in $(seq 1 5); do
  fresh; P=$FRESH; B=$(basis "$WX" "$P")
  worker service "c15w_$i" "$(claim_v2 "$WX" "$P" "$B")"; names+=("c15w_$i")
done
for i in $(seq 1 3); do
  fresh; C=$FRESH; ROOM=$(waiting "$C"); B=$(basis "$ROOM" "$X")
  worker service "c15x_$i" "$(claim_v2 "$ROOM" "$X" "$B")"; names+=("c15x_$i")
done
settle; no_deadlocks "${names[@]}"; check_one_active
echo "   successes $(count_ok "${names[@]}") · creator active $(active "$X") · room $(q -c "select status from public.ranked_matches where id = '$WX'")"
[[ $(count_ok "${names[@]}") == 1 && $(active "$X") == 1 ]] || fail "creator ended in $(active "$X") matches"

echo "══ Cross claims (A takes B's room while B takes A's), 12 pairs at once: no deadlock"
names=()
gate_close 2
for i in $(seq 1 12); do
  fresh; A=$FRESH; fresh; B=$FRESH; WA=$(waiting "$A"); WB=$(waiting "$B")
  worker service "x_${i}_a" "$(claim_v2 "$WB" "$A" "$(basis "$WB" "$A")")"
  worker service "x_${i}_b" "$(claim_v1 "$WA" "$B")"
  names+=("x_${i}_a" "x_${i}_b")
done
settle; no_deadlocks "${names[@]}"; check_one_active
for i in $(seq 1 12); do
  [[ $(count_ok "x_${i}_a" "x_${i}_b") == 1 ]] || fail "pair $i: $(result "x_${i}_a") / $(result "x_${i}_b")"
done
echo "   every pair: exactly one claim, no deadlock"

echo "══ A claim racing the result of the claimant's current match"
for i in $(seq 1 6); do
  fresh; P=$FRESH; fresh; O=$FRESH; fresh; C=$FRESH
  M=$(waiting "$O")
  q -c "select resumed from public.ranked_claim_match_v2('$M', '$P', 'P', (select basis from public.ranked_stakes('$M', '$P')))" >/dev/null
  q -c "select public.ranked_ready_match('$M', '$P', now()); select public.ranked_ready_match('$M', '$O', now());" >/dev/null
  ROOM=$(waiting "$C")
  # The basis a stale screen would hold: taken while the claimant is still busy.
  STALE=$(basis "$ROOM" "$P")
  REV=$(q -c "select revision from public.ranked_matches where id = '$M'")
  gate_close 1
  worker service "r_fin_$i" "select public.ranked_commit_match('$M', $REV, '{\"status\":\"finished\",\"scores\":{\"A\":0,\"B\":10}}'::jsonb, 'B', 'resign');"
  worker service "r_clm_$i" "$(claim_v2 "$ROOM" "$P" "$STALE")"
  settle; no_deadlocks "r_fin_$i" "r_clm_$i"; check_one_active
  [[ $(result "r_fin_$i") == ok ]] || fail "result refused: $(cat "$WORK/r_fin_$i")"
  r=$(result "r_clm_$i")
  # Busy when it ran, or free with a moved rating: never a claim on old stakes.
  [[ $r == ranked_already_active || $r == ranked_stakes_changed ]] || fail "claim on stale stakes: $r"
  # Once the result has landed the claimant is free, but the stakes they were
  # shown are gone with their old rating.
  printf "begin; select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true); set local role service_role; %s commit;" \
    "$(claim_v2 "$ROOM" "$P" "$STALE")" | psql "$DB" -Atq > "$WORK/r_late_$i" 2>&1 || true
  [[ $(result "r_late_$i") == ranked_stakes_changed ]] || fail "late stale claim: $(cat "$WORK/r_late_$i")"
  echo "   round $i: racing claim → $r · stale claim after the result → ranked_stakes_changed"
done

echo "══ The board limit, racing a Ranked claim against a normal board"
q -c "update public.system_settings set value_int = 2 where key = 'max_active_boards_per_user'" >/dev/null
SOLO="select room_id from public.create_live_game('{\"name\":\"solo\",\"gameMode\":\"solo\",\"players\":{\"A\":\"Me\"}}', 'private', 'none', null, 'invite_only', null);"
for i in $(seq 1 6); do
  fresh; P=$FRESH; fresh; C=$FRESH; ROOM=$(waiting "$C")
  printf "begin; select set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true); set local role authenticated; %s commit;" "$P" "$SOLO" | psql "$DB" -Atq >/dev/null
  B=$(basis "$ROOM" "$P")
  gate_close 1
  worker service "b_clm_$i" "$(claim_v2 "$ROOM" "$P" "$B")"
  worker "$P" "b_solo_$i" "$SOLO"
  settle; no_deadlocks "b_clm_$i" "b_solo_$i"; check_one_active
  (( $(boards "$P") <= 2 )) || fail "player holds $(boards "$P") boards at a limit of 2"
  [[ $(count_ok "b_clm_$i" "b_solo_$i") == 1 ]] || fail "board race $i: $(result "b_clm_$i") / $(result "b_solo_$i")"
  echo "   round $i: claim $(result "b_clm_$i") · board $(result "b_solo_$i") · boards $(boards "$P")"
done
q -c "update public.system_settings set value_int = 3 where key = 'max_active_boards_per_user'" >/dev/null

echo "══ A failed claim leaves nothing behind"
fresh; P=$FRESH; fresh; C=$FRESH; ROOM=$(waiting "$C")
BEFORE=$(q -c "select concat_ws('|', status, player_b_id, revision, md5(state::text)) from public.ranked_matches where id = '$ROOM'")
printf "begin; select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true); set local role service_role; %s commit;" \
  "$(claim_v2 "$ROOM" "$P" "rs1:stale")" | psql "$DB" -Atq > "$WORK/stale" 2>&1 || true
[[ $(result stale) == ranked_stakes_changed ]] || fail "stale claim: $(cat "$WORK/stale")"
AFTER=$(q -c "select concat_ws('|', status, player_b_id, revision, md5(state::text)) from public.ranked_matches where id = '$ROOM'")
[[ "$BEFORE" == "$AFTER" ]] || fail "a refused claim changed the room"
[[ $(q -c "select count(*) from public.ranked_ratings where player_id in ('$P', '$C')") == 0 ]] || fail "a refused claim wrote ratings"
echo "   room and ratings unchanged"

check_one_active
echo "PASS: ranked authority races (max active Ranked matches per user: $MAXA)"
