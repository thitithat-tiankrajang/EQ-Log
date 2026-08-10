export const TIMER_TICK_MS = 1_000;
export const LIVE_SESSION_SYNC_DEBOUNCE_MS = 120;
/** Fallback authoritative read because Postgres Changes does not replay missed events. */
export const LIVE_RECONCILE_INTERVAL_MS = 5_000;
/** Delay before rebuilding a realtime channel that reported an error. */
export const REALTIME_RETRY_MS = 3_000;
/** Ignore duplicate wake signals (focus + visibilitychange often co-fire). */
export const WAKE_DEBOUNCE_MS = 1_000;
export const MIN_LOADING_VISIBLE_MS = 240;
export const PROFILE_LOAD_TIMEOUT_MS = 6_000;
export const REMOTE_CAPABILITIES_TTL_MS = 30 * 60 * 1_000;
