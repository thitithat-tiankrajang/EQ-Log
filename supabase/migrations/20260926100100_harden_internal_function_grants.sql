-- Internal functions that browser roles could call directly.
--
-- Every function below is SECURITY DEFINER and, like all functions in a fresh
-- Supabase project, was executable by anon and authenticated. None is called by
-- the client, the engine service or an Edge Function; each is called only from
-- other SECURITY DEFINER functions owned by postgres (finalize_live_game,
-- set_game_storage_limits, move_public_snapshot(s)_to_region), which keep
-- working because they run as that owner.
--
-- record_player_result is the one that mattered: it takes any profile id and
-- adds a win, loss or draw to that player's user_mode_stats with no check of
-- who is asking, so anyone holding the public anon key could rewrite anyone's
-- record. The prune and cleanup functions only delete what retention already
-- would, but there is no reason for a browser to trigger them.
begin;

revoke execute on function public.record_player_result(uuid, text, text, text, integer, integer, timestamp with time zone, text)
  from public, anon, authenticated;
revoke execute on function public.prune_public_game_snapshots() from public, anon, authenticated;
revoke execute on function public.prune_region_game_snapshots(uuid) from public, anon, authenticated;
revoke execute on function public.cleanup_expired_live_games() from public, anon, authenticated;
revoke execute on function public.cleanup_private_library_trash() from public, anon, authenticated;

commit;
