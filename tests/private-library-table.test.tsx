import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listPrivateLibrary, movePrivateItems } = vi.hoisted(() => ({
  listPrivateLibrary: vi.fn(),
  movePrivateItems: vi.fn(),
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
  movePrivateItems,
  updatePrivateItem: vi.fn(),
}));

import { PrivateLibraryPage } from "../src/components/pages/PrivateLibraryPage";

describe("Private Library table", () => {
  afterEach(cleanup);

  beforeEach(() => {
    movePrivateItems.mockResolvedValue(undefined);
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

  it("opens files directly and keeps selection in the file browser", async () => {
    render(<PrivateLibraryPage folderId={null} />);

    const list = await screen.findByRole("list", { name: "Private files" });
    const toolbar = screen.getByRole("toolbar", { name: "Private file selection" });
    expect(list).toBeVisible();
    expect(toolbar.closest(".eq-file-browser")).toContainElement(list);
    expect(within(list).getAllByRole("checkbox")).toHaveLength(2);
    expect(
      screen.getByRole("link", {
        name: "Open Practice board",
      }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Practice board" })).toHaveAttribute(
      "href",
      "#/play/game-1?from=private",
    );

    const folderLink = screen.getByRole("link", {
      name: "Open Algebra drills",
    });
    fireEvent.click(folderLink);
    await waitFor(() => expect(window.location.hash).toBe("#/private/folder-1"));
    expect(within(toolbar).getByText("Choose files to move or manage")).toBeVisible();
  });

  it("supports click, shift range, checkbox, and select all", async () => {
    render(<PrivateLibraryPage folderId={null} />);

    await screen.findByRole("list", { name: "Private files" });
    const toolbar = screen.getByRole("toolbar", { name: "Private file selection" });
    fireEvent.click(screen.getByRole("button", { name: "Select Algebra drills" }));
    expect(within(toolbar).getByText("1 selected")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Select Practice board" }), {
      shiftKey: true,
    });
    expect(within(toolbar).getByText("2 selected")).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Algebra drills" }));
    expect(within(toolbar).getByText("1 selected")).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible files" }));
    expect(within(toolbar).getByText("2 selected")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(within(toolbar).getByText("Choose files to move or manage")).toBeVisible();
    const file = screen.getByRole("button", { name: "Select Practice board" });
    fireEvent.keyDown(file, { key: "a", ctrlKey: true });
    expect(within(toolbar).getByText("2 selected")).toBeVisible();
    fireEvent.keyDown(file, { key: "Escape" });
    expect(within(toolbar).getByText("Choose files to move or manage")).toBeVisible();
  });

  it("moves a selected file into a chosen folder", async () => {
    render(<PrivateLibraryPage folderId={null} />);
    await screen.findByRole("list", { name: "Private files" });
    fireEvent.click(screen.getByRole("button", { name: "Select Practice board" }));
    fireEvent.click(screen.getByRole("button", { name: "Move to…" }));
    const dialog = screen.getByRole("dialog", { name: "Move item" });
    expect(within(dialog).getByRole("button", { name: "Move here" })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: "Private — Already here" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("radio", { name: /Algebra drills/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Move here" }));
    await waitFor(() => expect(movePrivateItems).toHaveBeenCalledWith(["game-item-1"], "folder-1"));
  });

  it("opens a file with a desktop double click or Enter", async () => {
    render(<PrivateLibraryPage folderId={null} />);
    await screen.findByRole("list", { name: "Private files" });
    fireEvent.doubleClick(screen.getByRole("button", { name: "Select Practice board" }));
    await waitFor(() => expect(window.location.hash).toBe("#/play/game-1?from=private"));
    fireEvent.keyDown(screen.getByRole("button", { name: "Select Algebra drills" }), {
      key: "Enter",
    });
    await waitFor(() => expect(window.location.hash).toBe("#/private/folder-1"));
  });

  it("moves files by dropping them on a folder", async () => {
    render(<PrivateLibraryPage folderId={null} />);
    await screen.findByRole("list", { name: "Private files" });
    const source = screen
      .getByRole("button", { name: "Select Practice board" })
      .closest("[role='listitem']")!;
    const destination = screen
      .getByRole("button", { name: "Select Algebra drills" })
      .closest("[role='listitem']")!;
    const transfer = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "move",
      dropEffect: "move",
      setData: (type: string, value: string) => transfer.set(type, value),
      getData: (type: string) => transfer.get(type) ?? "",
    };
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(destination, { dataTransfer });
    fireEvent.drop(destination, { dataTransfer });
    await waitFor(() => expect(movePrivateItems).toHaveBeenCalledWith(["game-item-1"], "folder-1"));
  });
});
