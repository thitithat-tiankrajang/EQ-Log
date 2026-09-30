import { supabase } from "../../supabaseClient";

export type HistoryReplayAvailability =
  | "compact_available"
  | "legacy_available"
  | "legacy_partial"
  | "unsupported_legacy"
  | "unavailable";

export type HistoryItem = {
  sourceKind: "normal" | "ranked" | "stage";
  sourceId: string;
  gameId: string;
  participantSide: "A" | "B";
  gameName: string;
  modeKey: string;
  gameMode: "versus" | "solo" | "ranked" | "stage";
  opponentLabel: string | null;
  botKey: string | null;
  scoreFor: number | null;
  scoreAgainst: number | null;
  outcome: "win" | "loss" | "draw" | null;
  completedAt: string;
  rulesVersion: string | null;
  resultAuthority: "client_reported" | "server_reduced" | "captured_client_state" | "advisory";
  replayAvailability: HistoryReplayAvailability;
  isRecent: boolean;
  isSaved: boolean;
  savedState: "active" | "trashed" | "overflow" | null;
  canSave: boolean;
};

export type HistoryPage = { items: HistoryItem[]; nextCursor: string | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sourceKinds = new Set(["normal", "ranked", "stage"]);

type Cursor = { completedAt: string; sourceKind: HistoryItem["sourceKind"]; sourceId: string };

export function historyCursor(item: Cursor): string {
  return JSON.stringify([item.completedAt, item.sourceKind, item.sourceId]);
}

export function parseHistoryCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid History page cursor.");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 3 ||
    typeof parsed[0] !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(parsed[0]) ||
    !Number.isFinite(Date.parse(parsed[0])) ||
    typeof parsed[1] !== "string" ||
    !sourceKinds.has(parsed[1]) ||
    typeof parsed[2] !== "string" ||
    !uuid.test(parsed[2])
  )
    throw new Error("Invalid History page cursor.");
  return {
    completedAt: parsed[0],
    sourceKind: parsed[1] as Cursor["sourceKind"],
    sourceId: parsed[2],
  };
}

type HistoryRow = {
  source_kind: HistoryItem["sourceKind"];
  source_id: string;
  game_id: string;
  participant_side: HistoryItem["participantSide"];
  game_name: string;
  mode_key: string;
  game_mode: HistoryItem["gameMode"];
  opponent_label: string | null;
  bot_key: string | null;
  score_for: number | null;
  score_against: number | null;
  outcome: HistoryItem["outcome"];
  completed_at: string;
  rules_version: string | null;
  result_authority: HistoryItem["resultAuthority"];
  replay_availability: HistoryReplayAvailability;
  is_recent: boolean;
  is_saved: boolean;
  saved_state: HistoryItem["savedState"];
  can_save: boolean;
};

function mapRow(row: HistoryRow): HistoryItem {
  return {
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    gameId: row.game_id,
    participantSide: row.participant_side,
    gameName: row.game_name,
    modeKey: row.mode_key,
    gameMode: row.game_mode,
    opponentLabel: row.opponent_label,
    botKey: row.bot_key,
    scoreFor: row.score_for,
    scoreAgainst: row.score_against,
    outcome: row.outcome,
    completedAt: row.completed_at,
    rulesVersion: row.rules_version,
    resultAuthority: row.result_authority,
    replayAvailability: row.replay_availability,
    isRecent: row.is_recent,
    isSaved: row.is_saved,
    savedState: row.saved_state ?? (row.is_saved ? "active" : null),
    canSave: row.can_save,
  };
}

export async function listMyHistory(
  cursor: string | null = null,
  limit = 20,
): Promise<HistoryPage> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 49)
    throw new Error("Invalid History page size.");
  const before = cursor === null ? null : parseHistoryCursor(cursor);
  if (!supabase) return { items: [], nextCursor: null };
  const { data, error } = await supabase.rpc("list_my_game_history", {
    p_limit: limit + 1,
    p_before_at: before?.completedAt ?? null,
    p_before_kind: before?.sourceKind ?? null,
    p_before_id: before?.sourceId ?? null,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as HistoryRow[];
  const items = rows.slice(0, limit).map(mapRow);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? historyCursor(last) : null,
  };
}
