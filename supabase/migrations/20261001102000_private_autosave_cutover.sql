-- Mark the existing in-progress private autosave cohort before changing the
-- creation boundary. New private rooms no longer reserve old Library capacity.
begin;

alter table public.room_live add column legacy_private_autosave boolean not null default false;
update public.room_live set legacy_private_autosave = true
  where archive_policy = 'private';
comment on column public.room_live.legacy_private_autosave is
  'Frozen cutover marker for pre-existing private rooms; never inferred from a new room.';

alter function public.create_live_game(jsonb, text, text, uuid, text, uuid)
  rename to create_live_game_before_saved_cutover;
revoke all on function public.create_live_game_before_saved_cutover(jsonb, text, text, uuid, text, uuid)
  from public, anon, authenticated, service_role;
create function public.create_live_game(
  target_state jsonb, target_access_scope text, target_archive_policy text,
  target_region_id uuid default null, target_join_policy text default 'invite_only',
  target_private_parent_id uuid default null
) returns table (room_id uuid, room_code text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Keep private access and live resume; only the old automatic archive and
  -- its reservation are removed for rooms created after this cutover.
  return query select * from public.create_live_game_before_saved_cutover(
    target_state, target_access_scope,
    case when target_archive_policy = 'private' then 'none' else target_archive_policy end,
    target_region_id, target_join_policy,
    case when target_archive_policy = 'private' then null else target_private_parent_id end
  );
end $$;
revoke all on function public.create_live_game(jsonb, text, text, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_live_game(jsonb, text, text, uuid, text, uuid)
  to authenticated;

-- Bot rooms use create_live_game_core directly, so the ordinary room wrapper
-- alone would leave private bot rooms on the old quota/auto-archive path.
alter function public.create_bot_game(uuid, text, text, jsonb, text, text, uuid, text, uuid, text)
  rename to create_bot_game_before_saved_cutover;
revoke all on function public.create_bot_game_before_saved_cutover(
  uuid, text, text, jsonb, text, text, uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
create function public.create_bot_game(
  target_request_id uuid, target_bot_key text, target_bot_side text,
  target_state jsonb, target_access_scope text, target_archive_policy text,
  target_region_id uuid default null, target_join_policy text default 'invite_only',
  target_private_parent_id uuid default null, target_funding text default null
) returns table (room_id uuid, room_code text, replayed boolean,
  funding text, consumption_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare prior_policy text;
begin
  -- A creation retry begun before cutover must replay its original request.
  select r.archive_policy into prior_policy from public.room_creation_requests r
    where r.user_id = auth.uid() and r.request_id = target_request_id;
  return query select * from public.create_bot_game_before_saved_cutover(
    target_request_id, target_bot_key, target_bot_side, target_state,
    target_access_scope,
    case when target_archive_policy = 'private' and prior_policy is distinct from 'private'
      then 'none' else target_archive_policy end,
    target_region_id, target_join_policy,
    case when target_archive_policy = 'private' and prior_policy is distinct from 'private'
      then null else target_private_parent_id end,
    target_funding
  );
end $$;
revoke all on function public.create_bot_game(uuid, text, text, jsonb, text, text, uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_bot_game(uuid, text, text, jsonb, text, text, uuid, text, uuid, text)
  to authenticated;

-- The legacy cohort must finish even if its old reserved slot disappeared.
-- The browser cannot insert snapshot bytes into the old table. This narrow
-- bypass applies only to the finalizer's source ID for a marked live room.
create or replace function public.validate_private_library_item()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare cursor_id uuid; cursor_owner uuid; depth int := 0;
  depth_limit int; item_limit bigint; item_count bigint;
  legacy_finish boolean := false;
begin
  if tg_op = 'UPDATE' and old.item_type = 'game' and (
    new.snapshot is distinct from old.snapshot or new.game_id is distinct from old.game_id
    or new.game_mode is distinct from old.game_mode or new.mode_key is distinct from old.mode_key
    or new.completion_kind is distinct from old.completion_kind
    or new.completion_reason is distinct from old.completion_reason
    or new.source_scope is distinct from old.source_scope
    or new.source_game_id is distinct from old.source_game_id
  ) then raise exception 'private game snapshots are immutable' using errcode = '42501'; end if;
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    raise exception 'private items cannot change owner' using errcode = '42501';
  end if;
  if new.parent_id is not null then
    cursor_id := new.parent_id;
    loop
      select owner_id, parent_id into cursor_owner, cursor_id
        from public.private_library_items where id = cursor_id and item_type = 'folder';
      if not found or cursor_owner <> new.owner_id then
        raise exception 'parent folder not found' using errcode = '22023';
      end if;
      depth := depth + 1;
      if cursor_id is null then exit; end if;
      if cursor_id = new.id then
        raise exception 'folder cycle is not allowed' using errcode = '22023';
      end if;
    end loop;
    select value_int::int into depth_limit from public.system_settings
      where key = 'private_folder_depth_limit';
    if depth > coalesce(depth_limit, 8) then
      raise exception 'private folder depth limit reached' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text, 41));
    if new.item_type = 'game' and new.source_scope = 'private'
      and new.game_id = new.source_game_id then
      select exists (select 1 from public.room_live r
        where r.room_id = new.source_game_id and r.owner_id = new.owner_id
          and r.archive_policy = 'private' and r.legacy_private_autosave)
        into legacy_finish;
    end if;
    if not legacy_finish then
      select value_int into item_limit from public.system_settings
        where key = case when new.item_type = 'game' then 'private_board_limit'
          else 'private_folder_limit' end;
      select count(*) into item_count from public.private_library_items
        where owner_id = new.owner_id and item_type = new.item_type;
      if new.item_type = 'game' and new.source_scope = 'private' then
        select item_count + count(*) into item_count from public.room_live
          where owner_id = new.owner_id and archive_policy = 'private'
            and room_id <> new.source_game_id;
      end if;
      if item_count >= coalesce(item_limit,
        case when new.item_type = 'game' then 1000 else 200 end) then
        raise exception 'private library quota reached' using errcode = 'P0001';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

commit;
