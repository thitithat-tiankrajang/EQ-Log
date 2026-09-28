-- Phase 3b: open ArchBot to players.
--
-- The last step of Phase 3b, taken only after its gates passed: the browser
-- runtime, pinned provenance, exact parity with production Stage 5B, the bot
-- lifecycle, hidden-information and model-integrity tests.
--
--   * stage5b becomes a current product bot: active, enabled, open to new rooms.
--   * Players meet it as ArchBot (display name and mode label). The key, engine
--     family, difficulty and mode key are unchanged.
--   * Access tier (free) and execution type (CLIENT) are unchanged, so its frozen
--     room configuration is unchanged and config_version does not move.
--   * Its rooms get turn log, replay, analysis and alternate lines, and not the
--     bot explanation (Product Owner, Phase 3b): ArchBot is practice against a
--     bot, not a competitive mode, so analysis during the game is allowed. This
--     says nothing about Ranked, whose analysis policy is separate.
-- Idempotent.
begin;

with opened as (
  update public.bot_catalog
     set display_name = 'ArchBot', lifecycle = 'active', enabled = true,
         new_rooms_allowed = true, updated_at = now()
   where bot_key = 'stage5b'
     and access_tier = 'free' and execution_type = 'CLIENT'
     and (display_name <> 'ArchBot' or lifecycle <> 'active' or not enabled or not new_rooms_allowed)
  returning *
)
insert into public.bot_catalog_audit (bot_key, action, before, after, reason, actor_id)
select bot_key, 'update', null, to_jsonb(opened), 'Phase 3b: ArchBot opened after its client gates passed', null
  from opened;

update public.game_modes set label = 'ArchBot' where mode_key = 'stage5b_standard';

insert into public.game_mode_tools (mode_id, tool_id)
select m.id, t.id from public.game_modes m cross join public.game_tools t
 where m.mode_key = 'stage5b_standard'
   and t.tool_key in ('turn_log', 'replay', 'analysis', 'multiverse')
on conflict do nothing;

commit;
