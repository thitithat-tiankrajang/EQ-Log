-- Least privilege for the Phase 1 bot catalog objects (20260927120000).
--
-- Supabase's default privileges gave service_role full access to every new
-- table, and every API role USAGE/SELECT/UPDATE on every new sequence. The
-- Phase 1 migration revoked the browser roles' table access but left:
--   * service_role able to write bot_catalog directly — skipping the audited
--     admin functions — and to rewrite or delete the audit and the room
--     creation idempotency records;
--   * every API role able to read and setval() the audit id sequence.
-- After this, bot catalog changes go only through admin_upsert_bot /
-- admin_set_bot_enabled (audited). The database owner and superusers keep the
-- maintenance path. Nothing in the app, the engine or the ranked Edge Function
-- touches these objects as service_role.
--
-- The two bot triggers read bot_catalog. They now run as their owner, so a
-- role that may write room_live (service_role) is still checked against the
-- catalog without needing to read it itself.
--
-- Every SECURITY DEFINER function Phase 1 added or replaced also gets
-- `pg_temp` pinned last on its search_path, so no temporary object can shadow
-- a name it resolves. (All their table references are schema-qualified
-- already; this is defence in depth.) Idempotent.
begin;

revoke all on table public.bot_catalog, public.bot_catalog_audit, public.room_creation_requests
  from public, anon, authenticated, service_role;
revoke all on sequence public.bot_catalog_audit_id_seq from public, anon, authenticated, service_role;

alter function public.derive_live_bot_config() security definer;
alter function public.freeze_live_bot_config() security definer;
alter function public.derive_live_bot_config() set search_path = public, pg_temp;
alter function public.freeze_live_bot_config() set search_path = public, pg_temp;
revoke all on function public.derive_live_bot_config() from public, anon, authenticated, service_role;
revoke all on function public.freeze_live_bot_config() from public, anon, authenticated, service_role;

alter function public.create_live_game_core(jsonb, text, text, uuid, text, uuid, text, text)
  set search_path = public, pg_temp;
alter function public.create_live_game(jsonb, text, text, uuid, text, uuid) set search_path = public, pg_temp;
alter function public.create_bot_game(uuid, text, text, jsonb, text, text, uuid, text, uuid)
  set search_path = public, pg_temp;
alter function public.get_live_game_engine_context(uuid) set search_path = public, pg_temp;
alter function public.commit_live_game_command(uuid, bigint, text, text, jsonb, jsonb, text, jsonb, jsonb)
  set search_path = public, pg_temp;
alter function public.update_live_game_state(uuid, jsonb) set search_path = public, pg_temp;
alter function public.join_live_game(text, uuid) set search_path = public, pg_temp;
alter function public.list_bots() set search_path = public, pg_temp;
alter function public.admin_list_bots() set search_path = public, pg_temp;
alter function public.admin_set_bot_enabled(text, boolean, text) set search_path = public, pg_temp;
alter function public.admin_upsert_bot(text, text, text, text, text, text, text, boolean, integer, text)
  set search_path = public, pg_temp;

commit;
