import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const stage = vi.hoisted(() => ({
  listSurvivalLevels: vi.fn(),
  listMySurvivalWins: vi.fn(),
  startSurvivalPractice: vi.fn(),
}));

vi.mock("../src/auth", () => ({
  AccountChip: () => null,
  useAuth: () => auth.value,
}));
vi.mock("../src/supabaseClient", () => ({ isSupabaseConfigured: true, supabase: {} }));
vi.mock("../src/features/survival/repository", () => stage);
// The offline playtest list is a dev-server tool; it is not part of Stage.
vi.mock("../src/features/survivalPlay/api", () => ({
  survivalPlaytestSource: { levels: () => new Promise(() => undefined) },
}));

import { primaryDestinationFor, PrimaryNavigation } from "../src/app/shells/PrimaryNavigation";
import { servedRoute } from "../src/app/servedRoute";
import { LearnPage } from "../src/components/pages/learn/LearnPage";
import { SurvivalPage } from "../src/components/pages/survival/SurvivalPage";
import { CREATE_CHOICES } from "../src/features/rooms/create/createChoices";
import { LocaleProvider } from "../src/i18n/LocaleProvider";
import { chooseLocale, resetActiveLocale } from "../src/i18n/locale";
import { parseHash, routeToHash } from "../src/router";

/** Nothing on these pages may present progression the server does not own. */
const INVENTED = /\bEXP\b|\blevel\b|reward|\bPro\b|\bFree\b|locked|unlock|boss|premium/i;

function level(overrides: Record<string, unknown>) {
  return {
    id: `level-${String(overrides.level_no)}`,
    level_no: 1,
    seed: 4242,
    status: "approved",
    admin_note: "A short endgame with a clear winning line.",
    sample_count: 10,
    win_count: 3,
    start_sealed_at: "2026-09-20T00:00:00Z",
    ...overrides,
  };
}

function signedIn(overrides: Record<string, unknown> = {}) {
  auth.value = {
    configured: true,
    isApproved: true,
    userId: "user-1",
    profile: { id: "user-1", display_name: "Ada", region_id: null, region_name: null },
    ...overrides,
  };
}

function renderIn(ui: ReactElement) {
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}

function page() {
  return screen.getByRole("main");
}

beforeEach(() => {
  window.localStorage.clear();
  resetActiveLocale();
  window.history.replaceState(null, "", "/#/learn");
  signedIn();
  stage.listSurvivalLevels.mockReset().mockResolvedValue([]);
  stage.listMySurvivalWins.mockReset().mockResolvedValue(new Set());
  stage.startSurvivalPractice.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Learn", () => {
  it("is a page of its own, not Study served at #/learn", () => {
    expect(servedRoute({ kind: "learn" })).toEqual({ kind: "learn" });
    renderIn(<LearnPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Learn" })).toBeVisible();
    expect(screen.queryByRole("heading", { level: 1, name: "Study" })).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(nav).getByRole("link", { name: "Learn" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("offers exactly the capabilities that exist, each at its own address", () => {
    renderIn(<LearnPage />);
    const links = within(page())
      .getAllByRole("link")
      .map((link) => [link.querySelector("strong")?.textContent, link.getAttribute("href")]);
    expect(links).toEqual([
      ["Study a position", "#/study"],
      ["Public game history", "#/public/history"],
      ["Your saved games", "#/private"],
      ["Stage", "#/stage"],
    ]);
    for (const [, href] of links) {
      expect(["study", "home", "private", "stage"]).toContain(parseHash(href!).kind);
    }
    // No Training, no puzzles, no separate Analysis page: none is a player
    // capability today. In-game turn analysis is described, not linked.
    expect(page().textContent).not.toMatch(/Training|Puzzle|Drill/i);
    expect(screen.getByText(/analyse your own turn from inside the game/)).toBeVisible();
    expect(page().textContent).not.toMatch(INVENTED);
  });

  it("leads to Study, which is where positions are analysed", async () => {
    const user = userEvent.setup();
    renderIn(<LearnPage />);
    const study = within(page()).getByRole("link", { name: /Study a position/ });
    expect(study).toHaveTextContent(/see the best play/);
    await user.click(study);
    await waitFor(() => expect(parseHash(window.location.hash)).toEqual({ kind: "study" }));
  });

  it("offers the Region's history only to an account that has a region", () => {
    signedIn({
      profile: { id: "user-1", display_name: "Ada", region_id: "r-1", region_name: "North" },
    });
    renderIn(<LearnPage />);
    expect(within(page()).getByRole("link", { name: /Region game history/ })).toHaveAttribute(
      "href",
      "#/region/history",
    );
  });

  it("shows Stage as an Arena activity, not as a learning tool", () => {
    renderIn(<LearnPage />);
    const arena = screen.getByRole("region", { name: "Test yourself" });
    expect(within(arena).getByText("Arena")).toBeVisible();
    expect(within(arena).getByRole("link", { name: /^Stage/ })).toHaveAttribute("href", "#/stage");
    const examine = screen.getByRole("region", { name: "Examine a position" });
    expect(within(examine).queryByRole("link", { name: /Stage/ })).toBeNull();
    expect(page().textContent).not.toMatch(/Survival/i);
  });

  it("speaks Thai", () => {
    chooseLocale("th");
    renderIn(<LearnPage />);
    expect(screen.getByRole("heading", { level: 1, name: "เรียนรู้" })).toBeVisible();
    expect(within(page()).getByRole("link", { name: /ศึกษาตำแหน่ง/ })).toHaveAttribute(
      "href",
      "#/study",
    );
    expect(within(page()).getByRole("link", { name: /^สเตจ/ })).toHaveAttribute("href", "#/stage");
    expect(screen.getByRole("heading", { name: "ทดสอบฝีมือ" })).toBeVisible();
  });
});

describe("Stage addresses and navigation", () => {
  it("#/stage is Stage, and #/survival still opens it", () => {
    expect(parseHash("#/stage")).toEqual({ kind: "stage" });
    expect(parseHash("#/survival")).toEqual({ kind: "stage" });
    expect(routeToHash({ kind: "stage" })).toBe("#/stage");
    // A game started from Stage returns there.
    expect(parseHash("#/play/room-1?from=stage")).toEqual({
      kind: "play",
      roomId: "room-1",
      returnTo: { kind: "stage" },
    });
  });

  it("highlights no primary tab on Stage, and Learn on Learn and Study", () => {
    for (const [hash, expected] of [
      ["#/stage", null],
      ["#/survival", null],
      ["#/learn", "learn"],
      ["#/study", "learn"],
    ] as const) {
      expect(primaryDestinationFor(parseHash(hash)), hash).toBe(expected);
    }
    window.history.replaceState(null, "", "/#/stage");
    renderIn(<PrimaryNavigation />);
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(
      within(nav)
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page"),
    ).toEqual([]);
    // Five destinations, no Stage tab.
    expect(within(nav).getAllByRole("link")).toHaveLength(5);
    expect(within(nav).queryByRole("link", { name: /Stage/ })).toBeNull();
  });

  it("is not a Create choice", () => {
    expect(CREATE_CHOICES as readonly string[]).not.toContain("stage");
  });

  it("keeps Study and in-game analysis at their existing addresses", () => {
    expect(parseHash("#/study")).toEqual({ kind: "study" });
    expect(routeToHash({ kind: "study" })).toBe("#/study");
    expect(parseHash("#/play/room-9?from=public")).toEqual({
      kind: "play",
      roomId: "room-9",
      returnTo: { kind: "home", visibility: "public", section: "live" },
    });
  });
});

describe("the Stage page", () => {
  it("is called Stage, lists the open levels and the player's recorded wins", async () => {
    stage.listSurvivalLevels.mockResolvedValue([
      level({ level_no: 1 }),
      level({ level_no: 2, id: "level-2" }),
      level({ level_no: 3, status: "draft" }),
    ]);
    stage.listMySurvivalWins.mockResolvedValue(new Set(["level-2"]));
    window.history.replaceState(null, "", "/#/stage");
    renderIn(<SurvivalPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Stage" })).toBeVisible();
    const list = await screen.findByRole("list", { name: "Stages" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards.map((card) => within(card).getByRole("heading").textContent)).toEqual([
      "Stage 1",
      "Stage 2",
    ]);
    expect(within(cards[0]).queryByText("You've won this Stage")).toBeNull();
    expect(within(cards[1]).getByText("You've won this Stage")).toBeVisible();
    // The player's own wins are asked for.
    expect(stage.listMySurvivalWins).toHaveBeenCalledWith("user-1");
    expect(page().textContent).not.toMatch(/Survival|MVP|seed|#4242|3\/10/i);
  });

  it("invents no progression, reward or entitlement", async () => {
    stage.listSurvivalLevels.mockResolvedValue([
      level({ level_no: 1 }),
      level({ level_no: 21, id: "level-21" }),
      level({ level_no: 41, id: "level-41" }),
    ]);
    renderIn(<SurvivalPage />);
    const list = await screen.findByRole("list", { name: "Stages" });
    // Every open level is played the same way; no band is locked or priced.
    for (const number of [1, 21, 41]) {
      expect(within(list).getByRole("button", { name: `Play Stage ${number}` })).toBeEnabled();
    }
    expect(page().textContent).not.toMatch(INVENTED);
    expect(page().textContent).not.toMatch(/\d+\s*(of|\/)\s*\d+\s*(cleared|won)/i);
  });

  it("says when a level's start is not sealed, instead of offering a start the server refuses", async () => {
    stage.listSurvivalLevels.mockResolvedValue([
      level({ level_no: 1, start_sealed_at: null }),
      // An older database without the column: the server still decides.
      level({ level_no: 2, id: "level-2", start_sealed_at: undefined }),
    ]);
    renderIn(<SurvivalPage />);
    await screen.findByRole("list", { name: "Stages" });
    expect(screen.queryByRole("button", { name: "Play Stage 1" })).toBeNull();
    expect(screen.getByText("Not open to play yet")).toBeVisible();
    expect(screen.getByRole("button", { name: "Play Stage 2" })).toBeEnabled();
  });

  it("starts through the existing server attempt and returns to Stage", async () => {
    const user = userEvent.setup();
    const target = level({ level_no: 4, id: "level-4" });
    stage.listSurvivalLevels.mockResolvedValue([target]);
    stage.startSurvivalPractice.mockResolvedValue("room-42");
    renderIn(<SurvivalPage />);
    await user.click(await screen.findByRole("button", { name: "Play Stage 4" }));
    expect(stage.startSurvivalPractice).toHaveBeenCalledWith(target, "Ada", "user-1");
    await waitFor(() => expect(window.location.hash).toBe("#/play/room-42?from=stage"));
  });

  it("shows the server's refusal as it is", async () => {
    const user = userEvent.setup();
    stage.listSurvivalLevels.mockResolvedValue([level({ level_no: 1 })]);
    stage.startSurvivalPractice.mockRejectedValue(
      new Error("You already have the maximum number of active boards."),
    );
    renderIn(<SurvivalPage />);
    await user.click(await screen.findByRole("button", { name: "Play Stage 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You already have the maximum number of active boards.",
    );
  });

  it("says so when no level is open", async () => {
    renderIn(<SurvivalPage />);
    expect(await screen.findByText("No Stages are open yet.")).toBeVisible();
  });

  it("speaks Thai", async () => {
    chooseLocale("th");
    stage.listSurvivalLevels.mockResolvedValue([level({ level_no: 7 })]);
    renderIn(<SurvivalPage />);
    expect(screen.getByRole("heading", { level: 1, name: "สเตจ" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "สเตจ 7" })).toBeVisible();
    expect(screen.getByRole("button", { name: "เล่นสเตจ 7" })).toBeEnabled();
  });
});
