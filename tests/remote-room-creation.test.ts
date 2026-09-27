import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeGame } from "../src/codec";
import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { createNewGame } from "../src/game";
import { BOT_DISABLED_NOTICE } from "../src/bot/catalog";

const { from, rpc } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { from, rpc },
}));

import { commitRoomState, createRoom, emptyLiveSession } from "../src/remoteRooms";

describe("remote live-game creation", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
  });

  it("creates a bot room by catalog key and request id only, never by client bot config", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const game = createNewGame({
      ...DEFAULT_NEW_GAME_SETTINGS,
      playerB: "Authur",
      botSide: "B",
      botEngine: "authur",
      botDifficulty: "super",
      tileDrawMode: "play",
    });
    rpc.mockResolvedValue({ data: null, error: { message: "stop after creation" } });
    await expect(
      createRoom(
        game,
        ownerId,
        emptyLiveSession(ownerId),
        { visibility: "public", regionId: null },
        undefined,
        { requestId: "22222222-2222-4222-8222-222222222222" },
      ),
    ).rejects.toThrow("stop after creation");

    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["create_bot_game"]);
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(
      [
        "target_access_scope",
        "target_archive_policy",
        "target_bot_key",
        "target_bot_side",
        "target_funding",
        "target_join_policy",
        "target_private_parent_id",
        "target_region_id",
        "target_request_id",
        "target_state",
      ].sort(),
    );
    expect(args.target_bot_key).toBe("authur_strong");
    expect(args.target_bot_side).toBe("B");
    expect(args.target_request_id).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("sends the same request id on a retry of the same creation", async () => {
    const game = createNewGame({
      ...DEFAULT_NEW_GAME_SETTINGS,
      botSide: "B",
      botEngine: "authur",
      botDifficulty: "super",
      tileDrawMode: "play",
    });
    rpc.mockResolvedValue({ data: null, error: { message: "network" } });
    const requestId = "33333333-3333-4333-8333-333333333333";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        createRoom(
          game,
          "11111111-1111-4111-8111-111111111111",
          emptyLiveSession(null),
          { visibility: "public", regionId: null },
          undefined,
          { requestId },
        ),
      ).rejects.toThrow();
    }
    expect(
      rpc.mock.calls.map(([, args]) => (args as { target_request_id: string }).target_request_id),
    ).toEqual([requestId, requestId]);
  });

  it("keeps human rooms on create_live_game with no bot arguments", async () => {
    const game = createNewGame({ ...DEFAULT_NEW_GAME_SETTINGS, tileDrawMode: "play" });
    rpc.mockResolvedValue({ data: null, error: { message: "stop after creation" } });
    await expect(
      createRoom(game, "11111111-1111-4111-8111-111111111111", emptyLiveSession(null), {
        visibility: "public",
        regionId: null,
      }),
    ).rejects.toThrow("stop after creation");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["create_live_game"]);
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(args).not.toHaveProperty("target_bot_key");
    expect(args).not.toHaveProperty("target_request_id");
  });

  it("says a bot is disabled, not that creation failed", async () => {
    const game = createNewGame({
      ...DEFAULT_NEW_GAME_SETTINGS,
      botSide: "B",
      botEngine: "authur",
      botDifficulty: "super",
      tileDrawMode: "play",
    });
    rpc.mockResolvedValue({
      data: null,
      error: { message: "bot_disabled: Authur has been disabled by an administrator." },
    });
    await expect(
      createRoom(game, "11111111-1111-4111-8111-111111111111", emptyLiveSession(null), {
        visibility: "public",
        regionId: null,
      }),
    ).rejects.toThrow(BOT_DISABLED_NOTICE);
  });

  it("tells an out-of-date client to reload when the old path refuses a bot room", async () => {
    const game = createNewGame({ ...DEFAULT_NEW_GAME_SETTINGS, tileDrawMode: "play" });
    rpc.mockResolvedValue({
      data: null,
      error: {
        message: "bot_room_requires_catalog: bot rooms must be created with create_bot_game",
      },
    });
    await expect(
      createRoom(game, "11111111-1111-4111-8111-111111111111", emptyLiveSession(null), {
        visibility: "public",
        regionId: null,
      }),
    ).rejects.toThrow(/Reload the app/);
  });

  it("persists an Aether room's initial state and session atomically before reading it", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const roomId = "44444444-4444-4444-8444-444444444444";
    const game = createNewGame({
      ...DEFAULT_NEW_GAME_SETTINGS,
      playerA: "Owner",
      playerB: "Aether",
      botSide: "B",
      botDifficulty: "medium",
      botEngine: "aether",
      tileDrawMode: "play",
    });
    const session = emptyLiveSession(ownerId);
    let synced = false;

    rpc.mockImplementation(async (name: string) => {
      if (name === "create_bot_game") {
        return {
          data: [{ room_id: roomId, room_code: "AETHER123456", replayed: false }],
          error: null,
        };
      }
      if (name === "commit_live_game_command") {
        synced = true;
        return { data: { outcome: "committed", revision: 1 }, error: null };
      }
      return { data: null, error: null };
    });

    const row = {
      room_id: roomId,
      owner_id: ownerId,
      name: game.name,
      player_a: game.players.A,
      player_b: game.players.B,
      status: "playing",
      access_scope: "public",
      archive_policy: "public",
      join_policy: "invite_only",
      region_id: null,
      game_mode: game.gameMode,
      mode_key: "aether_medium",
      member_a_id: null,
      member_b_id: null,
      player_a_user_id: ownerId,
      player_b_user_id: null,
      starting_side: game.startingSide,
      creator_side: "A",
      turn_number: game.turnNumber,
      score_a: game.scores.A,
      score_b: game.scores.B,
      state: null as unknown,
      session,
      created_at: "2026-08-10T00:00:00.000Z",
      updated_at: "2026-08-10T00:00:00.000Z",
      profiles: { display_name: "Owner" },
    };
    const maybeSingle = vi.fn(async () => ({
      data: { ...row, state: synced ? encodeGame(game) : null, revision: synced ? 1 : 0 },
      error: null,
    }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    from.mockReturnValue({ select });

    await expect(
      createRoom(
        game,
        ownerId,
        session,
        { visibility: "public", regionId: null },
        {
          accessScope: "public",
          archivePolicy: "public",
          joinPolicy: "invite_only",
          regionId: null,
        },
      ),
    ).resolves.toEqual({
      id: roomId,
      meta: expect.objectContaining({ id: roomId, roomCode: "AETHER123456" }),
      game: expect.objectContaining({ playerUserIds: { A: ownerId } }),
    });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "create_bot_game",
      "commit_live_game_command",
      "get_live_game_code",
    ]);
    expect(rpc).toHaveBeenCalledWith(
      "commit_live_game_command",
      expect.objectContaining({
        target_expected_revision: 0,
        target_command_id: expect.any(String),
        target_state: expect.objectContaining({ playerUserIds: { A: ownerId } }),
        target_session: session,
      }),
    );
  });

  it("publishes the canonical 100-tile position alongside the record", async () => {
    const roomId = "44444444-4444-4444-8444-444444444444";
    const game = createNewGame({ ...DEFAULT_NEW_GAME_SETTINGS, tileDrawMode: "play" });
    rpc.mockResolvedValue({ data: { outcome: "committed", revision: 4 }, error: null });

    await expect(
      commitRoomState({
        id: roomId,
        game: { ...game, revision: 3 },
        session: emptyLiveSession(null),
        event: "submit_action",
        commandId: "intent-1",
        issuedBy: "A",
      }),
    ).resolves.toEqual({ outcome: "committed", revision: 4 });

    const [name, args] = rpc.mock.calls.at(-1)! as [string, Record<string, never>];
    expect(name).toBe("commit_live_game_command");
    const payload = args as unknown as {
      target_expected_revision: number;
      target_command_id: string;
      target_issued_by: string;
      target_canonical: { inventory: unknown[]; revision: number };
      target_canonical_digest: string;
      target_state: { revision: number };
    };
    expect(payload.target_expected_revision).toBe(3);
    expect(payload.target_command_id).toBe("intent-1");
    expect(payload.target_issued_by).toBe("A");
    // Bounded, and always the whole physical set.
    expect(payload.target_canonical.inventory).toHaveLength(100);
    expect(payload.target_canonical.revision).toBe(4);
    expect(payload.target_state.revision).toBe(4);
    expect(payload.target_canonical_digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it("reports a conflict instead of overwriting when the game has moved on", async () => {
    const game = createNewGame({ ...DEFAULT_NEW_GAME_SETTINGS, tileDrawMode: "play" });
    rpc.mockResolvedValue({ data: { outcome: "conflict", revision: 9 }, error: null });
    await expect(
      commitRoomState({
        id: "44444444-4444-4444-8444-444444444444",
        game: { ...game, revision: 3 },
        session: emptyLiveSession(null),
      }),
    ).resolves.toEqual({ outcome: "conflict", revision: 9 });
  });

  it("refuses to publish a position that is not the 100-tile set", async () => {
    const game = createNewGame({ ...DEFAULT_NEW_GAME_SETTINGS, tileDrawMode: "play" });
    rpc.mockResolvedValue({ data: { outcome: "committed", revision: 1 }, error: null });
    await expect(
      commitRoomState({
        id: "44444444-4444-4444-8444-444444444444",
        game: { ...game, tilebag: game.tilebag.slice(1) },
        session: emptyLiveSession(null),
      }),
    ).rejects.toThrow(/does not describe the 100-tile set/);
    expect(rpc).not.toHaveBeenCalled();
  });
});
