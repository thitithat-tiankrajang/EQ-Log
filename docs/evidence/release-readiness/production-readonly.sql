select jsonb_build_object(
 'policies',(select jsonb_agg(jsonb_build_object('name',policyname,'command',cmd,'roles',roles,'using',qual,'check',with_check)) from pg_policies where schemaname='realtime' and tablename='messages'),
 'tentative_helper_exists',to_regprocedure('public.can_receive_live_tentative(text)') is not null,
 'realtime_messages_rls',(select relrowsecurity from pg_class where oid='realtime.messages'::regclass),
 'raw_live_select',has_table_privilege('authenticated','public.room_live','select'),
 'private_history_select',has_table_privilege('authenticated','public.live_game_events','select'),
 'publication',(select jsonb_agg(tablename) from pg_publication_tables where pubname='supabase_realtime'),
 'bot_jobs',(select coalesce(jsonb_agg(row_to_json(j)),'[]'::jsonb) from (select status,count(*) from public.live_bot_jobs group by 1) j),
 'stage_catalog',(select jsonb_agg(row_to_json(s)) from (select status,count(*) from public.survival_levels group by 1) s),
 'rooms',(select jsonb_agg(row_to_json(r)) from (select authority_protocol,mode_key,room_purpose,count(*) from public.room_live group by 1,2,3) r),
 'server_rooms',(select jsonb_agg(row_to_json(r)) from (select mode_key,revision,state->>'status' as status,state->>'roomStage' as room_stage,state->>'botEngine' as bot_engine,(state->>'turnNumber')::int as turn_number,jsonb_array_length(coalesce(state->'logs','[]'::jsonb)) as log_count,count(*) from public.room_live where authority_protocol='server-v1' group by 1,2,3,4,5,6,7) r),
 'legacy_preservation',(select jsonb_build_object('legacy_count',count(*),'missing_quarantine',count(*) filter(where q.room_id is null),'state_mismatch',count(*) filter(where q.room_row->'state' is distinct from l.state),'raw_canonical_mismatch',count(*) filter(where q.room_row->'canonical' is distinct from l.canonical),'normalized_canonical_mismatch',count(*) filter(where q.room_row->'canonical' is distinct from coalesce(l.canonical,'null'::jsonb))) from public.room_live l left join private.live_legacy_quarantine q on q.room_id=l.room_id where l.authority_protocol='legacy-client')
 ) as audit;
