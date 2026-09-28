-- Foundation C2: the Stage 5B bot is presented to players as ArchBot.
--
-- DISPLAY DATA ONLY. Two player-facing values change:
--   bot_catalog.display_name for bot_key 'stage5b'          'Stage 5B' -> 'ArchBot'
--   game_modes.label         for mode_key 'stage5b_standard' 'Stage 5B' -> 'ArchBot'
--
-- Nothing else changes: bot_key 'stage5b', mode_key 'stage5b_standard',
-- difficulty 'stage5b64', engine_family, execution type, access tier and its
-- status, enabled, new_rooms_allowed, lifecycle, sort order and config_version
-- all stay as Phase 3 left them. A display name is not part of a room's frozen
-- configuration, so config_version does not move (the same rule
-- admin_upsert_bot follows). The change is recorded in bot_catalog_audit with
-- the full before/after rows, as an administrator's rename would be; earlier
-- audit rows are untouched. No function, grant or policy is redefined.
--
-- Stage 1-50 (the progression mode) is unrelated and not touched.
-- Idempotent: re-running it changes and records nothing.
begin;

with before_row as (
  select * from public.bot_catalog
   where bot_key = 'stage5b' and display_name is distinct from 'ArchBot'
   for update
), renamed as (
  update public.bot_catalog c
     set display_name = 'ArchBot', updated_at = now()
    from before_row b
   where c.bot_key = b.bot_key
  returning c.*
)
insert into public.bot_catalog_audit (bot_key, action, before, after, reason, actor_id)
select r.bot_key, 'update', to_jsonb(b), to_jsonb(r),
       'Foundation C2: player-facing name of the Stage 5B bot is ArchBot (display only)', null
  from renamed r
  join before_row b on b.bot_key = r.bot_key;

update public.game_modes
   set label = 'ArchBot'
 where mode_key = 'stage5b_standard' and label is distinct from 'ArchBot';

commit;
