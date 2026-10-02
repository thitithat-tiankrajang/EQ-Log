import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNewGame } from "../src/game";
import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";

const { invoke, rpc, from } = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke }, rpc, from },
}));
import { createRoom, emptyLiveSession } from "../src/remoteRooms";
const ownerId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
  from.mockReset();
  invoke.mockResolvedValue({ data: { id, roomCode: "ROOMCODE" }, error: null });
});

describe("trusted remote room creation", () => {
  it.each([false, true])(
    "sends settings and a stable intent, with no private state (bot=%s)",
    async (bot) => {
      const game = createNewGame({
        ...DEFAULT_NEW_GAME_SETTINGS,
        tileDrawMode: "play",
        playerAUserId: ownerId,
        ...(bot
          ? {
              botSide: "B" as const,
              botEngine: "authur" as const,
              botDifficulty: "super" as const,
              playerB: "Authur",
            }
          : {}),
      });
      const result = await createRoom(
        game,
        ownerId,
        emptyLiveSession(ownerId),
        { visibility: "public", regionId: null },
        undefined,
        { requestId },
      );
      expect(invoke).toHaveBeenCalledWith("live-game", {
        body: expect.objectContaining({ operation: "create", requestId }),
      });
      const body = invoke.mock.calls[0]![1].body;
      expect(Object.keys(body).sort()).toEqual(
        ["funding", "operation", "policy", "requestId", "settings"].sort(),
      );
      expect(JSON.stringify(body)).not.toMatch(
        /rackA|rackB|tilebag|canonical|inventory|history|pendingPlacements|session|rngSeed/,
      );
      expect(body.settings.playerAUserId).toBe(ownerId);
      expect(result.game.rackA).toEqual([]);
      expect(result.game.rackB).toEqual([]);
      expect(result.game.history).toEqual([]);
      expect(result.meta.roomCode).toBe("ROOMCODE");
      expect(rpc).not.toHaveBeenCalled();
      expect(from).not.toHaveBeenCalled();
    },
  );
  it("reuses the creation request ID after a lost response", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: "Network unavailable" } });
    const game = createNewGame({ ...DEFAULT_NEW_GAME_SETTINGS, tileDrawMode: "play" });
    await createRoom(
      game,
      ownerId,
      emptyLiveSession(ownerId),
      { visibility: "public", regionId: null },
      undefined,
      { requestId },
    ).catch(() => null);
    await createRoom(
      game,
      ownerId,
      emptyLiveSession(ownerId),
      { visibility: "public", regionId: null },
      undefined,
      { requestId },
    );
    expect(invoke.mock.calls.map((call) => call[1].body.requestId)).toEqual([requestId, requestId]);
  });
  it("does not claim creation success after a server refusal", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        context: new Response(JSON.stringify({ error: "Bot unavailable." }), { status: 409 }),
      },
    });
    const game = createNewGame({ ...DEFAULT_NEW_GAME_SETTINGS, tileDrawMode: "play" });
    await expect(
      createRoom(game, ownerId, emptyLiveSession(ownerId), {
        visibility: "public",
        regionId: null,
      }),
    ).rejects.toThrow("Bot unavailable.");
  });
});
