import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lists = vi.hoisted(() => ({
  listRooms: vi.fn(),
  listPrivateRooms: vi.fn(),
  rankedList: vi.fn(),
}));
vi.mock("../src/remoteRooms", () => ({
  listRooms: lists.listRooms,
  listPrivateRooms: lists.listPrivateRooms,
}));
vi.mock("../src/features/ranked/client", () => ({ rankedClient: { list: lists.rankedList } }));
vi.mock("../src/auth", () => ({ AccountChip: () => null, useAuth: () => ({}) }));
vi.mock("../src/supabaseClient", () => ({ isSupabaseConfigured: true, supabase: null }));

import { ArenaHomeView } from "../src/components/pages/home/ArenaHome";
import type { ProBotStatus } from "../src/bot/catalog";
import { arenaBots, type ArenaBot, type CatalogBot } from "../src/features/arena/arenaBots";
import { continuableGames, continuableRanked, openGames } from "../src/features/arena/arenaGames";
import { useArenaGames, type ArenaBots, type ArenaGames } from "../src/features/arena/useArenaHome";
import { LocaleProvider } from "../src/i18n/LocaleProvider";
import { chooseLocale, resetActiveLocale } from "../src/i18n/locale";
import type { RoomMeta } from "../src/rooms";
import { parseHash, routeToHash } from "../src/router";

function room(overrides: Partial<RoomMeta> & { id: string }): RoomMeta {
  return {
    name: `Room ${overrides.id}`,
    createdAt: "2026-09-28T10:00:00Z",
    updatedAt: "2026-09-28T10:00:00Z",
    playerA: "Ann",
    playerB: "Ben",
    turnNumber: 1,
    scoreA: 0,
    scoreB: 0,
    status: "playing",
    accessScope: "public",
    joinPolicy: "open",
    hasOpponent: true,
    ...overrides,
  };
}

const roles: Record<string, string> = {};
const roleOf = (r: RoomMeta) => roles[r.id] ?? "Spectator";

const catalogRow = (overrides: Partial<CatalogBot>): CatalogBot => ({
  bot_key: "authur_strong",
  display_name: "Authur",
  engine_family: "authur",
  difficulty: "super",
  execution_type: "SERVER",
  access_tier: "pro",
  enabled: true,
  new_rooms_allowed: true,
  lifecycle: "active",
  sort_order: 10,
  ...overrides,
});

const AUTHUR: ArenaBot = arenaBots([catalogRow({})], { serverAvailable: true })[0];

/** The Stage 5B bot as the Phase 3b migration opens it: ArchBot, free, on the device. */
const ARCHBOT_ROW: Partial<CatalogBot> = {
  bot_key: "stage5b",
  display_name: "ArchBot",
  engine_family: "stage5b",
  difficulty: "stage5b64",
  execution_type: "CLIENT",
  access_tier: "free",
  sort_order: 20,
};

const probot = (overrides: Partial<ProBotStatus> = {}): ProBotStatus => ({
  evaluated_at: "2026-09-28T10:00:00Z",
  plan_key: "pro",
  plan_name: "EQ Pro",
  plan_ends_at: null,
  allowance: { capacity: 5, available: 3, regen_minutes: 30, next_unit_at: null, reason: "ok" },
  weekly: { used: 1, cap: 30, remaining: 29, week_start: "", week_end: "" },
  credits: 0,
  boards: { active: 1, limit: 3 },
  ...overrides,
});

function renderHome({
  games = { status: "ready", rooms: [], ranked: { mine: [], waitingForOpponent: 0 } },
  bots = { status: "ready", bots: [AUTHUR], probot: probot() },
  regionAvailable = false,
}: { games?: ArenaGames; bots?: ArenaBots; regionAvailable?: boolean } = {}) {
  const handlers = {
    onContinue: vi.fn(),
    onOpenListed: vi.fn(),
    onReloadGames: vi.fn(),
    onReloadBots: vi.fn(),
  };
  render(
    <LocaleProvider>
      <ArenaHomeView
        games={games}
        bots={bots}
        regionAvailable={regionAvailable}
        roleOf={roleOf}
        opening={false}
        {...handlers}
      />
    </LocaleProvider>,
  );
  return handlers;
}

function section(name: string | RegExp) {
  return screen.getByRole("region", { name });
}

beforeEach(() => {
  window.localStorage.clear();
  resetActiveLocale();
  for (const key of Object.keys(roles)) delete roles[key];
  window.history.replaceState(null, "", "/#/");
});

afterEach(() => {
  cleanup();
});

describe("Continue", () => {
  it("puts your games first, most recent first, and resumes them through the existing open path", async () => {
    const user = userEvent.setup();
    const mine = room({ id: "mine", name: "Friday game", updatedAt: "2026-09-28T12:00:00Z" });
    const hosted = room({
      id: "hosted",
      name: "Club final",
      status: "draft",
      accessScope: "private",
    });
    const watching = room({ id: "watching", name: "Someone else's game" });
    roles.mine = "Player A";
    roles.hosted = "Owner";
    const { onContinue } = renderHome({
      games: {
        status: "ready",
        rooms: [hosted, watching, mine],
        ranked: { mine: [{ id: "rk-1", status: "playing" }], waitingForOpponent: 0 },
      },
    });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toBe("Continue");
    const rows = within(section("Continue")).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("strong")?.textContent)).toEqual([
      "Ranked match",
      "Friday game",
      "Club final",
    ]);
    // Ranked opens the existing Ranked match page.
    expect(within(rows[0]).getByRole("link")).toHaveAttribute("href", "#/ranked/rk-1");
    expect(rows[2]).toHaveTextContent("Waiting or paused · Private");
    await user.click(within(rows[1]).getByRole("button", { name: /Friday game.*Continue/ }));
    expect(onContinue).toHaveBeenCalledWith(mine);
    expect(
      screen.queryByText("Someone else's game", {
        selector: "section[aria-labelledby=home-continue-heading] *",
      }),
    ).toBeNull();
  });

  it("is left out when there is nothing to continue", () => {
    renderHome();
    expect(screen.queryByRole("region", { name: "Continue" })).toBeNull();
    expect(section("Live now")).toHaveTextContent("No open games right now. Start one below.");
    expect(within(section("Play")).getByRole("link", { name: /Create a game/ })).toBeVisible();
  });

  it("says it is loading, and offers a retry when the lists fail", async () => {
    const user = userEvent.setup();
    renderHome({ games: { status: "loading" } });
    expect(within(section("Continue")).getByRole("status")).toHaveTextContent(
      "Loading your games…",
    );
    cleanup();
    const { onReloadGames } = renderHome({ games: { status: "error" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Your games couldn't be loaded.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onReloadGames).toHaveBeenCalledTimes(1);
    // No invented activity when nothing could be read.
    expect(screen.queryByRole("region", { name: "Continue" })).toBeNull();
  });
});

describe("Live now", () => {
  it("lists other players' open seats, opens them as the lobby does, and links to the full lists", async () => {
    const user = userEvent.setup();
    const seat = room({
      id: "seat",
      name: "Open table",
      status: "draft",
      hasOpponent: false,
      ownerName: "Nok",
    });
    const full = room({ id: "full", name: "Full table", status: "playing" });
    const invite = room({
      id: "invite",
      name: "Invite only",
      status: "draft",
      hasOpponent: false,
      joinPolicy: "invite_only",
    });
    const { onOpenListed } = renderHome({
      games: {
        status: "ready",
        rooms: [seat, full, invite],
        ranked: { mine: [], waitingForOpponent: 2 },
      },
      regionAvailable: true,
    });
    const live = section("Live now");
    expect(
      within(live).getByRole("link", { name: "2 Ranked rooms waiting for an opponent" }),
    ).toHaveAttribute("href", "#/ranked");
    const rows = within(live).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("strong")?.textContent)).toEqual([
      "2 Ranked rooms waiting for an opponent",
      "Open table",
    ]);
    expect(rows[1]).toHaveTextContent("Nok · Open seat · Public");
    await user.click(within(rows[1]).getByRole("button"));
    expect(onOpenListed).toHaveBeenCalledWith(seat);
    expect(within(live).getByRole("link", { name: "All public games" })).toHaveAttribute(
      "href",
      "#/public",
    );
    expect(within(live).getByRole("link", { name: "All region games" })).toHaveAttribute(
      "href",
      "#/region",
    );
  });
});

describe("Play", () => {
  it("leads to the existing Ranked, Stage, Create, join and Learn pages", () => {
    renderHome();
    const play = section("Play");
    for (const [name, href, kind] of [
      [/^Ranked/, "#/ranked", "ranked"],
      [/^Stage/, "#/stage", "stage"],
      [/^Create a game/, "#/create", "create"],
      [/^Join with a code/, "#/public/join", "join"],
    ] as const) {
      const link = within(play).getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(parseHash(href).kind).toBe(kind);
    }
    expect(within(section("Improve")).getByRole("link", { name: /^Learn/ })).toHaveAttribute(
      "href",
      "#/learn",
    );
    // Create is the Create page itself, never a Play menu; Stage is not in it.
    expect(parseHash("#/create")).toEqual({ kind: "create", visibility: "public" });
  });

  it("offers Authur from the catalogue, as EQ Pro, through the existing bot setup", () => {
    renderHome();
    const bots = screen.getByRole("region", { name: "Play against AI" });
    const authur = within(bots).getByRole("link", { name: /Play Authur/ });
    expect(authur).toHaveTextContent("EQ Pro");
    expect(authur).toHaveTextContent("Plays on the game server");
    expect(authur).toHaveTextContent("Pro-Bot allowance: 3 games available");
    // The existing bot-room setup (space step, then the Pro-Bot panel), returning Home.
    expect(authur).toHaveAttribute("href", "#/create?mode=bot&from=home");
    expect(parseHash(authur.getAttribute("href")!)).toEqual({
      kind: "create",
      visibility: "public",
      preset: "bot",
      returnTo: { kind: "arena" },
    });
  });

  it("shows the plan and funding facts the server gave, and nothing it did not", () => {
    renderHome({
      bots: {
        status: "ready",
        bots: [AUTHUR],
        probot: probot({
          plan_key: "free",
          plan_name: "Free",
          allowance: {
            capacity: 0,
            available: 0,
            regen_minutes: null,
            next_unit_at: null,
            reason: "free_plan",
          },
          credits: 2,
          boards: { active: 3, limit: 3 },
        }),
      },
    });
    const authur = screen.getByRole("link", { name: /Play Authur/ });
    expect(authur).toHaveTextContent("The Free plan has no Pro-Bot allowance");
    expect(authur).toHaveTextContent("2 Pro-Bot Credits");
    expect(authur).toHaveTextContent("You already have the maximum number of active boards");
    // Still the same setup: the setup and the server decide, not Home.
    expect(authur).toHaveAttribute("href", "#/create?mode=bot&from=home");
  });

  it("says truthfully when Authur cannot be started, without a link", () => {
    const closed = arenaBots([catalogRow({ enabled: false })], { serverAvailable: true })[0];
    const noServer = arenaBots([catalogRow({})], { serverAvailable: false })[0];
    for (const [bot, text] of [
      [closed, "Not available right now"],
      [noServer, "Needs the game server"],
    ] as const) {
      renderHome({ bots: { status: "ready", bots: [bot], probot: probot() } });
      const row = within(screen.getByRole("region", { name: "Play against AI" })).getByRole(
        "listitem",
      );
      expect(row).toHaveTextContent(text);
      expect(within(row).queryByRole("link")).toBeNull();
      expect(row.querySelector("[aria-disabled=true]")).not.toBeNull();
      cleanup();
    }
  });

  it("shows every bot the catalogue offers, not only Authur", () => {
    const other: ArenaBot = { ...AUTHUR, key: "future_bot", name: "Future Bot", tier: "Free" };
    renderHome({ bots: { status: "ready", bots: [AUTHUR, other], probot: null } });
    const bots = screen.getByRole("region", { name: "Play against AI" });
    expect(
      within(bots)
        .getAllByRole("link")
        .map((link) => link.querySelector("strong")?.textContent),
    ).toEqual(["Play Authur", "Play Future Bot"]);
  });

  it("offers ArchBot beside Authur: Free, on your device, with no Pro-Bot funding", () => {
    const bots = arenaBots([catalogRow({}), catalogRow(ARCHBOT_ROW)], { serverAvailable: true });
    renderHome({ bots: { status: "ready", bots, probot: probot() } });
    const region = section("Play against AI");
    expect(
      within(region)
        .getAllByRole("link")
        .map((link) => link.querySelector("strong")?.textContent),
    ).toEqual(["Play Authur", "Play ArchBot"]);
    const archbot = within(region).getByRole("link", { name: /Play ArchBot/ });
    // ArchBot's own free setup, returning Home.
    expect(archbot).toHaveAttribute("href", "#/create?mode=archbot&from=home");
    expect(archbot).toHaveTextContent("Free");
    expect(archbot).toHaveTextContent("Plays on your device");
    // Allowance, Credits and the game server are Authur's facts, not ArchBot's.
    expect(archbot).not.toHaveTextContent(/Pro-Bot|Credit|game server/);
    const authur = within(region).getByRole("link", { name: /Play Authur/ });
    expect(authur).toHaveTextContent("EQ Pro");
    expect(authur).toHaveTextContent("Plays on the game server");
    expect(authur).toHaveTextContent("Pro-Bot allowance: 3 games available");
  });

  it("has a loading, an error, an empty and an offline state for AI opponents", async () => {
    const user = userEvent.setup();
    const cases: Array<[ArenaBots, RegExp]> = [
      [{ status: "loading" }, /Loading AI opponents/],
      [{ status: "offline" }, /need the online service/],
      [{ status: "ready", bots: [], probot: null }, /No AI opponent is open/],
    ];
    for (const [bots, text] of cases) {
      renderHome({ bots });
      expect(screen.getByRole("region", { name: "Play against AI" })).toHaveTextContent(text);
      cleanup();
    }
    const { onReloadBots } = renderHome({ bots: { status: "error" } });
    const region = screen.getByRole("region", { name: "Play against AI" });
    expect(within(region).getByRole("alert")).toHaveTextContent("AI opponents couldn't be loaded.");
    await user.click(within(region).getByRole("button", { name: "Try again" }));
    expect(onReloadBots).toHaveBeenCalled();
  });

  it("speaks Thai, keeping the plan names", () => {
    chooseLocale("th");
    renderHome();
    expect(screen.getByRole("heading", { level: 1, name: "หน้าหลัก" })).toBeVisible();
    const bots = screen.getByRole("region", { name: "เล่นกับ AI" });
    expect(within(bots).getByRole("link", { name: /เล่นกับ Authur/ })).toHaveTextContent("EQ Pro");
    expect(screen.getByRole("region", { name: "เล่น" })).toBeVisible();
  });
});

describe("the bot catalogue", () => {
  it("decides which bots appear, by name, tier and order", () => {
    const bots = arenaBots(
      [
        catalogRow({ sort_order: 10, display_name: "Authur the Second", access_tier: "pro" }),
        // Not offered: pending (ArchBot until Phase 3b), retired, or no setup here.
        catalogRow({
          bot_key: "stage5b",
          display_name: "ArchBot",
          lifecycle: "pending",
          enabled: false,
          access_tier: "free",
          execution_type: "CLIENT",
        }),
        catalogRow({
          bot_key: "aether_hard",
          display_name: "Aether Hard",
          lifecycle: "retired",
          new_rooms_allowed: false,
        }),
        catalogRow({ bot_key: "unknown_active", display_name: "Unknown", sort_order: 1 }),
      ],
      { serverAvailable: true },
    );
    expect(bots.map((bot) => [bot.name, bot.tier, bot.unavailable])).toEqual([
      ["Authur the Second", "EQ Pro", null],
    ]);
  });

  it("offers ArchBot once the catalogue opens it, with or without the game server", () => {
    for (const serverAvailable of [true, false]) {
      const bots = arenaBots([catalogRow({}), catalogRow(ARCHBOT_ROW)], { serverAvailable });
      expect(bots.map((bot) => [bot.name, bot.tier, bot.execution, bot.unavailable])).toEqual([
        ["Authur", "EQ Pro", "SERVER", serverAvailable ? null : "no_server"],
        ["ArchBot", "Free", "CLIENT", null],
      ]);
    }
    const closed = arenaBots([catalogRow({ ...ARCHBOT_ROW, new_rooms_allowed: false })], {
      serverAvailable: true,
    });
    expect(closed.map((bot) => [bot.name, bot.unavailable])).toEqual([["ArchBot", "closed"]]);
  });

  it("reads the tier from the catalogue rather than assuming one", () => {
    expect(
      arenaBots([catalogRow({ access_tier: "free" })], { serverAvailable: true })[0].tier,
    ).toBe("Free");
    expect(
      arenaBots([catalogRow({ access_tier: "plus" })], { serverAvailable: true })[0].tier,
    ).toBe("EQ Plus");
  });
});

describe("the lists Home reads", () => {
  it("are the lobbies' own calls: Public, your Region and Private, and the Ranked list", async () => {
    lists.listRooms.mockReset().mockResolvedValue([room({ id: "a" })]);
    lists.listPrivateRooms
      .mockReset()
      .mockResolvedValue([room({ id: "a" }), room({ id: "p", accessScope: "private" })]);
    lists.rankedList.mockReset().mockResolvedValue({
      open: [
        { id: "o1", creatorId: "me" },
        { id: "o2", creatorId: "x" },
      ],
      mine: [
        { id: "w", status: "waiting" },
        { id: "f", status: "finished" },
        { id: "p1", status: "playing" },
      ],
    });
    const { result } = renderHook(() =>
      useArenaGames({ remoteEnabled: true, regionId: "r-1", userId: "me" }),
    );
    await waitFor(() => expect(result.current.games.status).toBe("ready"));
    expect(lists.listRooms).toHaveBeenCalledWith({ visibility: "public", regionId: null });
    expect(lists.listRooms).toHaveBeenCalledWith({ visibility: "region", regionId: "r-1" });
    expect(lists.listPrivateRooms).toHaveBeenCalled();
    const games = result.current.games as Extract<ArenaGames, { status: "ready" }>;
    expect(games.rooms.map((r) => r.id)).toEqual(["a", "p"]);
    expect(games.ranked).toEqual({
      mine: [
        { id: "p1", status: "playing" },
        { id: "w", status: "waiting" },
      ],
      waitingForOpponent: 1,
    });
  });

  it("show Ranked as nothing, not zero, when it cannot be read, and fail recoverably otherwise", async () => {
    lists.listRooms.mockReset().mockResolvedValue([]);
    lists.listPrivateRooms.mockReset().mockResolvedValue([]);
    lists.rankedList.mockReset().mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() =>
      useArenaGames({ remoteEnabled: true, regionId: null, userId: "me" }),
    );
    await waitFor(() =>
      expect(result.current.games).toEqual({ status: "ready", rooms: [], ranked: null }),
    );
    expect(lists.listRooms).toHaveBeenCalledTimes(1);

    lists.listPrivateRooms.mockRejectedValueOnce(new Error("approved membership required"));
    result.current.reload();
    await waitFor(() => expect(result.current.games.status).toBe("error"));
  });

  it("choose continuable and open games by the server's role, never by guess", () => {
    roles.mine = "Owner";
    roles.admin = "Admin";
    const rooms = [
      room({ id: "mine", status: "draft" }),
      room({ id: "admin", status: "playing" }),
      room({ id: "done", status: "finished" }),
      room({ id: "seat", status: "draft", hasOpponent: false }),
    ];
    roles.done = "Player B";
    expect(continuableGames(rooms, roleOf).map((r) => r.id)).toEqual(["mine"]);
    expect(openGames(rooms, roleOf).map((r) => r.id)).toEqual(["seat"]);
    expect(continuableRanked([{ id: "x", status: "finished" }])).toEqual([]);
  });
});

describe("Home's code", () => {
  const read = (path: string) =>
    readFileSync(join(process.cwd(), path), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
  const sources = [
    "src/components/pages/home/ArenaHome.tsx",
    "src/features/arena/arenaGames.ts",
    "src/features/arena/arenaBots.ts",
    "src/features/arena/useArenaHome.ts",
  ].map(read);

  it("makes no authority of its own: no join, claim, create, preview or rating", () => {
    for (const source of sources) {
      expect(source).not.toMatch(
        /\.join\(\s*[a-z]|joinRoom|createRoom|claim|\.preview\(|create_bot_game|ranked_/,
      );
      expect(source).not.toMatch(/10\s*\*\*|Math\.pow|\/\s*400\b/);
      expect(source).not.toMatch(/\bexp\b|\blevel\b/i);
    }
  });

  it("does not assume Authur is the only bot", () => {
    const home = sources[0];
    expect(home).not.toMatch(/Authur/);
  });
});

it("keeps the (+) Create choices exactly as C5 made them", async () => {
  const { CREATE_CHOICES } = await import("../src/features/rooms/create/createChoices");
  expect([...CREATE_CHOICES]).toEqual(["match", "host", "passplay", "solo", "custom"]);
  expect(
    routeToHash({
      kind: "create",
      visibility: "public",
      preset: "bot",
      returnTo: { kind: "arena" },
    }),
  ).toBe("#/create?mode=bot&from=home");
});
