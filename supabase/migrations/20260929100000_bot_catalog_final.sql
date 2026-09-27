-- Phase 3: the launch bot catalog.
--
-- Product Owner decisions:
--   * Authur          — Pro tier, runs on the engine server, playable.
--   * Stage 5B        — Free tier, runs on the user's device (CLIENT), prepared
--                       here but disabled until the Phase 3b client exists.
--   * Aether (all)    — retired: no new rooms, not an active product. Rows stay
--                       so legacy rooms and history keep a catalog identity.
--
-- Access tier and execution location are independent: the tier decides how a
-- room is funded, the execution type where the move search runs. Neither is
-- derived from the other anywhere.
--
-- Execution vocabulary names a LOCATION, not a language: CLIENT means the move
-- search normally runs on the user's device (JavaScript, WebAssembly, or any
-- other browser technology). CLIENT_WASM is retired; no row ever used it.
-- Idempotent.
begin;

-- ── Vocabulary ──────────────────────────────────────────────────────────────

alter table public.bot_catalog drop constraint if exists bot_catalog_execution_type_check;
alter table public.bot_catalog add constraint bot_catalog_execution_type_check
  check (execution_type in ('CLIENT', 'SERVER', 'HYBRID'));
alter table public.bot_catalog drop constraint if exists bot_catalog_engine_family_check;
alter table public.bot_catalog add constraint bot_catalog_engine_family_check
  check (engine_family in ('aether', 'authur', 'stage5b'));
alter table public.bot_catalog drop constraint if exists bot_catalog_difficulty_check;
alter table public.bot_catalog add constraint bot_catalog_difficulty_check
  check (difficulty in ('medium', 'hard', 'max', 'super', 'easy', 'stage5b64'));

-- active   = a current product bot
-- pending  = decided but not yet playable (cannot be opened to new rooms)
-- retired  = kept only for legacy rooms and history
alter table public.bot_catalog add column if not exists lifecycle text not null default 'active';
alter table public.bot_catalog drop constraint if exists bot_catalog_lifecycle_check;
alter table public.bot_catalog add constraint bot_catalog_lifecycle_check
  check (lifecycle in ('active', 'pending', 'retired'));
alter table public.bot_catalog drop constraint if exists bot_catalog_lifecycle_rooms_check;
alter table public.bot_catalog add constraint bot_catalog_lifecycle_rooms_check
  check (lifecycle = 'active' or not new_rooms_allowed);

alter table public.room_live drop constraint if exists room_live_bot_identity_check;
alter table public.room_live add constraint room_live_bot_identity_check check (
  (bot_side is null and bot_key is null and bot_access_tier is null
    and bot_execution_type is null and bot_config_version is null)
  or (bot_side is not null and bot_key is not null
    and bot_access_tier in ('free', 'pro')
    and bot_execution_type in ('CLIENT', 'SERVER', 'HYBRID')
    and bot_config_version >= 1)
);
alter table public.room_live drop constraint if exists room_live_bot_config_check;
alter table public.room_live add constraint room_live_bot_config_check check (
  (bot_side is null and bot_difficulty is null)
  or (bot_side in ('A', 'B')
      and bot_difficulty in ('medium', 'hard', 'max', 'super', 'easy', 'stage5b64'))
);

insert into public.game_modes (mode_key, label) values ('stage5b_standard', 'Stage 5B')
on conflict (mode_key) do nothing;

-- ── Final classification ────────────────────────────────────────────────────

-- Authur becomes Pro. Its frozen room config changes, so its version moves;
-- existing Authur rooms keep the tier they were created with.
with changed as (
  update public.bot_catalog
     set access_tier = 'pro', access_tier_status = 'decided', lifecycle = 'active',
         config_version = config_version + 1, updated_at = now()
   where bot_key = 'authur_strong' and access_tier <> 'pro'
  returning *
)
insert into public.bot_catalog_audit (bot_key, action, before, after, reason, actor_id)
select bot_key, 'update', null, to_jsonb(changed), 'Phase 3: Product Owner classified Authur as Pro', null
  from changed;

with retired as (
  update public.bot_catalog
     set lifecycle = 'retired', new_rooms_allowed = false, updated_at = now()
   where engine_family = 'aether' and lifecycle <> 'retired'
  returning *
)
insert into public.bot_catalog_audit (bot_key, action, before, after, reason, actor_id)
select bot_key, 'update', null, to_jsonb(retired), 'Phase 3: Aether retired from the product', null
  from retired;

insert into public.bot_catalog
  (bot_key, display_name, engine_family, difficulty, mode_key, execution_type,
   access_tier, access_tier_status, enabled, new_rooms_allowed, lifecycle, sort_order)
values
  ('stage5b', 'Stage 5B', 'stage5b', 'stage5b64', 'stage5b_standard', 'CLIENT',
   'free', 'decided', false, false, 'pending', 20)
on conflict (bot_key) do nothing;
insert into public.bot_catalog_audit (bot_key, action, before, after, reason, actor_id)
select 'stage5b', 'insert', null, to_jsonb(c), 'Phase 3: Stage 5B prepared, awaiting the Phase 3b client', null
  from public.bot_catalog c
 where c.bot_key = 'stage5b'
   and not exists (select 1 from public.bot_catalog_audit a where a.bot_key = 'stage5b');

-- ── Catalog functions ───────────────────────────────────────────────────────

drop function if exists public.list_bots();
create function public.list_bots()
returns table (
  bot_key text, display_name text, engine_family text, difficulty text,
  execution_type text, access_tier text, enabled boolean, new_rooms_allowed boolean,
  lifecycle text, sort_order integer
)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.bot_key, c.display_name, c.engine_family, c.difficulty,
         c.execution_type, c.access_tier, c.enabled, c.new_rooms_allowed,
         c.lifecycle, c.sort_order
    from public.bot_catalog c
   where public.is_approved() or public.is_admin()
   order by c.sort_order, c.bot_key
$$;

drop function if exists public.admin_list_bots();
create function public.admin_list_bots()
returns table (
  bot_key text, display_name text, engine_family text, difficulty text, mode_key text,
  execution_type text, access_tier text, access_tier_status text, enabled boolean,
  new_rooms_allowed boolean, lifecycle text, config_version integer, sort_order integer,
  updated_at timestamptz, live_rooms bigint
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  return query
    select c.bot_key, c.display_name, c.engine_family, c.difficulty, c.mode_key,
           c.execution_type, c.access_tier, c.access_tier_status, c.enabled,
           c.new_rooms_allowed, c.lifecycle, c.config_version, c.sort_order, c.updated_at,
           (select count(*) from public.room_live l where l.bot_key = c.bot_key)
      from public.bot_catalog c
     order by case c.lifecycle when 'active' then 0 when 'pending' then 1 else 2 end,
              c.sort_order, c.bot_key;
end; $$;

-- A pending bot has no playable client yet: it cannot be switched on here.
-- A retired bot may still be switched on or off (its legacy rooms).
create or replace function public.admin_set_bot_enabled(
  target_bot_key text,
  target_enabled boolean,
  target_reason text default ''
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  before_row public.bot_catalog%rowtype;
  after_row public.bot_catalog%rowtype;
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if target_enabled is null then
    raise exception 'enabled must be true or false' using errcode = '22023';
  end if;
  select * into before_row from public.bot_catalog where bot_key = target_bot_key for update;
  if not found then
    raise exception 'unknown bot' using errcode = 'P0002';
  end if;
  if target_enabled and before_row.lifecycle = 'pending' then
    raise exception 'bot_pending: % is not playable yet and cannot be enabled', before_row.display_name
      using errcode = '22023';
  end if;
  if before_row.enabled = target_enabled then
    return;
  end if;
  update public.bot_catalog
     set enabled = target_enabled, updated_at = now(), updated_by = auth.uid()
   where bot_key = target_bot_key
  returning * into after_row;
  insert into public.bot_catalog_audit (bot_key, action, before, after, reason, actor_id)
  values (target_bot_key, case when target_enabled then 'enable' else 'disable' end,
          to_jsonb(before_row), to_jsonb(after_row), coalesce(btrim(target_reason), ''), auth.uid());
end; $$;

-- As before, plus: a bot that is not `active` cannot be opened to new rooms,
-- and new bots start `pending`. Lifecycle changes are migrations, not clicks.
create or replace function public.admin_upsert_bot(
  target_bot_key text,
  target_display_name text,
  target_engine_family text,
  target_difficulty text,
  target_mode_key text,
  target_execution_type text,
  target_access_tier text,
  target_new_rooms_allowed boolean,
  target_sort_order integer,
  target_reason text default ''
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  before_row public.bot_catalog%rowtype;
  after_row public.bot_catalog%rowtype;
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  select * into before_row from public.bot_catalog where bot_key = target_bot_key for update;
  if not found then
    insert into public.bot_catalog (
      bot_key, display_name, engine_family, difficulty, mode_key, execution_type,
      access_tier, access_tier_status, enabled, new_rooms_allowed, lifecycle, sort_order,
      updated_by
    ) values (
      target_bot_key, btrim(target_display_name), target_engine_family, target_difficulty,
      target_mode_key, target_execution_type, target_access_tier, 'decided',
      false, false, 'pending', coalesce(target_sort_order, 100), auth.uid()
    ) returning * into after_row;
    insert into public.bot_catalog_audit (bot_key, action, before, after, reason, actor_id)
    values (target_bot_key, 'insert', null, to_jsonb(after_row),
            coalesce(btrim(target_reason), ''), auth.uid());
    return;
  end if;

  if target_engine_family is distinct from before_row.engine_family
     or target_difficulty is distinct from before_row.difficulty
     or target_mode_key is distinct from before_row.mode_key then
    raise exception 'engine family, difficulty and mode of an existing bot cannot change'
      using errcode = '22023';
  end if;
  if coalesce(target_new_rooms_allowed, before_row.new_rooms_allowed) and before_row.lifecycle <> 'active' then
    raise exception 'bot_not_active: a % bot cannot be opened to new rooms', before_row.lifecycle
      using errcode = '22023';
  end if;

  update public.bot_catalog
     set display_name = btrim(target_display_name),
         execution_type = target_execution_type,
         access_tier = target_access_tier,
         access_tier_status = case
           when target_access_tier is distinct from before_row.access_tier then 'decided'
           else before_row.access_tier_status
         end,
         new_rooms_allowed = coalesce(target_new_rooms_allowed, before_row.new_rooms_allowed),
         sort_order = coalesce(target_sort_order, before_row.sort_order),
         config_version = before_row.config_version + case
           when target_execution_type is distinct from before_row.execution_type
             or target_access_tier is distinct from before_row.access_tier then 1
           else 0
         end,
         updated_at = now(),
         updated_by = auth.uid()
   where bot_key = target_bot_key
  returning * into after_row;
  insert into public.bot_catalog_audit (bot_key, action, before, after, reason, actor_id)
  values (target_bot_key, 'update', to_jsonb(before_row), to_jsonb(after_row),
          coalesce(btrim(target_reason), ''), auth.uid());
end; $$;

revoke all on function public.list_bots() from public, anon, authenticated, service_role;
revoke all on function public.admin_list_bots() from public, anon, authenticated, service_role;
grant execute on function public.list_bots() to authenticated;
grant execute on function public.admin_list_bots() to authenticated;

commit;
