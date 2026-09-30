// @vitest-environment node
/** Opt-in real local Supabase test. Use an isolated stack only. */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

const workdir = process.env.HISTORY_TEST_SUPABASE_WORKDIR;
const local = workdir ? it : it.skip;

local(
  "creates one History entry per seated user under concurrent terminal callbacks",
  async () => {
    const output = execFileSync("supabase", ["status", "--workdir", workdir!, "-o", "env"], {
      encoding: "utf8",
    });
    const env: Record<string, string> = {};
    for (const line of output.split("\n")) {
      const match = line.match(/^([A-Z_]+)="?([^"\n]+)"?$/);
      if (match) env[match[1]!] = match[2]!;
    }
    const url = env.API_URL!;
    if (!url.startsWith("http://127.0.0.1:") || !env.DB_URL?.includes("127.0.0.1"))
      throw new Error("History integration test requires an isolated loopback Supabase stack.");
    execFileSync("psql", [
      env.DB_URL,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "insert into private.runtime_secrets (key, value) values ('room_code_secret', repeat('s', 40)) on conflict (key) do nothing",
    ]);
    const service = createClient(url, env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const password = "LocalTest-History-2026!";
    async function makeUser(tag: string) {
      const email = `history-${tag}-${crypto.randomUUID()}@example.test`;
      const made = await service.auth.admin.createUser({ email, password, email_confirm: true });
      if (made.error || !made.data.user) throw made.error ?? new Error("Missing test user.");
      const approved = await service
        .from("profiles")
        .update({ status: "approved" })
        .eq("id", made.data.user.id);
      if (approved.error) throw approved.error;
      const client = createClient(url, env.ANON_KEY!, { auth: { persistSession: false } });
      const session = await client.auth.signInWithPassword({ email, password });
      if (session.error) throw session.error;
      return { id: made.data.user.id, client };
    }
    const owner = await makeUser("owner");
    const opponent = await makeUser("opponent");
    const spectator = await makeUser("spectator");
    const initial = {
      gameId: crypto.randomUUID(),
      name: "History concurrent terminal",
      gameMode: "versus",
      roomStage: "playing",
      status: "playing",
      phase: "refill",
      players: { A: "Owner", B: "Opponent" },
      playerUserIds: { A: owner.id, B: opponent.id },
      scores: { A: 0, B: 0 },
      startingSide: "A",
      activeSide: "A",
      turnNumber: 1,
    };
    const created = await owner.client.rpc("create_live_game", {
      target_state: initial,
      target_access_scope: "public",
      target_archive_policy: "none",
      target_region_id: null,
      target_join_policy: "open",
      target_private_parent_id: null,
    });
    if (created.error) throw created.error;
    const room = Array.isArray(created.data) ? created.data[0] : created.data;
    const gameId = room.room_id as string;
    const finished = { ...initial, status: "finished", scores: { A: 21, B: 10 } };
    const callbacks = await Promise.all(
      Array.from({ length: 4 }, () =>
        owner.client.rpc("finalize_live_game", {
          target_game_id: gameId,
          target_state: finished,
          target_completion_kind: "terminated",
          target_completion_reason: "manual",
          target_surrendered_side: null,
        }),
      ),
    );
    for (const callback of callbacks) expect(callback.error).toBeNull();

    const history = await service
      .from("game_history")
      .select("participant_id,score_for,score_against,outcome")
      .eq("source_kind", "normal")
      .eq("source_id", gameId);
    if (history.error) throw history.error;
    expect(history.data).toHaveLength(2);
    expect(history.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ participant_id: owner.id, score_for: 21, outcome: "win" }),
        expect.objectContaining({ participant_id: opponent.id, score_for: 10, outcome: "loss" }),
      ]),
    );
    const ownerPage = await owner.client.rpc("list_my_game_history", { p_limit: 20 });
    const otherPage = await opponent.client.rpc("list_my_game_history", { p_limit: 20 });
    const strangerPage = await spectator.client.rpc("list_my_game_history", { p_limit: 20 });
    expect(ownerPage.error).toBeNull();
    expect(otherPage.error).toBeNull();
    expect(strangerPage.error).toBeNull();
    expect(ownerPage.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ game_id: gameId, replay_availability: "unavailable" }),
      ]),
    );
    expect(otherPage.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ game_id: gameId, replay_availability: "unavailable" }),
      ]),
    );
    expect(strangerPage.data).toEqual([]);
    expect((await owner.client.from("game_history").select("*")).error).toBeTruthy();
    expect(
      (
        await owner.client.from("game_history").insert({
          source_kind: "normal",
          source_id: crypto.randomUUID(),
          participant_id: owner.id,
          game_id: crypto.randomUUID(),
          participant_side: "A",
          game_name: "Forged",
          mode_key: "solo_practice",
          game_mode: "solo",
          completed_at: new Date().toISOString(),
          result_authority: "server_reduced",
        })
      ).error,
    ).toBeTruthy();
    expect(
      (await owner.client.from("game_history").update({ outcome: "loss" }).eq("source_id", gameId))
        .error,
    ).toBeTruthy();
  },
  30_000,
);
