\set ON_ERROR_STOP on
begin read only;
-- PRE-DEPLOY REQUIRED: an operator with read-only access must save this output.
-- Counts/metadata only. Never export Stage seeds, racks, canonical or cron SQL.
select version from supabase_migrations.schema_migrations order by version;
select status,count(*) as levels,
 count(*) filter(where start_canonical is not null and start_sealed_at is not null) as sealed,
 count(*) filter(where approved_by is not null and approved_at is not null) as approved
 from public.survival_levels group by status order by status;
-- Safe Stage identifiers and eligibility flags only; no generation material.
select id,season_key,level_no,status,
 start_canonical is not null and start_sealed_at is not null as sealed,
 approved_by is not null and approved_at is not null as approved,
 jsonb_array_length(winning_replays) as winning_replay_count,
 immediate_winning_moves,shortest_winning_replay_turns
 from public.survival_levels where status='approved' order by season_key,level_no;
select bot_key,engine_family,difficulty,mode_key,execution_type,access_tier,
 lifecycle,enabled,new_rooms_allowed,config_version from public.bot_catalog order by bot_key;
select key,value_int from public.system_settings order by key;
select plan_key,capability_key,status,value,same_as_plan from public.plan_capabilities
 where capability_key in ('stage_plan_ceiling','private_drive_limit','probot_allowance_capacity','probot_regen_minutes','probot_weekly_allowance_cap')
 order by plan_key,capability_key;
select m.mode_key,t.tool_key from public.game_mode_tools mt
 join public.game_modes m on m.id=mt.mode_id join public.game_tools t on t.id=mt.tool_id
 order by m.mode_key,t.tool_key;
select room_purpose,mode_key,status,count(*) as rooms,
 sum(pg_column_size(state)+coalesce(pg_column_size(canonical),0)) as private_bytes
 from public.room_live group by room_purpose,mode_key,status order by 1,2,3;
select jobid,jobname,schedule,active,md5(command) as command_digest,
 command ~* '(sync_live_game|update_live_game|commit_live_game|capture_|finalize_|autosave|expire)' as needs_authority_review
 from cron.job order by jobid;
select schemaname,tablename from pg_publication_tables
 where pubname='supabase_realtime' order by schemaname,tablename;
rollback;
