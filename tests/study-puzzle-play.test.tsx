import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionPanel } from "../src/components/actions/ActionPanel";
import type { PlayerPuzzle } from "../src/features/studyPuzzles/api";
import {
  parseStudyPuzzleRoomId,
  studyPlacementsFromLog,
  studyPuzzleGame,
  studyPuzzleRoomId,
  studyTilebagView,
} from "../src/features/studyPuzzles/play";
import type { TurnLog } from "../src/game";
import { parseHash, routeToHash } from "../src/router";
// Real output of tools/study-puzzles: the targeted HOOK set, as the dev API serves it.
import hookFixture from "./fixtures/study-puzzles/v2-hook-set.json";

const PLAYER = hookFixture.player as PlayerPuzzle;
const SET_ID = "set-20260925-133523-ea3e0b";
const PUZZLE_ID = "pz-7392892028f3";

const tilesOnBoard = (game: ReturnType<typeof studyPuzzleGame>["game"]) =>
  game.board.flat().filter((cell) => cell?.tile).length;

describe("a Study puzzle on the Play page", () => {
  afterEach(cleanup);

  it("is addressed as a room of its own namespace", () => {
    const roomId = studyPuzzleRoomId(SET_ID, PUZZLE_ID);
    expect(roomId).toBe(`study:${SET_ID}:${PUZZLE_ID}`);
    expect(parseStudyPuzzleRoomId(roomId)).toEqual({ setId: SET_ID, puzzleId: PUZZLE_ID });
    // Through the router and back, colons encoded on the way.
    const route = parseHash(routeToHash({ kind: "play", roomId }));
    expect(route).toEqual({ kind: "play", roomId });

    for (const other of [
      null,
      "",
      "room-123",
      "survival:abc",
      "study:",
      `study:${SET_ID}`,
      `study:${SET_ID}:`,
      `study:${SET_ID}:${PUZZLE_ID}:extra`,
      `study:../${SET_ID}:${PUZZLE_ID}`,
      `study:SET:${PUZZLE_ID}`,
    ]) {
      expect(parseStudyPuzzleRoomId(other)).toBeNull();
    }
  });

  it("becomes a game with the player to move and every tile accounted for", () => {
    const { game, setId, puzzleId, humanSide } = studyPuzzleGame(PLAYER, {
      playerName: "Admin",
      now: "2026-09-25T13:40:00.000Z",
    });
    const { position } = PLAYER;
    expect({ setId, puzzleId, humanSide }).toEqual({
      setId: SET_ID,
      puzzleId: PUZZLE_ID,
      humanSide: "A",
    });
    expect(game.activeSide).toBe("A");
    expect(game.phase).toBe("choose_action");
    expect(game.status).toBe("playing");
    expect(game.turnNumber).toBe(position.turnNumber);
    expect(game.scores).toEqual({ A: position.scores.self, B: position.scores.opponent });
    expect(game.players.A).toBe("Admin");
    expect(game.logs).toEqual([]);
    expect(game.timers.untimed).toBe(true);

    // The board, exactly: every square the projection names, choice tiles keeping their face.
    expect(tilesOnBoard(game)).toBe(position.board.length);
    for (const cell of position.board) {
      const tile = game.board[cell.r]![cell.c]!.tile!;
      expect(tile.token).toBe(cell.kind);
      if (cell.kind === "+/-" || cell.kind === "x//" || cell.kind === "?") {
        expect(tile.assignedToken).toBe(cell.face);
      }
    }
    // The authentic rack, and the unseen pool at the right counts.
    expect(game.rackA.map((tile) => tile.token)).toEqual(position.rack);
    expect(game.tilebag).toHaveLength(position.bagCount);
    expect(game.rackB).toHaveLength(position.oppRackCount);
    const unseen = [...game.tilebag, ...game.rackB].reduce<Record<string, number>>(
      (counts, tile) => {
        counts[tile.token] = (counts[tile.token] ?? 0) + 1;
        return counts;
      },
      {},
    );
    expect(unseen).toEqual(
      Object.fromEntries(Object.entries(position.unseen).filter(([, n]) => n > 0)),
    );
    expect(tilesOnBoard(game) + game.rackA.length + game.rackB.length + game.tilebag.length).toBe(
      100,
    );
    // Nothing of the answer can be in it: the projection does not have it.
    expect(JSON.stringify(PLAYER)).not.toMatch(
      /"(answer|best|nearBest|hidden|bag|opponentRack|seed|log)"/,
    );
  });

  it("refuses a projection whose unseen tiles do not match its counts", () => {
    const broken = structuredClone(PLAYER);
    broken.position.bagCount += 1;
    expect(() => studyPuzzleGame(broken)).toThrow(/unseen/);
  });

  it("lists the unseen tiles as one pool, never the bag apart from the opponent's rack", () => {
    const { game } = studyPuzzleGame(PLAYER);
    const view = studyTilebagView(game);
    expect(view.listKind).toBe("unseen");
    expect(view.tiles).toHaveLength(PLAYER.position.bagCount + PLAYER.position.oppRackCount);
    // While the bag can still refill the opponent, the count is the bag.
    expect(view.kind).toBe("bag");
    expect(view.remainingCount).toBe(PLAYER.position.bagCount);

    // Late in a game — an empty bag, a short opponent rack — only the pool is honest.
    const late = { ...game, tilebag: [], rackB: game.rackB.slice(0, 5) };
    expect(studyTilebagView(late)).toMatchObject({ kind: "opponent-rack", remainingCount: 5 });
  });

  it("sends the placement a turn made, a choice tile with the face it was given", () => {
    const log = {
      action: "place_equation",
      actionDetail: {
        placedTiles: [
          { row: 1, col: 2, token: "4", tileId: "rack-1" },
          { row: 2, col: 2, token: "+/-", assignedToken: "-", tileId: "rack-6" },
          { row: 3, col: 2, token: "?", assignedToken: "12", tileId: "rack-9" },
        ],
      },
    } as unknown as TurnLog;
    expect(studyPlacementsFromLog(log)).toEqual([
      { r: 1, c: 2, kind: "4", face: "4" },
      { r: 2, c: 2, kind: "+/-", face: "-" },
      { r: 3, c: 2, kind: "?", face: "12" },
    ]);
    expect(studyPlacementsFromLog({ action: "pass" } as unknown as TurnLog)).toBeNull();
  });

  it("offers neither Exchange nor Pass: the answer is one placement", () => {
    const { game } = studyPuzzleGame(PLAYER);
    const props = {
      activeRack: game.rackA,
      actionMode: "none" as const,
      canChooseAction: true,
      canEditRefill: false,
      canExchange: false,
      exchangeDisabledReason: "โจทย์นี้ตอบได้ด้วยการลงเบี้ยเท่านั้น (แลกหรือผ่านไม่ได้)",
      exchangeDraft: { outgoingIds: [], incomingTiles: [] },
      exchangeReady: false,
      game,
      pendingPlacements: [],
      readOnly: false,
      refillNeeded: false,
      replayIndex: 0,
      replayPhase: "before" as const,
      replayTotalSteps: 0,
      reviewing: false,
      showViewPanel: false,
      validation: { isValid: false, errors: [], equations: [], score: 0, bingoBonus: 0 },
      viewPanelLog: null,
      onCancelAction: vi.fn(),
      onConfirmExchange: vi.fn(),
      onConfirmPass: vi.fn(),
      onConfirmPlace: vi.fn(),
      onEditRefill: vi.fn(),
      onReplayExit: vi.fn(),
      onReplayNext: vi.fn(),
      onReplayPrev: vi.fn(),
      onStartAction: vi.fn(),
      onUpdatePendingAssignment: vi.fn(),
    };
    const { rerender } = render(<ActionPanel {...props} canPass={false} />);
    expect(screen.getByRole("button", { name: "Exchange" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pass" })).toBeDisabled();
    expect(screen.getByText(/ตอบได้ด้วยการลงเบี้ยเท่านั้น/)).toBeInTheDocument();

    // Everywhere else Pass is as it was.
    rerender(<ActionPanel {...props} />);
    expect(screen.getByRole("button", { name: "Pass" })).toBeEnabled();
  });
});
