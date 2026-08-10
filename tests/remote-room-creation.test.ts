import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeGame } from "../src/codec";
import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { createNewGame } from "../src/game";

const { from, rpc } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { from, rpc },
}));

import { createRoom, emptyLiveSession } from "../src/remoteRooms";

describe("remote live-game creation", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
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
      tileDrawMode: "play",
    });
    const session = emptyLiveSession(ownerId);
    let synced = false;

    rpc.mockImplementation(async (name: string) => {
      if (name === "create_live_game") {
        return { data: { room_id: roomId, room_code: "AETHER123456" }, error: null };
      }
      if (name === "sync_live_game_state") synced = true;
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
      data: { ...row, state: synced ? encodeGame(game) : null },
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
      "create_live_game",
      "sync_live_game_state",
      "get_live_game_code",
    ]);
    expect(rpc).toHaveBeenCalledWith(
      "sync_live_game_state",
      expect.objectContaining({
        target_state: expect.objectContaining({ playerUserIds: { A: ownerId } }),
        target_session: session,
      }),
    );
  });
});
