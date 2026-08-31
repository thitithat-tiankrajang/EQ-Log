import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { createNewGame } from "../src/game";

const {
  listRooms,
  readRoom,
  realtimeHarness,
  subscribeToGameCommits,
  subscribeToRoom,
  commitRoomState,
} = vi.hoisted(() => {
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
    commitRoomState: vi.fn(),
  };
  return {
    listRooms: harness.listRooms,
    readRoom: harness.readRoom,
    realtimeHarness: harness,
    subscribeToGameCommits: harness.subscribeToGameCommits,
    subscribeToRoom: harness.subscribeToRoom,
    commitRoomState: harness.commitRoomState,
  };
});

const { requestBotMove, attachBotMove, listJobs } = vi.hoisted(() => ({
  requestBotMove: vi.fn(),
  attachBotMove: vi.fn(),
  listJobs: vi.fn(),
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
    commitRoomState,
  };
});

// Mocked at the HTTP boundary so the real `engineSessions` store runs. These
// tests are about what the APP does with a server lifecycle, and the store is
// what connects the two.
vi.mock("../src/bot/engineApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bot/engineApi")>();
  return { ...actual, requestBotMove, attachBotMove, listJobs, isEngineApiConfigured: true };
});

import App from "../src/App";
import { EngineApiError } from "../src/bot/engineApi";
import * as engineSessions from "../src/engineSessions";
import * as playSnapshotCache from "../src/playSnapshotCache";

const ROOM_ID = "22222222-2222-4222-8222-222222222222";

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
    commitRoomState.mockReset().mockResolvedValue({ outcome: "committed", revision: 1 });
    // A search that never settles, unless a test says otherwise.
    requestBotMove.mockReset().mockImplementation(() => new Promise<never>(() => undefined));
    attachBotMove.mockReset().mockResolvedValue({ kind: "idle" });
    listJobs.mockReset().mockResolvedValue([]);
    engineSessions.resetForTests();
    window.sessionStorage.clear();
    playSnapshotCache.forget(ROOM_ID);
    realtimeHarness.statusHandler = undefined;
    window.location.hash = `#/play/${ROOM_ID}`;
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

  /** The authoritative room payload for a bot game at `revision`. */
  function botPayload(game: ReturnType<typeof createNewGame>, ownerId: string) {
    return {
      game,
      meta: {
        id: ROOM_ID,
        ownerId,
        ownerName: "Owner",
        name: game.name,
        playerA: game.players.A,
        playerB: game.players.B,
        gameMode: "versus" as const,
        inviteUserAId: ownerId,
        startingSide: game.startingSide,
        turnNumber: game.turnNumber,
        scoreA: 0,
        scoreB: 0,
        status: "playing" as const,
        visibility: "public" as const,
        regionId: null,
        createdAt: game.createdAt,
        updatedAt: game.lastSavedAt,
      },
      session: {
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
      },
      needsCompaction: false,
      needsInviteRepair: false,
    };
  }

  const OWNER_ID = "11111111-1111-4111-8111-111111111111";

  /** The same room, but with the HUMAN on move, so nothing the bot does can be
   *  mistaken for the write under test. */
  function humanTurnGame(revision: number) {
    const initial = createNewGame({
      ...DEFAULT_NEW_GAME_SETTINGS,
      name: "Owner vs Aether",
      playerA: "Owner",
      playerB: "Aether",
      botSide: "B",
      startingSide: "A",
      tileDrawMode: "play",
    });
    return { ...initial, playerUserIds: { A: OWNER_ID }, revision };
  }

  function payloadForHumanTurn(game: ReturnType<typeof humanTurnGame>) {
    return botPayload(game as unknown as ReturnType<typeof botGame>, OWNER_ID);
  }

  function botGame(revision: number) {
    const initial = createNewGame({
      ...DEFAULT_NEW_GAME_SETTINGS,
      name: "Owner vs Aether",
      playerA: "Owner",
      playerB: "Aether",
      botSide: "B",
      startingSide: "B",
      tileDrawMode: "play",
    });
    return { ...initial, playerUserIds: { A: OWNER_ID }, revision };
  }

  it("starts Aether when the reserved human side is linked to the room owner", async () => {
    const game = botGame(0);
    readRoom.mockResolvedValue(botPayload(game, OWNER_ID));

    const view = render(<App />);

    await waitFor(() => expect(readRoom).toHaveBeenCalled());
    // Loaded from the authority, so the position is confirmed and the bot may
    // ask about it. It was NOT freshly admitted by this client, so it looks
    // before it leaps.
    await waitFor(() => expect(attachBotMove).toHaveBeenCalledTimes(1));
    view.unmount();
  });

  it("retries Aether after sync confirms a newer revision of the same turn", async () => {
    const revisionFive = botGame(5);
    const revisionSix = { ...revisionFive, revision: 6 };
    readRoom
      .mockResolvedValueOnce(botPayload(revisionFive, OWNER_ID))
      .mockResolvedValueOnce(botPayload(revisionSix, OWNER_ID));
    attachBotMove.mockImplementation(async (options: { expectedRevision: number }) =>
      options.expectedRevision === 5
        ? Promise.reject(new EngineApiError("stale_revision", "moved on"))
        : new Promise<never>(() => undefined),
    );

    const view = render(<App />);

    await waitFor(() => expect(attachBotMove).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(realtimeHarness.statusHandler).toBeTypeOf("function"));
    realtimeHarness.statusHandler?.("SUBSCRIBED");
    await waitFor(() => expect(readRoom).toHaveBeenCalledTimes(2));

    await waitFor(() => expect(attachBotMove).toHaveBeenCalledTimes(2));
    expect(attachBotMove.mock.calls[1]?.[0]).toMatchObject({ expectedRevision: 6 });
    view.unmount();
  });

  it("does not wipe a live bot search while room ownership is still unresolved", async () => {
    // THE regression. A snapshot-seeded mount paints the board instantly, but
    // `activeRoomMeta` — and with it ownership — arrives a round trip later.
    // Until it does, every capability flag reads "spectator", and the teardown
    // used to take that as "the bot's turn is over" and delete the progress the
    // player came back to look at. Absence of information is not an answer.
    const game = botGame(5);
    playSnapshotCache.remember(ROOM_ID, game);
    window.sessionStorage.setItem(
      `eq-lab:engine-session:v1:${ROOM_ID}`,
      JSON.stringify([
        {
          key: `bot:${ROOM_ID}:5`,
          kind: "bot",
          roomId: ROOM_ID,
          revision: 5,
          progress: {
            phase: "sim",
            percent: 50,
            elapsedMs: 5_000,
            etaMs: 5_000,
            detail: "samples=2/4",
          },
          startedAt: Date.now(),
        },
      ]),
    );
    listJobs.mockResolvedValue([
      {
        kind: "bot",
        difficulty: "medium",
        status: "running",
        progress: {
          phase: "sim",
          percent: 50,
          elapsedMs: 5_000,
          etaMs: 5_000,
          detail: "samples=2/4",
        },
      },
    ]);
    attachBotMove.mockImplementation(() => new Promise<never>(() => undefined));
    // Metadata never arrives during this test: ownership stays unresolved for
    // its whole duration, which is the worst case the old code failed on.
    readRoom.mockImplementation(() => new Promise(() => undefined));

    const view = render(<App />);

    // The remembered percentage is still there — not deleted, not replaced by a
    // fresh "requesting", not 0%.
    // `getAllBy`: the bar is drawn in the action slot, and the shell renders
    // that slot once per layout (CSS hides the one that does not apply).
    await waitFor(() => expect(view.getAllByText(/50%/)).not.toHaveLength(0));
    expect(
      JSON.parse(window.sessionStorage.getItem(`eq-lab:engine-session:v1:${ROOM_ID}`) ?? "[]"),
    ).toHaveLength(1);
    view.unmount();
  });

  it("never asks the engine about a position the server has not confirmed", async () => {
    // The unconfirmed-revision race, in the shape that actually reaches
    // production: the board is on screen (from the snapshot seed) and says it is
    // the bot's turn, but nothing has been read back from the server yet, so
    // `revision` may name a position the server does not hold. Asking then
    // returned `turn_rule` — which used to fall through to a PASS and hand the
    // bot's turn away over a timing accident.
    const game = botGame(5);
    playSnapshotCache.remember(ROOM_ID, game);
    readRoom.mockImplementation(() => new Promise(() => undefined));

    const view = render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Not a request of any kind: not a start, and not a discovery attach.
    expect(requestBotMove).not.toHaveBeenCalled();
    expect(attachBotMove).not.toHaveBeenCalled();
    view.unmount();
  });

  it("does not commit a cached snapshot back as a new revision", async () => {
    // A phantom revision is not a harmless extra write. The revision is the
    // identity every engine job is keyed on, so minting one retires the analysis
    // or bot search in flight — silently, while the server goes on computing an
    // answer that can no longer be delivered and the player's budget stays
    // spent. The player sees the Analyze button back and nothing explaining it.
    //
    // The mount that did this is the one that renders a CACHED snapshot: the
    // "last applied" key started empty, which looks exactly like "the player
    // changed something, push it". Every snapshot in that cache came from the
    // authority, so there is nothing to push.
    const game = humanTurnGame(5);
    playSnapshotCache.remember(ROOM_ID, game);
    readRoom.mockResolvedValue(payloadForHumanTurn(game));

    const view = render(<App />);
    await waitFor(() => expect(readRoom).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(commitRoomState).not.toHaveBeenCalled();
    view.unmount();
  });

  it("does not pass the bot's turn when the engine refuses on a turn rule", async () => {
    // `turn_rule` is a disagreement about the position, not a verdict on the
    // move. A pass is scoring and irreversible; nothing but the engine choosing
    // one may play one.
    const game = botGame(5);
    readRoom.mockResolvedValue(botPayload(game, OWNER_ID));
    attachBotMove.mockRejectedValue(
      new EngineApiError("turn_rule", "It is not the engine's turn."),
    );

    const view = render(<App />);
    await waitFor(() => expect(attachBotMove).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));

    // No move was written for the bot — no pass, nothing.
    const passes = commitRoomState.mock.calls.filter((call) => {
      const committed = (call[0] as { game?: { logs?: Array<{ action: string }> } }).game;
      return committed?.logs?.some((log) => log.action === "pass");
    });
    expect(passes).toHaveLength(0);
    view.unmount();
  });
});
