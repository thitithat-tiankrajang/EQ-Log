// Bot-play statistics grouped into admin-controlled "folders" (portfolios).
//
// An admin creates folders and keeps exactly one open. While a folder is open,
// the SERVER appends a row for every finished bot game (finalize_live_game),
// taking the bot's identity from the room's frozen columns — the client no
// longer reports anything. Scores and outcome come from the finished game and
// are advisory. Only admins can read the data, through admin RPCs; nothing
// here, and nothing on the server, feeds statistics into the economy.

import { supabase } from "./supabaseClient";
import type { BotDifficulty, Side } from "./game";

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
  botEngine: string;
  botKey: string | null;
  botDifficulty: BotDifficulty | null;
  botScore: number;
  oppScore: number;
  outcome: BotOutcome;
  turns: number;
  finishedAt: string | null;
  createdAt: string;
  /** true = recorded by the server from the room; false = legacy client report. */
  recordedByServer: boolean;
};

// ---- row mapping -----------------------------------------------------------

type FolderRow = {
  id: string;
  name: string;
  created_by?: string | null;
  is_open: boolean;
  created_at: string;
  opened_at: string | null;
  closed_at: string | null;
};

function mapFolder(row: FolderRow): BotFolder {
  return {
    id: row.id,
    name: row.name,
    createdBy: row.created_by ?? null,
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
  player_member_id?: string | null;
  bot_side: Side;
  bot_engine?: string;
  bot_key?: string | null;
  recorded_by_server?: boolean;
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
    playerMemberId: row.player_member_id ?? null,
    botSide: row.bot_side,
    botEngine: row.bot_engine ?? "aether",
    botKey: row.bot_key ?? null,
    recordedByServer: row.recorded_by_server === true,
    botDifficulty: row.bot_difficulty,
    botScore: row.bot_score,
    oppScore: row.opp_score,
    outcome: row.outcome,
    turns: row.turns,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

// ---- data access (admin RPCs only) -----------------------------------------

/** True when the admin bot-stats RPCs answer for this account. */
export async function botStatsAvailable(): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.rpc("admin_list_bot_stat_folders");
  return !error;
}

export async function listBotFolders(): Promise<BotFolder[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_list_bot_stat_folders");
  if (error) throw error;
  return ((data ?? []) as FolderRow[]).map(mapFolder);
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
  const { error } = await supabase.rpc("admin_delete_bot_stat_folder", { target_folder: id });
  if (error) throw error;
}

export async function loadFolderGames(folderId: string): Promise<BotGameRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_list_bot_stat_games", {
    target_folder: folderId,
  });
  if (error) throw error;
  return ((data ?? []) as GameRow[]).map(mapGame);
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
