import { beforeEach, describe, expect, it, vi } from "vitest";

const { channel, channelBuilder, on, removeChannel, rpc } = vi.hoisted(() => {
  const builder = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  builder.on.mockReturnValue(builder);
  builder.subscribe.mockReturnValue(builder);
  return {
    channel: vi.fn(() => builder),
    channelBuilder: builder,
    on: builder.on,
    removeChannel: vi.fn(),
    rpc: vi.fn(),
  };
});

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc,
    channel,
    removeChannel,
    from: vi.fn(() => {
      throw new Error("room_live must not be queried directly for lobby summaries");
    }),
  },
}));

import { listRooms, subscribeToRoom } from "../src/remoteRooms";

describe("remote live-game listing", () => {
  beforeEach(() => {
    rpc.mockReset();
    on.mockClear();
    channelBuilder.subscribe.mockClear();
  });

  it("loads a public-safe summary projection without player IDs, state, session, or code hash", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          room_id: "11111111-2222-4333-8444-555555555555",
          name: "Public room",
          player_a: "Alice",
          player_b: "Bob",
          status: "waiting",
          access_scope: "public",
          archive_policy: "public",
          join_policy: "open",
          region_id: null,
          game_mode: "versus",
          mode_key: "local_versus",
          starting_side: "A",
          turn_number: 1,
          score_a: 0,
          score_b: 0,
          created_at: "2026-08-10T00:00:00.000Z",
          updated_at: "2026-08-10T00:00:00.000Z",
          owner_name: "Alice",
          viewer_role: "Spectator",
          can_manage: false,
          has_opponent: false,
        },
      ],
      error: null,
    });

    const rooms = await listRooms({ visibility: "public", regionId: null });

    expect(rpc).toHaveBeenCalledWith("list_live_games", {
      target_access_scope: "public",
      target_region_id: null,
    });
    expect(rooms).toEqual([
      expect.objectContaining({
        id: "11111111-2222-4333-8444-555555555555",
        ownerId: null,
        ownerName: "Alice",
        viewerRole: "Spectator",
        canManage: false,
        hasOpponent: false,
      }),
    ]);
    expect(rooms[0]).not.toHaveProperty("inviteUserAId");
    expect(rooms[0]).not.toHaveProperty("inviteUserBId");
  });

  it("subscribes to the opened room with only the readable live-game columns", () => {
    const unsubscribe = subscribeToRoom("11111111-2222-4333-8444-555555555555", vi.fn(), vi.fn());

    expect(on.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        event: "*",
        schema: "public",
        table: "room_live",
        filter: "room_id=eq.11111111-2222-4333-8444-555555555555",
        select: expect.arrayContaining(["room_id", "state", "session"]),
      }),
    );
    expect(on.mock.calls[0]?.[1].select).not.toEqual(
      expect.arrayContaining(["room_code_hash", "private_parent_id"]),
    );
    unsubscribe();
  });

  it("treats a session-only Realtime update as a draft instead of a complete game state", () => {
    const onState = vi.fn();
    const onSession = vi.fn();
    const unsubscribe = subscribeToRoom("11111111-2222-4333-8444-555555555555", onState, onSession);
    const handleChange = on.mock.calls[0]?.[2] as ((payload: unknown) => void) | undefined;

    handleChange?.({
      eventType: "UPDATE",
      schema: "public",
      table: "room_live",
      commit_timestamp: "2026-08-10T00:00:00.000Z",
      errors: null,
      old: { room_id: "11111111-2222-4333-8444-555555555555" },
      new: {
        room_id: "11111111-2222-4333-8444-555555555555",
        session: {
          version: 1,
          actorId: "22222222-2222-4222-8222-222222222222",
          gameId: "33333333-3333-4333-8333-333333333333",
          turnNumber: 1,
          activeSide: "A",
          actionMode: "place_equation",
          pendingPlacements: [],
          exchangeDraft: { outgoingIds: [], incomingTiles: [] },
          selectedRackTileId: null,
          selectedPendingTileId: null,
          updatedAt: "2026-08-10T00:00:00.000Z",
        },
      },
    });

    expect(onState).not.toHaveBeenCalled();
    expect(onSession).toHaveBeenCalledWith(
      expect.objectContaining({ actionMode: "place_equation", activeSide: "A" }),
    );
    unsubscribe();
  });
});
