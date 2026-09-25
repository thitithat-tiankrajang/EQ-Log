// The end of a game, as the player sees it.
//
// Two failures lived here. When the BOT played the game-ending move the turn was never handed
// over — a finished game has nobody to hand it to — so the bot stayed "on move" and the board
// showed it thinking about a game that was already over. And every revision, including the one
// that finished the game, asked the engine what was running for it; a finished game has no live
// row, so the engine answered 404 and the console filled with errors.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameState } from "../src/game";
import { withRevision } from "../src/gameSync";
import { newGame, pass, place } from "./helpers/simulateGame";

const mocks = vi.hoisted(() => ({
  listRooms: vi.fn(),
  readRoom: vi.fn(),
  subscribeToRoom: vi.fn(() => () => undefined),
  subscribeToGameCommits: vi.fn(() => () => undefined),
  commitRoomState: vi.fn(),
  updateRoomSession: vi.fn(),
  readGameSnapshot: vi.fn(),
  readTimeline: vi.fn(),
}));

const engine = vi.hoisted(() => ({
  requestBotMove: vi.fn(),
  attachBotMove: vi.fn(),
  listJobs: vi.fn(),
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
  return { ...actual, ...engine, isEngineApiConfigured: true };
});

import App from "../src/App";
import * as engineSessions from "../src/engineSessions";
import * as playSnapshotCache from "../src/playSnapshotCache";

const ROOM_ID = "55555555-5555-4555-8555-555555555555";

/** A bot game one scoreless turn from its end, with the bot (B) on move. */
function botToEndIt(): GameState {
  let game = newGame("play");
  game = { ...game, botSide: "B", botDifficulty: "medium", botEngine: "aether" };
  game = place(place(game, 2), 2);
  for (let turn = 0; turn < 5; turn += 1) game = pass(game);
  return withRevision(game, 12) as GameState;
}

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

/** What the finished game's archive answers with once the live row is gone. */
function archivedPayload(game: GameState) {
  const live = payload(game);
  return {
    ...live,
    // Carries the owner (tests/archive-read-owner.test.ts pins that the read asks for it); only
    // what an archive row genuinely lacks is missing.
    meta: { ...live.meta, ownerName: null, status: "finished" as const },
  };
}

describe("a game the bot ends", () => {
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
    for (const mock of [...Object.values(mocks), ...Object.values(engine)]) mock.mockReset();
    mocks.listRooms.mockResolvedValue([]);
    mocks.subscribeToRoom.mockReturnValue(() => undefined);
    mocks.subscribeToGameCommits.mockReturnValue(() => undefined);
    mocks.updateRoomSession.mockResolvedValue(undefined);
    engine.attachBotMove.mockResolvedValue({ kind: "idle" });
    engine.listJobs.mockResolvedValue([]);
    engineSessions.resetForTests();
    playSnapshotCache.forget(ROOM_ID);
    window.sessionStorage.clear();
    window.location.hash = `#/play/${ROOM_ID}`;
  });

  it("stops showing the bot as thinking once its move has ended the game", async () => {
    const game = botToEndIt();
    mocks.readRoom.mockResolvedValue(payload(game));
    mocks.commitRoomState.mockResolvedValue({ outcome: "committed", revision: 13 });
    engine.requestBotMove.mockResolvedValue({
      revision: 12,
      gameId: ROOM_ID,
      side: "B",
      move: { type: "pass", placements: [], exchange: [], score: 0 },
      solver: "greedy",
      endgameSolved: false,
      stats: { elapsedMs: 5, nodes: 1, samples: 0 },
    });

    const view = render(<App />);
    try {
      // The bot moves, and its pass is the sixth scoreless turn: the game is over.
      await waitFor(
        () =>
          expect(
            mocks.commitRoomState.mock.calls.some(
              ([args]) => (args as { game: GameState }).game.status === "finished",
            ),
          ).toBe(true),
        { timeout: 5_000 },
      );
      await waitFor(() => expect(screen.getAllByText(/จบเกม/).length).toBeGreaterThan(0));
      // Nothing may say the bot is still at work.
      expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument();
      expect(document.querySelector(".bot-thinking-note")).toBeNull();
      expect(document.body.textContent).not.toMatch(/กำลังคิด|บอทกำลังเดิน|ลองอีกครั้ง/);
      // And nobody asks the engine about a game that no longer has a live row.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(engine.listJobs.mock.calls.every(([options]) => options.revision !== 13)).toBe(true);
    } finally {
      view.unmount();
    }
  });

  it("stays the owner's board, and does not reopen a closed result, when the game is archived", async () => {
    const game = botToEndIt();
    mocks.readRoom.mockResolvedValue(payload(game));
    mocks.commitRoomState.mockResolvedValue({ outcome: "committed", revision: 13 });
    let onState: ((event: unknown) => void) | undefined;
    mocks.subscribeToRoom.mockImplementation((_id: string, handler: (event: unknown) => void) => {
      onState = handler;
      return () => undefined;
    });
    engine.requestBotMove.mockResolvedValue({
      revision: 12,
      gameId: ROOM_ID,
      side: "B",
      move: { type: "pass", placements: [], exchange: [], score: 0 },
      solver: "greedy",
      endgameSolved: false,
      stats: { elapsedMs: 5, nodes: 1, samples: 0 },
    });

    // Count every time the result dialog enters the page: once is smooth, more is a flicker.
    let resultMounts = 0;
    const watcher = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (
            node instanceof HTMLElement &&
            (node.matches(".result-modal") || node.querySelector(".result-modal"))
          ) {
            resultMounts += 1;
          }
        }
      }
    });
    watcher.observe(document.body, { childList: true, subtree: true });
    const view = render(<App />);
    try {
      await waitFor(() => expect(screen.getByText("Final Result")).toBeInTheDocument());

      const role = () => document.querySelector(".role-badge")?.textContent;
      const ownerRole = role();
      // The player reads the result and closes it.
      fireEvent.click(screen.getByRole("button", { name: /close/i }));
      await waitFor(() => expect(screen.queryByText("Final Result")).not.toBeInTheDocument());

      // Finalizing deletes the live row; Realtime reports it; the app reads the archive.
      const finished = mocks.commitRoomState.mock.calls
        .map(([args]) => (args as { game: GameState }).game)
        .find((candidate) => candidate.status === "finished")!;
      mocks.readRoom.mockResolvedValue(archivedPayload(withRevision(finished, 13) as GameState));
      onState!({ eventType: "DELETE", old: { id: ROOM_ID }, new: {} });
      await waitFor(() => expect(mocks.readRoom).toHaveBeenCalledTimes(2));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(role()).toBe(ownerRole);
      expect(screen.queryByText("Final Result")).not.toBeInTheDocument();
      // Shown once, when the game ended — never torn down and rebuilt along the way.
      expect(resultMounts).toBe(1);
    } finally {
      watcher.disconnect();
      view.unmount();
    }
  });

  it("does not bounce back to the unfinished game while the server is still archiving it", async () => {
    const game = botToEndIt();
    const live = payload(game);
    mocks.readRoom.mockResolvedValue(live);
    // Archiving takes a moment on the server. Until it commits, the room still reads as the live
    // row from BEFORE the finishing move — exactly what a reader that asks too early gets back.
    let archive!: () => void;
    mocks.commitRoomState.mockImplementation(
      () =>
        new Promise((resolve) => {
          archive = () => resolve({ outcome: "committed", revision: 13 });
        }),
    );
    // A realtime channel reports itself connected as soon as it is opened.
    mocks.subscribeToGameCommits.mockImplementation(
      (_id: string, _onCommit: unknown, onStatus?: (status: "SUBSCRIBED") => void) => {
        queueMicrotask(() => onStatus?.("SUBSCRIBED"));
        return () => undefined;
      },
    );
    engine.requestBotMove.mockResolvedValue({
      revision: 12,
      gameId: ROOM_ID,
      side: "B",
      move: { type: "pass", placements: [], exchange: [], score: 0 },
      solver: "greedy",
      endgameSolved: false,
      stats: { elapsedMs: 5, nodes: 1, samples: 0 },
    });

    const frames: string[] = [];
    const view = render(<App />);
    // Finished (the top bar offers Result) and whether the result is on screen. The "saving…"
    // note while the server archives is not a change of state and is left out on purpose.
    const sample = () => {
      const finished = Boolean(document.querySelector('.top-actions button[aria-label="Result"]'));
      const now = `${finished ? "finished" : "playing"}|${Boolean(document.querySelector(".result-modal"))}`;
      if (frames.at(-1) !== now) frames.push(now);
    };
    const sampler = setInterval(sample, 5);
    try {
      await waitFor(() => expect(screen.getByText("Final Result")).toBeInTheDocument());
      await new Promise((resolve) => setTimeout(resolve, 150));
      archive();
      await new Promise((resolve) => setTimeout(resolve, 150));
      sample();
      // Once the game has ended on screen it stays ended: no frame goes back to play.
      const firstFinished = frames.findIndex((frame) => frame === "finished|true");
      expect(firstFinished).toBeGreaterThan(-1);
      expect(frames.slice(firstFinished)).toEqual([frames[firstFinished]]);
    } finally {
      clearInterval(sampler);
      view.unmount();
    }
  });
});
