-- A sealed Stage game starts with a real nonzero score. Reject a later client
-- commit that resets either side below that opening baseline. This is a guard
-- against the observed client total-from-zero defect, not an authoritative
-- score reducer; finalize_live_game bypasses this per-commit guard, so its
-- terminal state and competitive result still need separate server work.
begin;
create or replace function public.check_stage_commit(live public.room_live, target_canonical jsonb)
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  expected jsonb;
  new_inventory jsonb := target_canonical -> 'inventory';
  old_inventory jsonb;
  before_tile jsonb;
  after_tile jsonb;
begin
  select l.start_canonical into expected
    from public.survival_attempts a join public.survival_levels l on l.id = a.level_id
   where a.room_id = live.room_id;
  if expected is null then
    raise exception 'stage_start_unknown: this Stage room has no sealed starting position' using errcode = 'P0001';
  end if;
  if jsonb_typeof(new_inventory) is distinct from 'array' or jsonb_array_length(new_inventory) <> 100 then
    raise exception 'stage_invalid_position: a Stage position must place all 100 tiles' using errcode = 'P0001';
  end if;
  if live.canonical is null then
    if new_inventory <> expected -> 'inventory'
       or target_canonical -> 'scores' is distinct from expected -> 'scores'
       or target_canonical -> 'activeSide' is distinct from expected -> 'activeSide'
       or target_canonical -> 'turnNumber' is distinct from expected -> 'turnNumber'
       or target_canonical -> 'startingSide' is distinct from expected -> 'startingSide' then
      raise exception 'stage_start_mismatch: the first position is not this level''s sealed start'
        using errcode = 'P0001';
    end if;
    return;
  end if;
  if jsonb_typeof(target_canonical -> 'scores') is distinct from 'object'
     or jsonb_typeof(target_canonical #> '{scores,A}') is distinct from 'number'
     or jsonb_typeof(target_canonical #> '{scores,B}') is distinct from 'number'
     or (target_canonical #>> '{scores,A}')::numeric < (expected #>> '{scores,A}')::numeric
     or (target_canonical #>> '{scores,B}')::numeric < (expected #>> '{scores,B}')::numeric then
    raise exception 'stage_score_baseline: a Stage score cannot lose its sealed opening points'
      using errcode = 'P0001';
  end if;
  old_inventory := live.canonical -> 'inventory';
  for i in 0 .. 99 loop
    before_tile := old_inventory -> i;
    if before_tile ->> 'at' = 'board' then
      after_tile := new_inventory -> i;
      if after_tile ->> 'at' is distinct from 'board'
         or after_tile -> 'row' is distinct from before_tile -> 'row'
         or after_tile -> 'col' is distinct from before_tile -> 'col' then
        raise exception 'stage_board_rewrite: a Stage attempt cannot move or remove a tile already on the board'
          using errcode = 'P0001';
      end if;
    end if;
  end loop;
end; $$;
revoke all on function public.check_stage_commit(public.room_live, jsonb)
  from public, anon, authenticated, service_role;
commit;
