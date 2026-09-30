import { supabase } from "../../supabaseClient";
import type { HistoryItem } from "./history";

export type SavedUsage = { planName: string; activeCount: number; capacity: number };
export type SavedState = "active" | "overflow" | "trashed";
export type SavedItem = {
  sourceKind: "normal" | "stage";
  sourceId: string;
  gameId: string;
  gameName: string;
  modeKey: string;
  opponentLabel: string | null;
  scoreFor: number | null;
  scoreAgainst: number | null;
  completedAt: string;
  savedAt: string;
  resultAuthority: HistoryItem["resultAuthority"];
  replayFormat: "compact" | "legacy_v3";
  state: SavedState;
  stateChangedAt: string;
};

type SavedRow = {
  source_kind: SavedItem["sourceKind"];
  source_id: string;
  game_id: string;
  game_name: string;
  mode_key: string;
  opponent_label: string | null;
  score_for: number | null;
  score_against: number | null;
  completed_at: string;
  saved_at: string;
  result_authority: SavedItem["resultAuthority"];
  replay_format: SavedItem["replayFormat"];
  item_state: SavedState;
  state_changed_at: string;
};

function mapRow(row: SavedRow): SavedItem {
  return {
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    gameId: row.game_id,
    gameName: row.game_name,
    modeKey: row.mode_key,
    opponentLabel: row.opponent_label,
    scoreFor: row.score_for,
    scoreAgainst: row.score_against,
    completedAt: row.completed_at,
    savedAt: row.saved_at,
    resultAuthority: row.result_authority,
    replayFormat: row.replay_format,
    state: row.item_state,
    stateChangedAt: row.state_changed_at,
  };
}

export async function saveCompletedGame(item: Pick<HistoryItem, "sourceKind" | "sourceId">) {
  if (!supabase) throw new Error("Saved is unavailable.");
  const { data, error } = await supabase.functions.invoke("save-completed-game", {
    body: { sourceKind: item.sourceKind, sourceId: item.sourceId },
  });
  if (error) {
    const response = error.context;
    const detail =
      response instanceof Response
        ? ((await response.json().catch(() => null)) as { error?: string } | null)
        : null;
    throw new Error(detail?.error ?? "Unable to save this replay.");
  }
  return data as
    | {
        saved_at: string;
        already_saved: boolean;
        active_count: number;
        capacity: number;
        plan_name: string;
      }
    | undefined;
}

export async function getSavedUsage(): Promise<SavedUsage> {
  if (!supabase) return { planName: "Free", activeCount: 0, capacity: 100 };
  const { data, error } = await supabase.rpc("saved_game_usage");
  if (error) throw new Error(error.message);
  const row = data?.[0] as
    { plan_name: string; active_count: number; capacity: number } | undefined;
  if (!row) throw new Error("Saved capacity is unavailable.");
  return { planName: row.plan_name, activeCount: Number(row.active_count), capacity: row.capacity };
}

export async function listMySavedGames(
  cursor: string | null = null,
  limit = 20,
  state: SavedState = "active",
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 49)
    throw new Error("Invalid Saved page size.");
  if (!supabase) return { items: [] as SavedItem[], nextCursor: null as string | null };
  let before: [string, SavedItem["sourceKind"], string] | null = null;
  if (cursor !== null) {
    try {
      const parsed: unknown = JSON.parse(cursor);
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 3 ||
        typeof parsed[0] !== "string" ||
        !Number.isFinite(Date.parse(parsed[0])) ||
        (parsed[1] !== "normal" && parsed[1] !== "stage") ||
        typeof parsed[2] !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(parsed[2])
      )
        throw new Error("Invalid Saved page cursor.");
      before = parsed as [string, SavedItem["sourceKind"], string];
    } catch {
      throw new Error("Invalid Saved page cursor.");
    }
  }
  const { data, error } = await supabase.rpc("list_my_saved_games", {
    p_limit: limit + 1,
    p_before_at: before?.[0] ?? null,
    p_before_kind: before?.[1] ?? null,
    p_before_id: before?.[2] ?? null,
    p_state: state,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SavedRow[];
  const items = rows.slice(0, limit).map(mapRow);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? JSON.stringify([last.savedAt, last.sourceKind, last.sourceId])
        : null,
  };
}

export async function changeMySavedGame(
  item: Pick<SavedItem, "sourceKind" | "sourceId">,
  action: "trash" | "restore" | "activate" | "delete",
): Promise<void> {
  if (!supabase) throw new Error("Saved is unavailable.");
  const { error } = await supabase.rpc("change_my_saved_game", {
    p_source_kind: item.sourceKind,
    p_source_id: item.sourceId,
    p_action: action,
  });
  if (error) throw new Error(error.message);
}
