-- Local/staging-only. Apply the ranked capture migration first, then run with
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/ranked_private_revisions_smoke.sql.
-- The whole fixture rolls back. A duplicate result forces failure AFTER the
-- revision trigger fires, proving that its capture rolls back with the CAS.
begin;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-000000000921', 'ranked-capture-a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000922', 'ranked-capture-b@example.test', 'authenticated', 'authenticated');
update public.profiles set status = 'approved'
where id in ('00000000-0000-4000-8000-000000000921', '00000000-0000-4000-8000-000000000922');

do $test$
declare
  a constant uuid := '00000000-0000-4000-8000-000000000921';
  b constant uuid := '00000000-0000-4000-8000-000000000922';
  m constant uuid := '00000000-0000-4000-8000-000000000923';
  first_revision bigint;
  next_revision bigint;
  playing jsonb;
  finished jsonb;
  rejected boolean := false;
begin
  if has_table_privilege('authenticated', 'public.ranked_private_revisions', 'SELECT')
     or has_table_privilege('anon', 'public.ranked_private_revisions', 'SELECT')
     or not has_table_privilege('service_role', 'public.ranked_private_revisions', 'SELECT') then
    raise exception 'ranked private capture grants are unsafe';
  end if;

  insert into public.ranked_matches
    (id, player_a_id, player_b_id, status, minutes_a, minutes_b, state)
  values
    (m, a, b, 'matched', 10, 10,
     '{"status":"draft","roomStage":"waiting","lobbyReadyBySide":{"A":false,"B":false},"timers":{"A":600,"B":600,"paused":true},"scores":{"A":0,"B":0}}');
  if not public.ranked_ready_match(m, a, now())
     or not public.ranked_ready_match(m, b, now()) then
    raise exception 'ranked readiness failed';
  end if;
  select revision into first_revision from public.ranked_matches where id = m;
  if (select count(*) from public.ranked_private_revisions where match_id = m) <> 1
     or not exists (select 1 from public.ranked_private_revisions
                    where match_id = m and revision = first_revision
                      and state ->> 'status' = 'playing') then
    raise exception 'ready transition did not capture the playing genesis';
  end if;

  select state || '{"turnNumber":2}'::jsonb into playing
    from public.ranked_matches where id = m;
  if not public.ranked_commit_match(m, first_revision, playing, null, null) then
    raise exception 'ranked playing CAS failed';
  end if;
  select revision into next_revision from public.ranked_matches where id = m;
  if next_revision <> first_revision + 1
     or (select count(*) from public.ranked_private_revisions where match_id = m) <> 2
     or public.ranked_commit_match(m, first_revision, playing, null, null) then
    raise exception 'stale CAS changed private revision history';
  end if;

  finished := playing || '{"status":"finished","scores":{"A":8,"B":0}}'::jsonb;
  insert into public.ranked_results
    (match_id, player_a_id, player_b_id, winner_id, reason, score_a, score_b,
     rating_a_before, rating_b_before, rating_a_after, rating_b_after)
  values (m, a, b, a, 'resign', 8, 0, 1000, 1000, 1000, 1000);
  begin
    perform public.ranked_commit_match(m, next_revision, finished, 'A', 'resign');
  exception when unique_violation then
    rejected := true;
  end;
  if not rejected
     or (select revision from public.ranked_matches where id = m) <> next_revision
     or (select count(*) from public.ranked_private_revisions where match_id = m) <> 2 then
    raise exception 'failed result transaction left a phantom private revision';
  end if;

  delete from public.ranked_results where match_id = m;
  -- Evaluate the mutating function before querying its effects: SQL does not
  -- guarantee left-to-right evaluation of operands inside one expression.
  if not public.ranked_commit_match(m, next_revision, finished, 'A', 'resign') then
    raise exception 'terminal ranked commit returned false';
  end if;
  if (select count(*) from public.ranked_private_revisions where match_id = m) <> 3
     or not exists (select 1 from public.ranked_private_revisions
                    where match_id = m and revision = next_revision + 1
                      and state = finished) then
    raise exception 'terminal commit and capture diverged';
  end if;
end $test$;

rollback;
