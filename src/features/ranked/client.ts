import { supabase } from "../../supabaseClient";
import type { RankedAction } from "./rules";
import type { RankedMatchView } from "./publicView";

export type RankedOpenRoom = {
  id: string;
  creatorId: string;
  creator: string;
  minutesA: number;
  createdAt: string;
};
export type RankedRating = {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
};
export type RankedLeaderboardRow = RankedRating & {
  player_id: string;
  name: string;
  place: number;
};

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Ranked needs an online account.");
  const { data, error } = await supabase.functions.invoke("ranked", { body });
  if (error) {
    const response = "context" in error ? error.context : null;
    const detail =
      response instanceof Response
        ? ((await response.json().catch(() => null)) as { error?: string } | null)
        : null;
    throw new Error(detail?.error ?? error.message);
  }
  return data as T;
}

export const rankedClient = {
  list: () =>
    invoke<{ open: RankedOpenRoom[]; mine: { id: string; status: string }[] }>({
      operation: "list",
    }),
  leaderboard: () =>
    invoke<{ rows: RankedLeaderboardRow[]; own: RankedRating }>({ operation: "leaderboard" }),
  create: (minutesA: number, minutesB: number) =>
    invoke<{ match: RankedMatchView }>({ operation: "create", minutesA, minutesB }),
  join: (id: string) => invoke<{ match: RankedMatchView }>({ operation: "join", id }),
  cancel: (id: string) => invoke<{ cancelled: boolean }>({ operation: "cancel", id }),
  ready: (id: string) => invoke<{ match: RankedMatchView }>({ operation: "ready", id }),
  read: (id: string) => invoke<{ match: RankedMatchView }>({ operation: "read", id }),
  action: (id: string, revision: number, action: RankedAction) =>
    invoke<{ match: RankedMatchView }>({ operation: "action", id, revision, action }),
};
