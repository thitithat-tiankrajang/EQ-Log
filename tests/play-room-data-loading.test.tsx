import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { createNewGame } from "../src/game";

const { listRooms, readRoom, realtimeHarness, subscribeToGameCommits, subscribeToRoom } =
  vi.hoisted(() => {
    const harness = {
      listRooms: vi.fn(),
      readRoom: vi.fn(),
      statusHandler: undefined as ((status: "SUBSCRIBED") => void) | undefined,
      commitHandler: undefined as ((commit: unknown) => void) | undefined,
      subscribeToRoom: vi.fn(
        (
          _id: string,
          _onState: unknown,
          _onSession: unknown,
          onStatus?: (status: "SUBSCRIBED") => void,
        ) => {
          harness.statusHandler = onStatus;
          return () => undefined;
        },
      ),
      subscribeToGameCommits: vi.fn((_id: string, onCommit: (commit: unknown) => void) => {
        harness.commitHandler = onCommit;
        return () => undefined;
      }),
    };
    return {
      listRooms: harness.listRooms,
      readRoom: harness.readRoom,
      realtimeHarness: harness,
      subscribeToGameCommits: harness.subscribeToGameCommits,
      subscribeToRoom: harness.subscribeToRoom,
    };
  });

const { thinkWithBot, warmUpBotEngine } = vi.hoisted(() => ({
  thinkWithBot: vi.fn(() => ({
    promise: new Promise<never>(() => undefined),
    cancel: vi.fn(),
  })),
  warmUpBotEngine: vi.fn(),
}));

vi.mock("../src/auth", () => ({
  useAuth: () => ({
    configured: true,
    isApproved: true,
    profile: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.test",
      display_name: "Owner",
      status: "approved",
      is_admin: false,
      region_id: null,
      region_name: null,
    },
    userId: "11111111-1111-4111-8111-111111111111",
  }),
}));

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {},
}));

vi.mock("../src/remoteRooms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/remoteRooms")>();
  return {
    ...actual,
    listRooms,
    readRoom,
    subscribeToGameCommits,
    subscribeToRoom,
  };
});

vi.mock("../src/bot/botController", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bot/botController")>();
  return { ...actual, thinkWithBot, warmUpBotEngine };
});

import App from "../src/App";

describe("play route data loading", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    listRooms.mockReset().mockResolvedValue([]);
    readRoom.mockReset();
    subscribeToRoom.mockClear();
    subscribeToGameCommits.mockClear();
    thinkWithBot.mockClear();
    warmUpBotEngine.mockClear();
    realtimeHarness.statusHandler = undefined;
    window.location.hash = "#/play/22222222-2222-4222-8222-222222222222";
  });

  it("does not replace the opened room's full metadata with a lobby summary", async () => {
    const game = createNewGame({
      ...DEFAULT_NEW_GAME_SETTINGS,
      name: "Active room",
      playerA: "Owner",
      playerB: "Player B",
      tileDrawMode: "play",
    });
    readRoom.mockResolvedValue({
      game,
      meta: {
        id: "22222222-2222-4222-8222-222222222222",
        ownerId: "11111111-1111-4111-8111-111111111111",
        ownerName: "Owner",
        name: game.name,
        playerA: game.players.A,
        playerB: game.players.B,
        gameMode: "versus",
        startingSide: game.startingSide,
        turnNumber: game.turnNumber,
        scoreA: 0,
        scoreB: 0,
        status: "playing",
        visibility: "public",
        regionId: null,
        createdAt: game.createdAt,
        updatedAt: game.lastSavedAt,
      },
      session: {
        version: 1,
        actorId: null,
        gameId: null,
        turnNumber: null,
        activeSide: null,
        actionMode: "none",
        pendingPlacements: [],
        exchangeDraft: { outgoingIds: [], incomingTiles: [] },
        selectedRackTileId: null,
        selectedPendingTileId: null,
        updatedAt: game.lastSavedAt,
      },
      needsCompaction: false,
      needsInviteRepair: false,
    });

    const view = render(<App />);

    await waitFor(() => expect(readRoom).toHaveBeenCalled());
    expect(listRooms).not.toHaveBeenCalled();
    view.unmount();
  });

  it("reconciles the latest live draft after the realtime channel reconnects", async () => {
    const game = createNewGame({
      ...DEFAULT_NEW_GAME_SETTINGS,
      name: "Spectator room",
      playerA: "Player A",
      playerB: "Player B",
      tileDrawMode: "play",
    });
    const meta = {
      id: "22222222-2222-4222-8222-222222222222",
      ownerId: "11111111-1111-4111-8111-111111111111",
      ownerName: "Owner",
      name: game.name,
      playerA: game.players.A,
      playerB: game.players.B,
      gameMode: "versus" as const,
      startingSide: game.startingSide,
      turnNumber: game.turnNumber,
      scoreA: 0,
      scoreB: 0,
      status: "playing" as const,
      visibility: "public" as const,
      regionId: null,
      createdAt: game.createdAt,
      updatedAt: game.lastSavedAt,
    };
    const emptySession = {
      version: 1 as const,
      actorId: null,
      gameId: null,
      turnNumber: null,
      activeSide: null,
      actionMode: "none" as const,
      pendingPlacements: [],
      exchangeDraft: { outgoingIds: [], incomingTiles: [] },
      selectedRackTileId: null,
      selectedPendingTileId: null,
      updatedAt: game.lastSavedAt,
    };
    const pendingTile = game.rackA[0];
    const draftSession = {
      ...emptySession,
      actorId: "33333333-3333-4333-8333-333333333333",
      gameId: game.gameId,
      turnNumber: game.turnNumber,
      activeSide: game.activeSide,
      actionMode: "place_equation" as const,
      pendingPlacements: [
        {
          tile: pendingTile,
          row: 7,
          col: 7,
          rackSlot: 0,
        },
      ],
      updatedAt: new Date(Date.parse(game.lastSavedAt) + 1_000).toISOString(),
    };
    readRoom
      .mockResolvedValueOnce({
        game,
        meta,
        session: emptySession,
        needsCompaction: false,
        needsInviteRepair: false,
      })
      .mockResolvedValueOnce({
        game,
        meta,
        session: draftSession,
        needsCompaction: false,
        needsInviteRepair: false,
      });

    const view = render(<App />);
    await waitFor(() => expect(realtimeHarness.statusHandler).toBeTypeOf("function"));

    realtimeHarness.statusHandler?.("SUBSCRIBED");

    await waitFor(() => {
      expect(view.container.querySelectorAll(".board-cell.pending")).toHaveLength(1);
    });
    view.unmount();
  });

  it("starts Aether when the reserved human side is linked to the room owner", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const initial = createNewGame({
      ...DEFAULT_NEW_GAME_SETTINGS,
      name: "Owner vs Aether",
      playerA: "Owner",
      playerB: "Aether",
      botSide: "B",
      startingSide: "B",
      tileDrawMode: "play",
    });
    const game = { ...initial, playerUserIds: { A: ownerId } };
    readRoom.mockResolvedValue({
      game,
      meta: {
        id: "22222222-2222-4222-8222-222222222222",
        ownerId,
        ownerName: "Owner",
        name: game.name,
        playerA: game.players.A,
        playerB: game.players.B,
        gameMode: "versus",
        inviteUserAId: ownerId,
        startingSide: game.startingSide,
        turnNumber: game.turnNumber,
        scoreA: 0,
        scoreB: 0,
        status: "playing",
        visibility: "public",
        regionId: null,
        createdAt: game.createdAt,
        updatedAt: game.lastSavedAt,
      },
      session: {
        version: 1,
        actorId: null,
        gameId: null,
        turnNumber: null,
        activeSide: null,
        actionMode: "none",
        pendingPlacements: [],
        exchangeDraft: { outgoingIds: [], incomingTiles: [] },
        selectedRackTileId: null,
        selectedPendingTileId: null,
        updatedAt: game.lastSavedAt,
      },
      needsCompaction: false,
      needsInviteRepair: false,
    });

    const view = render(<App />);

    await waitFor(() => expect(readRoom).toHaveBeenCalled());
    await waitFor(() => expect(thinkWithBot).toHaveBeenCalledTimes(1));
    view.unmount();
  });
});
