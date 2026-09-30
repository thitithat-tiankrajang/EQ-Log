-- Isolated local/staging database only; no application fixtures or durable writes.
begin;
do $$
declare fn regprocedure := 'public.get_game_terminal_route(uuid)'::regprocedure;
begin
  if not has_function_privilege('authenticated', fn, 'EXECUTE')
    or has_function_privilege('anon', fn, 'EXECUTE')
    or has_function_privilege('service_role', fn, 'EXECUTE') then
    raise exception 'terminal route RPC has unexpected caller grants';
  end if;
  if has_column_privilege('authenticated', 'public.room_live', 'room_purpose', 'SELECT')
    or has_column_privilege('authenticated', 'public.room_live', 'room_code_hash', 'SELECT')
    or has_column_privilege('authenticated', 'public.room_live', 'legacy_private_autosave', 'SELECT')
    or not has_column_privilege('authenticated', 'public.room_live', 'state', 'SELECT')
    or not has_column_privilege('authenticated', 'public.room_live', 'room_id', 'SELECT') then
    raise exception 'terminal correction changed the raw live-column boundary';
  end if;
  if exists (select 1 from pg_proc where oid=fn and
    (not prosecdef or provolatile <> 's' or proconfig is distinct from
      array['search_path=public, pg_temp'])) then
    raise exception 'terminal route RPC security configuration drifted';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations) <> 36
    or not exists (select 1 from supabase_migrations.schema_migrations
      where version='20261001102600') then
    raise exception 'expected unchanged 35-migration baseline plus one correction';
  end if;
end $$;
rollback;
