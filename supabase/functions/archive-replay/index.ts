import { createClient } from "npm:@supabase/supabase-js@2";
import {
  projectFirstAuthorizedArchive,
  type ArchiveCandidate,
} from "../../../src/completedGame/archiveRead.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function candidates(gameId: string, userId: string): Promise<ArchiveCandidate[]> {
  const found: ArchiveCandidate[] = [];
  const publicRow = await db
    .from("public_game_snapshots")
    .select("game_id,source_owner_id,name,finished_at,snapshot")
    .eq("game_id", gameId)
    .maybeSingle();
  if (publicRow.error) throw publicRow.error;
  if (publicRow.data)
    found.push({
      scope: "public",
      gameId: publicRow.data.game_id,
      ownerId: publicRow.data.source_owner_id ?? "",
      name: publicRow.data.name,
      finishedAt: publicRow.data.finished_at,
      snapshot: publicRow.data.snapshot,
    });

  const regionRow = await db
    .from("region_game_snapshots")
    .select("game_id,region_id,source_owner_id,name,finished_at,snapshot")
    .eq("game_id", gameId)
    .maybeSingle();
  if (regionRow.error) throw regionRow.error;
  if (regionRow.data)
    found.push({
      scope: "region",
      gameId: regionRow.data.game_id,
      regionId: regionRow.data.region_id,
      ownerId: regionRow.data.source_owner_id ?? "",
      name: regionRow.data.name,
      finishedAt: regionRow.data.finished_at,
      snapshot: regionRow.data.snapshot,
    });

  const privateRow = await db
    .from("private_library_items")
    .select("game_id,owner_id,name,updated_at,snapshot")
    .eq("owner_id", userId)
    .eq("game_id", gameId)
    .eq("item_type", "game")
    .is("trashed_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (privateRow.error) throw privateRow.error;
  if (privateRow.data)
    found.push({
      scope: "private",
      gameId: privateRow.data.game_id,
      ownerId: privateRow.data.owner_id,
      name: privateRow.data.name,
      finishedAt: privateRow.data.updated_at,
      snapshot: privateRow.data.snapshot,
    });

  // The service-only RPC checks the signed-in participant's relation and
  // reads its payload in one database snapshot, including during eviction.
  const recent = await db.rpc("read_recent_game_payload", {
    p_game_id: gameId,
    p_user_id: userId,
  });
  if (recent.error) throw recent.error;
  const retained = recent.data?.[0];
  if (retained)
    found.push({
      scope: "recent",
      gameId: retained.game_id,
      ownerId: userId,
      name: "Recent game",
      finishedAt: retained.completed_at,
      snapshot: retained.record,
    });

  const saved = await db.rpc("read_saved_game_payload", {
    p_game_id: gameId,
    p_user_id: userId,
  });
  if (saved.error) throw saved.error;
  const savedRow = saved.data?.[0];
  if (savedRow)
    // The owner's frozen Saved source wins over a mutable/prunable legacy
    // archive with the same game ID.
    found.unshift({
      scope: savedRow.source_kind === "stage" ? "stage" : "saved",
      gameId: savedRow.game_id,
      ownerId: userId,
      name: "Saved game",
      finishedAt: savedRow.completed_at,
      snapshot: savedRow.record,
    });

  const stageRow = await db
    .from("stage_completed_attempts")
    .select("room_id,player_id,completed_at,record")
    .eq("room_id", gameId)
    .eq("player_id", userId)
    .maybeSingle();
  if (stageRow.error) throw stageRow.error;
  if (stageRow.data)
    found.push({
      scope: "stage",
      gameId: stageRow.data.room_id,
      ownerId: stageRow.data.player_id,
      name: "Stage attempt",
      finishedAt: stageRow.data.completed_at,
      snapshot: stageRow.data.record,
    });
  return found;
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
    const body = (await request.json()) as { gameId?: unknown };
    if (typeof body.gameId !== "string" || !uuid.test(body.gameId))
      return respond({ error: "Invalid game ID." }, 400);
    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("status,is_admin,region_id")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    const viewer = {
      userId: auth.user.id,
      approved: profile?.status === "approved",
      admin: profile?.is_admin === true,
      regionIds: profile?.region_id ? [profile.region_id] : [],
    };
    const result = await projectFirstAuthorizedArchive(
      await candidates(body.gameId, auth.user.id),
      viewer,
    );
    if (!result) return respond({ error: "Replay unavailable." }, 404);
    return respond(result);
  } catch (error) {
    console.error("archive-replay failed", error);
    return respond({ error: "Unable to open replay." }, 500);
  }
});
