-- Local/staging-only smoke test for 20260930100000_archbot_display_identity.sql.
-- Run against a local Supabase built from supabase/migrations:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/archbot_display_smoke.sql
-- Reads only, then rolls back. Never run it against production.
--
-- The Stage 5B bot is PRESENTED as ArchBot. Only its display data changed:
-- every identifier and every entitlement/execution fact is Phase 3's.

begin;

do $$
declare
  bot public.bot_catalog%rowtype;
  audit_row public.bot_catalog_audit%rowtype;
  audits integer;
  mode_label text;
begin
  -- ── 1. The player-facing names ──────────────────────────────────────────────
  select * into bot from public.bot_catalog where bot_key = 'stage5b';
  if not found then
    raise exception 'the stage5b catalogue row must exist';
  end if;
  if bot.display_name <> 'ArchBot' then
    raise exception 'stage5b must be presented as ArchBot, got %', bot.display_name;
  end if;
  select label into mode_label from public.game_modes where mode_key = 'stage5b_standard';
  if mode_label is distinct from 'ArchBot' then
    raise exception 'stage5b_standard must be labelled ArchBot, got %', mode_label;
  end if;

  -- ── 2. Identifiers are untouched ────────────────────────────────────────────
  if bot.engine_family <> 'stage5b' or bot.difficulty <> 'stage5b64'
     or bot.mode_key <> 'stage5b_standard' then
    raise exception 'stage5b identifiers changed: % / % / %',
      bot.engine_family, bot.difficulty, bot.mode_key;
  end if;
  if exists (select 1 from public.bot_catalog where bot_key = 'archbot' or engine_family = 'archbot')
     or exists (select 1 from public.game_modes where mode_key like '%archbot%') then
    raise exception 'ArchBot is a display name, never a key';
  end if;

  -- ── 3. Entitlement, execution and lifecycle are Phase 3's ──────────────────
  if bot.access_tier <> 'free' or bot.access_tier_status <> 'decided'
     or bot.execution_type <> 'CLIENT' or bot.lifecycle <> 'pending'
     or bot.enabled or bot.new_rooms_allowed or bot.sort_order <> 20 then
    raise exception 'stage5b entitlement/execution/lifecycle changed';
  end if;

  -- ── 4. The rename is audited once, and moved nothing but the name ──────────
  select count(*) into audits from public.bot_catalog_audit
   where bot_key = 'stage5b' and before ->> 'display_name' = 'Stage 5B'
     and after ->> 'display_name' = 'ArchBot';
  if audits <> 1 then
    raise exception 'expected exactly one ArchBot rename audit row, found %', audits;
  end if;
  select * into audit_row from public.bot_catalog_audit
   where bot_key = 'stage5b' and after ->> 'display_name' = 'ArchBot';
  if audit_row.action <> 'update' or audit_row.actor_id is not null
     or coalesce(btrim(audit_row.reason), '') = '' then
    raise exception 'the rename audit row must be an attributed update with a reason';
  end if;
  if (audit_row.before - 'display_name' - 'updated_at')
       is distinct from (audit_row.after - 'display_name' - 'updated_at') then
    raise exception 'the rename changed more than the display name: % -> %',
      audit_row.before, audit_row.after;
  end if;
  if (audit_row.before ->> 'config_version') is distinct from bot.config_version::text then
    raise exception 'a display rename must not move config_version';
  end if;
  -- The Phase 3 insert fact is still there, unmodified.
  if not exists (select 1 from public.bot_catalog_audit
                  where bot_key = 'stage5b' and action = 'insert'
                    and after ->> 'display_name' = 'Stage 5B') then
    raise exception 'the historical Phase 3 audit fact must be preserved';
  end if;

  -- ── 5. Other bots and modes, and Stage, are not renamed ─────────────────────
  if exists (select 1 from public.bot_catalog where bot_key <> 'stage5b' and display_name = 'ArchBot')
     or exists (select 1 from public.game_modes
                 where mode_key <> 'stage5b_standard' and label = 'ArchBot') then
    raise exception 'only the stage5b bot and its mode are ArchBot';
  end if;
  if not exists (select 1 from public.bot_catalog
                  where bot_key = 'authur_strong' and display_name = 'Authur') then
    raise exception 'Authur must keep its name';
  end if;
end $$;

-- ── 6. Players read the name through list_bots ─────────────────────────────────
do $$
declare
  approved uuid := gen_random_uuid();
  name text;
begin
  insert into auth.users (id, email) values (approved, approved || '@archbot.test');
  insert into public.profiles (id, email, display_name, status)
  values (approved, approved || '@archbot.test', 'archbot-smoke', 'approved')
  on conflict (id) do update set status = 'approved';
  perform set_config('request.jwt.claims',
    json_build_object('sub', approved, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', approved::text, true);
  execute 'set local role authenticated';
  select b.display_name into name from public.list_bots() b where b.bot_key = 'stage5b';
  execute 'reset role';
  if name is distinct from 'ArchBot' then
    raise exception 'list_bots must give approved players the name ArchBot, got %', name;
  end if;
end $$;

rollback;
