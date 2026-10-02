// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import {
  authorityTestEnabled,
  call,
  normal,
  player,
  service,
  sql,
  stage,
} from "./helpers/liveAuthority";
import { env } from "./live-security-browser/fixtures";
const connection = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  get supabase() {
    return connection.client;
  },
}));
import { liveGameClient } from "../src/liveGame/client";
import {
  saveCompletedGame,
  listMySavedGames,
  changeMySavedGame,
} from "../src/features/gameRecords/saved";
const local = authorityTestEnabled ? it : it.skip;

local(
  "finishes through the real frontend when raw room purpose is denied",
  async () => {
    const a = await player(),
      b = await player();
    const match = await normal(a, b);
    connection.client = a.client;
    expect(
      (await a.client.from("room_live").select("room_purpose").eq("room_id", match.id)).error?.code,
    ).toBe("42501");
    await liveGameClient.action(match.id, match.revision, { kind: "resign" });
    expect(
      sql(`select count(*) from public.recent_game_payloads where source_id='${match.id}'`),
    ).toBe("1");
    const replay = await call(a, { gameId: match.id }, "archive-replay");
    expect(replay.status).toBe(200);
    expect(replay.body.replay.finalRacks.B).toBeDefined();
  },
  30000,
);

local(
  "keeps completion/reconnect retries exactly once and exposes only owned safe Replay",
  async () => {
    const a = await player(),
      b = await player(),
      outsider = await player();
    const match = await normal(a, b),
      command = crypto.randomUUID();
    connection.client = a.client;
    await expect(
      liveGameClient.action(match.id, match.revision - 1, { kind: "resign" }, crypto.randomUUID()),
    ).rejects.toThrow();
    await liveGameClient.action(match.id, match.revision, { kind: "resign" }, command);
    await expect(
      liveGameClient.action(match.id, match.revision, { kind: "resign" }, command),
    ).rejects.toThrow();
    const dispatch = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    try {
      await expect(liveGameClient.read(match.id)).rejects.toThrow();
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0]![0].type).toBe("eq-lab:archive-replay-ready");
      expect(dispatch.mock.calls[0]![0].detail.archive.gameId).toBe(match.id);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(
      sql(`select count(*) from public.recent_game_payloads where source_id='${match.id}'`),
    ).toBe("1");
    expect(sql(`select count(*) from public.game_history where source_id='${match.id}'`)).toBe("2");
    await saveCompletedGame({ sourceKind: "normal", sourceId: match.id });
    expect((await listMySavedGames()).items.some((x) => x.sourceId === match.id)).toBe(true);
    const item = (await listMySavedGames()).items.find((x) => x.sourceId === match.id)!;
    await changeMySavedGame(item, "trash");
    expect(
      (await listMySavedGames(null, 20, "trashed")).items.some((x) => x.sourceId === match.id),
    ).toBe(true);
    await changeMySavedGame(item, "restore");
    expect((await listMySavedGames()).items.some((x) => x.sourceId === match.id)).toBe(true);
    expect((await call(outsider, { gameId: match.id }, "archive-replay")).status).toBe(404);
  },
  30000,
);

local(
  "routes a non-admin Stage and its lost-response retry without trusting the game name",
  async () => {
    const owner = await player(),
      outsider = await player();
    const { match } = await stage(owner);
    connection.client = owner.client;
    const command = crypto.randomUUID();
    expect((await owner.client.from("room_live").select("room_purpose")).error?.code).toBe("42501");
    await liveGameClient.action(match.id, match.revision, { kind: "resign" }, command);
    await expect(
      liveGameClient.action(match.id, match.revision, { kind: "resign" }, command),
    ).rejects.toThrow();
    const captured = await service
      .from("stage_completed_attempts")
      .select("state_authority")
      .eq("room_id", match.id);
    expect(captured.error).toBeNull();
    expect(captured.data).toEqual([{ state_authority: "server_reduced" }]);
    expect((await call(owner, { gameId: match.id }, "archive-replay")).status).toBe(200);
    expect((await call(outsider, { gameId: match.id }, "archive-replay")).status).toBe(404);
  },
  30000,
);

local(
  "reveals no terminal route to spectators, pending users, anonymous clients or Ranked callers",
  async () => {
    const a = await player(),
      b = await player(),
      observer = await player(),
      pending = await player();
    const match = await normal(a, b);
    sql(`update public.profiles set status='pending' where id='${pending.id}'`);
    for (const who of [observer, pending]) {
      connection.client = who.client;
      await expect(
        liveGameClient.action(match.id, match.revision, { kind: "resign" }),
      ).rejects.toThrow();
      expect(
        (await who.client.rpc("get_game_terminal_route", { target_game_id: match.id })).data,
      ).toBeNull();
    }
    connection.client = createClient(env.API_URL, env.ANON_KEY, {
      auth: { persistSession: false },
    });
    await expect(
      liveGameClient.action(match.id, match.revision, { kind: "resign" }),
    ).rejects.toThrow();
    const ranked = await call(a, { operation: "create", minutesA: 15, minutesB: 15 }, "ranked");
    expect(ranked.status).toBe(200);
    connection.client = a.client;
    await expect(
      liveGameClient.action(ranked.body.match.id, ranked.body.match.revision, { kind: "resign" }),
    ).rejects.toThrow();
    expect(sql(`select count(*) from public.room_live where room_id='${match.id}'`)).toBe("1");
    expect(sql(`select count(*) from public.game_history where source_id='${match.id}'`)).toBe("0");
    expect(
      (await call(a, { operation: "cancel", id: ranked.body.match.id }, "ranked")).status,
    ).toBe(200);
    for (const table of ["live_game_events", "game_timelines", "ranked_private_revisions"])
      expect((await a.client.from(table).select("*")).error).toBeTruthy();
  },
  30000,
);
