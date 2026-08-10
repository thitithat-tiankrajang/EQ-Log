import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { createNewGame } from "../src/game";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc },
}));

import {
  emptyLiveSession,
  makeLiveSession,
  updateRoomSession,
  updateRoomState,
} from "../src/remoteRooms";

describe("remote live-game write ordering", () => {
  beforeEach(() => rpc.mockReset());

  it("waits for an in-flight draft before atomically writing state with its matching session", async () => {
    let releaseDraft!: () => void;
    const draftBlocked = new Promise<void>((resolve) => {
      releaseDraft = resolve;
    });
    rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (
        name === "update_live_game_session" &&
        (args.target_session as { actionMode?: string }).actionMode === "place_equation"
      ) {
        await draftBlocked;
      }
      return { data: null, error: null };
    });

    const roomId = "44444444-4444-4444-8444-444444444444";
    const game = createNewGame({
      ...DEFAULT_NEW_GAME_SETTINGS,
      tileDrawMode: "play",
    });
    const draft = makeLiveSession({
      actorId: "11111111-1111-4111-8111-111111111111",
      gameId: game.gameId,
      turnNumber: game.turnNumber,
      activeSide: game.activeSide,
      actionMode: "place_equation",
      pendingPlacements: [{ tile: game.rackA[0], row: 7, col: 7, rackSlot: 0 }],
      exchangeDraft: { outgoingIds: [], incomingTiles: [] },
      selectedRackTileId: null,
      selectedPendingTileId: null,
    });
    const committedSession = emptyLiveSession(draft.actorId);

    const draftWrite = updateRoomSession(roomId, draft);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    const stateWrite = updateRoomState({ id: roomId, game, session: committedSession });

    await Promise.resolve();
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["update_live_game_session"]);

    releaseDraft();
    await Promise.all([draftWrite, stateWrite]);

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "update_live_game_session",
      "sync_live_game_state",
    ]);
    expect(rpc).toHaveBeenLastCalledWith(
      "sync_live_game_state",
      expect.objectContaining({ target_session: committedSession }),
    );
  });
});
