import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listMyHistory: vi.fn(),
  saveCompletedGame: vi.fn(),
  getSavedUsage: vi.fn(),
  listMySavedGames: vi.fn(),
  changeMySavedGame: vi.fn(),
}));
vi.mock("../src/features/gameRecords/history", () => ({ listMyHistory: mocks.listMyHistory }));
vi.mock("../src/features/gameRecords/saved", () => ({
  saveCompletedGame: mocks.saveCompletedGame,
  getSavedUsage: mocks.getSavedUsage,
  listMySavedGames: mocks.listMySavedGames,
  changeMySavedGame: mocks.changeMySavedGame,
}));

import { HistorySection } from "../src/components/pages/profile/HistorySection";
import { SavedSection } from "../src/components/pages/profile/SavedSection";

const item = {
  sourceKind: "normal",
  sourceId: "source-1",
  gameId: "game-1",
  participantSide: "A",
  gameName: "Finished match",
  modeKey: "friend",
  gameMode: "versus",
  opponentLabel: "B",
  botKey: null,
  scoreFor: 25,
  scoreAgainst: 20,
  outcome: "win",
  completedAt: "2026-09-29T10:00:00Z",
  rulesVersion: null,
  resultAuthority: "client_reported",
  replayAvailability: "compact_available",
  isRecent: true,
  isSaved: false,
  canSave: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listMyHistory.mockResolvedValue({ items: [item], nextCursor: null });
  mocks.getSavedUsage.mockResolvedValue({ planName: "Free", activeCount: 37, capacity: 100 });
  mocks.listMySavedGames.mockResolvedValue({
    items: [
      {
        sourceKind: "normal",
        sourceId: "source-1",
        gameId: "game-1",
        gameName: "Finished match",
        modeKey: "friend",
        opponentLabel: "B",
        scoreFor: 25,
        scoreAgainst: 20,
        completedAt: item.completedAt,
        savedAt: "2026-09-29T10:10:00Z",
        resultAuthority: "client_reported",
        replayFormat: "compact",
      },
    ],
    nextCursor: null,
  });
});
afterEach(cleanup);

describe("Me Saved surface", () => {
  it("offers explicit Save and then marks the History item Saved", async () => {
    const onSaved = vi.fn();
    mocks.saveCompletedGame.mockResolvedValue({ already_saved: false });
    render(<HistorySection userId="owner" onSaved={onSaved} />);
    await userEvent.click(await screen.findByRole("button", { name: "Save replay" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Client-reported result")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledOnce();
    expect(mocks.saveCompletedGame).toHaveBeenCalledWith(item);
  });

  it("shows an authoritative capacity refusal without marking the item Saved", async () => {
    mocks.saveCompletedGame.mockRejectedValue(new Error("Saved capacity reached (100 of 100)."));
    render(<HistorySection userId="owner" />);
    await userEvent.click(await screen.findByRole("button", { name: "Save replay" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved capacity reached");
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("offers a seated Hosted player Save without claiming the old private archive is open", async () => {
    mocks.listMyHistory.mockResolvedValue({
      items: [{ ...item, replayAvailability: "unavailable", canSave: true }],
      nextCursor: null,
    });
    render(<HistorySection userId="owner" />);
    expect(await screen.findByRole("button", { name: "Save to open replay" })).toBeInTheDocument();
    expect(screen.getByText("Replay unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open replay" })).not.toBeInTheDocument();
  });

  it("lists retained metadata and capacity without fetching replay payloads", async () => {
    render(<SavedSection userId="owner" revision={0} />);
    expect(await screen.findByText("37 / 100 saved · Free")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open replay" })).toHaveAttribute(
      "href",
      "#/play/game-1",
    );
    expect(mocks.listMySavedGames).toHaveBeenCalledOnce();
  });

  it("shows Overflow and Trash actions and reports a capacity refusal", async () => {
    mocks.listMySavedGames.mockImplementation(
      async (_cursor: unknown, _limit: unknown, state: string) => ({
        items: [
          {
            sourceKind: "normal",
            sourceId: "source-1",
            gameId: "game-1",
            gameName: "Finished match",
            modeKey: "friend",
            opponentLabel: "B",
            scoreFor: 25,
            scoreAgainst: 20,
            completedAt: item.completedAt,
            savedAt: "2026-09-29T10:10:00Z",
            resultAuthority: "client_reported",
            replayFormat: "compact",
            state,
          },
        ],
        nextCursor: null,
      }),
    );
    mocks.changeMySavedGame.mockRejectedValueOnce(
      new Error("Saved capacity reached (100 of 100)."),
    );
    mocks.changeMySavedGame.mockResolvedValue(undefined);
    render(<SavedSection userId="owner" revision={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "Overflow" }));
    await userEvent.click(await screen.findByRole("button", { name: "Activate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved capacity reached");
    await userEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    expect(mocks.changeMySavedGame).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "source-1" }),
      "trash",
    );
    await userEvent.click(screen.getByRole("button", { name: "Trash", exact: true }));
    expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Permanently delete" }));
    expect(screen.getByRole("button", { name: "Confirm permanent delete" })).toBeInTheDocument();
  });
});
