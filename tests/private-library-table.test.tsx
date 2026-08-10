import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listPrivateLibrary } = vi.hoisted(() => ({
  listPrivateLibrary: vi.fn(),
}));

vi.mock("../src/auth", () => ({
  AccountChip: () => null,
  useAuth: () => ({ configured: true, profile: null, userId: "user-1" }),
}));

vi.mock("../src/admin", () => ({ AdminButton: () => null }));

vi.mock("../src/remoteRooms", () => ({
  listPrivateRooms: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/features/gameRecords/repository", () => ({
  copyPrivateGameItem: vi.fn(),
  createPrivateFolder: vi.fn(),
  deletePrivateItem: vi.fn(),
  getGameStorageLimits: vi.fn().mockResolvedValue({
    privateBoards: 1_000,
    publicArchive: 100_000,
    regionArchive: 1_000,
  }),
  listPrivateLibrary,
  movePrivateItems: vi.fn(),
  updatePrivateItem: vi.fn(),
}));

import { PrivateLibraryPage } from "../src/components/pages/PrivateLibraryPage";

describe("Private Library table", () => {
  afterEach(cleanup);

  beforeEach(() => {
    window.location.hash = "#/private";
    listPrivateLibrary.mockResolvedValue([
      {
        id: "folder-1",
        ownerId: "user-1",
        itemType: "folder",
        parentId: null,
        name: "Algebra drills",
        sourceScope: null,
        sourceGameId: null,
        gameId: null,
        gameMode: null,
        modeKey: null,
        completionKind: null,
        completionReason: null,
        turnNumber: null,
        scoreA: null,
        scoreB: null,
        trashedAt: null,
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "game-item-1",
        ownerId: "user-1",
        itemType: "game",
        parentId: null,
        name: "Practice board",
        sourceScope: "public",
        sourceGameId: "game-1",
        gameId: "game-1",
        gameMode: "versus",
        modeKey: "online_versus",
        completionKind: "natural",
        completionReason: "natural_finish",
        turnNumber: 8,
        scoreA: 24,
        scoreB: 18,
        trashedAt: null,
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-10T00:00:00.000Z",
      },
    ]);
  });

  it("renders folders and games as rows, then opens a folder on the second click", async () => {
    render(<PrivateLibraryPage folderId={null} />);

    const table = await screen.findByRole("table", { name: "Private files" });
    const toolbar = screen.getByRole("toolbar", { name: "Private file selection" });
    expect(table).toBeVisible();
    expect(toolbar.closest(".eq-game-table-wrap")).toContainElement(table);
    expect(within(table).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: "Select Practice board; activate again to open",
      }),
    ).toBeVisible();

    const folderLink = screen.getByRole("link", {
      name: "Select Algebra drills; activate again to open",
    });
    fireEvent.click(folderLink);

    expect(window.location.hash).toBe("#/private");
    expect(folderLink.closest("tr")).toHaveClass("is-selected");
    expect(folderLink.closest("tr")).not.toHaveClass("is-selectable");
    expect(within(toolbar).getByText("1 selected")).toBeVisible();

    fireEvent.click(folderLink);
    await waitFor(() => expect(window.location.hash).toBe("#/private/folder-1"));
  });

  it("clears selection outside the table and supports modifier or explicit multi-select", async () => {
    render(<PrivateLibraryPage folderId={null} />);

    await screen.findByRole("table", { name: "Private files" });
    const toolbar = screen.getByRole("toolbar", { name: "Private file selection" });
    const folderLink = screen.getByRole("link", {
      name: "Select Algebra drills; activate again to open",
    });
    fireEvent.click(folderLink);

    const gameLink = screen.getByRole("link", {
      name: "Select Practice board; activate again to open",
    });
    fireEvent.click(gameLink, { metaKey: true });
    expect(within(toolbar).getByText("2 selected")).toBeVisible();

    fireEvent.pointerDown(screen.getByRole("heading", { level: 1, name: "Private" }));
    expect(within(toolbar).getByText("Select an item")).toBeVisible();

    fireEvent.click(within(toolbar).getByRole("button", { name: "Select multiple items" }));
    expect(
      within(toolbar).getByRole("button", { name: "Finish selecting multiple items" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("link", { name: "Add Algebra drills to selection" }));
    fireEvent.click(screen.getByRole("link", { name: "Add Practice board to selection" }));
    expect(within(toolbar).getByText("2 selected")).toBeVisible();
  });
});
