import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const listMyHistory = vi.hoisted(() => vi.fn());
vi.mock("../src/features/gameRecords/history", () => ({ listMyHistory }));

import { HistorySection } from "../src/components/pages/profile/HistorySection";

describe("Me History section", () => {
  it("shows safe metadata and links only stored replays", async () => {
    listMyHistory.mockResolvedValue({
      nextCursor: null,
      items: [
        {
          sourceKind: "normal",
          sourceId: "a",
          gameId: "game-a",
          participantSide: "A",
          gameName: "Old game",
          modeKey: "online_versus",
          gameMode: "versus",
          opponentLabel: "Other",
          botKey: null,
          scoreFor: 20,
          scoreAgainst: 10,
          outcome: "win",
          completedAt: "2026-09-29T10:00:00Z",
          rulesVersion: null,
          resultAuthority: "client_reported",
          replayAvailability: "legacy_available",
          isRecent: true,
        },
        {
          sourceKind: "stage",
          sourceId: "b",
          gameId: "game-b",
          participantSide: "A",
          gameName: "Stage level 1",
          modeKey: "stage",
          gameMode: "stage",
          opponentLabel: "Authur",
          botKey: "authur_strong",
          scoreFor: 4,
          scoreAgainst: 9,
          outcome: "loss",
          completedAt: "2026-09-28T10:00:00Z",
          rulesVersion: null,
          resultAuthority: "advisory",
          replayAvailability: "unsupported_legacy",
          isRecent: false,
        },
      ],
    });
    render(<HistorySection userId="owner" />);
    expect(await screen.findByText("Old game", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open legacy replay" })).toHaveAttribute(
      "href",
      "#/play/game-a",
    );
    expect(screen.getByText("Older result · no full replay")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /older result/i })).not.toBeInTheDocument();
    expect(screen.getByText("20–10")).toBeInTheDocument();
    expect(screen.getByText("Recent replay")).toBeInTheDocument();
  });
});
