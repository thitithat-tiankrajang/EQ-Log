-- ── Server-side engine: authoritative bot configuration and control context ──
--
-- The A-Math engine no longer runs in the browser. A backend service computes
-- bot moves and turn analysis, and it must decide two things without trusting
-- anything the client says:
--
--   1. WHO controls the turn it is being asked about, and
--   2. WHETHER that turn belongs to the bot.
--
-- (1) already exists in this schema — `can_read_live_game` / `can_write_live_game`
-- plus the player/owner columns — and this migration deliberately reuses it
-- rather than inventing a second permission model. What is missing is (2):
-- `botSide` lives only inside the client-written `state` blob, so "is it the
-- bot's turn" was a client opinion. A room whose bot side could be re-declared
-- mid-game would let a player ask the server to play THEIR turn for them, which
-- is exactly the abuse the analysis permission rule exists to prevent.
--
-- So bot configuration is promoted to real columns, fixed when the room is
-- created, and immutable afterwards.
--
-- Run AFTER supabase/canonical_revision_migration.sql.

begin;

set statement_timeout = '120s';
set lock_timeout = '15s';

-- 1) Bot configuration as authoritative columns -------------------------------

alter table public.room_live
  add column if not exists bot_side text,
  add column if not exists bot_difficulty text;

comment on column public.room_live.bot_side is
  'Side played by the engine, or null in a human-only room. Fixed at creation; the server refuses to change it.';
comment on column public.room_live.bot_difficulty is
  'Engine strength for `bot_side`. Fixed at creation alongside it.';

-- Backfill from the state blob and the mode key, in that order of confidence.
-- `mode_key` already records the difficulty authoritatively (`aether_<tier>`);
-- only the side has to come out of the blob, and existing rooms are the only
-- rooms that will ever be trusted for it.
update public.room_live
   set bot_side = case
         when state ->> 'botSide' in ('A', 'B') then state ->> 'botSide'
         else null
       end,
       bot_difficulty = case
         when state ->> 'botDifficulty' in ('easy', 'medium', 'hard', 'max', 'super')
           then state ->> 'botDifficulty'
         when mode_key like 'aether\_%'
           then nullif(substring(mode_key from 8), '')
         else null
       end
 where bot_side is null
   and (state ->> 'botSide' in ('A', 'B') or mode_key like 'aether\_%');

-- A room is either a bot room (both set) or it is not (both null). A half-set
-- pair has no meaning and would make "is it the bot's turn" ambiguous.
alter table public.room_live drop constraint if exists room_live_bot_config_check;
alter table public.room_live add constraint room_live_bot_config_check check (
  (bot_side is null and bot_difficulty is null)
  or (bot_side in ('A', 'B') and bot_difficulty in ('easy', 'medium', 'hard', 'max', 'super'))
);

-- Derived once, from the state the room is created with. `create_live_game`
-- already reads `state ->> 'botSide'` at this exact moment (it forces Aether
-- rooms to be invite-only and seats the creator opposite the bot), so this
-- trigger records the decision that function has already acted on rather than
-- introducing a second opinion about it. Doing it here leaves that large,
-- well-tested RPC untouched.
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
    if new.bot_difficulty not in ('easy', 'medium', 'hard', 'max', 'super') then
      new.bot_difficulty := 'medium';
    end if;
  end if;
  if new.bot_side is null then
    new.bot_difficulty := null;
  end if;
  return new;
end; $$;

drop trigger if exists room_live_bot_config_derived on public.room_live;
create trigger room_live_bot_config_derived
  before insert on public.room_live
  for each row execute function public.derive_live_bot_config();

-- Only that INSERT may set it; nothing may change it later.
-- Without this, a player could flip `bot_side` to their own side and have the
-- server compute their turn for them under the bot endpoint.
create or replace function public.freeze_live_bot_config()
returns trigger language plpgsql as $$
begin
  if new.bot_side is distinct from old.bot_side
     or new.bot_difficulty is distinct from old.bot_difficulty then
    raise exception 'bot configuration is fixed for the life of a game'
      using errcode = '42501';
  end if;
  return new;
end; $$;

drop trigger if exists room_live_bot_config_frozen on public.room_live;
create trigger room_live_bot_config_frozen
  before update on public.room_live
  for each row execute function public.freeze_live_bot_config();

-- 2) Who controls the side that is on move ------------------------------------
--
-- The SQL mirror of `getRoomActorCapabilities` in the client. The client copy
-- stays where it is and keeps driving the UI; this one is the authority, and it
-- is the only one the engine service consults.
--
-- Deliberately NOT a re-derivation of read access: it composes with
-- `can_write_live_game`, so scope/region/approval rules keep their single home.
create or replace function public.controls_live_game_side(
  target_game_id uuid,
  target_side text
)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.room_live l
    where l.room_id = target_game_id
      and public.can_write_live_game(l.room_id)
      and target_side in ('A', 'B')
      and case
        -- A direct room has no gameplay host: each account plays its own side,
        -- and neither ownership nor admin reaches across the table.
        when coalesce(l.state ->> 'emailPlayMode', '') = 'direct' then
          auth.uid() = case target_side
            when 'A' then l.player_a_user_id
            else l.player_b_user_id
          end
        -- A hosted room with assigned seats: the seated account acts, and the
        -- owner still hosts whichever seat is unassigned (pass-and-play).
        when l.player_a_user_id is not null or l.player_b_user_id is not null then
          auth.uid() = coalesce(
            case target_side when 'A' then l.player_a_user_id else l.player_b_user_id end,
            l.owner_id
          )
          or public.is_admin()
        -- Local / pass-and-play: one device, the owner drives both sides.
        else auth.uid() = l.owner_id or public.is_admin()
      end
  )
$$;

revoke all on function public.controls_live_game_side(uuid, text) from public, anon, authenticated;
grant execute on function public.controls_live_game_side(uuid, text) to authenticated;

-- 3) One call the engine service can act on -----------------------------------
--
-- The service calls this AS THE REQUESTING USER (their access token, so
-- `auth.uid()` is them and every policy above applies unchanged). It returns
-- the facts a compute decision needs and nothing else. In particular it returns
-- the canonical state — the service needs the real position to search, and it
-- never forwards that state to the client.
--
-- `canonical` is exactly what `get_live_game_snapshot` already exposes to any
-- reader of the game, so this adds no visibility that did not already exist.
create or replace function public.get_live_game_engine_context(target_game_id uuid)
returns table (
  revision bigint,
  status text,
  game_mode text,
  mode_key text,
  bot_side text,
  bot_difficulty text,
  active_side text,
  turn_number int,
  phase text,
  canonical jsonb,
  canonical_digest text,
  caller_controls_active_side boolean,
  active_side_is_bot boolean
)
language sql stable security definer set search_path = public as $$
  select
    l.revision,
    l.status,
    l.game_mode,
    l.mode_key,
    l.bot_side,
    l.bot_difficulty,
    l.canonical ->> 'activeSide' as active_side,
    (l.canonical ->> 'turnNumber')::int as turn_number,
    l.canonical ->> 'phase' as phase,
    l.canonical,
    l.canonical_digest,
    public.controls_live_game_side(l.room_id, l.canonical ->> 'activeSide')
      as caller_controls_active_side,
    (l.bot_side is not null and l.bot_side = l.canonical ->> 'activeSide')
      as active_side_is_bot
  from public.room_live l
  where l.room_id = target_game_id
    and public.can_read_live_game(target_game_id)
$$;

revoke all on function public.get_live_game_engine_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_live_game_engine_context(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
