import { createClient } from "npm:@supabase/supabase-js@2";
import type { EncodedGame } from "../../../src/codec.ts";
import { decodeMultiverse } from "../../../src/gameplay/multiverseCodec.ts";
import { prepareStageTerminal } from "../../../src/completedGame/stageTerminal.ts";
import type { StageSealedStart } from "../../../src/completedGame/adapters.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);
  try {
    const bearer = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!bearer) return respond({ error: "Sign in required." }, 401);
    const authClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: auth, error: authError } = await authClient.auth.getUser(bearer);
    if (authError || !auth.user) return respond({ error: "Sign in required." }, 401);
    const body = (await request.json()) as { gameId?: unknown; state?: unknown };
    if (
      typeof body.gameId !== "string" ||
      !uuid.test(body.gameId) ||
      !body.state ||
      typeof body.state !== "object"
    )
      return respond({ error: "Invalid Stage completion." }, 400);
    const roomId = body.gameId;

    // A lost HTTP response after commit is an ordinary retry. A completed
    // attempt is immutable; only its owner receives this minimal receipt.
    const saved = await db
      .from("stage_completed_attempts")
      .select("attempt_id,player_id,outcome,record_digest")
      .eq("room_id", roomId)
      .maybeSingle();
    if (saved.error) throw saved.error;
    if (saved.data) {
      if (saved.data.player_id !== auth.user.id)
        return respond({ error: "Stage attempt unavailable." }, 404);
      return respond({
        attemptId: saved.data.attempt_id,
        outcome: saved.data.outcome,
        digest: saved.data.record_digest,
      });
    }
    const room = await db
      .from("room_live")
      .select(
        "room_id,owner_id,room_purpose,archive_policy,revision,state,bot_key,bot_side,bot_config_version,bot_difficulty",
      )
      .eq("room_id", roomId)
      .maybeSingle();
    if (room.error) throw room.error;
    if (
      !room.data ||
      room.data.owner_id !== auth.user.id ||
      room.data.room_purpose !== "stage" ||
      room.data.archive_policy !== "none"
    )
      return respond({ error: "Stage attempt unavailable." }, 404);
    const attempt = await db
      .from("survival_attempts")
      .select("id,player_id,level_id,finished_at")
      .eq("room_id", roomId)
      .maybeSingle();
    if (attempt.error) throw attempt.error;
    if (
      !attempt.data ||
      attempt.data.player_id !== auth.user.id ||
      attempt.data.finished_at !== null
    )
      return respond({ error: "Stage attempt unavailable." }, 404);
    const level = await db
      .from("survival_levels")
      .select("id,seed,start_canonical")
      .eq("id", attempt.data.level_id)
      .single();
    if (level.error) throw level.error;
    const timeline = await db
      .from("game_timelines")
      .select("version,doc")
      .eq("game_id", roomId)
      .maybeSingle();
    if (timeline.error) throw timeline.error;
    const prepared = await prepareStageTerminal(
      {
        roomId,
        ownerId: auth.user.id,
        levelId: attempt.data.level_id,
        seed: level.data.seed,
        revision: room.data.revision,
        liveState: room.data.state as EncodedGame,
        sealedStart: level.data.start_canonical as StageSealedStart,
        botKey: room.data.bot_key,
        botConfigVersion: room.data.bot_config_version,
        botDifficulty: room.data.bot_difficulty,
        ...(timeline.data ? { branches: decodeMultiverse(timeline.data.doc) } : {}),
      },
      body.state as EncodedGame,
    );
    const captured = await db.rpc("capture_stage_terminal", {
      target_game_id: roomId,
      target_player_id: auth.user.id,
      target_expected_revision: room.data.revision,
      target_timeline_version: timeline.data?.version ?? null,
      target_state: prepared.state,
      target_record: prepared.record,
      target_completion_kind: prepared.completion.kind,
      target_completion_reason: prepared.completion.reason,
      target_surrendered_side: prepared.completion.surrenderedSide,
    });
    if (captured.error) {
      if (captured.error.code === "40001")
        return respond({ error: "Stage position changed. Reload and retry." }, 409);
      throw captured.error;
    }
    const result = Array.isArray(captured.data) ? captured.data[0] : captured.data;
    return respond({
      attemptId: result.attempt_id,
      outcome: result.outcome,
      digest: result.record_digest,
    });
  } catch (error) {
    console.error("stage-terminal failed", error);
    return respond({ error: "Unable to complete Stage attempt." }, 500);
  }
});
