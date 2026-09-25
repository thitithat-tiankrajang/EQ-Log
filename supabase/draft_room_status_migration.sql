-- Add the Save & Exit `draft` lifecycle state to existing room tables.
-- Run once in the Supabase SQL editor.

alter table public.rooms
  drop constraint if exists rooms_status_check;

alter table public.rooms
  add constraint rooms_status_check
  check (status in ('playing', 'draft', 'finished'));
