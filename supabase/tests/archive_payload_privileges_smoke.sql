-- Local/staging only, after the archive cutover and Ranked capture migrations.
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/archive_payload_privileges_smoke.sql
-- This fixture rolls back. It checks effective privileges and actual queries
-- under API roles, including a Public game copied to Private by the RPC.
begin;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.act_as_owner() returns void language plpgsql as $$
begin execute 'reset role'; end $$;
create function pg_temp.denied(query text) returns void language plpgsql as $$
begin
  execute query;
  raise exception 'payload query unexpectedly succeeded: %', query;
exception when insufficient_privilege then null;
end $$;
grant execute on function pg_temp.act_as(uuid), pg_temp.denied(text),
  pg_temp.act_as_owner() to authenticated;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-000000000931', 'archive-security-a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000932', 'archive-security-b@example.test', 'authenticated', 'authenticated');
insert into public.regions (id, name)
values ('00000000-0000-4000-8000-000000000933', 'Archive security fixture');
update public.profiles set status = 'approved', region_id = '00000000-0000-4000-8000-000000000933'
where id = '00000000-0000-4000-8000-000000000931';
update public.profiles set status = 'approved'
where id = '00000000-0000-4000-8000-000000000932';

insert into public.public_game_snapshots
  (game_id, source_owner_id, name, player_a, player_b, game_mode, mode_key,
   completion_kind, completion_reason, snapshot, created_at, finished_at)
values
  ('00000000-0000-4000-8000-000000000934', '00000000-0000-4000-8000-000000000931',
   'Legacy fixture', 'A', 'B', 'versus', 'friend', 'natural', 'rack_out',
   '{"v":3,"tilebag":[{"id":"SECRET_TILE_ID"}],"internalDrawOrder":"SECRET_BAG"}', now(), now()),
  ('00000000-0000-4000-8000-000000000935', '00000000-0000-4000-8000-000000000931',
   'Compact fixture', 'A', 'B', 'versus', 'friend', 'natural', 'rack_out',
   '{"format":1,"genesis":{"physical":{"bag":["SECRET_BAG"]}},"digest":"SECRET_DIGEST"}', now(), now());
insert into public.region_game_snapshots
  (game_id, region_id, source_owner_id, name, player_a, player_b, game_mode,
   mode_key, completion_kind, completion_reason, snapshot, created_at, finished_at)
values
  ('00000000-0000-4000-8000-000000000936', '00000000-0000-4000-8000-000000000933',
   '00000000-0000-4000-8000-000000000931', 'Region fixture', 'A', 'B',
   'versus', 'friend', 'natural', 'rack_out', '{"secret":"SECRET_REGION_BAG"}', now(), now());

create table public.archive_cutover_future_grant_probe (id int);
create function public.archive_cutover_future_function_probe() returns text
language sql as $$ select 'SECRET_FUTURE_PAYLOAD'::text $$;

do $privileges$
declare relation text;
begin
  foreach relation in array array[
    'public.public_game_snapshots', 'public.region_game_snapshots',
    'public.private_library_items'] loop
    if has_table_privilege('authenticated', relation, 'SELECT')
       or has_table_privilege('anon', relation, 'SELECT')
       or has_column_privilege('authenticated', relation, 'snapshot', 'SELECT')
       or has_column_privilege('anon', relation, 'snapshot', 'SELECT')
       or has_column_privilege('authenticated', relation, 'snapshot', 'INSERT')
       or has_column_privilege('authenticated', relation, 'snapshot', 'UPDATE')
       or has_column_privilege('anon', relation, 'snapshot', 'INSERT')
       or has_column_privilege('anon', relation, 'snapshot', 'UPDATE')
       or not has_column_privilege('authenticated', relation, 'name', 'SELECT')
       or not has_column_privilege('service_role', relation, 'snapshot', 'SELECT') then
      raise exception 'unsafe effective archive privilege on %', relation;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.ranked_private_revisions', 'SELECT')
     or has_column_privilege('authenticated', 'public.ranked_private_revisions', 'state', 'SELECT')
     or has_table_privilege('anon', 'public.ranked_private_revisions', 'SELECT')
     or not has_column_privilege('service_role', 'public.ranked_private_revisions', 'state', 'SELECT') then
    raise exception 'unsafe effective Ranked revision privilege';
  end if;
  if has_table_privilege('authenticated', 'public.archive_cutover_future_grant_probe', 'SELECT')
     or has_table_privilege('anon', 'public.archive_cutover_future_grant_probe', 'SELECT')
     or has_function_privilege('authenticated', 'public.archive_cutover_future_function_probe()', 'EXECUTE')
     or has_function_privilege('anon', 'public.archive_cutover_future_function_probe()', 'EXECUTE') then
    raise exception 'future public payload object inherited browser access';
  end if;
end $privileges$;

select pg_temp.act_as('00000000-0000-4000-8000-000000000931');
select pg_temp.denied('select snapshot from public.public_game_snapshots where game_id = ''00000000-0000-4000-8000-000000000934''');
select pg_temp.denied('select snapshot from public.public_game_snapshots where game_id = ''00000000-0000-4000-8000-000000000935''');
select pg_temp.denied('select snapshot from public.region_game_snapshots where game_id = ''00000000-0000-4000-8000-000000000936''');
select pg_temp.denied('select state from public.ranked_private_revisions');
do $$ begin
  if not exists (select 1 from public.public_game_snapshots where game_id = '00000000-0000-4000-8000-000000000934')
     or not exists (select 1 from public.region_game_snapshots where game_id = '00000000-0000-4000-8000-000000000936') then
    raise exception 'eligible listing access was lost';
  end if;
end $$;
select public.save_archive_to_private('public', '00000000-0000-4000-8000-000000000934', null);
select pg_temp.denied('select snapshot from public.private_library_items where source_game_id = ''00000000-0000-4000-8000-000000000934''');
do $$ begin
  if not exists (select 1 from public.private_library_items
                 where source_game_id = '00000000-0000-4000-8000-000000000934') then
    raise exception 'saved-copy listing failed';
  end if;
end $$;

select pg_temp.act_as('00000000-0000-4000-8000-000000000932');
do $$ begin
  if exists (select 1 from public.region_game_snapshots
             where game_id = '00000000-0000-4000-8000-000000000936')
     or exists (select 1 from public.private_library_items
                where source_game_id = '00000000-0000-4000-8000-000000000934') then
    raise exception 'ineligible region/private metadata became visible';
  end if;
end $$;
select pg_temp.denied('select snapshot from public.private_library_items');
select pg_temp.act_as_owner();

rollback;
