import { createClient } from "npm:@supabase/supabase-js@2";
import { readCompletedGame } from "../../../src/completedGame/record.ts";
import { projectStoredCompletedGame } from "../../../src/completedGame/projection.ts";

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
    const body = (await request.json()) as { sourceKind?: unknown; sourceId?: unknown };
    if ((body.sourceKind !== "normal" && body.sourceKind !== "stage") ||
      typeof body.sourceId !== "string" || !uuid.test(body.sourceId))
      return respond({ error: "Invalid completed game." }, 400);

    // Ordinary Compact Save remains an authenticated database RPC. Only the
    // legacy fallback reaches the service validator and service-only writer.
    const direct = await userClient.rpc("save_completed_game", {
      p_source_kind: body.sourceKind,
      p_source_id: body.sourceId,
    });
    if (!direct.error) return respond(direct.data?.[0]);
    if (direct.error.message !== "legacy_validation_required")
      return respond({ error: direct.error.message },
        direct.error.code === "42501" ? 403 : 409);

    const candidate = await db.rpc("read_legacy_save_candidate", {
      p_source_id: body.sourceId,
      p_user_id: auth.user.id,
    });
    if (candidate.error) throw candidate.error;
    const source = candidate.data?.[0];
    if (!source) return respond({ error: "Complete replay unavailable for Saved." }, 404);
    try {
      const decoded = await readCompletedGame(JSON.stringify(source.snapshot));
      if (decoded.kind !== "legacy" && decoded.kind !== "compact")
        throw new Error("Unsupported replay format.");
      if (decoded.game.status !== "finished" ||
        (decoded.game.logs.length > 0 && decoded.game.history.length === 0))
        throw new Error("Incomplete legacy replay.");
      const ownSide = source.participant_side as "A" | "B";
      const otherSide = ownSide === "A" ? "B" : "A";
      if (source.score_for !== null && decoded.game.scores[ownSide] !== source.score_for ||
        source.score_against !== null && decoded.game.scores[otherSide] !== source.score_against)
        throw new Error("Legacy replay disagrees with the completed result.");
      await projectStoredCompletedGame(source.snapshot, {
        scope: "private", ownerId: auth.user.id, participantIds: [], published: false,
      }, {
        userId: auth.user.id, regionIds: [], approved: false, admin: false,
      });
    } catch {
      return respond({ error: "Legacy replay is incomplete or unreadable; it was not Saved." }, 422);
    }
    const saved = await db.rpc("save_validated_legacy_game", {
      p_source_id: body.sourceId,
      p_user_id: auth.user.id,
      p_source_digest: source.source_digest,
    });
    if (saved.error)
      return respond({ error: saved.error.message }, saved.error.code === "40001" ? 409 : 422);
    return respond(saved.data?.[0]);
  } catch (error) {
    console.error("save-completed-game failed", error);
    return respond({ error: "Unable to Save this replay." }, 500);
  }
});
