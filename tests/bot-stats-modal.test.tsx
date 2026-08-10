import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/botStats", () => ({
  closeBotFolder: vi.fn(),
  computeFolderStats: vi.fn(),
  createBotFolder: vi.fn(),
  deleteBotFolder: vi.fn(),
  listBotFolders: vi.fn().mockResolvedValue([]),
  loadFolderGames: vi.fn(),
  openBotFolder: vi.fn(),
}));

import { BotStatsPanel } from "../src/components/botstats/BotStatsPanel";

describe("Bot stats modal", () => {
  afterEach(cleanup);

  it("portals the dialog above the app and keeps backdrop dismissal", async () => {
    const onClose = vi.fn();
    const { container } = render(<BotStatsPanel onClose={onClose} />);

    const dialog = await screen.findByRole("dialog", { name: "Bot stat folders" });
    const backdrop = dialog.closest(".bstat-backdrop");

    expect(backdrop?.parentElement).toBe(document.body);
    expect(container).not.toContainElement(dialog);

    fireEvent.click(screen.getByRole("button", { name: "Close bot statistics" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
