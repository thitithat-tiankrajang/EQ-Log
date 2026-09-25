-- Allow an authenticated admin to fully manage any room.
-- Run once in the Supabase SQL editor for existing installations.

drop policy if exists rooms_insert on public.rooms;
create policy rooms_insert on public.rooms for insert
  with check (
    owner_id = auth.uid()
    and (public.is_approved() or public.is_admin())
  );

drop policy if exists rooms_update on public.rooms;
create policy rooms_update on public.rooms for update
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists rooms_delete on public.rooms;
create policy rooms_delete on public.rooms for delete
  using (owner_id = auth.uid() or public.is_admin());
