-- Local isolated stack only. Actual grant/RLS and historic-advisory fixture.
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/stage_terminal_privileges_smoke.sql
begin;
do $test$
begin
  if has_table_privilege('authenticated', 'public.stage_completed_attempts', 'SELECT')
     or has_column_privilege('authenticated', 'public.stage_completed_attempts', 'record', 'SELECT')
     or has_table_privilege('anon', 'public.stage_completed_attempts', 'SELECT')
     or not has_table_privilege('service_role', 'public.stage_completed_attempts', 'SELECT')
     or has_column_privilege('authenticated', 'public.survival_attempts', 'result', 'UPDATE')
     or has_column_privilege('authenticated', 'public.survival_attempts', 'player_score', 'UPDATE')
     or has_function_privilege('authenticated',
       'public.capture_stage_terminal(uuid,uuid,bigint,bigint,jsonb,jsonb,text,text,text)',
       'EXECUTE')
     or has_function_privilege('authenticated',
       'public.finalize_live_game_before_stage_capture(uuid,jsonb,text,text,text)',
       'EXECUTE')
     or has_function_privilege('authenticated',
       'public.create_stage_attempt_before_start_freeze(uuid,uuid,jsonb)',
       'EXECUTE') then
    raise exception 'Stage capture grants are unsafe';
  end if;
end $test$;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-000000000981',
   'historic-stage-advisory@example.test', 'authenticated', 'authenticated');
insert into public.survival_levels (
  id, season_key, level_no, seed, sample_policy, sample_count, win_count
) values (
  '00000000-0000-4000-8000-000000000982',
  'local-historic-advisory', 1, 981, 'local-test', 1, 0
);
insert into public.survival_attempts (
  id, level_id, room_id, player_id, finished_at, player_score, authur_score, result
) values (
  '00000000-0000-4000-8000-000000000983',
  '00000000-0000-4000-8000-000000000982',
  '00000000-0000-4000-8000-000000000984',
  '00000000-0000-4000-8000-000000000981', now(), 100, 0, 'win'
);
do $test$
begin
  if not exists (
    select 1 from public.survival_attempts
    where id = '00000000-0000-4000-8000-000000000983'
      and result = 'win' and result_authority = 'advisory'
  ) or exists (
    select 1 from public.stage_completed_attempts
    where room_id = '00000000-0000-4000-8000-000000000984'
  ) then
    raise exception 'historic advisory Stage row was upgraded or fabricated';
  end if;
end $test$;
rollback;
