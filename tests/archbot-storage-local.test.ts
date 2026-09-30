// @vitest-environment node
/** Opt-in ArchBot-to-Storage integration gate. Use only a disposable local stack. */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { decodeGame, encodeGame } from "../src/codec";
import { readCompletedGameRecord } from "../src/completedGame/record";
import { encodeCanonical, canonicalFromSnapshot } from "../src/domain/projection";
import { applyRankedAction } from "../src/features/ranked/rules";
import { createNewGame, makeSnapshot, type GameState } from "../src/game";

const workdir = process.env.ARCHBOT_STORAGE_TEST_SUPABASE_WORKDIR;
const local = workdir ? it : it.skip;

local(
  "finishes a production ArchBot room through Compact, History, Recent and safe replay",
  async () => {
    const output = execFileSync("supabase", ["status", "--workdir", workdir!, "-o", "env"], {
      encoding: "utf8",
    });
    const env: Record<string, string> = {};
    for (const line of output.split("\n")) {
      const match = line.match(/^([A-Z_]+)="?([^"\n]+)"?$/);
      if (match) env[match[1]!] = match[2]!;
    }
    if (!env.API_URL?.startsWith("http://127.0.0.1:") || !env.DB_URL?.includes("127.0.0.1"))
      throw new Error("ArchBot integration requires a disposable loopback Supabase stack.");
    const sql = (statement: string) =>
      execFileSync("psql", [env.DB_URL!, "-v", "ON_ERROR_STOP=1", "-At", "-c", statement], {
        encoding: "utf8",
      }).trim();
    sql(`insert into private.runtime_secrets(key,value) values
      ('room_code_secret',repeat('s',40)) on conflict(key) do nothing`);
    const service = createClient(env.API_URL, env.SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const archbot = JSON.parse(
      sql(`select row_to_json(c) from
      (select bot_key,display_name,access_tier,execution_type,enabled,new_rooms_allowed,
        config_version,difficulty,mode_key
       from public.bot_catalog where bot_key='stage5b') c`),
    );
    expect(archbot).toMatchObject({
      bot_key: "stage5b",
      display_name: "ArchBot",
      access_tier: "free",
      execution_type: "CLIENT",
      enabled: true,
      new_rooms_allowed: true,
    });

    const email = `archbot-storage-${crypto.randomUUID()}@example.test`;
    const password = "LocalTest-ArchBot-2026!";
    const made = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (made.error || !made.data.user) throw made.error ?? new Error("Missing local test user.");
    const userId = made.data.user.id;
    try {
      const approved = await service
        .from("profiles")
        .update({ status: "approved" })
        .eq("id", userId);
      if (approved.error) throw approved.error;
      const client = createClient(env.API_URL, env.ANON_KEY!, { auth: { persistSession: false } });
      const signed = await client.auth.signInWithPassword({ email, password });
      if (signed.error || !signed.data.session) throw signed.error ?? new Error("Missing session.");
      const token = signed.data.session.access_token;
      const initial = createNewGame({
        name: "ArchBot Storage gate",
        gameMode: "versus",
        playerA: "Human",
        playerB: "ArchBot",
        playerAUserId: userId,
        startingSide: "A",
        botSide: "B",
        botEngine: "stage5b",
        botDifficulty: "stage5b64",
        tileDrawMode: "play",
      });
      const created = await client.rpc("create_bot_game", {
        target_request_id: crypto.randomUUID(),
        target_bot_key: "stage5b",
        target_bot_side: "B",
        target_state: encodeGame(initial),
        target_access_scope: "public",
        target_archive_policy: "none",
        target_region_id: null,
        target_join_policy: "invite_only",
        target_private_parent_id: null,
      });
      if (created.error) throw created.error;
      const roomId = (Array.isArray(created.data) ? created.data[0] : created.data)
        .room_id as string;
      const room = await service
        .from("room_live")
        .select("state,revision,room_purpose,bot_key,bot_config_version,bot_difficulty,mode_key")
        .eq("room_id", roomId)
        .single();
      if (room.error) throw room.error;
      expect(room.data).toMatchObject({
        room_purpose: "normal",
        bot_key: "stage5b",
        bot_difficulty: "stage5b64",
        mode_key: "stage5b_standard",
        revision: 0,
      });
      expect(room.data.bot_config_version).toBe(archbot.config_version);
      expect(room.data.bot_difficulty).toBe(archbot.difficulty);
      expect(room.data.mode_key).toBe(archbot.mode_key);
      const started = decodeGame(room.data.state);
      const committed = await client.rpc("commit_live_game_command", {
        target_game_id: roomId,
        target_expected_revision: 0,
        target_command_id: crypto.randomUUID(),
        target_issued_by: "host",
        target_command: { kind: "create" },
        target_canonical: encodeCanonical(canonicalFromSnapshot(started, 1)),
        target_canonical_digest: "archbot-storage-local",
        target_state: encodeGame({ ...started, revision: 1 }),
      });
      if (committed.error) throw committed.error;

      // Use the legal action reducer for a human pass, a bot pass and a
      // human resignation. The current live protocol still trusts the client
      // for intermediate actions; terminal storage must label that honestly.
      let game: GameState = started;
      const t0 = Date.parse(game.currentTurnStartedAt);
      for (const [index, side, kind] of [
        [1, "A", "pass"],
        [2, "B", "pass"],
        [3, "A", "resign"],
      ] as const) {
        const next = applyRankedAction(
          game,
          side,
          { kind },
          new Date(t0 + index * 1000).toISOString(),
        );
        if (kind === "resign") next.matchControl = { surrenderedSide: side };
        next.history = [...game.history, makeSnapshot(next)];
        next.historyIndex = next.history.length - 1;
        game = next;
      }
      expect(game.status).toBe("finished");
      expect(game.logs.map((log) => log.action)).toEqual(["pass", "pass", "end_game"]);
      const finished = { ...game, revision: 2 };
      const terminal = await fetch(`${env.API_URL}/functions/v1/normal-terminal`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: env.ANON_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId: roomId, state: encodeGame(finished) }),
      });
      const terminalBody = await terminal.json();
      expect(terminal.status, JSON.stringify(terminalBody)).toBe(200);
      expect(terminalBody.replayRetained).toBe(true);
      const stored = await service
        .from("recent_game_payloads")
        .select("record")
        .eq("source_id", roomId)
        .single();
      if (stored.error) throw stored.error;
      const record = stored.data.record;
      expect(record.provenance).toMatchObject({
        mode: "bot",
        completionAuthority: "client-reported",
        bot: {
          catalogId: "stage5b",
          catalogVersion: String(room.data.bot_config_version),
          difficulty: "stage5b64",
        },
      });
      expect(record.provenance.stage).toBeUndefined();
      expect(JSON.stringify(record)).not.toMatch(/modelWeights|modelPath|decisionSeed|reasoning/);
      const rebuilt = await readCompletedGameRecord(record);
      expect(rebuilt.game.logs).toEqual(finished.logs);
      expect(rebuilt.game.rackA).toEqual(finished.rackA);
      expect(rebuilt.game.rackB).toEqual(finished.rackB);
      expect(rebuilt.game.tilebag).toEqual(finished.tilebag);

      const history = await client.rpc("list_my_game_history", { p_limit: 20 });
      if (history.error) throw history.error;
      expect(
        history.data.find((item: { source_id: string }) => item.source_id === roomId),
      ).toMatchObject({ is_recent: true, replay_availability: "compact_available" });
      expect(
        sql(`select result_authority || ':' || bot_key from public.game_history
        where source_id='${roomId}'::uuid and participant_id='${userId}'::uuid`),
      ).toBe("client_reported:stage5b");
      expect(
        sql(`select count(*) from public.survival_attempts where player_id='${userId}'::uuid`),
      ).toBe("0");
      expect(
        sql(`select count(*) from public.probot_consumptions where user_id='${userId}'::uuid`),
      ).toBe("0");
      expect(
        sql(`select count(*) from public.economy_entries where user_id='${userId}'::uuid`),
      ).toBe("0");

      const replay = await fetch(`${env.API_URL}/functions/v1/archive-replay`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: env.ANON_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId: roomId }),
      });
      const safe = await replay.json();
      expect(replay.status, JSON.stringify(safe)).toBe(200);
      expect(safe.archive.scope).toBe("recent");
      expect(safe.replay.mode).toBe("bot");
      expect(safe.replay.players.B).toBe("ArchBot");
      expect(safe.replay.bot.displayName).toBe("ArchBot");
      expect(safe.replay.bot.difficulty).toBeUndefined();
      expect(safe.replay.bot.modelLevel).toBeUndefined();
      expect(safe.replay.turns).toHaveLength(3);
      const wire = JSON.stringify(safe);
      expect(wire).not.toContain(record.digest);
      expect(wire).not.toContain(finished.tilebag[0]?.id);
      expect(wire).not.toMatch(
        /tilebag|drawOrder|decisionSeed|modelWeights|reasoning|finalStateDigest/,
      );
    } finally {
      await service.auth.admin.deleteUser(userId);
    }
  },
  90_000,
);
