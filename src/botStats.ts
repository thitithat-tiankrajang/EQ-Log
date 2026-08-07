// Bot-play statistics grouped into admin-controlled "folders" (portfolios).
//
// An admin creates folders and keeps exactly one open. While a folder is open,
// every finished Play-vs-BOT game appends a summary row via record_bot_game.
// Everything here is a thin wrapper over the Supabase RPCs/tables defined in
// supabase/bot_stats_migration.sql, plus pure aggregation used by the UI.

import { supabase } from "./supabaseClient";
import type { BotDifficulty, GameState, Side } from "./game";
import { otherSide } from "./game";

export type BotFolder = {
  id: string;
  name: string;
  createdBy: string | null;
  isOpen: boolean;
  createdAt: string;
  openedAt: string | null;
  closedAt: string | null;
};

export type BotOutcome = "bot_win" | "bot_loss" | "draw";

export type BotGameRow = {
  id: string;
  folderId: string;
  gameId: string;
  roomId: string | null;
  playerName: string;
  playerMemberId: string | null;
  botSide: Side;
  botDifficulty: BotDifficulty | null;
  botScore: number;
  oppScore: number;
  outcome: BotOutcome;
  turns: number;
  finishedAt: string | null;
  createdAt: string;
};

/** Payload the game screen hands to record_bot_game when a bot match finishes. */
export type BotGameRecord = {
  gameId: string;
  roomId: string | null;
  playerName: string;
  playerMemberId: string | null;
  botSide: Side;
  botDifficulty: BotDifficulty | null;
  botScore: number;
  oppScore: number;
  outcome: BotOutcome;
  turns: number;
  finishedAt: string;
};

// ---- row mapping -----------------------------------------------------------

type FolderRow = {
  id: string;
  name: string;
  created_by: string | null;
  is_open: boolean;
  created_at: string;
  opened_at: string | null;
  closed_at: string | null;
};

function mapFolder(row: FolderRow): BotFolder {
  return {
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    isOpen: row.is_open,
    createdAt: row.created_at,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  };
}

type GameRow = {
  id: string;
  folder_id: string;
  game_id: string;
  room_id: string | null;
  player_name: string;
  player_member_id: string | null;
  bot_side: Side;
  bot_difficulty: BotDifficulty | null;
  bot_score: number;
  opp_score: number;
  outcome: BotOutcome;
  turns: number;
  finished_at: string | null;
  created_at: string;
};

function mapGame(row: GameRow): BotGameRow {
  return {
    id: row.id,
    folderId: row.folder_id,
    gameId: row.game_id,
    roomId: row.room_id,
    playerName: row.player_name,
    playerMemberId: row.player_member_id,
    botSide: row.bot_side,
    botDifficulty: row.bot_difficulty,
    botScore: row.bot_score,
    oppScore: row.opp_score,
    outcome: row.outcome,
    turns: row.turns,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

// ---- data access -----------------------------------------------------------

/** True when the bot-stats migration is live; false lets the UI show a hint. */
export async function botStatsAvailable(): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("bot_stat_folders").select("id").limit(1);
  return !error;
}

export async function listBotFolders(): Promise<BotFolder[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("bot_stat_folders")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as FolderRow[]).map(mapFolder);
}

export async function createBotFolder(name: string, open = true): Promise<BotFolder> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("create_bot_folder", {
    p_name: name,
    p_open: open,
  });
  if (error) throw error;
  return mapFolder(data as FolderRow);
}

export async function openBotFolder(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc("open_bot_folder", { p_id: id });
  if (error) throw error;
}

export async function closeBotFolder(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc("close_bot_folder", { p_id: id });
  if (error) throw error;
}

export async function deleteBotFolder(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("bot_stat_folders").delete().eq("id", id);
  if (error) throw error;
}

export async function loadFolderGames(folderId: string): Promise<BotGameRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("bot_stat_games")
    .select("*")
    .eq("folder_id", folderId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as GameRow[]).map(mapGame);
}

/**
 * Append a finished bot game to whichever folder is currently open. The server
 * resolves the open folder and no-ops when none is open, so this is always safe
 * to fire-and-forget. Returns the folder id it recorded into, or null.
 */
export async function recordBotGame(record: BotGameRecord): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("record_bot_game", {
    p_game_id: record.gameId,
    p_room_id: record.roomId,
    p_player_name: record.playerName,
    p_player_member_id: record.playerMemberId,
    p_bot_side: record.botSide,
    p_bot_difficulty: record.botDifficulty,
    p_bot_score: record.botScore,
    p_opp_score: record.oppScore,
    p_outcome: record.outcome,
    p_turns: record.turns,
    p_finished_at: record.finishedAt,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/**
 * Build a record payload from a finished bot game, or null when the game is not
 * a finished bot match. "bot" is the engine side; the opponent is the human.
 */
export function botRecordFromGame(game: GameState, roomId: string | null): BotGameRecord | null {
  if (!game.botSide || game.status !== "finished") return null;
  const bot = game.botSide;
  const human: Side = otherSide(bot);
  const botScore = game.scores[bot] ?? 0;
  const oppScore = game.scores[human] ?? 0;
  const outcome: BotOutcome =
    botScore === oppScore ? "draw" : botScore > oppScore ? "bot_win" : "bot_loss";
  return {
    gameId: game.gameId,
    roomId,
    playerName: game.players[human] || "Player",
    playerMemberId: game.playerMembers?.[human] ?? null,
    botSide: bot,
    botDifficulty: game.botDifficulty ?? null,
    botScore,
    oppScore,
    outcome,
    turns: game.turnNumber,
    finishedAt: game.lastSavedAt || new Date().toISOString(),
  };
}

// ---- aggregation (pure) ----------------------------------------------------

export type DensityBin = {
  /** Inclusive lower bound of the bin. */
  from: number;
  /** Exclusive upper bound (inclusive for the final bin). */
  to: number;
  count: number;
};

export type BotFolderStats = {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  avgBotScore: number;
  avgOppScore: number;
  avgMargin: number;
  bestScore: number | null;
  worstScore: number | null;
  medianScore: number | null;
  /** Population standard deviation of the bot's score. */
  scoreStdDev: number;
  /** Histogram of the bot's per-game score, for the density chart. */
  density: DensityBin[];
  /** Scores that sit far from the mean (|z| >= 2), flagged as outliers. */
  outliers: BotGameRow[];
};

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Bucket bot scores into evenly spaced bins. Bin width adapts to the observed
 * range so a folder of tight games and one of wild swings both read clearly.
 */
function buildDensity(scores: number[]): DensityBin[] {
  if (scores.length === 0) return [];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (min === max) {
    return [{ from: min, to: min, count: scores.length }];
  }
  const span = max - min;
  const targetBins = Math.min(12, Math.max(5, Math.ceil(Math.sqrt(scores.length))));
  const rawWidth = span / targetBins;
  // Round the bin width to a friendly step (…, 5, 10, 20, 25, 50, …).
  const niceSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
  const width = niceSteps.find((s) => s >= rawWidth) ?? niceSteps[niceSteps.length - 1];
  const start = Math.floor(min / width) * width;
  const bins: DensityBin[] = [];
  for (let from = start; from <= max; from += width) {
    bins.push({ from, to: from + width, count: 0 });
  }
  for (const score of scores) {
    let idx = Math.floor((score - start) / width);
    if (idx >= bins.length) idx = bins.length - 1;
    if (idx < 0) idx = 0;
    bins[idx].count += 1;
  }
  return bins;
}

export function computeFolderStats(games: BotGameRow[]): BotFolderStats {
  const empty: BotFolderStats = {
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    winRate: 0,
    avgBotScore: 0,
    avgOppScore: 0,
    avgMargin: 0,
    bestScore: null,
    worstScore: null,
    medianScore: null,
    scoreStdDev: 0,
    density: [],
    outliers: [],
  };
  if (games.length === 0) return empty;

  let wins = 0;
  let losses = 0;
  let draws = 0;
  let sumBot = 0;
  let sumOpp = 0;
  const scores: number[] = [];
  for (const g of games) {
    if (g.outcome === "bot_win") wins += 1;
    else if (g.outcome === "bot_loss") losses += 1;
    else draws += 1;
    sumBot += g.botScore;
    sumOpp += g.oppScore;
    scores.push(g.botScore);
  }
  const n = games.length;
  const avgBotScore = sumBot / n;
  const variance = scores.reduce((acc, s) => acc + (s - avgBotScore) ** 2, 0) / n;
  const scoreStdDev = Math.sqrt(variance);
  const sorted = [...scores].sort((a, b) => a - b);

  // Flag games whose score is ≥2σ from the mean (needs a real spread first).
  const outliers =
    scoreStdDev > 0
      ? games
          .filter((g) => Math.abs(g.botScore - avgBotScore) >= 2 * scoreStdDev)
          .sort((a, b) => Math.abs(b.botScore - avgBotScore) - Math.abs(a.botScore - avgBotScore))
      : [];

  return {
    games: n,
    wins,
    losses,
    draws,
    winRate: n > 0 ? wins / n : 0,
    avgBotScore,
    avgOppScore: sumOpp / n,
    avgMargin: (sumBot - sumOpp) / n,
    bestScore: sorted[sorted.length - 1],
    worstScore: sorted[0],
    medianScore: median(sorted),
    scoreStdDev,
    density: buildDensity(scores),
    outliers,
  };
}
