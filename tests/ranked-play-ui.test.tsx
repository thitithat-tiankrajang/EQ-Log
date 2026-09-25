import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RankedMatchPage } from "../src/components/pages/ranked/RankedMatchPage";
import { rankedPublicView } from "../src/features/ranked/publicView";
import { createRankedGame } from "../src/features/ranked/rules";
import { rankedClient } from "../src/features/ranked/client";

vi.mock("../src/features/ranked/client", () => ({
  rankedClient: { read: vi.fn(), ready: vi.fn(), cancel: vi.fn(), action: vi.fn() },
}));
vi.mock("../src/auth", () => ({
  AccountChip: () => null,
  useAuth: () => ({ userId: "mine", isApproved: true }),
}));
vi.mock("../src/admin", () => ({ AdminButton: () => null }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("uses the shared play board and rack while keeping an opponent replay rack closed", async () => {
  const game = createRankedGame("mine", "Me", 15, 15, "A");
  game.playerUserIds = { A: "mine", B: "other" };
  game.players.B = "Opponent";
  game.status = "playing";
  game.roomStage = "playing";
  game.timers.paused = false;
  game.currentTurnStartedAt = new Date().toISOString();
  const view = rankedPublicView("match-id", 2, game, "mine");
  view.logs.push({
    id: "other-turn",
    turnNumber: 1,
    side: "B",
    action: "exchange",
    score: 0,
    exchangedCount: 2,
    boardAfter: view.board,
  });
  vi.mocked(rankedClient.read).mockResolvedValue({ match: view });

  const { container } = render(<RankedMatchPage matchId="match-id" />);
  await waitFor(() => expect(container.querySelectorAll(".board-cell")).toHaveLength(225));
  expect(container.querySelectorAll(".rack-tile")).toHaveLength(8);
  expect(container.querySelector(".scoreboard")).not.toBeNull();

  fireEvent.click(screen.getByRole("button", { name: /เปลี่ยน 2 ตัว/ }));
  expect(screen.getByLabelText("เบี้ยคู่แข่งปิด").querySelectorAll(".rack-tile-back")).toHaveLength(
    8,
  );
  expect(container.querySelectorAll(".rack-tile")).toHaveLength(0);
});

it("moves a selected rack tile onto the shared board without duplicating it in the rack", async () => {
  const game = createRankedGame("mine", "Me", 15, 15, "A");
  game.playerUserIds = { A: "mine", B: "other" };
  game.players.B = "Opponent";
  game.status = "playing";
  game.roomStage = "playing";
  game.timers.paused = false;
  game.currentTurnStartedAt = new Date().toISOString();
  vi.mocked(rankedClient.read).mockResolvedValue({
    match: rankedPublicView("match-id", 2, game, "mine"),
  });

  const { container } = render(<RankedMatchPage matchId="match-id" />);
  await waitFor(() => expect(container.querySelectorAll(".rack-tile")).toHaveLength(8));
  fireEvent.click(container.querySelector(".rack-tile")!);
  fireEvent.click(container.querySelectorAll(".board-cell")[7 * 15 + 7]!);
  expect(container.querySelectorAll(".board-cell.pending")).toHaveLength(1);
  expect(container.querySelectorAll(".rack-tile")).toHaveLength(7);
  fireEvent.click(container.querySelectorAll(".board-cell")[7 * 15 + 8]!);
  fireEvent.click(container.querySelector(".rack-tile")!);
  expect(container.querySelectorAll(".board-cell.pending")).toHaveLength(2);
  expect(container.querySelectorAll(".rack-tile")).toHaveLength(6);
});

it("cycles the placement arrow and moves it with the same keys as normal play", async () => {
  const game = createRankedGame("mine", "Me", 15, 15, "A");
  game.playerUserIds = { A: "mine", B: "other" };
  game.players.B = "Opponent";
  game.status = "playing";
  game.roomStage = "playing";
  game.timers.paused = false;
  game.currentTurnStartedAt = new Date().toISOString();
  vi.mocked(rankedClient.read).mockResolvedValue({
    match: rankedPublicView("match-id", 2, game, "mine"),
  });

  const { container } = render(<RankedMatchPage matchId="match-id" />);
  await waitFor(() => expect(container.querySelectorAll(".board-cell")).toHaveLength(225));
  fireEvent.click(container.querySelectorAll(".board-cell")[7 * 15 + 7]!);
  expect(container.querySelectorAll(".board-cell")[7 * 15 + 7]).toHaveClass("cursor-right");
  fireEvent.keyDown(window, { key: " ", code: "Space" });
  expect(container.querySelectorAll(".board-cell")[7 * 15 + 7]).toHaveClass("cursor-down");
  fireEvent.keyDown(window, { key: "ArrowRight", code: "ArrowRight" });
  expect(container.querySelectorAll(".board-cell")[7 * 15 + 8]).toHaveClass("cursor-down");
});

it("types rack tiles along the arrow and submits the selected valid place action with Enter", async () => {
  const game = createRankedGame("mine", "Me", 15, 15, "A");
  game.playerUserIds = { A: "mine", B: "other" };
  game.players.B = "Opponent";
  game.status = "playing";
  game.roomStage = "playing";
  game.timers.paused = false;
  game.currentTurnStartedAt = new Date().toISOString();
  game.rackA = [
    { id: "one-a", token: "1" },
    { id: "plus", token: "+" },
    { id: "one-b", token: "1" },
    { id: "equals", token: "=" },
    { id: "two", token: "2" },
    { id: "three", token: "3" },
    { id: "four", token: "4" },
    { id: "five", token: "5" },
  ];
  const view = rankedPublicView("match-id", 2, game, "mine");
  vi.mocked(rankedClient.read).mockResolvedValue({ match: view });
  vi.mocked(rankedClient.action).mockResolvedValue({ match: view });

  const { container } = render(<RankedMatchPage matchId="match-id" />);
  await waitFor(() => expect(container.querySelectorAll(".rack-tile")).toHaveLength(8));
  fireEvent.click(container.querySelectorAll(".board-cell")[7 * 15 + 5]!);
  for (const [key, code] of [
    ["1", "Digit1"],
    ["p", "KeyP"],
    ["1", "Digit1"],
    ["=", "Equal"],
    ["2", "Digit2"],
  ]) {
    fireEvent.keyDown(window, { key, code });
  }
  expect(container.querySelectorAll(".board-cell.pending")).toHaveLength(5);
  expect(container.querySelectorAll(".board-cell")[7 * 15 + 10]).toHaveClass("cursor-right");
  fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
  await waitFor(() =>
    expect(rankedClient.action).toHaveBeenCalledWith("match-id", 2, {
      kind: "place",
      placements: [
        { tileId: "one-a", row: 7, col: 5, assignedToken: undefined },
        { tileId: "plus", row: 7, col: 6, assignedToken: undefined },
        { tileId: "one-b", row: 7, col: 7, assignedToken: undefined },
        { tileId: "equals", row: 7, col: 8, assignedToken: undefined },
        { tileId: "two", row: 7, col: 9, assignedToken: undefined },
      ],
    }),
  );
});

it("uses Enter for the chosen pass or exchange action and ignores an incomplete place", async () => {
  const game = createRankedGame("mine", "Me", 15, 15, "A");
  game.playerUserIds = { A: "mine", B: "other" };
  game.players.B = "Opponent";
  game.status = "playing";
  game.roomStage = "playing";
  game.timers.paused = false;
  game.currentTurnStartedAt = new Date().toISOString();
  const view = rankedPublicView("match-id", 2, game, "mine");
  vi.mocked(rankedClient.read).mockResolvedValue({ match: view });
  vi.mocked(rankedClient.action).mockResolvedValue({ match: view });

  const { container } = render(<RankedMatchPage matchId="match-id" />);
  await waitFor(() => expect(container.querySelectorAll(".rack-tile")).toHaveLength(8));
  fireEvent.click(container.querySelectorAll(".board-cell")[7 * 15 + 7]!);
  fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
  expect(rankedClient.action).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Pass" })[0]);
  fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
  await waitFor(() =>
    expect(rankedClient.action).toHaveBeenCalledWith("match-id", 2, { kind: "pass" }),
  );

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Exchange" })[0]);
  const tileId = container.querySelector<HTMLElement>(".rack-tile")!.dataset.tileId;
  fireEvent.click(container.querySelector(".rack-tile")!);
  fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
  await waitFor(() =>
    expect(rankedClient.action).toHaveBeenCalledWith("match-id", 2, {
      kind: "exchange",
      tileIds: [tileId],
    }),
  );
});

it("lets a typed blank choose its face and Backspace restores the tile and cursor", async () => {
  const game = createRankedGame("mine", "Me", 15, 15, "A");
  game.playerUserIds = { A: "mine", B: "other" };
  game.players.B = "Opponent";
  game.status = "playing";
  game.roomStage = "playing";
  game.timers.paused = false;
  game.currentTurnStartedAt = new Date().toISOString();
  game.rackA = [{ id: "seven", token: "7" }, { id: "blank", token: "?" }, ...game.rackA.slice(2)];
  vi.mocked(rankedClient.read).mockResolvedValue({
    match: rankedPublicView("match-id", 2, game, "mine"),
  });

  const { container } = render(<RankedMatchPage matchId="match-id" />);
  await waitFor(() => expect(container.querySelectorAll(".rack-tile")).toHaveLength(8));
  fireEvent.click(container.querySelectorAll(".board-cell")[7 * 15 + 7]!);
  fireEvent.keyDown(window, { key: "b", code: "KeyB" });
  fireEvent.keyDown(window, { key: "7", code: "Digit7" });
  expect(container.querySelectorAll(".board-cell.pending")).toHaveLength(1);
  expect(container.querySelector<HTMLElement>(".rack-tile[data-tile-id='blank']")).toBeNull();
  expect(container.querySelector<HTMLElement>(".rack-tile[data-tile-id='seven']")).not.toBeNull();
  fireEvent.keyDown(window, { key: "Backspace", code: "Backspace" });
  expect(container.querySelectorAll(".board-cell.pending")).toHaveLength(0);
  expect(container.querySelectorAll(".board-cell")[7 * 15 + 7]).toHaveClass("cursor-right");
  expect(container.querySelector<HTMLElement>(".rack-tile[data-tile-id='blank']")).not.toBeNull();
});
