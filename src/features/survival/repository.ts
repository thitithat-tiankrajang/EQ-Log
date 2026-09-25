import { supabase } from "../../supabaseClient";
import * as remoteRooms from "../../remoteRooms";
import { isEngineApiConfigured } from "../../bot/engineApi";
import { createSurvivalTestGame } from "./seededGame";

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
};

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
): Promise<string> {
  const game = createSurvivalTestGame(level.seed, playerName, userId ?? undefined);
  const scope = { visibility: "public" as const, regionId: null };
  if (!supabase || !isEngineApiConfigured)
    throw new Error("Survival ต้องใช้เซิร์ฟเวอร์เกมที่เชื่อมต่ออยู่");
  if (!userId) throw new Error("เข้าสู่ระบบก่อนเริ่มด่าน");
  const result = await remoteRooms.createRoom(
    game,
    userId,
    remoteRooms.emptyLiveSession(userId),
    scope,
    { accessScope: "private", archivePolicy: "none", joinPolicy: "invite_only", regionId: null },
  );
  const { error } = await supabase.from("survival_attempts").insert({
    level_id: level.id,
    room_id: result.id,
    player_id: userId,
  });
  if (error) throw error;
  return result.id;
}

export async function recordSurvivalPracticeResult(
  roomId: string,
  playerScore: number,
  authurScore: number,
): Promise<void> {
  if (!supabase) return;
  const result = playerScore > authurScore ? "win" : playerScore < authurScore ? "loss" : "tie";
  const { error } = await supabase
    .from("survival_attempts")
    .update({
      player_score: playerScore,
      authur_score: authurScore,
      result,
      finished_at: new Date().toISOString(),
    })
    .eq("room_id", roomId)
    .is("finished_at", null);
  if (error) throw error;
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

export async function listMySurvivalWins(): Promise<Set<string>> {
  if (!supabase) return new Set();
  const { data, error } = await supabase
    .from("survival_attempts")
    .select("level_id")
    .eq("result", "win");
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.level_id));
}
