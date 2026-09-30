# Authur runtime regression on isolated local services

This opt-in suite uses the real frontend, real Supabase Auth/PostgREST/RPCs,
real engine HTTP server and shipped Authur/Stage5B/C++ runners. It creates
throwaway accounts and rooms. Use a new local stack; never a hosted project.
The suite rejects non-local database and API addresses. Tests cover funding,
exactly-once creation, four Authur turns with real commits, reload and two tabs,
Analysis start/read/active cancellation/stale cancellation, retained Analysis
budget isolation, preflight/errors, and bounded retries under real queue load.

1. Initialize a scratch Supabase directory with a unique project id. Copy this
   checkout's `supabase/migrations` into it. Use API port 54921, DB port 54922,
   distinct ports for other services, and a local-only `room_code_secret` in
   `private.runtime_secrets`. Start the stack and save `supabase status -o json`
   to a private temporary file outside the repository. The file contains local
   keys; do not commit or publish it. Stop the disposable stack after testing.
2. In the paired production-lineage engine checkout, run `make cli` and install
   service dependencies. Start `service/src/server.ts` with port 8795, the
   absolute built engine path, local Supabase URL/key, concurrency 1, queue 2,
   `ENGINE_BUDGET_PER_WINDOW=30`, `ENGINE_ANALYSIS_BUDGETED=true`, and explicit
   origins `https://eq-log.vercel.app,http://127.0.0.1:4475`. The small legacy
   budget proves Analysis exhaustion cannot block Authur. Do not change search
   parameters or model files. Use the normal asymmetric token verifier.
3. Start this frontend on port 4475 with the local Supabase URL/anon key and
   `VITE_ENGINE_API_URL=http://127.0.0.1:8795`.
4. Run:

   ```sh
   AUTHUR_LOCAL_STATUS_FILE=/private/temp/local-status.json \
     npx playwright test --config playwright.authur-runtime.config.ts
   ```

The 1440 × 1000 viewport keeps the existing desktop action controls accessible;
an earlier 1280 × 720 run hit existing layout clipping after two bot turns.
No layout changes are part of this runtime patch. SSE bodies are verified by
transport tests; browser overload verifies the real JSON rejection and browser
request timing because Chromium does not reliably expose completed SSE bodies
to its network-capture API.
