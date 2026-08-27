-- ── Bot tier table: `easy` retired, `super` added ────────────────────────────
--
-- The engine's strength tiers changed. `easy` — the 200 ms static-solver tier —
-- is gone from the picker, and `super` is new: the same search as `max` with no
-- wall-clock ceiling on it at all, so it returns when the schedule is finished
-- rather than when a deadline fires.
--
-- Two decisions worth stating, because both look like omissions:
--
--   • `easy` STAYS legal in the constraint. Rooms outlive tier tables. Live
--     rooms created against `easy` are games in progress, and `room_live` has a
--     trigger (`freeze_live_bot_config`) whose entire job is to refuse changes
--     to a room's bot configuration mid-game — for good reason: silently
--     restrengthening someone's opponent halfway through is not a migration,
--     it is a different game. Those rooms keep their stored value; the service
--     resolves it to `medium` when it reads them (`resolveBotTier` in
--     service/src/levels.ts), and no new room can be created with it because
--     the trigger below no longer accepts it.
--
--   • Archived `mode_key` values (`aether_easy`) are left exactly as they are.
--     They are a record of a game that was played, not a configuration.
--
-- Run AFTER supabase/engine_service_migration.sql.

begin;

set statement_timeout = '120s';
set lock_timeout = '15s';

-- The set a row may HOLD: the current tiers, plus the retired one that existing
-- rows are already storing. A constraint is validated against the whole table
-- on creation, so dropping `easy` here would refuse to apply while a single
-- unfinished `easy` room remains.
alter table public.room_live drop constraint if exists room_live_bot_config_check;
alter table public.room_live add constraint room_live_bot_config_check check (
  (bot_side is null and bot_difficulty is null)
  or (bot_side in ('A', 'B')
      and bot_difficulty in ('medium', 'hard', 'max', 'super', 'easy'))
);

-- The set a NEW room may be created with: current tiers only. Anything else —
-- a retired `easy`, a typo, a client that has not been redeployed — becomes
-- `medium`, exactly as before.
create or replace function public.derive_live_bot_config()
returns trigger language plpgsql as $$
begin
  if new.bot_side is null then
    new.bot_side := case
      when new.state ->> 'botSide' in ('A', 'B') then new.state ->> 'botSide'
      else null
    end;
  end if;
  if new.bot_side is not null and new.bot_difficulty is null then
    new.bot_difficulty := coalesce(
      nullif(new.state ->> 'botDifficulty', ''),
      'medium'
    );
    if new.bot_difficulty not in ('medium', 'hard', 'max', 'super') then
      new.bot_difficulty := 'medium';
    end if;
  end if;
  if new.bot_side is null then
    new.bot_difficulty := null;
  end if;
  return new;
end; $$;

comment on column public.room_live.bot_difficulty is
  'Engine strength for `bot_side`: medium | hard | max | super. Fixed at creation. '
  '`easy` is retired — still stored by rooms created before it was removed, never assigned to new ones.';

commit;
