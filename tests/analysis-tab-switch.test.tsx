// Switching to another tab and straight back must not lose a running analysis.
//
// Every earlier test of this drove the panel on its own. Coming back fires a
// WAKE in the shell, and the wake does several things the panel never sees — it
// advances the clock, bumps the subscription epoch, rebuilds the realtime
// channel, and re-reads the room row. So this mounts the real App and fires the
// real browser events.
//
// HONEST LIMIT, so nobody reads more into a green run than is there: this does
// NOT reproduce the bug a player reported against this exact gesture. It passes
// on the code from before the reconnect fixes as much as after, which means the
// mechanism is something this harness does not model — the engine transport is a
// pending promise here, where in the browser it is a live fetch stream. What
// this pins is that the shell's wake cascade on its own does not retire a
// session, so a future regression there would be caught.
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { createNewGame } from "../src/game";

const { listRooms, readRoom, realtimeHarness, subscribeToGameCommits, subscribeToRoom } =
  vi.hoisted(() => {
    const harness = {
      listRooms: vi.fn(),
      readRoom: vi.fn(),
      statusHandler: undefined as ((status: "SUBSCRIBED") => void) | undefined,
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
      subscribeToGameCommits: vi.fn(() => () => undefined),
    };
    return {
      listRooms: harness.listRooms,
      readRoom: harness.readRoom,
      realtimeHarness: harness,
      subscribeToGameCommits: harness.subscribeToGameCommits,
      subscribeToRoom: harness.subscribeToRoom,
    };
  });

const { requestAnalysis, attachAnalysis, listJobs } = vi.hoisted(() => ({
  requestAnalysis: vi.fn(),
  attachAnalysis: vi.fn(),
  listJobs: vi.fn(),
}));

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const ROOM_ID = "22222222-2222-4222-8222-222222222222";

vi.mock("../src/auth", () => ({
  useAuth: () => ({
    configured: true,
    isApproved: true,
    profile: {
      id: OWNER_ID,
      email: "owner@example.test",
      display_name: "Owner",
      status: "approved",
      is_admin: false,
      region_id: null,
      region_name: null,
    },
    userId: OWNER_ID,
  }),
}));

vi.mock("../src/supabaseClient", () => ({ isSupabaseConfigured: true, supabase: {} }));

vi.mock("../src/remoteRooms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/remoteRooms")>();
  return { ...actual, listRooms, readRoom, subscribeToGameCommits, subscribeToRoom };
});

vi.mock("../src/bot/engineApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bot/engineApi")>();
  return { ...actual, requestAnalysis, attachAnalysis, listJobs, isEngineApiConfigured: true };
});

import App from "../src/App";
import type { EngineProgress } from "../src/bot/engineApi";
import * as engineSessions from "../src/engineSessions";
import * as playSnapshotCache from "../src/playSnapshotCache";

/** A game where the HUMAN is on move, so Analyze is offered. */
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

function payloadFor(game: ReturnType<typeof humanTurnGame>) {
  return {
    game,
    meta: {
      id: ROOM_ID,
      ownerId: OWNER_ID,
      ownerName: "Owner",
      name: game.name,
      playerA: game.players.A,
      playerB: game.players.B,
      gameMode: "versus" as const,
      inviteUserAId: OWNER_ID,
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

/** Leave for another tab and come straight back, exactly as Chrome reports it. */
async function switchTabAndReturn() {
  const visibility = (state: DocumentVisibilityState) =>
    Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  await act(async () => {
    visibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("blur"));
    await Promise.resolve();
  });
  await act(async () => {
    visibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
  });
}

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
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  listRooms.mockReset().mockResolvedValue([]);
  readRoom.mockReset();
  subscribeToRoom.mockClear();
  subscribeToGameCommits.mockClear();
  requestAnalysis.mockReset().mockImplementation(() => new Promise<never>(() => undefined));
  attachAnalysis.mockReset().mockResolvedValue({ kind: "idle" });
  listJobs.mockReset().mockResolvedValue([]);
  engineSessions.resetForTests();
  window.sessionStorage.clear();
  playSnapshotCache.forget(ROOM_ID);
  realtimeHarness.statusHandler = undefined;
  window.location.hash = `#/play/${ROOM_ID}`;
});

describe("leaving for another tab mid-analysis", () => {
  it("still shows the running bar, at its real percentage, on return", async () => {
    const game = humanTurnGame(5);
    readRoom.mockResolvedValue(payloadFor(game));
    let report!: (progress: EngineProgress) => void;
    requestAnalysis.mockImplementation(
      (options: { onProgress?: (progress: EngineProgress) => void }) =>
        new Promise<never>(() => {
          report = options.onProgress!;
        }),
    );

    const view = render(<App />);
    await waitFor(() => expect(readRoom).toHaveBeenCalled());

    const analyze = await screen.findByRole("button", { name: /วิเคราะห์ตานี้/ });
    await userEvent.click(analyze);
    await userEvent.click(screen.getByRole("button", { name: /เร็ว/ }));
    await waitFor(() => expect(requestAnalysis).toHaveBeenCalledTimes(1));

    await act(async () => {
      report({ phase: "sim", percent: 42, elapsedMs: 2_000, etaMs: 3_000, detail: "samples=2/4" });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText(/42%/)).toBeInTheDocument());

    // Away to another tab, and straight back.
    await switchTabAndReturn();

    // The search never stopped, so the bar must still be here — and showing the
    // number it had reached, not a fresh 0%.
    expect(engineSessions.analysisFor(ROOM_ID, 5)).toBeDefined();
    expect(screen.getByText(/42%/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /วิเคราะห์ตานี้/ })).not.toBeInTheDocument();
    // And no second search was started for a position already being searched.
    expect(requestAnalysis).toHaveBeenCalledTimes(1);

    // Progress that arrives after the return still lands on screen.
    await act(async () => {
      report({ phase: "sim", percent: 77, elapsedMs: 4_000, etaMs: 1_000, detail: "samples=3/4" });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText(/77%/)).toBeInTheDocument());
    view.unmount();
  });
});
