-- Study analysis at the Stage 5B deep pass (`stage5b64`), promoted from
-- supabase/study_stage5b64_migration.sql so it is applied in order. Widens the
-- allowed levels; no existing row changes. Idempotent.
begin;

alter table public.study_positions
  drop constraint if exists study_positions_level_check;

alter table public.study_positions
  add constraint study_positions_level_check
  check (level in ('medium', 'hard', 'max', 'super', 'stage5b64'));

commit;
