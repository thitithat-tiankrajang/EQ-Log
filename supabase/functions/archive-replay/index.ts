import { encodeGame } from "../../../src/codec.ts";
import type { GameState } from "../../../src/game.ts";
import { buildRankedCompletedGameRecord } from "../../../src/completedGame/adapters.ts";
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
  const { data, error } = await db.rpc("read_completed_replay_sources", {
    p_game_id: gameId,
    p_user_id: userId,
  });
  if (error) throw error;
  const rows = (data ?? []) as Array<
    ArchiveCandidate & { rankedState?: GameState; rankedRevisions?: GameState[] }
  >;
  for (const row of rows) {
    if (row.scope !== "ranked" || !row.rankedState) continue;
    // Older Ranked games without a captured zero-log start retain their known
    // legacy log facts. Never invent a missing historical rack or draw.
    row.snapshot =
      row.rankedRevisions?.[0]?.logs.length === 0
        ? await buildRankedCompletedGameRecord(row.rankedRevisions)
        : encodeGame(row.rankedState);
  }
  return rows;
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
      { live: false },
    );
    if (!result) return respond({ error: "Replay unavailable." }, 404);
    return respond(result);
  } catch (error) {
    console.error("archive-replay failed", error);
    return respond({ error: "Unable to open replay." }, 500);
  }
});
