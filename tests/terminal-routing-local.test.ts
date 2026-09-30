// @vitest-environment node
/** Real frontend terminal calls against an isolated Supabase with production grants. */
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { createNewGame, pushActionSnapshot, type GameState } from "../src/game";
import { encodeGame } from "../src/codec";
import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { listMyHistory } from "../src/features/gameRecords/history";
import {
  saveCompletedGame,
  listMySavedGames,
  changeMySavedGame,
} from "../src/features/gameRecords/saved";
import { readCompletedGameRecord } from "../src/completedGame/record";
import { stageStartCanonical } from "../src/features/survival/repository";
import { createSurvivalTestGame } from "../src/features/survival/seededGame";

const connection = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  get supabase() {
    return connection.client;
  },
}));
import {
  commitRoomState,
  createRoom,
  emptyLiveSession,
  createStageAttempt,
  readRoom,
} from "../src/remoteRooms";

const workdir = process.env.TERMINAL_TEST_SUPABASE_WORKDIR;
const local = workdir ? it : it.skip;

function localServices() {
  const env: Record<string, string> = {};
  const output = execFileSync("supabase", ["status", "--workdir", workdir!, "-o", "env"], {
    encoding: "utf8",
  });
  for (const line of output.split("\n")) {
    const match = line.match(/^([A-Z_]+)="?([^"\n]+)"?$/);
    if (match) env[match[1]!] = match[2]!;
  }
  if (!env.API_URL?.startsWith("http://127.0.0.1:") || !env.DB_URL?.includes("127.0.0.1"))
    throw new Error("Terminal routing regression requires an isolated loopback stack.");
  const service = createClient(env.API_URL, env.SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const sql = (text: string) =>
    execFileSync("psql", [env.DB_URL!, "-v", "ON_ERROR_STOP=1", "-At", "-c", text], {
      encoding: "utf8",
    }).trim();
  const users: string[] = [];
  async function user(approved = true) {
    const email = `terminal-${crypto.randomUUID()}@example.test`;
    const password = "LocalTest-Terminal-2026!";
    const made = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (made.error || !made.data.user) throw made.error ?? new Error("Missing local user.");
    users.push(made.data.user.id);
    if (approved) {
      const changed = await service
        .from("profiles")
        .update({ status: "approved" })
        .eq("id", made.data.user.id);
      if (changed.error) throw changed.error;
    }
    const client = createClient(env.API_URL!, env.ANON_KEY!, { auth: { persistSession: false } });
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    return { id: made.data.user.id, client };
  }
  return {
    env,
    service,
    sql,
    user,
    async cleanup() {
      connection.client = null;
      for (const id of users.reverse()) await service.auth.admin.deleteUser(id);
    },
  };
}

const privatePolicy = {
  accessScope: "private",
  archivePolicy: "none",
  joinPolicy: "invite_only",
  regionId: null,
} as const;
const finish = (game: GameState) =>
  pushActionSnapshot({ ...game, status: "finished", timers: { ...game.timers, paused: true } });

local(
  "finishes through the real frontend when raw room purpose is denied",
  async () => {
    const f = localServices();
    try {
      f.sql(
        "insert into private.runtime_secrets(key,value) values ('room_code_secret',repeat('s',40)) on conflict do nothing",
      );
      const { id: userId, client } = await f.user();
      connection.client = client;
      const game = createNewGame({
        name: "Terminal routing permission regression",
        gameMode: "solo",
        playerA: "Owner",
        playerAUserId: userId,
        startingSide: "A",
        tileDrawMode: "play",
      });
      const created = await createRoom(
        game,
        userId,
        emptyLiveSession(userId),
        { visibility: "private", regionId: null },
        privatePolicy,
      );
      const denied = await client
        .from("room_live")
        .select("room_purpose")
        .eq("room_id", created.id)
        .maybeSingle();
      expect(denied.error?.code).toBe("42501");
      const finished = pushActionSnapshot({
        ...created.game,
        status: "finished",
        timers: { ...created.game.timers, paused: true },
      });
      try {
        expect(await commitRoomState({ id: created.id, game: finished })).toMatchObject({
          outcome: "committed",
        });
      } catch (error) {
        // Disproof control: identical user, state and revision through the actual
        // existing Edge boundary. This must succeed even while client routing fails.
        const control = await client.functions.invoke("normal-terminal", {
          body: {
            gameId: created.id,
            state: encodeGame({ ...finished, revision: finished.revision + 1 }),
          },
        });
        expect(control.error).toBeNull();
        expect(control.data?.replayRetained).toBe(true);
        throw error;
      }
      const persisted = await f.service
        .from("recent_game_payloads")
        .select("record")
        .eq("source_id", created.id)
        .single();
      expect(persisted.error).toBeNull();
      expect(persisted.data?.record.format).toBe(1);
    } finally {
      await f.cleanup();
    }
  },
  60_000,
);

local(
  "keeps completion/reconnect retries exactly once and exposes only owned safe replay",
  async () => {
    const f = localServices();
    try {
      const owner = await f.user();
      const outsider = await f.user();
      connection.client = owner.client;
      const game = createNewGame({
        name: "Normal terminal retry",
        gameMode: "solo",
        playerA: "Owner",
        playerAUserId: owner.id,
        tileDrawMode: "play",
      });
      const made = await createRoom(
        game,
        owner.id,
        emptyLiveSession(owner.id),
        { visibility: "private", regionId: null },
        privatePolicy,
      );
      const finished = finish(made.game);
      await expect(
        commitRoomState({ id: made.id, game: finished, expectedRevision: 0 }),
      ).rejects.toThrow("Game changed. Reload and retry.");
      expect(
        (await f.service.from("recent_game_payloads").select("source_id").eq("source_id", made.id))
          .data,
      ).toHaveLength(0);
      await commitRoomState({ id: made.id, game: finished });
      expect(await readRoom(made.id)).toBeNull();
      const reloadedClient = createClient(f.env.API_URL!, f.env.ANON_KEY!, {
        auth: { persistSession: false },
      });
      const session = (await owner.client.auth.getSession()).data.session!;
      await reloadedClient.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      connection.client = reloadedClient;
      await Promise.all([
        commitRoomState({ id: made.id, game: finished }),
        commitRoomState({ id: made.id, game: finished }),
      ]);
      const rows = await f.service
        .from("recent_game_payloads")
        .select("record")
        .eq("source_id", made.id);
      expect(rows.error).toBeNull();
      expect(rows.data).toHaveLength(1);
      const record = rows.data![0]!.record;
      const rebuilt = await readCompletedGameRecord(record);
      expect(rebuilt.game.logs).toEqual(finished.logs);
      expect(rebuilt.game.rackA).toEqual(finished.rackA);
      expect(rebuilt.game.tilebag).toEqual(finished.tilebag);
      const history = await listMyHistory();
      expect(history.items.filter((x) => x.sourceId === made.id)).toHaveLength(1);
      expect(history.items.find((x) => x.sourceId === made.id)).toMatchObject({
        isRecent: true,
        replayAvailability: "compact_available",
      });
      const source = { sourceKind: "normal", sourceId: made.id } as const;
      await saveCompletedGame(source);
      await saveCompletedGame(source);
      expect((await listMySavedGames()).items.filter((x) => x.sourceId === made.id)).toHaveLength(
        1,
      );
      await changeMySavedGame(source, "trash");
      expect((await listMySavedGames(null, 20, "trashed")).items[0]?.sourceId).toBe(made.id);
      await changeMySavedGame(source, "restore");
      expect((await listMySavedGames()).items[0]?.sourceId).toBe(made.id);
      const replay = await reloadedClient.functions.invoke("archive-replay", {
        body: { gameId: made.id },
      });
      expect(replay.error).toBeNull();
      expect(JSON.stringify(replay.data)).not.toMatch(
        /tilebag|drawOrder|finalStateDigest|decisionSeed/,
      );
      expect(JSON.stringify(replay.data)).not.toContain(record.digest);
      expect(JSON.stringify(replay.data)).not.toContain(finished.rackA[0]!.id);
      expect(
        (await outsider.client.rpc("get_game_terminal_route", { target_game_id: made.id })).data,
      ).toBeNull();
      expect(
        (await outsider.client.functions.invoke("archive-replay", { body: { gameId: made.id } }))
          .error,
      ).toBeTruthy();
      expect(
        f.sql(`select count(*) from public.probot_consumptions where user_id='${owner.id}'`),
      ).toBe("0");
    } finally {
      await f.cleanup();
    }
  },
  60_000,
);

local(
  "routes a non-admin Stage and its lost-response retry without trusting the game name",
  async () => {
    const f = localServices();
    const levelId = crypto.randomUUID();
    try {
      const owner = await f.user();
      const outsider = await f.user();
      const seed = 17;
      const seal = JSON.stringify(stageStartCanonical(seed)).replaceAll("'", "''");
      f.sql(
        `insert into public.survival_levels(id,season_key,level_no,seed,sample_policy,sample_count,win_count,winning_replays,immediate_winning_moves,shortest_winning_replay_turns,status,start_canonical,approved_by,approved_at,admin_note) values ('${levelId}','terminal-${levelId}',1,${seed},'local-test',3,3,'[{},{},{}]',0,5,'approved','${seal}','${owner.id}',now(),'Local terminal routing fixture')`,
      );
      connection.client = owner.client;
      const start = createSurvivalTestGame(seed, "Owner", owner.id);
      const made = await createStageAttempt(start, owner.id, levelId, crypto.randomUUID());
      const live = await readRoom(made.id);
      expect(live).not.toBeNull();
      expect(
        (await owner.client.from("room_live").select("room_purpose").eq("room_id", made.id)).error
          ?.code,
      ).toBe("42501");
      expect(
        (await owner.client.rpc("get_game_terminal_route", { target_game_id: made.id })).data,
      ).toBe("stage");
      expect(
        (await outsider.client.rpc("get_game_terminal_route", { target_game_id: made.id })).data,
      ).toBeNull();
      const finished = finish(live!.game);
      await commitRoomState({ id: made.id, game: finished });
      expect(await readRoom(made.id)).toBeNull();
      await Promise.all([
        commitRoomState({ id: made.id, game: { ...finished, name: "Not a Stage name" } }),
        commitRoomState({ id: made.id, game: finished }),
      ]);
      const receipts = await f.service
        .from("stage_completed_attempts")
        .select("record,outcome")
        .eq("room_id", made.id);
      expect(receipts.error).toBeNull();
      expect(receipts.data).toHaveLength(1);
      expect(
        (await listMyHistory()).items.filter(
          (x) => x.sourceId === made.attemptId && x.sourceKind === "stage",
        ),
      ).toHaveLength(1);
      expect(
        (await outsider.client.rpc("get_game_terminal_route", { target_game_id: made.id })).data,
      ).toBeNull();
      expect(
        f.sql(`select count(*) from public.probot_consumptions where user_id='${owner.id}'`),
      ).toBe("0");
    } finally {
      // Permanent Stage records intentionally restrict deletion; only this
      // disposable fixture is cleaned, in dependency order, never production.
      f.sql(
        `delete from public.game_history where source_id in (select id from public.survival_attempts where level_id='${levelId}'); delete from public.stage_completed_attempts where level_id='${levelId}'; delete from public.survival_attempts where level_id='${levelId}'; delete from public.survival_levels where id='${levelId}'`,
      );
      await f.cleanup();
    }
  },
  60_000,
);

local(
  "reveals no terminal route to spectators, pending users, anonymous clients or Ranked callers",
  async () => {
    const f = localServices();
    try {
      const owner = await f.user();
      const spectator = await f.user();
      const participant = await f.user();
      const pending = await f.user(false);
      const anon = createClient(f.env.API_URL!, f.env.ANON_KEY!, {
        auth: { persistSession: false },
      });
      connection.client = owner.client;
      const game = createNewGame({
        ...DEFAULT_NEW_GAME_SETTINGS,
        name: "Public spectator boundary",
        playerA: "Owner",
        playerAUserId: owner.id,
        playerBUserId: participant.id,
        tileDrawMode: "play",
      });
      const made = await createRoom(
        game,
        owner.id,
        emptyLiveSession(owner.id),
        { visibility: "public", regionId: null },
        { ...privatePolicy, accessScope: "public" },
      );
      expect(
        (await spectator.client.from("room_live").select("room_id").eq("room_id", made.id)).data,
      ).toHaveLength(1);
      expect(
        (await participant.client.rpc("get_game_terminal_route", { target_game_id: made.id })).data,
      ).toBe("normal");
      for (const client of [spectator.client, pending.client]) {
        expect(
          (await client.rpc("get_game_terminal_route", { target_game_id: made.id })).data,
        ).toBeNull();
        expect(
          (await client.rpc("get_game_terminal_route", { target_game_id: crypto.randomUUID() }))
            .data,
        ).toBeNull();
      }
      expect(
        (await anon.rpc("get_game_terminal_route", { target_game_id: made.id })).error,
      ).toBeTruthy();
      const rankedId = crypto.randomUUID();
      f.sql(
        `insert into public.ranked_matches(id,player_a_id,status,minutes_a,minutes_b,state) values ('${rankedId}','${owner.id}','waiting',10,10,'{}')`,
      );
      expect(
        (await owner.client.rpc("get_game_terminal_route", { target_game_id: rankedId })).data,
      ).toBeNull();
      await expect(commitRoomState({ id: rankedId, game: finish(made.game) })).rejects.toThrow(
        "Game completion unavailable.",
      );
      expect(
        (await owner.client.from("ranked_matches").select("state").eq("id", rankedId)).error,
      ).toBeTruthy();
      for (const field of ["room_purpose", "room_code_hash", "legacy_private_autosave"])
        expect(
          (await owner.client.from("room_live").select(field).eq("room_id", made.id)).error?.code,
        ).toBe("42501");
      for (const table of [
        "recent_game_payloads",
        "saved_game_items",
        "stage_completed_attempts",
        "ranked_private_revisions",
        "game_history",
      ])
        expect((await owner.client.from(table).select("*")).error).toBeTruthy();
    } finally {
      await f.cleanup();
    }
  },
  60_000,
);
