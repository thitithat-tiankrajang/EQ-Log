import { createClient } from "npm:@supabase/supabase-js@2";
import {
  applyRankedAction,
  createRankedGame,
  isRankedTime,
  resultOf,
  settleRankedClock,
  type RankedAction,
} from "../../../src/features/ranked/rules.ts";
import { rankedPublicView } from "../../../src/features/ranked/publicView.ts";
import type { GameState } from "../../../src/game.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

type MatchRow = {
  id: string;
  player_a_id: string;
  player_b_id: string | null;
  status: "waiting" | "matched" | "playing" | "finished";
  revision: number;
  minutes_a: number;
  minutes_b: number;
  state: GameState;
  created_at: string;
};

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function getMatch(id: string): Promise<MatchRow> {
  const { data, error } = await db.from("ranked_matches").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Ranked room not found.");
  return data as MatchRow;
}

async function commit(id: string, revision: number, game: GameState): Promise<boolean> {
  const result = resultOf(game);
  const { data, error } = await db.rpc("ranked_commit_match", {
    target_match_id: id,
    target_revision: revision,
    target_state: game,
    target_winner: result ? (result.winner ?? "draw") : null,
    target_reason: result?.reason ?? null,
  });
  if (error) throw error;
  return data === true;
}

async function viewFor(id: string, revision: number, game: GameState, userId: string) {
  const view = rankedPublicView(id, revision, game, userId);
  if (game.status !== "finished") return view;
  const { data, error } = await db
    .from("ranked_results")
    .select("rating_a_before,rating_a_after,rating_b_before,rating_b_after")
    .eq("match_id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data || !view.yourSide) return view;
  return {
    ...view,
    ratingChange:
      view.yourSide === "A"
        ? { before: data.rating_a_before, after: data.rating_a_after }
        : { before: data.rating_b_before, after: data.rating_b_after },
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const authorization = request.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return respond({ error: "Sign in required." }, 401);
    const authClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(
      authorization.slice(7),
    );
    if (authError || !authData.user) return respond({ error: "Sign in required." }, 401);
    const userId = authData.user.id;
    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("display_name,status")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) throw profileError;
    if (profile?.status !== "approved")
      return respond({ error: "Approved account required." }, 403);
    const name = profile.display_name?.trim() || "Player";
    const body =
      request.method === "POST" ? ((await request.json()) as Record<string, unknown>) : {};
    const operation = String(body.operation ?? "");

    if (operation === "list") {
      const { data: open, error: openError } = await db
        .from("ranked_matches")
        .select("id,player_a_id,minutes_a,created_at")
        .eq("status", "waiting")
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(50);
      if (openError) throw openError;
      const ids = (open ?? []).map((room) => room.player_a_id);
      const { data: profiles } = ids.length
        ? await db.from("profiles").select("id,display_name").in("id", ids)
        : { data: [] as { id: string; display_name: string | null }[] };
      const names = new Map((profiles ?? []).map((item) => [item.id, item.display_name]));
      const { data: mine, error: mineError } = await db
        .from("ranked_matches")
        .select("id,player_a_id,player_b_id,status,created_at")
        .or(`player_a_id.eq.${userId},player_b_id.eq.${userId}`)
        .order("created_at", { ascending: false })
        .limit(20);
      if (mineError) throw mineError;
      return respond({
        open: (open ?? []).map((room) => ({
          id: room.id,
          creatorId: room.player_a_id,
          creator: names.get(room.player_a_id) ?? "Player",
          minutesA: room.minutes_a,
          createdAt: room.created_at,
        })),
        mine,
      });
    }

    if (operation === "leaderboard") {
      const { data: ratings, error } = await db
        .from("ranked_ratings")
        .select("player_id,rating,games,wins,losses,draws")
        .gte("games", 10)
        .order("rating", { ascending: false })
        .order("wins", { ascending: false })
        .limit(100);
      if (error) throw error;
      const ids = (ratings ?? []).map((row) => row.player_id);
      const { data: profiles } = ids.length
        ? await db.from("profiles").select("id,display_name").in("id", ids)
        : { data: [] as { id: string; display_name: string | null }[] };
      const names = new Map((profiles ?? []).map((item) => [item.id, item.display_name]));
      const { data: own } = await db
        .from("ranked_ratings")
        .select("rating,games,wins,losses,draws")
        .eq("player_id", userId)
        .maybeSingle();
      return respond({
        rows: (ratings ?? []).map((row, index) => ({
          ...row,
          place: index + 1,
          name: names.get(row.player_id) ?? "Player",
        })),
        own: own ?? { rating: 1000, games: 0, wins: 0, losses: 0, draws: 0 },
      });
    }

    if (operation === "create") {
      const minutesA = Number(body.minutesA);
      const minutesB = Number(body.minutesB);
      if (!isRankedTime(minutesA) || minutesA !== minutesB)
        return respond({ error: "Choose the same 10, 15, 20 or 30 minutes for both sides." }, 400);
      const game = createRankedGame(
        userId,
        name,
        minutesA,
        minutesB,
        crypto.getRandomValues(new Uint8Array(1))[0] % 2 === 0 ? "A" : "B",
      );
      const { data, error } = await db
        .from("ranked_matches")
        .insert({
          player_a_id: userId,
          status: "waiting",
          minutes_a: minutesA,
          minutes_b: minutesB,
          state: game,
        })
        .select("id,revision")
        .single();
      if (error?.code === "23505")
        return respond({ error: "You already have a waiting ranked room." }, 409);
      if (error) throw error;
      return respond({ match: await viewFor(data.id, data.revision, game, userId) });
    }

    const id = String(body.id ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id))
      return respond({ error: "Invalid room id." }, 400);

    if (operation === "join") {
      const { data, error } = await db.rpc("ranked_claim_match", {
        target_match_id: id,
        target_player_id: userId,
        target_player_name: name,
        target_now: new Date().toISOString(),
      });
      if (error) throw error;
      if (!data) return respond({ error: "This room is no longer open." }, 409);
    }

    const match = await getMatch(id);
    if (match.player_a_id !== userId && match.player_b_id !== userId)
      return respond({ error: "Only players can open this match." }, 403);

    if (operation === "cancel") {
      if (
        (match.status !== "waiting" && match.status !== "matched") ||
        (match.status === "waiting" && match.player_a_id !== userId)
      )
        return respond({ error: "This match has already started." }, 403);
      const { data, error } = await db
        .from("ranked_matches")
        .delete()
        .eq("id", id)
        .in("status", ["waiting", "matched"])
        .select("id");
      if (error) throw error;
      if (!data?.length) return respond({ error: "This room has already started." }, 409);
      return respond({ cancelled: true });
    }

    if (operation === "ready") {
      const { data, error } = await db.rpc("ranked_ready_match", {
        target_match_id: id,
        target_player_id: userId,
        target_now: new Date().toISOString(),
      });
      if (error) throw error;
      if (!data) return respond({ error: "This match cannot be readied." }, 409);
      const updated = await getMatch(id);
      return respond({ match: await viewFor(id, updated.revision, updated.state, userId) });
    }

    if (operation === "read" || operation === "join") {
      const now = new Date().toISOString();
      const settled = settleRankedClock(match.state, now);
      if (settled.status === "finished" && match.status === "playing") {
        if (!(await commit(id, match.revision, settled)))
          return respond({ error: "Position changed; refresh the match." }, 409);
        return respond({ match: await viewFor(id, match.revision + 1, settled, userId) });
      }
      return respond({ match: await viewFor(id, match.revision, settled, userId) });
    }

    if (operation === "action") {
      if (match.revision !== body.revision)
        return respond({ error: "Position changed; refresh the match." }, 409);
      const side = match.player_a_id === userId ? "A" : "B";
      const action = body.action as RankedAction;
      if (!action || !["place", "exchange", "pass", "resign"].includes(action.kind))
        return respond({ error: "Unknown action." }, 400);
      const now = new Date().toISOString();
      const next = applyRankedAction(match.state, side, action, now);
      if (!(await commit(id, match.revision, next)))
        return respond({ error: "Position changed; refresh the match." }, 409);
      return respond({ match: await viewFor(id, match.revision + 1, next, userId) });
    }
    return respond({ error: "Unknown operation." }, 400);
  } catch (error) {
    return respond(
      { error: error instanceof Error ? error.message : "Ranked request failed." },
      400,
    );
  }
});
