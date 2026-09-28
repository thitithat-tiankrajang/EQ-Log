import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
const leaderboard = vi.hoisted(() => vi.fn());

vi.mock("../src/auth", () => ({
  AccountChip: () => null,
  useAuth: () => auth.value,
}));
vi.mock("../src/supabaseClient", () => ({ isSupabaseConfigured: true, supabase: {} }));
vi.mock("../src/features/ranked/client", () => ({ rankedClient: { leaderboard } }));

import { MePage } from "../src/components/pages/me/MePage";
import { LocaleProvider } from "../src/i18n/LocaleProvider";
import { resetActiveLocale } from "../src/i18n/locale";

const signOut = vi.fn();

function signedIn(overrides: Record<string, unknown> = {}) {
  auth.value = {
    configured: true,
    isApproved: true,
    userId: "user-1",
    signOut,
    profile: {
      id: "user-1",
      email: "ada@example.test",
      display_name: "Ada",
      status: "approved",
      is_admin: false,
      region_id: "r-1",
      region_name: "North",
    },
    ...overrides,
  };
}

function renderMe() {
  return render(
    <LocaleProvider>
      <MePage />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetActiveLocale();
  window.history.replaceState(null, "", "/#/me");
  leaderboard.mockReset().mockResolvedValue({
    rows: [],
    own: { rating: 1234, games: 7, wins: 5, losses: 2, draws: 0 },
  });
  signOut.mockReset();
  signedIn();
});

afterEach(() => {
  cleanup();
});

describe("Me", () => {
  it("is its own page, not the Profile page", () => {
    renderMe();
    expect(screen.getByRole("heading", { level: 1, name: "Me" })).toBeVisible();
    expect(screen.queryByText("At a glance")).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(nav).getByRole("link", { name: "Me" })).toHaveAttribute("aria-current", "page");
  });

  it("shows the signed-in identity from the profile", () => {
    renderMe();
    expect(screen.getByText("Ada")).toBeVisible();
    expect(screen.getByText(/Region: North/)).toBeVisible();
  });

  it("shows the player's own Ranked rating from the Ranked read, with the canonical tier", async () => {
    renderMe();
    expect(await screen.findByText("Gold · 1,234")).toBeVisible();
    expect(screen.getByText("7 ranked games")).toBeVisible();
    expect(leaderboard).toHaveBeenCalledTimes(1);
  });

  it("says when the rating cannot be read, and does not ask for it without approval", async () => {
    leaderboard.mockRejectedValueOnce(new Error("offline"));
    renderMe();
    expect(await screen.findByText(/could not be loaded/)).toBeVisible();
    cleanup();
    leaderboard.mockClear();
    signedIn({ isApproved: false });
    renderMe();
    expect(leaderboard).not.toHaveBeenCalled();
  });

  it("leads to statistics, saved games, both live-games lobbies and Ranked", () => {
    renderMe();
    for (const [name, href] of [
      [/Game statistics/, "#/profile"],
      [/Saved games/, "#/private"],
      [/Public games/, "#/public"],
      [/Region games/, "#/region"],
      [/Open Ranked/, "#/ranked"],
    ] as const) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("offers Admin only to administrators", () => {
    renderMe();
    expect(screen.queryByRole("link", { name: /Admin/ })).toBeNull();
    cleanup();
    signedIn({
      profile: {
        id: "user-1",
        email: "ada@example.test",
        display_name: "Ada",
        status: "approved",
        is_admin: true,
        region_id: null,
        region_name: null,
      },
    });
    renderMe();
    expect(screen.getByRole("link", { name: /Admin/ })).toHaveAttribute("href", "#/admin/users");
  });

  it("signs out through the existing flow", async () => {
    const user = userEvent.setup();
    renderMe();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("switches the whole page to Thai when the player chooses it", async () => {
    const user = userEvent.setup();
    renderMe();
    await user.click(screen.getByRole("button", { name: "ไทย" }));
    expect(screen.getByRole("heading", { level: 1, name: "ฉัน" })).toBeVisible();
    expect(screen.getByRole("link", { name: /เกมที่บันทึกไว้/ })).toHaveAttribute(
      "href",
      "#/private",
    );
    expect(screen.getByRole("navigation", { name: "เมนูหลัก" })).toBeVisible();
    // The tier is a product name and stays canonical.
    await waitFor(() => expect(screen.getByText("Gold · 1,234")).toBeVisible());
  });

  it("invents nothing: no level, EXP, activity, achievements or online status", async () => {
    renderMe();
    await screen.findByText("Gold · 1,234");
    expect(document.body.textContent).not.toMatch(
      /\bEXP\b|\blevel\b|achievement|badge|activity|online|follow/i,
    );
  });

  it("works without an account on a local-only build", () => {
    auth.value = { configured: false, isApproved: false, userId: null, profile: null, signOut };
    renderMe();
    expect(screen.getByText(/without an account/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(leaderboard).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Public games/ })).toBeVisible();
  });
});
