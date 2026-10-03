-- Phase B: trusted tentative live sync.
--
-- Tentative tiles are public ephemeral information for ONE recipient: the
-- seated opponent in an Online Match. The trusted live-game Edge function
-- validates each proposal against room_live and broadcasts a server-built
-- message on the private topic  tentative:<game id>:<recipient user id>
-- through the Realtime broadcast API (no database write per message).
--
-- This policy only lets that recipient JOIN its own topic. There is still no
-- INSERT policy on realtime.messages, so no browser can broadcast anything;
-- spectators (who may read game:<id>) can never join a tentative topic.
-- Topic parts are compared as text, so a malformed topic cannot raise.

create or replace function public.can_receive_live_tentative(target_topic text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null
    and split_part(target_topic, ':', 1) = 'tentative'
    and split_part(target_topic, ':', 3) = auth.uid()::text
    and split_part(target_topic, ':', 4) = ''
    and exists (
      select 1 from public.room_live l
      where l.room_id::text = split_part(target_topic, ':', 2)
        and l.mode_key = 'online_versus'
        and l.authority_protocol = 'server-v1'
        and auth.uid() in (l.player_a_user_id, l.player_b_user_id)
    )
$$;
revoke all on function public.can_receive_live_tentative(text) from public, anon;
grant execute on function public.can_receive_live_tentative(text) to authenticated;

drop policy if exists live_tentative_receive on realtime.messages;
create policy live_tentative_receive on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and topic like 'tentative:%'
    and public.can_receive_live_tentative(topic)
  );
