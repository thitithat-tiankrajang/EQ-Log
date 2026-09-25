// The Turn Log Map: the whole multiverse, a turn to look at, and what can be done from it.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnLogMap } from "../src/components/logs/TurnLogMap";
import {
  buildTree,
  continueFrom,
  EMPTY_MULTIVERSE,
  type ContinueResult,
} from "../src/gameplay/multiverse";
import { newGame, pass, playTurns } from "./helpers/simulateGame";

function ok(result: ContinueResult) {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

function branched() {
  const game = playTurns(newGame("play"), 6);
  const away = ok(
    continueFrom(game, EMPTY_MULTIVERSE, { nodeId: game.logs[2]!.id, phase: "after" }),
  );
  const explored = pass(away.game);
  return { original: game, game: explored, tree: buildTree(explored.logs, away.multiverse) };
}

/** A turn's node on the graph, by id: turn numbers repeat across lines. */
function node(id: string) {
  return document.querySelector(`[data-node="${id}"]`) as SVGGElement;
}

afterEach(cleanup);

function map(props: Partial<Parameters<typeof TurnLogMap>[0]> = {}) {
  const { game, tree, original } = branched();
  const handlers = {
    onClose: vi.fn(),
    onView: vi.fn(),
    onContinue: vi.fn(),
    onPrune: vi.fn(),
    onRetry: vi.fn(),
  };
  const view = render(
    <TurnLogMap
      open
      game={game}
      tree={tree}
      status="ready"
      error={null}
      viewedId={null}
      canBranch
      branchBlockedReason={null}
      busy={false}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, view, game, tree, original };
}

describe("the Turn Log Map", () => {
  it("sums the multiverse up in its heading", () => {
    const { view } = map();
    expect(screen.getByRole("dialog", { name: "เส้นทางเกม" })).toBeInTheDocument();
    expect(screen.getByText(/2 เส้นทาง · 7 ตา · แตกกิ่ง 1 จุด/)).toBeInTheDocument();
    view.unmount();
  });

  it("opens on the live position, which cannot be continued to again", () => {
    const { view } = map();
    expect(screen.getByRole("button", { name: /\(ตอนนี้\)/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /เล่นต่อจากตรงนี้/ })).toBeDisabled();
    expect(document.querySelector(".tlm-line-tag")).toHaveTextContent("เส้นที่เล่นอยู่");
    view.unmount();
  });

  it("studies a parked turn on the board, or plays on from it", () => {
    const { original, onView, onContinue, view } = map();
    const parked = original.logs[4]!;
    fireEvent.click(node(parked.id));
    expect(document.querySelector(".tlm-line-tag")).toHaveTextContent("เส้นที่เก็บไว้");
    fireEvent.click(screen.getByRole("button", { name: /ดูบนกระดาน/ }));
    expect(onView).toHaveBeenCalledWith(parked.id);
    fireEvent.click(screen.getByRole("button", { name: /เล่นต่อจากตรงนี้/ }));
    expect(onContinue).toHaveBeenCalledWith({ nodeId: parked.id, phase: "after" });
    fireEvent.click(screen.getByRole("button", { name: /เดินตานี้ใหม่/ }));
    expect(onContinue).toHaveBeenLastCalledWith({ nodeId: parked.id, phase: "before" });
    view.unmount();
  });

  it("asks before deleting a line, and says how much goes with it", () => {
    const { original, tree, onPrune, view } = map();
    const parked = original.logs[3]!;
    fireEvent.click(node(parked.id));
    fireEvent.click(screen.getByRole("button", { name: /ลบเส้นทางนี้/ }));
    const confirm = screen.getByRole("group", { name: "ยืนยันการลบเส้นทาง" });
    expect(within(confirm).getByText(/ลบ 3 ตา/)).toBeInTheDocument();
    expect(onPrune).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "ลบ" }));
    expect(onPrune).toHaveBeenCalledWith(tree.nodes.get(parked.id)!.lineId);
    view.unmount();
  });

  it("walks the graph with the keyboard, and Enter shows the turn on the board", () => {
    const { game, onView, view } = map();
    const graph = screen.getByRole("group", { name: /แผนที่เส้นทาง/ });
    fireEvent.keyDown(graph, { key: "ArrowLeft" });
    const previous = game.logs[game.logs.length - 2]!;
    expect(node(previous.id)).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(graph, { key: "Home" });
    expect(screen.getByRole("button", { name: "เริ่มเกม" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.keyDown(graph, { key: "Enter" });
    expect(onView).toHaveBeenCalledWith(null);
    view.unmount();
  });

  it("lets spectators look and nothing more", () => {
    const { view } = map({ canBranch: false });
    expect(screen.getByRole("button", { name: /ดูบนกระดาน/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /เล่นต่อจากตรงนี้/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ลบเส้นทางนี้/ })).not.toBeInTheDocument();
    view.unmount();
  });

  it("says when the other lines could not be loaded, and retries", () => {
    const { onRetry, view } = map({ status: "error", error: "network down" });
    expect(screen.getByRole("alert")).toHaveTextContent("network down");
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(onRetry).toHaveBeenCalled();
    view.unmount();
  });
});
