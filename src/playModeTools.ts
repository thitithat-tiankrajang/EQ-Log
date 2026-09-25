import type { GameState } from "./game";
import { deriveModeKey } from "./features/gameRecords/domain";
import { supabase } from "./supabaseClient";

export type PlayTool = "turn_log" | "replay" | "analysis" | "multiverse" | "bot_insight";

const ALL_TOOLS: readonly PlayTool[] = [
  "turn_log",
  "replay",
  "analysis",
  "multiverse",
  "bot_insight",
];

const MODE_DEFAULTS: Record<string, readonly PlayTool[]> = {
  local_versus: ["turn_log", "replay", "analysis", "multiverse"],
  hosted_versus: ["turn_log", "replay", "analysis", "multiverse"],
  online_versus: ["turn_log", "replay", "analysis"],
  solo_practice: ["turn_log", "replay", "analysis"],
  aether_easy: ALL_TOOLS,
  aether_medium: ALL_TOOLS,
  aether_hard: ALL_TOOLS,
  aether_max: ALL_TOOLS,
  aether_super: ALL_TOOLS,
  authur_strong: ALL_TOOLS,
  // The offline Survival playtest (src/features/survivalPlay). Local only, never
  // in the catalog: no analysis or bot insight, which would hand the player the
  // answer, and no branching, since the level's server keeps one line.
  survival_playtest: ["turn_log", "replay"],
  // A one-turn Study puzzle preview (src/features/studyPuzzles). No tools at all:
  // analysis would be the answer, and there is no game to log or replay.
  study_puzzle: [],
};

const cache = new Map<string, ReadonlySet<PlayTool>>();
const pending = new Map<string, Promise<ReadonlySet<PlayTool>>>();

export function playModeKey(game: GameState, storedKey?: string | null): string {
  return storedKey || deriveModeKey(game);
}

export function defaultPlayTools(modeKey: string): ReadonlySet<PlayTool> {
  return new Set(MODE_DEFAULTS[modeKey] ?? []);
}

export function cachedPlayTools(modeKey: string): ReadonlySet<PlayTool> | null {
  return cache.get(modeKey) ?? null;
}

/** A mode is fetched once per tab. Unknown modes stay closed until the catalog answers. */
export function loadPlayTools(modeKey: string): Promise<ReadonlySet<PlayTool>> {
  const cached = cache.get(modeKey);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(modeKey);
  if (existing) return existing;
  const request = (async () => {
    if (!supabase || typeof supabase.rpc !== "function") return defaultPlayTools(modeKey);
    let data: { tool_key: string }[] | null = null;
    let error: unknown = null;
    try {
      const result = await supabase.rpc("get_game_mode_tools", { target_mode_key: modeKey });
      data = result.data as { tool_key: string }[] | null;
      error = result.error;
    } catch {
      return defaultPlayTools(modeKey);
    }
    // Older deployments do not have the catalog yet. Preserve known modes;
    // never guess which tools an unfamiliar mode is allowed to use.
    if (error) return defaultPlayTools(modeKey);
    const tools = new Set<PlayTool>();
    for (const row of (data ?? []) as { tool_key: string }[]) {
      if (ALL_TOOLS.includes(row.tool_key as PlayTool)) tools.add(row.tool_key as PlayTool);
    }
    cache.set(modeKey, tools);
    return tools;
  })().finally(() => pending.delete(modeKey));
  pending.set(modeKey, request);
  return request;
}
