/**
 * Rollout switch for the Arena platform shell (Arena Home and the new primary
 * navigation). It chooses which entry the ONE application shows, never a
 * second application: every route and page exists either way, and turning it
 * off is the rollback. Off unless the build sets VITE_ARENA_PLATFORM=1.
 */
export function isArenaPlatformEnabled(
  env: { readonly VITE_ARENA_PLATFORM?: string } = import.meta.env,
): boolean {
  return env.VITE_ARENA_PLATFORM === "1";
}
