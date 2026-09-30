import { supabase } from "../../supabaseClient";
import * as remoteRooms from "../../remoteRooms";
import { isEngineApiConfigured } from "../../bot/engineApi";
import { canonicalFromSnapshot, encodeCanonical } from "../../domain/projection";
import { createSurvivalTestGame } from "./seededGame";
import { getActiveLocale } from "../../i18n/locale";
import { translate } from "../../i18n/translate";

export type SurvivalLevel = {
  id: string;
  season_key: string;
  level_no: number;
  seed: number;
  reference_key: string;
  sample_policy: string;
  sample_count: number;
  win_count: number;
  immediate_winning_moves: number;
  shortest_winning_replay_turns: number;
  bot_latency_ms: { p50?: number; p95?: number; count?: number };
  winning_replays: Array<{
    policy: string;
    trial: number;
    scores: { A: number; B: number };
    actions: Array<{
      side: "A" | "B";
      id: string;
      type: "place" | "pass" | "exchange";
      score: number;
      move: {
        type: "place" | "pass" | "exchange";
        placements?: Array<{ cell: number; kind: string; face: string }>;
        kinds?: string[];
      };
    }>;
  }>;
  status: "draft" | "approved";
  admin_note: string;
  /** When an admin sealed the level's starting position; null = not playable. */
  start_sealed_at?: string | null;
};

/**
 * The starting position a Stage attempt at this seed must begin from, in the
 * canonical wire form the server compares against. Built by the same code
 * that builds the attempt (`createSurvivalTestGame`), so a sealed start and a
 * real attempt's first commit are the same bytes. Player name and account do
 * not affect it.
 */
export function stageStartCanonical(seed: number) {
  const canonical = encodeCanonical(
    canonicalFromSnapshot(createSurvivalTestGame(seed, "Player"), 1),
  ) as {
    inventory: unknown[];
    scores: { A: number; B: number };
    activeSide: string;
    turnNumber: number;
    startingSide: string;
  };
  return {
    inventory: canonical.inventory,
    scores: canonical.scores,
    activeSide: canonical.activeSide,
    turnNumber: canonical.turnNumber,
    startingSide: canonical.startingSide,
  };
}

/** Admin: seal a level's starting position so attempts can be created. */
export async function sealStageStart(level: Pick<SurvivalLevel, "id" | "seed">): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc("admin_seal_stage_start", {
    target_level: level.id,
    target_start: stageStartCanonical(level.seed),
  });
  if (error) throw error;
}

export async function listSurvivalLevels(): Promise<SurvivalLevel[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("survival_levels").select("*").order("level_no");
  if (error) {
    if (/survival_levels|PGRST205|does not exist/i.test(error.message)) {
      throw new Error(
        "Survival ยังไม่เปิดในฐานข้อมูล: รัน migration 20260924180000_survival_levels.sql",
      );
    }
    throw error;
  }
  return (data ?? []) as SurvivalLevel[];
}

export async function startSurvivalPractice(
  level: Pick<SurvivalLevel, "id" | "seed">,
  playerName: string,
  userId: string | null,
  requestId: string = crypto.randomUUID(),
): Promise<string> {
  const game = createSurvivalTestGame(level.seed, playerName, userId ?? undefined);
  if (!supabase || !isEngineApiConfigured)
    throw new Error(translate(getActiveLocale(), "stage.needsServer"));
  if (!userId) throw new Error(translate(getActiveLocale(), "stage.signIn"));
  // The server creates the room AND its attempt, marks it a Stage room (never
  // charged), and checks the first position against the level's sealed start.
  const { id } = await remoteRooms.createStageAttempt(game, userId, level.id, requestId);
  return id;
}

export async function listSurvivalAttemptStats(): Promise<
  Record<string, { attempts: number; wins: number }>
> {
  if (!supabase) return {};
  const { data, error } = await supabase
    .from("survival_attempts")
    .select("level_id, result")
    .not("finished_at", "is", null);
  if (error) throw error;
  const stats: Record<string, { attempts: number; wins: number }> = {};
  for (const attempt of data ?? []) {
    const current = stats[attempt.level_id] ?? { attempts: 0, wins: 0 };
    current.attempts += 1;
    if (attempt.result === "win") current.wins += 1;
    stats[attempt.level_id] = current;
  }
  return stats;
}

/**
 * The levels this player has a recorded win on. Results are client-reported
 * (advisory) until the Stage product records them on the server. Filtered to
 * the player: an administrator can read everyone's attempts.
 */
export async function listMySurvivalWins(userId: string | null): Promise<Set<string>> {
  if (!supabase || !userId) return new Set();
  const { data, error } = await supabase
    .from("survival_attempts")
    .select("level_id")
    .eq("player_id", userId)
    .eq("result", "win");
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.level_id));
}
