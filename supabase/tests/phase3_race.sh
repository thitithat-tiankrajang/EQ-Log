#!/usr/bin/env bash
# Local-only concurrency test for the Phase 3 economy, Stage attempts and the
# active-board limit. Needs separate sessions, so it cannot live in a single
# rolled-back .sql file. It COMMITS throwaway users, rooms and economy rows
# and deletes them at the end.
#
#   LOCAL_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
#     bash supabase/tests/phase3_race.sh
#
# Every race releases all of its sessions at the same instant: each session
# first waits on a shared advisory lock that a gate session holds, then runs.
# Never point LOCAL_DB_URL at a hosted project.
set -euo pipefail
DB="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
case "$DB" in *127.0.0.1*|*localhost*) ;; *) echo "refusing: not a local database" >&2; exit 2 ;; esac

WORK=$(mktemp -d)
PREFIX=00000000-0000-4000-8000-0000000d
uid() { printf '%s%04d' "$PREFIX" "$1"; }
ADMIN=$(uid 1)
LEVEL=00000000-0000-4000-8000-00000000d1e7
q() { psql "$DB" -v ON_ERROR_STOP=1 -Atq "$@"; }
fail() { echo "FAIL: $*"; exit 1; }

cleanup() {
  q -c "begin;
    delete from public.room_live where owner_id::text like '${PREFIX}%' or player_a_user_id::text like '${PREFIX}%'
      or player_b_user_id::text like '${PREFIX}%';
    delete from public.ranked_matches where player_a_id::text like '${PREFIX}%' or player_b_id::text like '${PREFIX}%';
    delete from public.survival_attempts where player_id::text like '${PREFIX}%';
    delete from public.survival_levels where id = '$LEVEL';
    delete from public.room_creation_requests where user_id::text like '${PREFIX}%';
    alter table public.economy_entries disable trigger economy_entries_immutable;
    alter table public.probot_consumptions disable trigger probot_consumptions_immutable;
    delete from public.probot_consumptions where user_id::text like '${PREFIX}%';
    delete from public.economy_entries where user_id::text like '${PREFIX}%';
    alter table public.economy_entries enable trigger economy_entries_immutable;
    alter table public.probot_consumptions enable trigger probot_consumptions_immutable;
    delete from public.economy_balances where user_id::text like '${PREFIX}%';
    delete from public.probot_allowance_state where user_id::text like '${PREFIX}%';
    alter table public.plan_passes disable trigger user;
    delete from public.plan_segments where user_id::text like '${PREFIX}%';
    delete from public.plan_passes where user_id::text like '${PREFIX}%';
    alter table public.plan_passes enable trigger user;
    delete from public.bot_catalog where bot_key = 'race_free';
    update public.bot_catalog set enabled = true where bot_key = 'authur_strong';
    delete from auth.users where id::text like '${PREFIX}%';
    commit;" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
cleanup
WORK=$(mktemp -d)

# ── session helpers ─────────────────────────────────────────────────────────
GATE_KEY=424242
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
as() { # as <who> <sql> — one serial transaction
  local who=$1 sql=$2 pre
  case $who in
    owner) pre="" ;;
    service) pre="select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true); set local role service_role;" ;;
    *) pre="select set_config('request.jwt.claims', '{\"sub\":\"$who\",\"role\":\"authenticated\"}', true); set local role authenticated;" ;;
  esac
  printf "begin;\n%s\n%s\ncommit;\n" "$pre" "$sql" | psql "$DB" -v ON_ERROR_STOP=1 -Atq 2>&1 | grep -v '^{' || true
}
count_ok() { local n=0; for f in "$@"; do [[ $(result "$f") == ok ]] && n=$((n+1)); done; echo $n; }
boards() { q -c "select public.active_board_count('$1', clock_timestamp(), null, null)"; }
consumptions() { q -c "select count(*) from public.probot_consumptions where user_id = '$1'"; }
credits() { q -c "select coalesce((select balance from public.economy_balances where user_id = '$1'), 0)"; }
units_at() { q -c "select units || '/' || reason from public.probot_allowance_at('$1', $2)"; }
MAXB=0
check_all_boards() {
  local m
  m=$(q -c "select coalesce(max(public.active_board_count(p.id, clock_timestamp(), null, null)), 0)
              from public.profiles p where p.id::text like '${PREFIX}%' and p.id <> '$(uid 32)'")
  (( m <= 3 )) || fail "a user holds $m active boards"
  (( m > MAXB )) && MAXB=$m
  return 0
}

STATE="'{\"name\":\"race\",\"gameMode\":\"versus\",\"players\":{\"A\":\"P\",\"B\":\"Authur\"},\"botSide\":\"B\"}'::jsonb"
bot_room() { # bot_room <request uuid> <funding|null>
  local f=$2; [[ $f == null ]] || f="'$f'"
  echo "select room_id from public.create_bot_game('$1', 'authur_strong', 'B', $STATE, 'private', 'none', null, 'invite_only', null, $f);"
}
SOLO="select room_id from public.create_live_game('{\"name\":\"solo\",\"gameMode\":\"solo\",\"players\":{\"A\":\"Me\"}}', 'private', 'none', null, 'invite_only', null);"
new_req() { q -c "select gen_random_uuid()"; }
pass() { # pass <user> <plan> <activated_at sql>
  q -c "insert into public.plan_passes (user_id, plan_key, kind, months, source, idempotency_key, activated_at, reason, created_by)
        values ('$1', '$2', 'grant', 1, 'admin', 'race:' || gen_random_uuid(), $3, 'race', '$ADMIN') returning id" | head -1
  q -c "select public.rebuild_plan_timeline('$1')" >/dev/null
}
grant_credits() { q -c "select public.economy_post('$1', 'probot_credit', $2, 'admin_grant', 'admin_request', 'race', 'race:' || gen_random_uuid(), '$ADMIN', 'race')" >/dev/null; }
fill_solo() { local i; for ((i=0; i<$2; i++)); do as "$1" "$SOLO" >/dev/null; done; }

# ── fixtures ────────────────────────────────────────────────────────────────
q -c "insert into private.runtime_secrets (key, value) values ('room_code_secret', repeat('s', 40)) on conflict (key) do nothing" >/dev/null
q -c "insert into auth.users (id, email, aud, role)
      select ('${PREFIX}' || lpad(n::text, 4, '0'))::uuid, 'race3-' || n || '@example.test', 'authenticated', 'authenticated'
        from generate_series(1, 60) n" >/dev/null
q -c "update public.profiles set status = 'approved' where id::text like '${PREFIX}%';
      update public.profiles set is_admin = true where id = '$ADMIN'" >/dev/null
q -c "insert into public.bot_catalog (bot_key, display_name, engine_family, difficulty, mode_key,
        access_tier, access_tier_status, execution_type, enabled, new_rooms_allowed, lifecycle, sort_order, config_version)
      select 'race_free', 'Race Free', engine_family, difficulty, mode_key,
             'free', 'decided', 'CLIENT', true, true, 'active', 99, 1
        from public.bot_catalog where bot_key = 'stage5b'" >/dev/null
q -c "insert into public.survival_levels (id, season_key, level_no, seed, sample_policy, sample_count, win_count,
        immediate_winning_moves, shortest_winning_replay_turns, winning_replays, status, admin_note, approved_by, approved_at,
        start_canonical, start_sealed_at)
      values ('$LEVEL', 'race3', 99, 777, 'race', 10, 5, 0, 6, '[1,2,3]', 'approved', 'race', '$ADMIN', now(),
        jsonb_build_object('inventory', (select jsonb_agg(jsonb_build_object('at','bag')) from generate_series(1,100)),
          'scores', '{\"A\":0,\"B\":0}'::jsonb, 'activeSide', 'A', 'turnNumber', 1, 'startingSide', 'A'), now())" >/dev/null

echo "══ Economy races"

echo "── A. allowance = 1, two creations at once"
U=$(uid 2); pass $U plus "now() - interval '1 hour'" >/dev/null
q -c "select public.probot_charge('$U', gen_random_uuid(), gen_random_uuid(), 'authur_strong', 'allowance', clock_timestamp());
      select public.probot_charge('$U', gen_random_uuid(), gen_random_uuid(), 'authur_strong', 'allowance', clock_timestamp());" >/dev/null
gate_close; worker $U a1 "$(bot_room $(new_req) allowance)"; worker $U a2 "$(bot_room $(new_req) allowance)"; settle
echo "   $(result a1) / $(result a2)"
[[ $(count_ok a1 a2) == 1 ]] || fail "A: expected exactly one creation"
[[ "$(result a1)$(result a2)" == *allowance_empty* ]] || fail "A: the loser should see allowance_empty"
[[ $(consumptions $U) == 3 ]] || fail "A: $(consumptions $U) consumptions"
echo "   ok: one room, one allowance_empty, 3 consumptions total"

echo "── B. credits = 1, two creations at once"
U=$(uid 3); grant_credits $U 1
gate_close; worker $U b1 "$(bot_room $(new_req) credit)"; worker $U b2 "$(bot_room $(new_req) credit)"; settle
echo "   $(result b1) / $(result b2)"
[[ $(count_ok b1 b2) == 1 && "$(result b1)$(result b2)" == *insufficient_credits* ]] || fail "B"
[[ $(credits $U) == 0 && $(consumptions $U) == 1 ]] || fail "B: balance $(credits $U), consumptions $(consumptions $U)"
echo "   ok: one room, balance 0, never negative"

echo "── C. same request id, simultaneously"
U=$(uid 4); grant_credits $U 5; R=$(new_req)
gate_close; worker $U c1 "$(bot_room $R credit)"; worker $U c2 "$(bot_room $R credit)"; worker $U c3 "$(bot_room $R credit)"; settle
ROOMS=$(sort -u <(grep -h -E '^[0-9a-f-]{36}$' "$WORK/c1" "$WORK/c2" "$WORK/c3") | wc -l | tr -d ' ')
echo "   $(result c1) / $(result c2) / $(result c3); distinct rooms $ROOMS"
[[ $(count_ok c1 c2 c3) == 3 && $ROOMS == 1 && $(credits $U) == 4 && $(consumptions $U) == 1 ]] || fail "C"
echo "   ok: one room, charged once, the others replayed it"

echo "── D. same request id, different funding, simultaneously"
U=$(uid 5); grant_credits $U 5; pass $U plus "now() - interval '1 hour'" >/dev/null; R=$(new_req)
gate_close; worker $U d1 "$(bot_room $R credit)"; worker $U d2 "$(bot_room $R allowance)"; settle
echo "   $(result d1) / $(result d2)"
[[ $(count_ok d1 d2) == 1 && "$(result d1)$(result d2)" == *idempotency_conflict* ]] || fail "D"
[[ $(consumptions $U) == 1 ]] || fail "D: $(consumptions $U) consumptions"
echo "   ok: the first funding wins, the other is an idempotency conflict, one charge"

# Timed races run probot_charge at chosen instants, as the owner, in parallel:
# it takes the same per-user lock as create_bot_game.
CHARGE() { echo "select public.probot_charge('$1', gen_random_uuid(), gen_random_uuid(), 'authur_strong', 'allowance', $2);"; }

echo "── E. weekly boundary (Plus: 30 per Bangkok week)"
U=$(uid 6)
WEEK=$(q -c "select public.bangkok_week_start(now() + interval '7 days')")
WEEK_END=$(q -c "select '$WEEK'::timestamptz + interval '7 days'")
pass $U plus "'$WEEK'::timestamptz - interval '1 day'" >/dev/null
q -c "select count(*) from (select public.probot_charge('$U', gen_random_uuid(), gen_random_uuid(), 'authur_strong', 'allowance',
        '$WEEK'::timestamptz + interval '1 hour' + i * interval '30 minutes') from generate_series(1, 29) i) x" >/dev/null
gate_close
worker owner e1 "$(CHARGE $U "'$WEEK_END'::timestamptz - interval '1 second'")"
worker owner e2 "$(CHARGE $U "'$WEEK_END'::timestamptz - interval '1 second'")"
settle
echo "   last second of the week: $(result e1) / $(result e2)"
[[ $(count_ok e1 e2) == 1 && "$(result e1)$(result e2)" == *allowance_weekly_cap* ]] || fail "E: before the boundary"
gate_close
worker owner e3 "$(CHARGE $U "'$WEEK_END'::timestamptz")"
worker owner e4 "$(CHARGE $U "'$WEEK_END'::timestamptz")"
settle
echo "   first instant of the next week: $(result e3) / $(result e4)"
[[ $(count_ok e3 e4) == 2 ]] || fail "E: after the boundary"
[[ $(q -c "select weekly_used from public.probot_allowance_at('$U', '$WEEK_END'::timestamptz)") == 2 ]] || fail "E: new week usage"
echo "   ok: exactly 30 in the week; the next week starts at Monday 00:00 Bangkok"

echo "── F. regeneration boundary (Plus: 3 units, 1 per 30 min)"
U=$(uid 7); T1="now() + interval '2 days'"
pass $U plus "now() - interval '1 hour'" >/dev/null
T1=$(q -c "select date_trunc('second', $T1)")
for i in 1 2 3; do q -c "$(CHARGE $U "'$T1'::timestamptz")" >/dev/null; done
gate_close
worker owner f1 "$(CHARGE $U "'$T1'::timestamptz + interval '30 minutes' - interval '1 millisecond'")"
worker owner f2 "$(CHARGE $U "'$T1'::timestamptz + interval '30 minutes' - interval '1 millisecond'")"
settle
echo "   1 ms before the unit: $(result f1) / $(result f2)"
[[ $(count_ok f1 f2) == 0 ]] || fail "F: spent a unit before it regenerated"
gate_close
worker owner f3 "$(CHARGE $U "'$T1'::timestamptz + interval '30 minutes'")"
worker owner f4 "$(CHARGE $U "'$T1'::timestamptz + interval '30 minutes'")"
settle
echo "   at the unit: $(result f3) / $(result f4)"
[[ $(count_ok f3 f4) == 1 ]] || fail "F: expected exactly one regenerated unit"
echo "   ok: the regenerated unit is spent exactly once"

echo "── G. plan ends during creation"
U=$(uid 8)
pass $U plus "now() - interval '1 hour'" >/dev/null
END=$(q -c "select ends_at from public.plan_segments where user_id = '$U' order by starts_at desc limit 1")
gate_close
worker owner g1 "$(CHARGE $U "'$END'::timestamptz - interval '1 millisecond'")"
worker owner g2 "$(CHARGE $U "'$END'::timestamptz")"
settle
echo "   last ms of Plus: $(result g1); first instant after: $(result g2)"
[[ $(result g1) == ok && $(result g2) == allowance_free_plan ]] || fail "G: expiry"
U=$(uid 9); PASS=$(pass $U plus "now() - interval '1 hour'")
gate_close 0 # ordered: the first session must hold the user lock first
worker $U g3 "$(bot_room $(new_req) allowance) select pg_sleep(1);"
sleep 0.6
worker $ADMIN g4 "select public.admin_revoke_pass('$PASS', 'race revoke');"
settle
echo "   creation holding the lock: $(result g3); revoke that waited: $(result g4)"
[[ $(result g3) == ok && $(result g4) == ok ]] || fail "G: revoke vs create"
OUT=$(as $U "$(bot_room $(new_req) allowance)")
[[ "$OUT" == *allowance_free_plan* ]] || fail "G: creation after revoke: $OUT"
echo "   ok: a creation sees one plan for its whole transaction; after the revoke, Free"

echo "── H. bot disabled during creation"
U=$(uid 10); grant_credits $U 3
gate_close 0 # ordered: the first session must hold the user lock first
worker $U h1 "$(bot_room $(new_req) credit) select pg_sleep(1.2);"
sleep 0.6
start=$(date +%s)
worker $ADMIN h2 "select public.admin_set_bot_enabled('authur_strong', false, 'race');"
settle
echo "   creation in flight: $(result h1); disable: $(result h2)"
[[ $(result h1) == ok && $(result h2) == ok ]] || fail "H"
OUT=$(as $U "$(bot_room $(new_req) credit)")
[[ "$OUT" == *bot_disabled* && $(credits $U) == 2 ]] || fail "H: after disable: $OUT, credits $(credits $U)"
q -c "update public.bot_catalog set enabled = true where bot_key = 'authur_strong'" >/dev/null
echo "   ok: the in-flight room finished first; later creations refused, not charged"

echo "── I. failure after a tentative charge rolls back (board limit)"
U=$(uid 11); grant_credits $U 3; fill_solo $U 2
gate_close; worker $U i1 "$(bot_room $(new_req) credit)"; worker $U i2 "$(bot_room $(new_req) credit)"; settle
echo "   $(result i1) / $(result i2)"
[[ $(count_ok i1 i2) == 1 && "$(result i1)$(result i2)" == *active_board_limit* ]] || fail "I"
[[ $(credits $U) == 2 && $(consumptions $U) == 1 && $(boards $U) == 3 ]] || fail "I: credits $(credits $U), consumptions $(consumptions $U)"
echo "   ok: the refused room was never charged (credits 2, one consumption)"

echo "── J. free bot: zero consumption"
U=$(uid 12)
FREE="select room_id from public.create_bot_game(gen_random_uuid(), 'race_free', 'B', $STATE, 'private', 'none', null, 'invite_only', null, null);"
gate_close; worker $U j1 "$FREE"; worker $U j2 "$FREE"; worker $U j3 "select room_id from public.create_bot_game(gen_random_uuid(), 'race_free', 'B', $STATE, 'private', 'none', null, 'invite_only', null, 'credit');"; settle
echo "   $(result j1) / $(result j2) / funded: $(result j3)"
[[ $(result j1) == ok && $(result j2) == ok && $(result j3) == funding_not_applicable ]] || fail "J"
[[ $(consumptions $U) == 0 && $(q -c "select count(*) from public.economy_entries where user_id = '$U'") == 0 ]] || fail "J: consumed"
echo "   ok: free rooms consume nothing; funding one is refused"

echo "── K. Stage: zero consumption"
U=$(uid 13); pass $U plus "now() - interval '1 hour'" >/dev/null
STAGE="select room_id from public.create_stage_attempt(gen_random_uuid(), '$LEVEL', '{}');"
gate_close; worker $U k1 "$STAGE"; worker $U k2 "$STAGE"; settle
echo "   $(result k1) / $(result k2)"
[[ $(count_ok k1 k2) == 2 && $(consumptions $U) == 0 && $(units_at $U "clock_timestamp()") == "3/ok" ]] || fail "K"
echo "   ok: two attempts, allowance untouched (3/ok), no ledger rows"

echo "══ Board races (limit 3)"
X=$(uid 20)
echo "── create / create at 2"
fill_solo $X 2
gate_close; worker $X bb1 "$SOLO"; worker $X bb2 "$SOLO"; worker $X bb3 "$SOLO"; settle
echo "   $(result bb1) / $(result bb2) / $(result bb3) → $(boards $X)"
[[ $(count_ok bb1 bb2 bb3) == 1 && $(boards $X) == 3 ]] || fail "create/create at 2"
echo "── create / create at 3"
gate_close; worker $X bb4 "$SOLO"; worker $X bb5 "$SOLO"; settle
[[ $(count_ok bb4 bb5) == 0 && $(boards $X) == 3 ]] || fail "create/create at 3"
echo "   ok: none"

open_room() { # an open versus room owned by $1 with seat B empty
  as "$1" "select room_id from public.create_live_game(jsonb_build_object('name','open','gameMode','versus','players',jsonb_build_object('A','O'),'playerUserIds',jsonb_build_object('A','$1')), 'public', 'public', null, 'open', null);" | grep -E '^[0-9a-f-]{36}$'
}
echo "── create / join"
X=$(uid 21); O=$(uid 40); fill_solo $X 2; RM=$(open_room $O)
gate_close; worker $X cj1 "$SOLO"; worker $X cj2 "select room_id from public.join_live_game(null, '$RM');"; settle
echo "   create $(result cj1) / join $(result cj2) → $(boards $X)"
[[ $(count_ok cj1 cj2) == 1 && $(boards $X) == 3 ]] || fail "create/join"

echo "── join / join"
X=$(uid 22); O=$(uid 41); fill_solo $X 2; R1=$(open_room $O); R2=$(open_room $O)
gate_close; worker $X jj1 "select room_id from public.join_live_game(null, '$R1');"; worker $X jj2 "select room_id from public.join_live_game(null, '$R2');"; settle
echo "   $(result jj1) / $(result jj2) → $(boards $X)"
[[ $(count_ok jj1 jj2) == 1 && $(boards $X) == 3 ]] || fail "join/join"

echo "── two joiners race for one seat"
X=$(uid 23); Y=$(uid 24); O=$(uid 42); RM=$(open_room $O)
gate_close; worker $X js1 "select claimed_side from public.join_live_game(null, '$RM');"; worker $Y js2 "select claimed_side from public.join_live_game(null, '$RM');"; settle
SEATED=$(q -c "select count(*) from (values ('$X'), ('$Y')) v(u) join public.room_live l on l.room_id = '$RM' and v.u::uuid in (l.player_a_user_id, l.player_b_user_id)")
echo "   seats taken by the two joiners: $SEATED"
[[ $SEATED == 1 ]] || fail "one seat, two players"

HOSTED() { # host seats $1 as A and $2 as B
  echo "select room_id from public.create_live_game(jsonb_build_object('name','hosted','gameMode','versus','emailPlayMode','hosted','players',jsonb_build_object('A','A','B','B'),'playerUserIds',jsonb_build_object('A','$1','B','$2')), 'private', 'none', null, 'invite_only', null);"
}
echo "── invite / seating vs own creation"
X=$(uid 25); Y=$(uid 26); H=$(uid 43); fill_solo $X 2
gate_close; worker $H is1 "$(HOSTED $X $Y)"; worker $X is2 "$SOLO"; settle
echo "   seated by host $(result is1) / own create $(result is2) → $(boards $X)"
[[ $(count_ok is1 is2) == 1 && $(boards $X) == 3 ]] || fail "invite/seating"

echo "── two users seated in one operation, each also creating"
X=$(uid 27); Y=$(uid 28); H=$(uid 44); fill_solo $X 2; fill_solo $Y 2
gate_close; worker $H two1 "$(HOSTED $X $Y)"; worker $X two2 "$SOLO"; worker $Y two3 "$SOLO"; settle
echo "   host $(result two1) / X $(result two2) / Y $(result two3) → X $(boards $X), Y $(boards $Y)"
(( $(boards $X) <= 3 && $(boards $Y) <= 3 )) || fail "two seated"
[[ $(result two1) == ok ]] && [[ $(count_ok two2 two3) == 0 ]] || [[ $(result two1) != ok ]] || fail "two seated: accounting"

echo "── Ranked vs normal"
X=$(uid 29); fill_solo $X 2
gate_close
worker service rk1 "insert into public.ranked_matches (player_a_id, status, minutes_a, minutes_b, state) values ('$X', 'waiting', 10, 10, '{}') returning id;"
worker $X rk2 "$SOLO"
settle
echo "   ranked $(result rk1) / normal $(result rk2) → $(boards $X)"
[[ $(count_ok rk1 rk2) == 1 && $(boards $X) == 3 ]] || fail "ranked/normal"

echo "── Stage vs normal"
X=$(uid 30); fill_solo $X 2
gate_close; worker $X sn1 "$STAGE"; worker $X sn2 "$SOLO"; settle
echo "   stage $(result sn1) / normal $(result sn2) → $(boards $X)"
[[ $(count_ok sn1 sn2) == 1 && $(boards $X) == 3 ]] || fail "stage/normal"

echo "── bot vs normal"
X=$(uid 31); fill_solo $X 2; grant_credits $X 1
gate_close; worker $X bn1 "$(bot_room $(new_req) credit)"; worker $X bn2 "$SOLO"; settle
echo "   bot $(result bn1) / normal $(result bn2) → $(boards $X), credits $(credits $X)"
[[ $(count_ok bn1 bn2) == 1 && $(boards $X) == 3 ]] || fail "bot/normal"
if [[ $(result bn1) == ok ]]; then [[ $(credits $X) == 0 ]]; else [[ $(credits $X) == 1 ]]; fi || fail "bot/normal charge"

echo "── reconnect and play at 3, and above 3"
X=$(uid 32); fill_solo $X 3
ROOMS=($(q -c "select room_id from public.room_live where player_a_user_id = '$X'"))
gate_close
worker $X rc1 "select outcome from public.commit_live_game_command('${ROOMS[0]}', 0, 'rc1', 'A', '{\"kind\":\"place\"}', '{\"activeSide\":\"A\",\"turnNumber\":2}', 'd', null, null);"
worker $X rc2 "select revision, state is not null from public.room_live where room_id = '${ROOMS[1]}';"
worker $X rc3 "$SOLO"
settle
echo "   move $(result rc1) / reconnect read $(result rc2) / new board $(result rc3)"
[[ $(result rc1) == ok && $(result rc2) == ok && $(result rc3) == active_board_limit ]] || fail "reconnect at 3"
q -c "update public.system_settings set value_int = 4 where key = 'max_active_boards_per_user'" >/dev/null
as $X "$SOLO" >/dev/null
q -c "update public.system_settings set value_int = 3 where key = 'max_active_boards_per_user'" >/dev/null
ROOMS=($(q -c "select room_id from public.room_live where player_a_user_id = '$X'"))
gate_close
for i in 0 1 2 3; do worker $X ab$i "select outcome from public.commit_live_game_command('${ROOMS[$i]}', (select revision from public.room_live where room_id = '${ROOMS[$i]}'), 'ab$i', 'A', '{\"kind\":\"place\"}', '{\"activeSide\":\"A\",\"turnNumber\":3}', 'd', null, null);"; done
settle
echo "   four boards held at limit 3, four moves: $(result ab0) $(result ab1) $(result ab2) $(result ab3)"
[[ $(count_ok ab0 ab1 ab2 ab3) == 4 ]] || fail "above the limit, play blocked"

echo "── a room finishing while another creation waits"
X=$(uid 33); fill_solo $X 3
FIRST=$(q -c "select room_id from public.room_live where player_a_user_id = '$X' limit 1")
gate_close 0 # ordered: the first session must hold the user lock first
worker $X fw1 "select public.cancel_live_game('$FIRST'); select pg_sleep(1);"
sleep 0.6
worker $X fw2 "$SOLO"
settle
echo "   cancel $(result fw1) / create during the uncommitted cancel $(result fw2) → $(boards $X)"
(( $(boards $X) <= 3 )) || fail "finish/create exceeded"
OUT=$(as $X "$SOLO")
[[ $(boards $X) == 3 ]] || fail "finish/create: slot not usable after the finish ($OUT)"
echo "   ok: never above 3; the freed slot is usable once the finish commits"

check_all_boards
echo "   maximum active boards held by any race user (outside the deliberate above-limit case): $MAXB"
echo "phase 3 race test passed"
