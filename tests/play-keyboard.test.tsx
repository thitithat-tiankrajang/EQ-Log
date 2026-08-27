// Typing tiles in a real game, against the real play screen.
//
// The decision logic is pure and tested exhaustively in rack-resolution and
// tile-keys. What can only be checked here is the WIRING: that a keystroke
// reaches the board, that it spends the tile the resolver chose, and that the
// player is told when it spent a blank.
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { createNewGame, type GameState, type TileInstance } from "../src/game";

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

vi.mock("../src/supabaseClient", () => ({ isSupabaseConfigured: true, supabase: {} }));

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

import App from "../src/App";

const ROOM_ID = "22222222-2222-4222-8222-222222222222";
const OWNER = "11111111-1111-4111-8111-111111111111";

/** Deal a known rack to the side on move, so a keystroke has a predictable
 *  answer. Everything else about the game is left alone. */
function gameWithRack(tokens: string[]): GameState {
  const game = createNewGame({
    ...DEFAULT_NEW_GAME_SETTINGS,
    name: "Keyboard room",
    playerA: "Owner",
    playerB: "Player B",
    tileDrawMode: "play",
  });
  // The tiles already dealt to A go BACK in the bag first. Replacing the rack
  // without returning them would leave those tiles in no location at all, and
  // the canonical projection refuses a game that does not describe the
  // hundred-tile set — which is a blank screen, not an error message.
  const bag = [...game.tilebag, ...game.rackA];
  const rack: TileInstance[] = tokens.map((token) => {
    const at = bag.findIndex((tile) => tile.token === token);
    if (at < 0) throw new Error(`no "${token}" left in the bag to deal`);
    return bag.splice(at, 1)[0]!;
  });
  return { ...game, tilebag: bag, rackA: rack, activeSide: "A" };
}

function payload(game: GameState) {
  return {
    game,
    meta: {
      id: ROOM_ID,
      ownerId: OWNER,
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

/** Open the room, put the cursor on the centre square, and hand back the view. */
async function openWithCursorAtCentre(game: GameState) {
  readRoom.mockResolvedValue(payload(game));
  const view = render(<App />);
  await waitFor(() => expect(realtimeHarness.statusHandler).toBeTypeOf("function"));
  realtimeHarness.statusHandler?.("SUBSCRIBED");

  // An empty container here means the room never reached the play view at all —
  // usually a game that does not describe the hundred-tile set, which the
  // canonical projection refuses by throwing rather than by rendering anything.
  const cells = await waitFor(() => {
    const found = view.container.querySelectorAll<HTMLButtonElement>(".board-cell");
    expect(found.length, "the board never rendered").toBe(15 * 15);
    return found;
  });
  fireEvent.click(cells[7 * 15 + 7]!);
  return { view, cells };
}

/** The face rendered on the single pending tile. */
function pendingFace(container: HTMLElement): string | null {
  const pending = container.querySelector(".board-cell.pending .tile b");
  return pending?.textContent ?? null;
}

describe("typing a tile in a game", () => {
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
    commitRoomState.mockReset().mockResolvedValue({ outcome: "committed", revision: 1 });
    realtimeHarness.statusHandler = undefined;
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.location.hash = `#/play/${ROOM_ID}`;
  });

  afterEach(() => vi.unstubAllGlobals());

  it("places the exact tile when the rack holds it", async () => {
    const { view } = await openWithCursorAtCentre(
      gameWithRack(["5", "1", "2", "3", "4", "6", "7", "8"]),
    );

    fireEvent.keyDown(window, { key: "5", code: "Digit5" });

    await waitFor(() => expect(pendingFace(view.container)).toBe("5"));
    view.unmount();
  });

  it("spends a blank when the rack cannot show the face any other way, and says so", async () => {
    // The case that was asked for: press 5 with no 5 in hand but a blank there.
    const { view } = await openWithCursorAtCentre(
      gameWithRack(["?", "1", "2", "3", "4", "6", "7", "8"]),
    );

    fireEvent.keyDown(window, { key: "5", code: "Digit5" });

    await waitFor(() => expect(pendingFace(view.container)).toBe("5"));
    // Spending a blank without noticing is the one way the prediction can cost
    // a player something, so it is never silent.
    expect(view.container.querySelector(".key-notice")?.textContent).toContain("Blank");
    view.unmount();
  });

  it("keeps the flexible tile when an exact one is in hand", async () => {
    // Rack holds BOTH `+` and `+/-`. The plain one is spent; the two-faced tile
    // stays for a square that needs it.
    const { view } = await openWithCursorAtCentre(
      gameWithRack(["+", "+/-", "1", "2", "3", "4", "5", "6"]),
    );

    fireEvent.keyDown(window, { key: "p", code: "KeyP" });

    await waitFor(() => expect(pendingFace(view.container)).toBe("+"));
    // A `+/-` played as `+` renders through the assigned-choice styling; the
    // plain tile does not.
    expect(view.container.querySelector(".board-cell.pending .tile.assigned-choice")).toBeNull();
    view.unmount();
  });

  it("never opens the assignment dialog for a typed tile", async () => {
    // The keystroke already named the face. Having to answer a dialog for it is
    // most of what made clicking slow.
    const { view } = await openWithCursorAtCentre(
      gameWithRack(["?", "1", "2", "3", "4", "6", "7", "8"]),
    );

    fireEvent.keyDown(window, { key: "b", code: "KeyB" });
    fireEvent.keyDown(window, { key: "7", code: "Digit7" });

    await waitFor(() => expect(pendingFace(view.container)).toBe("7"));
    expect(view.container.querySelector(".assignment-modal, [role='dialog']")).toBeNull();
    view.unmount();
  });

  it("re-aims with Space, so the next tile goes down instead of across", async () => {
    const { view } = await openWithCursorAtCentre(
      gameWithRack(["1", "2", "3", "4", "5", "6", "7", "8"]),
    );

    fireEvent.keyDown(window, { key: "1", code: "Digit1" });
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    fireEvent.keyDown(window, { key: "2", code: "Digit2" });
    fireEvent.keyDown(window, { key: "3", code: "Digit3" });

    await waitFor(() =>
      expect(view.container.querySelectorAll(".board-cell.pending")).toHaveLength(3),
    );
    // 1 at H8, cursor steps right to I8 where the 2 lands, then Space aims it
    // down so the 3 is directly below the 2 rather than beside it.
    const cells = [...view.container.querySelectorAll(".board-cell")];
    const at = (row: number, col: number) => cells[row * 15 + col]!;
    expect(at(7, 7).className).toContain("pending");
    expect(at(7, 8).className).toContain("pending");
    expect(at(8, 8).className).toContain("pending");
    view.unmount();
  });

  it("says so when nothing in hand can play the face", async () => {
    const { view } = await openWithCursorAtCentre(
      gameWithRack(["1", "2", "3", "4", "5", "6", "7", "8"]),
    );

    fireEvent.keyDown(window, { key: "=", code: "Equal" });

    await waitFor(() => expect(view.container.querySelector(".key-notice")).not.toBeNull());
    expect(view.container.querySelectorAll(".board-cell.pending")).toHaveLength(0);
    view.unmount();
  });
});
