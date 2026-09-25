// The turn log's half of branching: small, one line at a time, quick to step through.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogPanel, type BranchControl } from "../src/components/logs/LogPanel";
import { buildForkIndex, NO_FORKS } from "../src/components/logs/branchView";
import {
  buildTree,
  continueFrom,
  EMPTY_MULTIVERSE,
  pathTo,
  type ContinueResult,
} from "../src/gameplay/multiverse";
import type { GameState } from "../src/game";
import { newGame, pass, playTurns } from "./helpers/simulateGame";

function ok(result: ContinueResult) {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

afterEach(cleanup);

const ALLOWED: BranchControl = { available: true, blockedReason: null, busy: false };

function panel(game: GameState, overrides: Partial<Parameters<typeof LogPanel>[0]> = {}) {
  const handlers = {
    onSelectLog: vi.fn(),
    onStarsChange: vi.fn(),
    onNoteChange: vi.fn(),
    onStep: vi.fn(),
    onSetPhase: vi.fn(),
    onOpenMap: vi.fn(),
    onViewOption: vi.fn(),
    onContinue: vi.fn(),
  };
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  const view = render(
    <LogPanel
      game={game}
      logs={game.logs}
      selectedLogId={null}
      replayPhase="after"
      forks={NO_FORKS}
      lineView={null}
      lineCount={1}
      timelineStatus="idle"
      branch={ALLOWED}
      {...handlers}
      {...overrides}
    />,
  );
  return { ...handlers, view };
}

describe("the turn log", () => {
  it("steps through whole turns and back to live", () => {
    const game = playTurns(newGame("play"), 4);
    const { onStep, view } = panel(game);
    expect(screen.getByText("สด · 4 ตา")).toBeInTheDocument();
    // Live: nothing ahead, but everything behind.
    expect(screen.getByRole("button", { name: "ตาถัดไป" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "ตาก่อนหน้า" }));
    fireEvent.click(screen.getByRole("button", { name: "ตาแรก" }));
    expect(onStep.mock.calls.map(([step]) => step)).toEqual(["prev", "first"]);
    view.unmount();
  });

  it("offers continuing from the turn on the board, before or after it was played", () => {
    const game = playTurns(newGame("play"), 4);
    const { onSetPhase, onContinue, view } = panel(game, {
      selectedLogId: game.logs[1]!.id,
      replayPhase: "before",
    });
    expect(screen.getByText("ตา 2 / 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ก่อนเดิน" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "หลังเดิน" }));
    expect(onSetPhase).toHaveBeenCalledWith("after");
    fireEvent.click(screen.getByRole("button", { name: /เล่นต่อจากตรงนี้/ }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("says why it cannot continue instead of silently doing nothing", () => {
    const game = playTurns(newGame("play"), 3);
    const { view } = panel(game, {
      selectedLogId: game.logs[0]!.id,
      branch: { available: true, blockedReason: "ยกเลิกการวางเบี้ยที่ค้างอยู่ก่อน", busy: false },
    });
    expect(screen.getByRole("button", { name: /เล่นต่อจากตรงนี้/ })).toBeDisabled();
    expect(screen.getByText("ยกเลิกการวางเบี้ยที่ค้างอยู่ก่อน")).toBeInTheDocument();
    view.unmount();
  });

  it("shows spectators the line but never the button", () => {
    const game = playTurns(newGame("play"), 3);
    const { view } = panel(game, {
      selectedLogId: game.logs[0]!.id,
      branch: { available: false, blockedReason: null, busy: false },
    });
    expect(screen.queryByRole("button", { name: /เล่นต่อจากตรงนี้/ })).not.toBeInTheDocument();
    view.unmount();
  });

  it("marks a turn where another move was tried, and opens the alternatives in place", () => {
    const game = playTurns(newGame("play"), 5);
    const away = ok(
      continueFrom(game, EMPTY_MULTIVERSE, { nodeId: game.logs[1]!.id, phase: "after" }),
    );
    const explored = pass(away.game);
    const tree = buildTree(explored.logs, away.multiverse);
    const forks = buildForkIndex(tree, explored.logs);
    const { onViewOption, view } = panel(explored, { forks, lineCount: 2 });

    const badge = screen.getByRole("button", { name: "ตานี้มีทางเลือกอื่น 1 ทาง" });
    expect(screen.getAllByRole("button", { name: /ทางเลือกอื่น/ })).toHaveLength(1);
    fireEvent.click(badge);
    const options = within(screen.getByRole("list", { name: "ทางเลือกที่จุดนี้" })).getAllByRole(
      "button",
    );
    expect(options).toHaveLength(2);
    expect(options[0]).toBeDisabled(); // the one already on screen
    fireEvent.click(options[1]!);
    expect(onViewOption).toHaveBeenCalledWith(
      expect.objectContaining({ id: game.logs[2]!.id, tipId: game.logs[4]!.id, length: 3 }),
    );
    expect(screen.getByRole("button", { name: /Turn Log Map · 2 เส้นทาง/ })).toBeInTheDocument();
    view.unmount();
  });

  it("names the other line it is showing, and the way back", () => {
    const game = playTurns(newGame("play"), 5);
    const away = ok(
      continueFrom(game, EMPTY_MULTIVERSE, { nodeId: game.logs[1]!.id, phase: "after" }),
    );
    const tree = buildTree(away.game.logs, away.multiverse);
    const viewed = pathTo(tree, game.logs[4]!.id);
    const { onStep, view } = panel(away.game, {
      logs: viewed,
      selectedLogId: game.logs[3]!.id,
      forks: buildForkIndex(tree, viewed),
      lineView: { forkTurn: game.logs[1]!.turnNumber },
    });
    expect(
      screen.getByText(`กำลังดูอีกเส้นทาง · แยกหลังตา ${game.logs[1]!.turnNumber}`),
    ).toBeInTheDocument();
    // Notes belong to the line being played; another line is for looking.
    expect(screen.getByRole("textbox")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "กลับเส้นที่เล่นอยู่" }));
    expect(onStep).toHaveBeenCalledWith("live");
    view.unmount();
  });
});
