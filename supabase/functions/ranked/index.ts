import { createClient } from "npm:@supabase/supabase-js@2";
import type { GameState } from "../../../src/game.ts";
import type { RankedStakesRow } from "../../../src/features/ranked/stakes.ts";
import { handleRanked, StoreError, type MatchRow, type RankedStore } from "./handler.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

/** A PostgREST error as a StoreError: the database's message and SQLSTATE. */
function failed(error: { message: string; code?: string } | null): never {
  throw new StoreError(error?.message ?? "Database request failed.", error?.code ?? null);
}

/** The service-role database, as the handler sees it. */
const store: RankedStore = {
  async authenticate(token) {
    const authClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await authClient.auth.getUser(token);
    return error || !data.user ? null : data.user.id;
  },
  async profile(userId) {
    const { data, error } = await db
      .from("profiles")
      .select("display_name,status")
      .eq("id", userId)
      .maybeSingle();
    if (error) failed(error);
    return data;
  },
  async names(ids) {
    if (!ids.length) return new Map();
    const { data, error } = await db.from("profiles").select("id,display_name").in("id", ids);
    if (error) failed(error);
    return new Map(
      (data ?? []).map((row) => [row.id as string, row.display_name as string | null]),
    );
  },
  async listOpen(since) {
    const { data, error } = await db
      .from("ranked_matches")
      .select("id,player_a_id,minutes_a,created_at")
      .eq("status", "waiting")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) failed(error);
    return data ?? [];
  },
  async listMine(userId) {
    const { data, error } = await db
      .from("ranked_matches")
      .select("id,player_a_id,player_b_id,status,created_at")
      .or(`player_a_id.eq.${userId},player_b_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) failed(error);
    return data ?? [];
  },
  async leaderboard() {
    const { data, error } = await db
      .from("ranked_ratings")
      .select("player_id,rating,games,wins,losses,draws")
      .gte("games", 10)
      .order("rating", { ascending: false })
      .order("wins", { ascending: false })
      .limit(100);
    if (error) failed(error);
    return data ?? [];
  },
  async ownRating(userId) {
    const { data, error } = await db
      .from("ranked_ratings")
      .select("rating,games,wins,losses,draws")
      .eq("player_id", userId)
      .maybeSingle();
    if (error) failed(error);
    return data;
  },
  async insertWaiting(row) {
    const { data, error } = await db
      .from("ranked_matches")
      .insert({ ...row, status: "waiting" })
      .select("id,revision")
      .single();
    if (error) failed(error);
    return data;
  },
  async stakes(matchId, viewerId) {
    const { data, error } = await db
      .rpc("ranked_stakes", { target_match_id: matchId, target_player_id: viewerId })
      .single();
    if (error) failed(error);
    return data as RankedStakesRow;
  },
  async claim(matchId, playerId, playerName, basis, now) {
    const { data, error } = await db
      .rpc("ranked_claim_match_v2", {
        target_match_id: matchId,
        target_player_id: playerId,
        target_player_name: playerName,
        target_stakes_basis: basis,
        target_now: now,
      })
      .single();
    if (error) failed(error);
    return data as { match_id: string; revision: number; resumed: boolean };
  },
  async match(id) {
    const { data, error } = await db.from("ranked_matches").select("*").eq("id", id).maybeSingle();
    if (error) failed(error);
    return data as MatchRow | null;
  },
  async deleteUnstarted(id) {
    const { data, error } = await db
      .from("ranked_matches")
      .delete()
      .eq("id", id)
      .in("status", ["waiting", "matched"])
      .select("id");
    if (error) failed(error);
    return data?.length ?? 0;
  },
  async ready(matchId, playerId, now) {
    const { data, error } = await db.rpc("ranked_ready_match", {
      target_match_id: matchId,
      target_player_id: playerId,
      target_now: now,
    });
    if (error) failed(error);
    return data === true;
  },
  async commit(matchId, revision, state: GameState, winner, reason) {
    const { data, error } = await db.rpc("ranked_commit_match", {
      target_match_id: matchId,
      target_revision: revision,
      target_state: state,
      target_winner: winner,
      target_reason: reason,
    });
    if (error) failed(error);
    return data === true;
  },
  async result(matchId) {
    const { data, error } = await db
      .from("ranked_results")
      .select("rating_a_before,rating_a_after,rating_b_before,rating_b_after")
      .eq("match_id", matchId)
      .maybeSingle();
    if (error) failed(error);
    return data;
  },
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  const body = request.method === "POST" ? await request.json().catch(() => null) : null;
  const response = await handleRanked(
    { authorization: request.headers.get("Authorization"), body },
    store,
  );
  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
