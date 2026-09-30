#!/usr/bin/env bash
# Run only against a disposable loopback Supabase database. This checks the
# authoritative Save transaction racing both Recent eviction and queue cleanup.
set -euo pipefail
DB="${LOCAL_DB_URL:?Set LOCAL_DB_URL to an isolated local database}"
case "$DB" in *127.0.0.1*|*localhost*) ;; *) echo "local database required" >&2; exit 2 ;; esac

user_id=$(uuidgen | tr 'A-Z' 'a-z')
source_id=$(uuidgen | tr 'A-Z' 'a-z')
output_a=$(mktemp)
output_b=$(mktemp)
q() { psql "$DB" -X -v ON_ERROR_STOP=1 -Atq "$@"; }
cleanup() {
  q -c "delete from public.saved_game_items where source_id='$source_id';
    delete from public.recent_game_items where source_id='$source_id';
    delete from public.completed_payload_cleanup_queue where source_id='$source_id';
    select set_config('app.allow_recent_payload_cleanup','1',false);
    delete from public.recent_game_payloads where source_id='$source_id';
    delete from public.game_history where source_id='$source_id';
    delete from auth.users where id='$user_id';" >/dev/null || true
  rm -f "$output_a" "$output_b"
}
trap cleanup EXIT

q -c "insert into auth.users(id,email,aud,role) values
    ('$user_id','cleanup-race-$user_id@example.test','authenticated','authenticated');
  update public.profiles set status='approved' where id='$user_id';
  insert into public.game_history(source_kind,source_id,participant_id,game_id,
    participant_side,game_name,mode_key,game_mode,completed_at,result_authority)
    values ('normal','$source_id','$user_id','$source_id','A','Cleanup race',
      'friend','versus',now(),'client_reported');
  insert into public.recent_game_payloads(source_id,game_id,record_digest,record)
    values ('$source_id','$source_id',repeat('f',64),
      jsonb_build_object('format',1,'digest',repeat('f',64),'genesis',
        jsonb_build_object('meta',jsonb_build_object('gameId','$source_id'))));
  insert into public.recent_game_items(source_kind,source_id,participant_id,completed_at)
    values ('normal','$source_id','$user_id',now());
  insert into public.completed_payload_cleanup_queue(source_id,queued_at)
    values ('$source_id','2000-01-01'::timestamptz);" >/dev/null

q >"$output_a" <<SQL &
begin;
select set_config('request.jwt.claim.sub','$user_id',true);
select set_config('request.jwt.claims','{"sub":"$user_id","role":"authenticated"}',true);
set local role authenticated;
select already_saved from public.save_completed_game('normal','$source_id');
select pg_sleep(1);
commit;
SQL
save_pid=$!
sleep 0.2
q -c "select public.process_completed_payload_cleanup(1,interval '0 seconds')" >"$output_b"
wait "$save_pid"

test "$(q -c "select count(*) from public.saved_game_items where source_id='$source_id'")" = 1
test "$(q -c "select count(*) from public.recent_game_payloads where source_id='$source_id'")" = 1
test "$(q -c "select count(*) from public.completed_payload_cleanup_queue where source_id='$source_id'")" = 0
q -c "delete from public.recent_game_items where source_id='$source_id';
  select public.process_completed_payload_cleanup(10000, interval '0 seconds');" >/dev/null
test "$(q -c "select count(*) from public.recent_game_payloads where source_id='$source_id'")" = 1
echo "PASS: cleanup racing Save and later Recent eviction both retain Saved payload"
