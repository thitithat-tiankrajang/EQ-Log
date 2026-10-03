import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase A.5 mode contracts in the shell, on the real reducers/projection:
 * completion seen by a seat that did not receive the final projection, and the
 * physical-draw prompt that opens the recorder.
 */
vi.setConfig({ testTimeout: 20_000 });
const history = vi.hoisted(() => ({
  items: [] as Array<{ sourceId: string; outcome: string | null; participantSide: "A" | "B" }>,
}));
vi.mock("../src/features/gameRecords/history", () => ({
  listMyHistory: async () => ({ items: history.items, nextCursor: null }),
}));
vi.mock("../src/auth", () => ({
  AccountChip: () => null,
  useAuth: () => ({ userId: null, isApproved: true }),
}));
vi.mock("../src/admin", () => ({ AdminButton: () => null }));

import { LiveGameScreen } from "../src/liveGame/shell/LiveGameScreen";
import { createFixtureSession } from "../src/liveGame/shell/dev/ShellFixture";
import { finalBoard, finishedFromArchive, winnerFrom } from "../src/liveGame/shell/completion";
import { activeLiveScreens } from "../src/liveGame/shell/terminalHold";
import type { SafeArchiveReplay } from "../src/completedGame/archiveRead";
import type { RankedMatchView } from "../src/features/ranked/publicView";

function replayFor(id: string, scores = { A: 40, B: 31 }): SafeArchiveReplay {
  return {
    archive: { gameId: id, name: "x", scope: "public", finishedAt: new Date().toISOString() },
    replay: {
      format: 1,
      mode: "standard",
      status: "finished",
      players: { A: "Nok", B: "Pim" },
      startingBoard: [],
      finalBoard: [
        { row: 7, col: 7, kind: "12", face: "12", side: "A", turn: 1 },
        { row: 7, col: 8, kind: "+/-", face: "-", side: "A", turn: 1 },
        { row: 7, col: 9, kind: "?", face: "7", side: "B", turn: 2 },
      ],
      finalScores: scores,
      finalRacks: { A: [], B: [] },
      clocks: { initial: { A: 0, B: 0 }, final: { A: 0, B: 0 } },
      positions: [],
      turns: [],
    } as unknown as SafeArchiveReplay["replay"],
  };
}

beforeEach(() => {
  window.localStorage.clear();
  history.items = [];
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 790 });
});
afterEach(cleanup);

describe("completion from the safe archive + the viewer's own History row", () => {
  it("maps the public final board (choice and blank faces) and the authoritative outcome", () => {
    const board = finalBoard(replayFor("g"));
    expect(board[7]![7]!.tile).toMatchObject({ token: "12" });
    expect(board[7]![7]!.tile.assignedToken).toBeUndefined();
    expect(board[7]![8]!.tile).toMatchObject({ token: "+/-", assignedToken: "-" });
    expect(board[7]![9]!.tile).toMatchObject({ token: "?", assignedToken: "7" });
    expect(winnerFrom({ outcome: "win", participantSide: "B" })).toBe("B");
    expect(winnerFrom({ outcome: "loss", participantSide: "B" })).toBe("A");
    expect(winnerFrom({ outcome: "draw", participantSide: "A" })).toBeNull();
    expect(winnerFrom(null)).toBeUndefined();
    const current = {
      id: "g",
      revision: 7,
      status: "playing",
      result: null,
    } as unknown as RankedMatchView;
    const done = finishedFromArchive(current, replayFor("g"), {
      outcome: "loss",
      participantSide: "A",
    });
    // A surrender is never misread from the scores: the History outcome decides.
    expect(done).toMatchObject({ status: "finished", revision: 7, scores: { A: 40, B: 31 } });
    expect(done.result).toEqual({ winner: "B" });
    expect(finishedFromArchive(current, replayFor("g"), null).result).toBeNull();
  });

  it("the opponent's screen shows the Result instead of jumping to the Replay", async () => {
    const session = createFixtureSession("active");
    render(
      <LiveGameScreen
        matchId="game-op"
        client={session.clientFor("b")}
        ranked={false}
        onOpenReplay={() => undefined}
      />,
    );
    await screen.findByText(/Nok is thinking/);
    // A live screen with a loaded game owns completion; the route leaves it alone.
    expect(activeLiveScreens.has("game-op")).toBe(true);
    history.items = [{ sourceId: "game-op", outcome: "loss", participantSide: "B" }];
    act(() => {
      window.dispatchEvent(
        new CustomEvent("eq-lab:archive-replay-ready", { detail: replayFor("game-op") }),
      );
    });
    await waitFor(() =>
      expect(document.querySelector(".lg-shell")).toHaveAttribute("data-turn", "finished"),
    );
    expect(screen.getByText("Nok won")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Replay" })).toBeInTheDocument();
  });

  it("a viewer with no History row (spectator) sees Game over, never an invented winner", async () => {
    const session = createFixtureSession("active");
    render(<LiveGameScreen matchId="game-sp" client={session.clientFor("host")} ranked={false} />);
    await screen.findByRole("region", { name: "Score" });
    act(() => {
      window.dispatchEvent(
        new CustomEvent("eq-lab:archive-replay-ready", { detail: replayFor("game-sp") }),
      );
    });
    await screen.findByText("Game over");
    expect(screen.queryByText(/won|Draw/)).toBeNull();
  });
});

describe("physical draws", () => {
  it("a due draw is a button that opens the Physical recorder", async () => {
    const session = createFixtureSession("physical");
    const game = session.game;
    const rack = game.rackA;
    const pick = (token: string, used: Set<string>) => {
      const tile = rack.find((item) => item.token === token && !used.has(item.id))!;
      used.add(tile.id);
      return tile.id;
    };
    const used = new Set<string>();
    act(() =>
      session.act("A", {
        kind: "place",
        placements: (["12", "=", "4", "x", "3"] as const).map((token, index) => ({
          tileId: pick(token, used),
          row: 7,
          col: 5 + index,
        })),
      }),
    );
    render(<LiveGameScreen matchId="game-ph" client={session.clientFor("host")} ranked={false} />);
    const prompt = await screen.findByRole("button", {
      name: "Record the physical draw to continue",
    });
    act(() => prompt.click());
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Physical" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(screen.getByLabelText("Physical tiles")).toBeInTheDocument();
  });
});
