/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** "1" turns on photo board import in a production build (always on in development). */
  readonly VITE_BOARD_IMPORT?: string;
  /** "1" turns on the Arena platform shell (rollout/rollback switch; off by default). */
  readonly VITE_ARENA_PLATFORM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
