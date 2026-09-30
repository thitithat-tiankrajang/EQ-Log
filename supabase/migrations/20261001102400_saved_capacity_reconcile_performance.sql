-- A metadata read may reconcile elapsed plan expiry. Avoid a no-op UPDATE
-- for accounts already within capacity. When a downgrade has excess rows,
-- materialize the ranked excess once so a poor row estimate cannot replay
-- the window scan for every Saved item.
begin;

create or replace function public.reconcile_saved_capacity(p_user_id uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare plan text; cap integer; changed integer; active_count bigint;
begin
  if p_user_id is null then raise exception 'account required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 41));
  select e.plan_key into plan from public.plan_effective(p_user_id, now()) e;
  cap := public.plan_capability_int(plan, 'private_drive_limit');
  if cap is null or cap < 0 then raise exception 'Saved capacity is not configured' using errcode = '22023'; end if;
  select count(*) into active_count from public.saved_game_items i
    where i.participant_id = p_user_id and i.state = 'active';
  if active_count <= cap then return 0; end if;
  with ranked as materialized (
    select source_kind, source_id, row_number() over (
      order by saved_at, source_kind, source_id
    ) as ordinal from public.saved_game_items
    where participant_id = p_user_id and state = 'active'
  ), excess as materialized (
    select source_kind, source_id from ranked where ordinal > cap
  )
  update public.saved_game_items i set state = 'overflow', state_changed_at = now()
  from excess r where i.participant_id = p_user_id
    and i.source_kind = r.source_kind and i.source_id = r.source_id;
  get diagnostics changed = row_count;
  return changed;
end $$;

commit;
