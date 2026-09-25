begin;

alter table public.study_positions
  drop constraint if exists study_positions_level_check;

alter table public.study_positions
  add constraint study_positions_level_check
  check (level in ('medium', 'hard', 'max', 'super', 'stage5b64'));

commit;
