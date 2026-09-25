// Branching through the whole app, against a mocked Supabase.
//
// The model is proven in multiverse.test.ts and the SQL in the smoke test. What only the app can
// get wrong is the WIRING: that a branch goes out as one timeline commit and never also as an
// ordinary state write, that another device loads the lines a position names, and that a
// refused branch leaves the game as the server has it.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameState } from "../src/game";
import { withRevision } from "../src/gameSync";
import { continueFrom, EMPTY_MULTIVERSE } from "../src/gameplay/multiverse";
import { encodeMultiverse } from "../src/gameplay/multiverseCodec";
import { newGame, playTurns } from "./helpers/simulateGame";

const mocks = vi.hoisted(() => ({
  listRooms: vi.fn(),
  readRoom: vi.fn(),
  subscribeToRoom: vi.fn(() => () => undefined),
  subscribeToGameCommits: vi.fn(() => () => undefined),
  commitRoomState: vi.fn(),
  updateRoomSession: vi.fn(),
  readGameSnapshot: vi.fn(),
  readTimeline: vi.fn(),
  commitTimelineChange: vi.fn(),
  pruneTimeline: vi.fn(),
}));

vi.mock("../src/auth", () => ({
  AccountChip: () => null,
  AdminButton: () => null,
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

vi.mock("../src/supabaseClient", () => ({ isSupabaseConfigured: true, supabase: {} }));

vi.mock("../src/remoteRooms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/remoteRooms")>();
  return { ...actual, ...mocks };
});

vi.mock("../src/bot/engineApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bot/engineApi")>();
  return { ...actual, isEngineApiConfigured: false };
});

import App from "../src/App";
import * as timelineStore from "../src/timelineStore";
import * as playSnapshotCache from "../src/playSnapshotCache";

const ROOM_ID = "44444444-4444-4444-8444-444444444444";

function payload(game: GameState) {
  return {
    game,
    meta: {
      id: ROOM_ID,
      ownerId: "11111111-1111-4111-8111-111111111111",
      ownerName: "Owner",
      name: game.name,
      playerA: game.players.A,
      playerB: game.players.B,
      gameMode: "versus" as const,
      startingSide: game.startingSide,
      turnNumber: game.turnNumber,
      scoreA: game.scores.A,
      scoreB: game.scores.B,
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

function logRail() {
  return document.querySelector(".log-rail") as HTMLElement;
}

function row(turn: number) {
  return within(logRail())
    .getAllByRole("button")
    .find(
      (button) =>
        button.classList.contains("turn-record-summary") &&
        button.textContent?.startsWith(`T${turn}`),
    )!;
}

describe("branching in a live room", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.listRooms.mockResolvedValue([]);
    mocks.subscribeToRoom.mockReturnValue(() => undefined);
    mocks.subscribeToGameCommits.mockReturnValue(() => undefined);
    mocks.commitRoomState.mockResolvedValue({ outcome: "committed", revision: 1 });
    mocks.updateRoomSession.mockResolvedValue(undefined);
    mocks.readTimeline.mockResolvedValue(null);
    timelineStore.forgetTimeline(ROOM_ID);
    playSnapshotCache.forget(ROOM_ID);
    window.sessionStorage.clear();
    window.location.hash = `#/play/${ROOM_ID}`;
  });

  it("sends a branch as one timeline commit, and never also as an ordinary write", async () => {
    const game = withRevision(playTurns(newGame("play"), 6), 7) as GameState;
    mocks.readRoom.mockResolvedValue(payload(game));
    mocks.commitTimelineChange.mockResolvedValue({
      outcome: "committed",
      revision: 8,
      timelineVersion: 1,
    });

    const view = render(<App />);
    try {
      await waitFor(() => expect(row(6)).toBeDefined());
      // A game that never branched asks for no parked lines at all.
      expect(mocks.readTimeline).not.toHaveBeenCalled();

      fireEvent.click(row(3));
      const cont = await within(logRail()).findByRole("button", { name: /เล่นต่อจากตรงนี้/ });
      fireEvent.click(cont);

      await waitFor(() => expect(mocks.commitTimelineChange).toHaveBeenCalledTimes(1));
      const sent = mocks.commitTimelineChange.mock.calls[0]![0] as {
        id: string;
        game: GameState;
        expectedRevision: number;
        expectedTimelineVersion: number;
        timeline: { version: number; lines: { from: string; logs: unknown[] }[] };
      };
      expect(sent.id).toBe(ROOM_ID);
      expect(sent.expectedRevision).toBe(7);
      expect(sent.expectedTimelineVersion).toBe(0);
      expect(sent.game.logs.map((log) => log.id)).toEqual(
        game.logs.slice(0, 3).map((log) => log.id),
      );
      expect(sent.game.timelineRef).toEqual({ version: 1, lines: 1 });
      expect(sent.timeline.version).toBe(1);
      expect(sent.timeline.lines).toHaveLength(1);
      expect(sent.timeline.lines[0]!.from).toBe(game.logs[2]!.id);
      expect(sent.timeline.lines[0]!.logs).toHaveLength(3);

      // The parked turns are one tap away, right where the live line now ends.
      expect(
        await within(logRail()).findByText("มีเส้นทางที่เดินต่อจากตรงนี้"),
      ).toBeInTheDocument();
      // The ordinary sync path left that position alone: it went out with its lines or not at all.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(
        mocks.commitRoomState.mock.calls.some(
          ([args]) => (args as { game: GameState }).game.logs.length === 3,
        ),
      ).toBe(false);
    } finally {
      view.unmount();
    }
  });

  it("loads the lines a position names, and shows where another move was tried", async () => {
    const played = playTurns(newGame("play"), 6);
    const away = continueFrom(played, EMPTY_MULTIVERSE, {
      nodeId: played.logs[1]!.id,
      phase: "after",
    });
    if (!away.ok) throw new Error(away.reason);
    const game = withRevision(away.game, 9) as GameState;
    mocks.readRoom.mockResolvedValue(payload(game));
    mocks.readTimeline.mockResolvedValue({ version: 1, doc: encodeMultiverse(away.multiverse) });

    const view = render(<App />);
    try {
      await waitFor(() => expect(mocks.readTimeline).toHaveBeenCalledWith(ROOM_ID));
      expect(mocks.readTimeline).toHaveBeenCalledTimes(1);
      expect(
        await within(logRail()).findByText("มีเส้นทางที่เดินต่อจากตรงนี้"),
      ).toBeInTheDocument();
      // Standing where the lines part, with nothing played from here yet: still one line.
      expect(
        within(logRail()).getByRole("button", { name: "เปิด Turn Log Map" }),
      ).toBeInTheDocument();
    } finally {
      view.unmount();
    }
  });

  it("drops a refused branch and takes the game back from the server", async () => {
    const game = withRevision(playTurns(newGame("play"), 5), 4) as GameState;
    mocks.readRoom.mockResolvedValue(payload(game));
    mocks.commitTimelineChange.mockResolvedValue({
      outcome: "conflict",
      revision: 5,
      timelineVersion: 0,
    });

    const view = render(<App />);
    try {
      await waitFor(() => expect(row(5)).toBeDefined());
      const readsBefore = mocks.readRoom.mock.calls.length;
      fireEvent.click(row(2));
      fireEvent.click(await within(logRail()).findByRole("button", { name: /เล่นต่อจากตรงนี้/ }));

      await waitFor(() => expect(mocks.commitTimelineChange).toHaveBeenCalledTimes(1));
      // Rolled back: re-read from the authority, whole line back in place, nothing parked.
      await waitFor(() => expect(mocks.readRoom.mock.calls.length).toBeGreaterThan(readsBefore));
      await waitFor(() => expect(row(5)).toBeDefined());
      expect(timelineStore.getTimeline(ROOM_ID).multiverse.lines).toEqual([]);
      expect(screen.queryByText("มีเส้นทางที่เดินต่อจากตรงนี้")).not.toBeInTheDocument();
    } finally {
      view.unmount();
    }
  });
});
