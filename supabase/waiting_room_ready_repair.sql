-- Repair deployments where the first canonical commit changed a newly created
-- waiting room to paused, causing set_room_ready to reject the invited player.
-- Run after supabase/canonical_revision_migration.sql. Safe to run more than once.

begin;

create or replace function public.commit_live_game_command(
  target_game_id uuid,
  target_expected_revision bigint,
  target_command_id text,
  target_issued_by text,
  target_command jsonb,
  target_canonical jsonb,
  target_canonical_digest text,
  target_state jsonb default null,
  target_session jsonb default null
)
returns table (
  outcome text,
  revision bigint,
  canonical jsonb,
  canonical_digest text
)
language plpgsql security definer set search_path = public as $$
declare
  live public.room_live%rowtype;
  existing public.live_game_events%rowtype;
  next_revision bigint;
  clean_session jsonb;
begin
  if target_command is null or jsonb_typeof(target_command) <> 'object' then
    raise exception 'a command must be an object' using errcode = '22023';
  end if;
  if target_canonical is null or jsonb_typeof(target_canonical) <> 'object' then
    raise exception 'canonical state must be an object' using errcode = '22023';
  end if;
  if coalesce(btrim(target_command_id), '') = '' then
    raise exception 'a command must carry a stable id' using errcode = '22023';
  end if;
  if target_issued_by not in ('A', 'B', 'host') then
    raise exception 'a command must be issued by A, B or host' using errcode = '22023';
  end if;

  select * into live from public.room_live where room_id = target_game_id for update;
  if not found then
    raise exception 'live game not found' using errcode = 'P0002';
  end if;
  if not public.can_write_live_game(target_game_id) then
    raise exception 'live game write access required' using errcode = '42501';
  end if;

  select * into existing from public.live_game_events
   where game_id = target_game_id and command_id = target_command_id;
  if found then
    return query select 'duplicate'::text, live.revision, live.canonical, live.canonical_digest;
    return;
  end if;

  if live.revision is distinct from target_expected_revision then
    return query select 'conflict'::text, live.revision, live.canonical, live.canonical_digest;
    return;
  end if;

  next_revision := live.revision + 1;

  insert into public.live_game_events (
    game_id, revision, command_id, issued_by, actor_id, command
  ) values (
    target_game_id, next_revision, target_command_id, target_issued_by, auth.uid(),
    public.sanitize_game_snapshot(target_command)
  );

  clean_session := case
    when target_session is null or jsonb_typeof(target_session) <> 'object' then live.session
    else jsonb_set(
      coalesce(public.sanitize_game_snapshot(target_session), '{}'::jsonb),
      '{actorId}', to_jsonb(auth.uid()::text), true
    )
  end;

  update public.room_live
     set revision = next_revision,
         canonical = public.sanitize_game_snapshot(target_canonical),
         canonical_digest = target_canonical_digest,
         state = coalesce(public.sanitize_game_snapshot(target_state), state),
         turn_number = coalesce((target_canonical ->> 'turnNumber')::int, turn_number),
         score_a = coalesce((target_canonical #>> '{scores,A}')::int, score_a),
         score_b = coalesce((target_canonical #>> '{scores,B}')::int, score_b),
         status = case
           when coalesce(target_state ->> 'roomStage', '') = 'waiting' then 'waiting'
           when coalesce(target_canonical ->> 'status', '') = 'draft' then 'paused'
           else 'playing'
         end,
         actor_id = auth.uid(),
         session = clean_session,
         last_activity_at = now()
   where room_id = target_game_id;

  perform public.broadcast_live_game_commit(
    target_game_id, next_revision, target_command_id, target_issued_by
  );

  return query select 'committed'::text, next_revision,
    (select l.canonical from public.room_live l where l.room_id = target_game_id),
    target_canonical_digest;
end; $$;

revoke all on function public.commit_live_game_command(uuid, bigint, text, text, jsonb, jsonb, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_live_game_command(uuid, bigint, text, text, jsonb, jsonb, text, jsonb, jsonb)
  to authenticated;

-- Recover waiting rooms that were already put in the impossible paused/waiting
-- split state. The trigger leaves state untouched and refreshes updated_at.
update public.room_live
set status = 'waiting'
where status = 'paused'
  and state ->> 'roomStage' = 'waiting';

notify pgrst, 'reload schema';

commit;
