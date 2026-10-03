import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

it("uses the live shell board and rack while keeping an opponent replay rack closed", async () => {
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
  await waitFor(() => expect(container.querySelectorAll(".lg-cell")).toHaveLength(225));
  expect(container.querySelectorAll(".lg-rack-tile[data-tile-id]")).toHaveLength(8);
  expect(container.querySelectorAll(".lg-sb-row")).toHaveLength(2);

  await act(async () => {});
  fireEvent.click(
    within(screen.getByRole("region", { name: "Turn Log" })).getByRole("button", {
      name: /Exchanged 2 tiles/,
    }),
  );
  expect(
    screen
      .getByRole("group", { name: "Opponent's rack (closed)" })
      .querySelectorAll(".lg-tile-back"),
  ).toHaveLength(8);
  expect(container.querySelectorAll(".lg-rack-tile[data-tile-id]")).toHaveLength(0);
});

it("moves a selected rack tile onto the board without duplicating it in the rack", async () => {
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
  await waitFor(() =>
    expect(container.querySelectorAll(".lg-rack-tile[data-tile-id]")).toHaveLength(8),
  );
  // The page clears any selection when the match revision changes, in an effect
  // that runs just after the first render shows the rack. Let it run before
  // clicking, or a fast click lands in between and is cleared (a CI-only flake).
  await act(async () => {});
  fireEvent.click(container.querySelector(".lg-rack-tile[data-tile-id]")!);
  fireEvent.click(container.querySelectorAll(".lg-cell")[7 * 15 + 7]!);
  expect(container.querySelectorAll(".lg-cell.is-tentative")).toHaveLength(1);
  expect(container.querySelectorAll(".lg-rack-tile[data-tile-id]")).toHaveLength(7);
  fireEvent.click(container.querySelectorAll(".lg-cell")[7 * 15 + 8]!);
  fireEvent.click(container.querySelector(".lg-rack-tile[data-tile-id]")!);
  expect(container.querySelectorAll(".lg-cell.is-tentative")).toHaveLength(2);
  expect(container.querySelectorAll(".lg-rack-tile[data-tile-id]")).toHaveLength(6);
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
  await waitFor(() => expect(container.querySelectorAll(".lg-cell")).toHaveLength(225));
  // The page clears any selection when the match revision changes, in an effect
  // that runs just after the first render shows the rack. Let it run before
  // clicking, or a fast click lands in between and is cleared (a CI-only flake).
  await act(async () => {});
  fireEvent.click(container.querySelectorAll(".lg-cell")[7 * 15 + 7]!);
  expect(container.querySelectorAll(".lg-cell")[7 * 15 + 7]).toHaveClass("is-cursor", "dir-right");
  fireEvent.keyDown(window, { key: " ", code: "Space" });
  expect(container.querySelectorAll(".lg-cell")[7 * 15 + 7]).toHaveClass("is-cursor", "dir-down");
  fireEvent.keyDown(window, { key: "ArrowRight", code: "ArrowRight" });
  expect(container.querySelectorAll(".lg-cell")[7 * 15 + 8]).toHaveClass("is-cursor", "dir-down");
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
  await waitFor(() =>
    expect(container.querySelectorAll(".lg-rack-tile[data-tile-id]")).toHaveLength(8),
  );
  fireEvent.click(container.querySelectorAll(".lg-cell")[7 * 15 + 5]!);
  for (const [key, code] of [
    ["1", "Digit1"],
    ["p", "KeyP"],
    ["1", "Digit1"],
    ["=", "Equal"],
    ["2", "Digit2"],
  ]) {
    fireEvent.keyDown(window, { key, code });
  }
  expect(container.querySelectorAll(".lg-cell.is-tentative")).toHaveLength(5);
  expect(container.querySelectorAll(".lg-cell")[7 * 15 + 10]).toHaveClass("is-cursor", "dir-right");
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
  await waitFor(() =>
    expect(container.querySelectorAll(".lg-rack-tile[data-tile-id]")).toHaveLength(8),
  );
  fireEvent.click(container.querySelectorAll(".lg-cell")[7 * 15 + 7]!);
  fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
  expect(rankedClient.action).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Pass" }));
  expect(screen.getByRole("button", { name: "Confirm pass" })).toBeEnabled();
  fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
  await waitFor(() =>
    expect(rankedClient.action).toHaveBeenCalledWith("match-id", 2, { kind: "pass" }),
  );

  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Exchange" }));
  const tileId = container.querySelector<HTMLElement>(".lg-rack-tile[data-tile-id]")!.dataset
    .tileId;
  fireEvent.click(container.querySelector(".lg-rack-tile[data-tile-id]")!);
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
  await waitFor(() =>
    expect(container.querySelectorAll(".lg-rack-tile[data-tile-id]")).toHaveLength(8),
  );
  fireEvent.click(container.querySelectorAll(".lg-cell")[7 * 15 + 7]!);
  fireEvent.keyDown(window, { key: "b", code: "KeyB" });
  fireEvent.keyDown(window, { key: "7", code: "Digit7" });
  expect(container.querySelectorAll(".lg-cell.is-tentative")).toHaveLength(1);
  expect(container.querySelector<HTMLElement>(".lg-rack-tile[data-tile-id='blank']")).toBeNull();
  expect(
    container.querySelector<HTMLElement>(".lg-rack-tile[data-tile-id='seven']"),
  ).not.toBeNull();
  fireEvent.keyDown(window, { key: "Backspace", code: "Backspace" });
  expect(container.querySelectorAll(".lg-cell.is-tentative")).toHaveLength(0);
  expect(container.querySelectorAll(".lg-cell")[7 * 15 + 7]).toHaveClass("is-cursor", "dir-right");
  expect(
    container.querySelector<HTMLElement>(".lg-rack-tile[data-tile-id='blank']"),
  ).not.toBeNull();
});
