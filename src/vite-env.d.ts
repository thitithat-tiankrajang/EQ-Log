/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** "1" turns on photo board import in a production build (always on in development). */
  readonly VITE_BOARD_IMPORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
