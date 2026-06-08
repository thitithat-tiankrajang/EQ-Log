import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Reads Vite env (set in .env — see SUPABASE_SETUP.md). When unset, the app runs
// in local-only mode (no accounts, rooms stay in localStorage) so it always works.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
