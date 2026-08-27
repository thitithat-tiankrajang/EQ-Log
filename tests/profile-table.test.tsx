import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listMyModeStats } = vi.hoisted(() => ({ listMyModeStats: vi.fn() }));

vi.mock("../src/auth", () => ({
  AccountChip: () => null,
  useAuth: () => ({
    configured: true,
    profile: { display_name: "Ada", region_name: "North" },
    userId: "user-1",
  }),
}));

vi.mock("../src/admin", () => ({ AdminButton: () => null }));

vi.mock("../src/features/gameRecords/repository", () => ({ listMyModeStats }));

import { ProfilePage } from "../src/components/pages/ProfilePage";

describe("Profile tables", () => {
  beforeEach(() => {
    window.location.hash = "#/profile";
    listMyModeStats.mockResolvedValue([
      {
        profileId: "user-1",
        modeKey: "local_versus",
        gamesCreated: 2,
        gamesPlayed: 3,
        wins: 2,
        losses: 1,
        draws: 0,
        soloScore: 0,
        lastPlayedAt: "2026-08-08T00:00:00.000Z",
      },
      {
        profileId: "user-1",
        modeKey: "solo_practice",
        gamesCreated: 1,
        gamesPlayed: 2,
        wins: 0,
        losses: 0,
        draws: 0,
        soloScore: 1_200,
        lastPlayedAt: "2026-08-09T00:00:00.000Z",
      },
      {
        profileId: "user-1",
        modeKey: "aether_easy",
        gamesCreated: 3,
        gamesPlayed: 4,
        wins: 2,
        losses: 1,
        draws: 1,
        soloScore: 0,
        lastPlayedAt: "2026-08-10T00:00:00.000Z",
      },
    ]);
  });

  it("renders overview and mode details as table rows instead of cards", async () => {
    const { container } = render(<ProfilePage />);

    const overview = await screen.findByRole("table", { name: "Profile overview" });
    expect(within(overview).getByRole("columnheader", { name: "Content" })).toBeVisible();
    const favoriteModeRow = within(overview).getByRole("row", { name: /Favorite mode Aether/ });
    expect(favoriteModeRow).toBeVisible();
    expect(within(favoriteModeRow).getByText("Aether")).toHaveAttribute("data-label", "Value");
    expect(within(overview).getByRole("row", { name: /Versus win rate 57%/ })).toHaveTextContent(
      "Wins 4 · Losses 2 · Draws 1",
    );

    const modes = screen.getByRole("table", { name: "Mode breakdown" });
    expect(within(modes).getByRole("row", { name: /Solo Practice/ })).toHaveTextContent(
      "1,200 total score",
    );
    expect(within(modes).getByRole("row", { name: /Aether/ })).toHaveTextContent(
      // `easy` is retired, so it is listed only because this player has games
      // there; a player who never used it sees the four current tiers alone.
      "easy 4 · medium 0 · hard 0 · max 0 · super 0",
    );
    expect(container.querySelector(".eq-profile-metric, .eq-mode-stat-card")).toBeNull();
  });
});
