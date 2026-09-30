import { createClient } from "npm:@supabase/supabase-js@2";
import { decodeGame, type EncodedGame } from "../../../src/codec.ts";
import { decodeMultiverse } from "../../../src/gameplay/multiverseCodec.ts";
import { deriveCompletion } from "../../../src/features/gameRecords/domain.ts";
import { projectStoredCompletedGame } from "../../../src/completedGame/projection.ts";
import {
  buildCompletedGameRecord,
  canonicalCompletedJSON,
  readCompletedGameRecord,
  type CompletedProvenance,
} from "../../../src/completedGame/record.ts";

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
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data: auth, error: authError } = await userClient.auth.getUser(bearer);
    if (authError || !auth.user) return respond({ error: "Sign in required." }, 401);
    const body = (await request.json()) as { gameId?: unknown; state?: unknown };
    if (
      typeof body.gameId !== "string" ||
      !uuid.test(body.gameId) ||
      !body.state ||
      typeof body.state !== "object"
    )
      return respond({ error: "Invalid game completion." }, 400);
    const roomId = body.gameId;
    const finished = decodeGame(body.state as EncodedGame);
    if (finished.status !== "finished") return respond({ error: "Invalid final game state." }, 400);
    const completion = deriveCompletion(finished);
    const room = await db
      .from("room_live")
      .select(
        "room_id,owner_id,player_a_user_id,player_b_user_id,room_purpose,revision,state,archive_policy,legacy_private_autosave,bot_key,bot_config_version,bot_difficulty",
      )
      .eq("room_id", roomId)
      .maybeSingle();
    if (room.error) throw room.error;
    if (!room.data) {
      const prior = await db
        .from("recent_game_payloads")
        .select("record_digest")
        .eq("source_id", roomId)
        .maybeSingle();
      if (prior.error) throw prior.error;
      const seat = await db
        .from("game_history")
        .select("participant_id,source_owner_id")
        .eq("source_kind", "normal")
        .eq("source_id", roomId)
        .or(`participant_id.eq.${auth.user.id},source_owner_id.eq.${auth.user.id}`)
        .limit(1);
      if (seat.error) throw seat.error;
      if (prior.data && seat.data?.length)
        return respond({ replayRetained: true, digest: prior.data.record_digest });
      const retained = await db.rpc("capture_normal_terminal", {
        p_room_id: roomId,
        p_actor_id: auth.user.id,
        p_expected_revision: finished.revision - 1,
        p_timeline_version: null,
        p_state: body.state,
        p_record: null,
        p_completion_kind: completion.kind,
        p_completion_reason: completion.reason,
        p_surrendered_side: completion.surrenderedSide,
      });
      if (!retained.error && retained.data?.[0]?.legacy_saved_state)
        return respond({
          replayRetained: false,
          legacySavedState: retained.data[0].legacy_saved_state,
        });
      return respond({ error: "Game no longer available." }, 404);
    }
    if (
      room.data.room_purpose === "stage" ||
      ![room.data.owner_id, room.data.player_a_user_id, room.data.player_b_user_id].includes(
        auth.user.id,
      )
    )
      return respond({ error: "Game completion unavailable." }, 403);
    const prior = decodeGame(room.data.state as EncodedGame);
    if (
      finished.gameId !== prior.gameId ||
      finished.revision !== room.data.revision + 1 ||
      finished.logs.length < prior.logs.length ||
      finished.history.length < prior.history.length ||
      canonicalCompletedJSON(finished.logs.slice(0, prior.logs.length)) !==
        canonicalCompletedJSON(prior.logs) ||
      canonicalCompletedJSON(finished.history.slice(0, prior.history.length)) !==
        canonicalCompletedJSON(prior.history)
    )
      return respond({ error: "Game changed. Reload and retry." }, 409);

    // Incomplete old history cannot become Compact. Freeze its actual v3
    // snapshot as legacy ownership in the same transaction as completion.
    if (
      !finished.history.length ||
      finished.history[0]?.logs.length !== 0 ||
      finished.historyIndex !== finished.history.length - 1
    ) {
      if (room.data.legacy_private_autosave && room.data.archive_policy === "private") {
        const parked = await db
          .from("game_timelines")
          .select("version,doc")
          .eq("game_id", roomId)
          .maybeSingle();
        if (parked.error) throw parked.error;
        await projectStoredCompletedGame(
          parked.data
            ? { ...(body.state as Record<string, unknown>), timeline: parked.data.doc }
            : body.state,
          {
            scope: "private",
            ownerId: room.data.owner_id,
            participantIds: [],
            published: false,
          },
          { userId: room.data.owner_id, regionIds: [], approved: false, admin: false },
        );
        const retained = await db.rpc("capture_normal_terminal", {
          p_room_id: roomId,
          p_actor_id: auth.user.id,
          p_expected_revision: room.data.revision,
          p_timeline_version: parked.data?.version ?? null,
          p_state: body.state,
          p_record: null,
          p_completion_kind: completion.kind,
          p_completion_reason: completion.reason,
          p_surrendered_side: completion.surrenderedSide,
        });
        if (retained.error) return respond({ error: retained.error.message }, 409);
        return respond({
          replayRetained: false,
          legacySavedState: retained.data?.[0]?.legacy_saved_state ?? null,
          reason: "incomplete_legacy_history",
        });
      }
      const fallback = await userClient.rpc("finalize_live_game", {
        target_game_id: roomId,
        target_state: body.state,
        target_completion_kind: completion.kind,
        target_completion_reason: completion.reason,
        target_surrendered_side: completion.surrenderedSide,
      });
      if (fallback.error) return respond({ error: fallback.error.message }, 409);
      return respond({ replayRetained: false, reason: "incomplete_legacy_history" });
    }
    const timeline = await db
      .from("game_timelines")
      .select("version,doc")
      .eq("game_id", roomId)
      .maybeSingle();
    if (timeline.error) throw timeline.error;
    const mode: CompletedProvenance["mode"] =
      finished.gameMode === "solo"
        ? "solo"
        : finished.botSide
          ? "bot"
          : finished.emailPlayMode === "hosted"
            ? "hosted"
            : "standard";
    const record = await buildCompletedGameRecord(
      finished,
      timeline.data ? decodeMultiverse(timeline.data.doc) : undefined,
      {
        mode,
        completionAuthority: "client-reported",
        ...(room.data.bot_key
          ? {
              bot: {
                catalogId: room.data.bot_key,
                catalogVersion: String(room.data.bot_config_version ?? "legacy"),
                difficulty: room.data.bot_difficulty ?? undefined,
              },
            }
          : {}),
      },
    );
    await readCompletedGameRecord(record);
    const captured = await db.rpc("capture_normal_terminal", {
      p_room_id: roomId,
      p_actor_id: auth.user.id,
      p_expected_revision: room.data.revision,
      p_timeline_version: timeline.data?.version ?? null,
      p_state: body.state,
      p_record: record,
      p_completion_kind: completion.kind,
      p_completion_reason: completion.reason,
      p_surrendered_side: completion.surrenderedSide,
    });
    if (captured.error)
      return respond(
        {
          error: captured.error.message,
          code: captured.error.code,
          details: captured.error.details,
          hint: captured.error.hint,
        },
        captured.error.code === "40001" ? 409 : 422,
      );
    const result = captured.data?.[0];
    return respond({
      replayRetained: result?.recent_retained ?? false,
      digest: result?.record_digest ?? null,
      legacySavedState: result?.legacy_saved_state ?? null,
    });
  } catch (error) {
    console.error("normal-terminal failed", error);
    return respond({ error: "Unable to finish this game." }, 500);
  }
});
