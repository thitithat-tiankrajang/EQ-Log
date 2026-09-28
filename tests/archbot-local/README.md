# ArchBot end to end on a local Supabase stack

`playwright.archbot-local.config.ts` plays ArchBot in the real app against an
**isolated, throwaway** local Supabase stack, with no engine service configured.
It checks the room is free, `CLIENT`, not a Stage; that ArchBot's turns are
computed on the device and committed through the normal path; that a reload
mid-turn and a second tab on the same room each produce exactly one commit per
ArchBot turn; and that no engine-service request is ever made.

It is opt-in and never runs against a hosted project (the config refuses any
non-local URL).

1. Start a stack with its own project id and ports, so it cannot touch any other
   local stack: copy `supabase/migrations` into a scratch directory next to a
   `config.toml` with a unique `project_id`, `[api] port = 54721`,
   `[db] port = 54722`, and run `supabase start --workdir <dir>`.
2. ArchBot must be open in that stack's catalog (the Phase 3b enabling migration).
3. Export `ARCHBOT_LOCAL_ANON_KEY` and `ARCHBOT_LOCAL_SERVICE_KEY` from
   `supabase status -o json --workdir <dir>` (and `ARCHBOT_LOCAL_PSQL` if `psql`
   is not on `PATH`), then:

   ```sh
   npx playwright test --config playwright.archbot-local.config.ts
   ```

The test creates an ephemeral approved account through the local auth admin API
and never prints its credentials.
