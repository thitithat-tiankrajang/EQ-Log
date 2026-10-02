import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const online = vi.hoisted(() => ({ configured: true }));
const { from, rpc, invoke } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), invoke: vi.fn() }));

vi.mock("../src/supabaseClient", () => ({
  get isSupabaseConfigured() {
    return online.configured;
  },
  supabase: { from, rpc, functions: { invoke } },
}));
vi.mock("../src/auth", () => ({
  useAuth: () => ({ profile: { display_name: "Ada" }, userId: "user-1" }),
  AccountChip: () => null,
}));
vi.mock("../src/admin", () => ({ AdminButton: () => null, AdminPage: () => null }));
vi.mock("../src/components/pages/lobby/useMembersCatalog", () => ({
  useMembersCatalog: () => ({ error: null, loading: false, members: [] }),
}));
vi.mock("../src/components/pages/lobby/useRegisteredPlayersCatalog", () => ({
  useRegisteredPlayersCatalog: () => ({ error: null, loading: false, players: [] }),
}));

import { PrimaryNavigation } from "../src/app/shells/PrimaryNavigation";
import { settingsForPlayMode } from "../src/components/pages/lobby/CreateRoomPanel";
import { CreateRoomPage } from "../src/components/pages/pregame/CreateRoomPage";
import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { createNewGame, type NewGameSettings } from "../src/game";
import { LocaleProvider } from "../src/i18n/LocaleProvider";
import { chooseLocale, resetActiveLocale } from "../src/i18n/locale";
import { createRoom, emptyLiveSession, type CreateRoomPolicy } from "../src/remoteRooms";
import { parseHash, routeToHash, type CreatePreset, type ReturnDestination } from "../src/router";

type Created = { settings: NewGameSettings; policy: CreateRoomPolicy };

/** Every Arena activity and internal name that must not read as a Create choice. */
const NOT_CREATE = /Ranked|Stage|Survival|Authur|ArchBot|stage5b|\bAI\b|\bbot\b|Study/i;

function at(hash: string) {
  window.history.replaceState(null, "", `/${hash}`);
}

function renderPage({
  preset,
  visibility = "public",
  returnTo,
  regionAvailable = true,
  canCreate = true,
}: {
  preset?: CreatePreset;
  visibility?: "public" | "region";
  returnTo?: ReturnDestination;
  regionAvailable?: boolean;
  canCreate?: boolean;
} = {}) {
  const created: Created[] = [];
  const onBack = vi.fn();
  const view = render(
    <LocaleProvider>
      <CreateRoomPage
        canCreate={canCreate}
        createDisabledReason={canCreate ? null : "Your account must be approved first."}
        visibility={visibility}
        returnTo={returnTo}
        regionAvailable={regionAvailable}
        regionId={regionAvailable ? "region-1" : null}
        regionName={regionAvailable ? "North" : null}
        preset={preset}
        submitting={false}
        onBack={onBack}
        onCreate={(settings, policy) => created.push({ settings, policy })}
        onCreateRanked={async () => undefined}
      />
    </LocaleProvider>,
  );
  return { view, created, onBack };
}

function renderNavigation() {
  return render(
    <LocaleProvider>
      <PrimaryNavigation />
    </LocaleProvider>,
  );
}

function createAction() {
  return within(screen.getByRole("navigation", { name: /Primary navigation|เมนูหลัก/ })).getByRole(
    "link",
    { name: /Create game|สร้างเกม/ },
  );
}

function choiceLinks(container: HTMLElement) {
  return within(within(container).getByRole("list")).getAllByRole("link");
}

async function submit(view: ReturnType<typeof render>) {
  const user = userEvent.setup();
  const form = view.getByRole("region", { name: "Room setup" });
  await user.click(within(form).getByRole("button", { name: /Create .*room|Start/i }));
}

beforeEach(() => {
  online.configured = true;
  window.localStorage.clear();
  resetActiveLocale();
  at("#/");
});

afterEach(() => {
  cleanup();
});

describe("the (+) Create action", () => {
  it("opens the Create chooser over the current page, and stays a link to #/create", async () => {
    const user = userEvent.setup();
    at("#/learn");
    renderNavigation();
    const create = createAction();
    expect(create).toHaveAttribute("href", "#/create");
    expect(create).toHaveAttribute("aria-haspopup", "dialog");
    expect(create).toHaveAttribute("aria-expanded", "false");

    await user.click(create);

    const dialog = screen.getByRole("dialog", { name: "Create a game" });
    expect(dialog).toBeVisible();
    expect(create).toHaveAttribute("aria-expanded", "true");
    // Opening it is not a navigation.
    expect(window.location.hash).toBe("#/learn");
  });

  it("offers exactly the creation choices that exist, in order", async () => {
    const user = userEvent.setup();
    renderNavigation();
    await user.click(createAction());
    const dialog = screen.getByRole("dialog", { name: "Create a game" });
    expect(
      choiceLinks(dialog).map((link) => [
        link.querySelector("strong")?.textContent,
        link.getAttribute("href"),
      ]),
    ).toEqual([
      ["Play another player", "#/create?mode=match"],
      ["Host a game", "#/create?mode=host"],
      ["Pass & Play / Record", "#/create?mode=passplay"],
      ["Solo practice", "#/create?mode=solo"],
      ["Custom game", "#/create?mode=custom"],
    ]);
    expect(within(dialog).getByRole("link", { name: /Join a game/ })).toHaveAttribute(
      "href",
      "#/public/join",
    );
    // Every choice is an address the router reads back as that choice.
    for (const link of choiceLinks(dialog)) {
      const route = parseHash(link.getAttribute("href")!);
      expect(route.kind).toBe("create");
      expect(routeToHash(route)).toBe(link.getAttribute("href"));
    }
  });

  it("does not present Ranked, Stage or a bot as something to create", async () => {
    const user = userEvent.setup();
    renderNavigation();
    await user.click(createAction());
    const dialog = screen.getByRole("dialog", { name: "Create a game" });
    for (const link of within(dialog).getAllByRole("link")) {
      expect(link.textContent, link.getAttribute("href") ?? "").not.toMatch(NOT_CREATE);
      expect(link.getAttribute("href")).not.toMatch(/mode=(ranked|bot)|#\/(stage|survival|ranked)/);
    }
    expect(dialog.textContent).not.toMatch(/ArchBot|stage5b|Survival/i);
  });

  it("makes hosting discoverable as a neutral role", async () => {
    const user = userEvent.setup();
    renderNavigation();
    await user.click(createAction());
    const host = within(screen.getByRole("dialog")).getByRole("link", { name: /Host a game/ });
    expect(host).toHaveTextContent(/without taking a seat/);
    expect(host).toHaveAttribute("href", "#/create?mode=host");
  });

  it("keeps the space and return place of the page it was opened on", async () => {
    const user = userEvent.setup();
    for (const [hash, match, join] of [
      ["#/region", "#/create?space=region&mode=match", "#/region/join"],
      ["#/private", "#/create?mode=match&from=private", "#/public/join"],
      ["#/private/folder-9", "#/create?mode=match&from=private%2Ffolder-9", "#/public/join"],
      ["#/public/history", "#/create?mode=match&from=public%2Fhistory", "#/public/join"],
      [
        "#/region/history",
        "#/create?space=region&mode=match&from=region%2Fhistory",
        "#/region/join",
      ],
      [
        "#/create?space=region&from=region%2Fhistory",
        "#/create?space=region&mode=match&from=region%2Fhistory",
        "#/region/join",
      ],
      ["#/me", "#/create?mode=match", "#/public/join"],
    ]) {
      at(hash);
      renderNavigation();
      await user.click(createAction());
      const dialog = screen.getByRole("dialog");
      expect(
        within(dialog).getByRole("link", { name: /Play another player/ }),
        hash,
      ).toHaveAttribute("href", match);
      expect(within(dialog).getByRole("link", { name: /Join a game/ }), hash).toHaveAttribute(
        "href",
        join,
      );
      cleanup();
    }
  });

  it("opens from the keyboard, moves focus in, and Escape closes it back onto (+)", async () => {
    const user = userEvent.setup();
    renderNavigation();
    const create = createAction();
    create.focus();
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "Create a game" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Tab stays inside the chooser.
    for (let step = 0; step < 10; step += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(create);
    expect(create).toHaveAttribute("aria-expanded", "false");
  });

  it("closes with its close button", async () => {
    const user = userEvent.setup();
    renderNavigation();
    await user.click(createAction());
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes when a choice is made, and the choice is a navigation", async () => {
    const user = userEvent.setup();
    at("#/region");
    renderNavigation();
    await user.click(createAction());
    await user.click(
      within(screen.getByRole("dialog")).getByRole("link", { name: /Solo practice/ }),
    );
    await waitFor(() => expect(window.location.hash).toBe("#/create?space=region&mode=solo"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("is left behind by Back, and does not reopen on returning", async () => {
    const user = userEvent.setup();
    at("#/learn");
    window.location.hash = "#/me";
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    renderNavigation();
    await user.click(createAction());
    expect(screen.getByRole("dialog")).toBeVisible();

    act(() => window.history.back());
    await waitFor(() => expect(window.location.hash).toBe("#/learn"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    act(() => window.history.forward());
    await waitFor(() => expect(window.location.hash).toBe("#/me"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("follows a modified click as an ordinary link", async () => {
    renderNavigation();
    const create = createAction();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    create.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("speaks Thai when the player chose Thai", async () => {
    const user = userEvent.setup();
    chooseLocale("th");
    renderNavigation();
    await user.click(createAction());
    const dialog = screen.getByRole("dialog", { name: "สร้างเกม" });
    expect(choiceLinks(dialog).map((link) => link.querySelector("strong")?.textContent)).toEqual([
      "เล่นกับผู้เล่นอื่น",
      "เป็นผู้จัดเกม",
      "เล่นเครื่องเดียว / บันทึกเกม",
      "ฝึกเดี่ยว",
      "เกมกำหนดเอง",
    ]);
    expect(within(dialog).getByRole("button", { name: "ปิด" })).toBeVisible();
  });

  it("says why the online choices cannot be used without the online service", async () => {
    online.configured = false;
    const user = userEvent.setup();
    renderNavigation();
    await user.click(createAction());
    const dialog = screen.getByRole("dialog");
    expect(choiceLinks(dialog).map((link) => link.getAttribute("href"))).toEqual([
      "#/create?mode=passplay",
      "#/create?mode=solo",
      "#/create?mode=custom",
    ]);
    expect(within(dialog).getAllByText("Needs the online service")).toHaveLength(2);
  });
});

describe("the #/create page", () => {
  it("shows the same choices when opened directly, in the page's context", () => {
    const { view } = renderPage({
      visibility: "region",
      returnTo: { kind: "home", visibility: "region", section: "history" },
    });
    expect(view.getByRole("heading", { level: 1, name: "Create a game" })).toBeVisible();
    expect(choiceLinks(view.container).map((link) => link.getAttribute("href"))).toEqual([
      "#/create?space=region&mode=match&from=region%2Fhistory",
      "#/create?space=region&mode=host&from=region%2Fhistory",
      "#/create?space=region&mode=passplay&from=region%2Fhistory",
      "#/create?space=region&mode=solo&from=region%2Fhistory",
      "#/create?space=region&mode=custom&from=region%2Fhistory",
    ]);
    // The page's own content; the primary navigation's Ranked tab is not Create.
    expect(view.container.querySelector(".eq-flow-page")?.textContent).not.toMatch(NOT_CREATE);
  });

  it("makes a choice in place of the chooser, so Back skips it as it skipped the old steps", async () => {
    const user = userEvent.setup();
    at("#/public");
    window.location.hash = "#/create";
    await waitFor(() => expect(window.location.hash).toBe("#/create"));
    const before = window.history.length;
    const { view } = renderPage();
    await user.click(view.getByRole("link", { name: /Solo practice/ }));
    expect(window.location.hash).toBe("#/create?mode=solo");
    expect(window.history.length).toBe(before);
  });

  it("goes back to where the player came from", async () => {
    const user = userEvent.setup();
    const { view, onBack } = renderPage();
    await user.click(view.getByRole("button", { name: /Back/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("keeps the choices closed, with the reason, when the account cannot create", () => {
    const { view } = renderPage({ canCreate: false });
    expect(view.getByText("Your account must be approved first.")).toBeVisible();
    expect(within(view.getByRole("list")).queryAllByRole("link")).toHaveLength(0);
  });
});

describe("a bookmarked choice opens its form directly", () => {
  it("solo: no chooser and no space step, and the same solo room as before", async () => {
    const { view, created } = renderPage({ preset: "solo" });
    expect(view.getByRole("heading", { level: 1, name: "Solo practice" })).toBeVisible();
    expect(view.queryByText("Choose a space")).toBeNull();
    expect(view.queryByRole("list", { name: /What do you want/ })).toBeNull();
    expect(view.getByRole("button", { name: "Public" })).toHaveAttribute("aria-pressed", "true");
    await submit(view);
    expect(created).toHaveLength(1);
    expect(created[0].settings.gameMode).toBe("solo");
    expect(created[0].settings.tileDrawMode).toBe("play");
    expect(created[0].policy).toEqual({
      accessScope: "public",
      archivePolicy: "public",
      joinPolicy: "invite_only",
      regionId: null,
    });
  });

  it("pass & play / record: both sides on this device, recording real tiles by default", async () => {
    const { view, created } = renderPage({ preset: "passplay" });
    expect(view.getByRole("heading", { level: 1, name: "Pass & Play / Record" })).toBeVisible();
    expect(view.getByRole("radio", { name: /Pass & play/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Both existing ways of drawing tiles are offered; neither is new.
    expect(view.getByRole("radio", { name: /App draws/ })).toBeInTheDocument();
    expect(view.getByRole("radio", { name: /Enter real tiles/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await submit(view);
    expect(created[0].settings).toMatchObject({
      gameMode: "versus",
      playerA: "Player A",
      playerB: "Player B",
      playerAUserId: null,
      playerBUserId: null,
      tileDrawMode: "manual",
    });
    expect(created[0].policy).toEqual({
      accessScope: "public",
      archivePolicy: "public",
      joinPolicy: "open",
      regionId: null,
    });
  });

  it("player game: the creator takes a side and chooses an opponent", () => {
    const { view } = renderPage({ preset: "match" });
    expect(view.getByRole("heading", { level: 1, name: "Play another player" })).toBeVisible();
    expect(view.getByRole("radio", { name: /Online/ })).toHaveAttribute("aria-checked", "true");
    expect(view.getByRole("radio", { name: /I play one side/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(view.getByText("Signed in as Ada")).toBeVisible();
  });

  it("hosted game: the host role is chosen and the host is not seated", () => {
    const { view } = renderPage({ preset: "host" });
    expect(view.getByRole("heading", { level: 1, name: "Host a game" })).toBeVisible();
    expect(view.getByRole("radio", { name: /I host two players/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // The one-player host option stays one tap away.
    expect(view.getByRole("radio", { name: /I host one player/ })).toBeInTheDocument();
    expect(view.queryByText("Signed in as Ada")).toBeNull();
  });

  it("starts the player and host forms from the same seating as choosing them in the form", () => {
    const direct = settingsForPlayMode(DEFAULT_NEW_GAME_SETTINGS, "direct_email", "user-1", "Ada");
    expect(direct).toMatchObject({
      gameMode: "versus",
      emailPlayMode: "direct",
      playerA: "Ada",
      playerAUserId: "user-1",
      playerBUserId: null,
      tileDrawMode: "play",
    });
    const hosted = settingsForPlayMode(DEFAULT_NEW_GAME_SETTINGS, "hosted_email", "user-1", "Ada");
    expect(hosted).toMatchObject({
      gameMode: "versus",
      emailPlayMode: "hosted",
      playerAUserId: null,
      playerBUserId: null,
      tileDrawMode: "play",
    });
    const physical = settingsForPlayMode(
      { ...hosted, tileDrawMode: "manual", playerAUserId: "user-1" },
      "hosted_email",
      "user-1",
      "Ada",
    );
    expect(physical).toMatchObject({ tileDrawMode: "manual", playerAUserId: "user-1" });
    // Hosting alone is never read as a seat.
    expect([hosted.playerAUserId, hosted.playerBUserId]).not.toContain("user-1");
  });

  it("falls back to this-device play when the online service is missing", () => {
    online.configured = false;
    const { view } = renderPage({ preset: "match" });
    expect(view.getByRole("radio", { name: /Pass & play/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(view.getByRole("radio", { name: /Online/ })).toBeDisabled();
  });
});

describe("who can watch, inside the form", () => {
  it("starts in the Region when the player came from it", async () => {
    const { view, created } = renderPage({ preset: "passplay", visibility: "region" });
    expect(view.getByRole("button", { name: "North" })).toHaveAttribute("aria-pressed", "true");
    await submit(view);
    expect(created[0].policy).toEqual({
      accessScope: "region",
      archivePolicy: "region",
      joinPolicy: "open",
      regionId: "region-1",
    });
  });

  it("starts Private when the player came from their saved games", async () => {
    const { view, created } = renderPage({
      preset: "passplay",
      returnTo: { kind: "private", folderId: null },
    });
    expect(view.getByRole("button", { name: "Private" })).toHaveAttribute("aria-pressed", "true");
    expect(view.getByRole("checkbox", { name: "Save finished game to Private" })).toBeChecked();
    await submit(view);
    expect(created[0].policy).toEqual({
      accessScope: "private",
      archivePolicy: "private",
      joinPolicy: "invite_only",
      regionId: null,
    });
  });

  it("can be changed, with the join policy following the space as in Custom", async () => {
    const user = userEvent.setup();
    const { view, created } = renderPage({ preset: "passplay" });
    await user.click(view.getByRole("button", { name: "Private" }));
    await user.click(view.getByRole("checkbox", { name: "Save finished game to Private" }));
    await submit(view);
    expect(created[0].policy).toEqual({
      accessScope: "private",
      archivePolicy: "none",
      joinPolicy: "invite_only",
      regionId: null,
    });
  });

  it("does not offer a Region the account does not have", () => {
    const { view } = renderPage({ preset: "solo", visibility: "region", regionAvailable: false });
    expect(view.getByRole("button", { name: "Region" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Public" })).toHaveAttribute("aria-pressed", "true");
    expect(view.getByText("Ask an admin to assign your region")).toBeVisible();
  });

  it("speaks Thai", () => {
    chooseLocale("th");
    const { view } = renderPage({ preset: "solo" });
    expect(view.getByRole("heading", { level: 1, name: "ฝึกเดี่ยว" })).toBeVisible();
    expect(view.getByRole("heading", { name: "ใครดูได้บ้าง" })).toBeVisible();
    expect(view.getByRole("button", { name: "สาธารณะ" })).toHaveAttribute("aria-pressed", "true");
    expect(view.getByRole("button", { name: "กลับ" })).toBeVisible();
  });
});

describe("Custom", () => {
  it("is the full step-by-step setup, without the Arena activities", async () => {
    const user = userEvent.setup();
    const { view } = renderPage({ preset: "custom" });
    expect(view.getByRole("heading", { level: 1, name: "Choose a space" })).toBeVisible();
    await user.click(view.getByRole("button", { name: /^Public/ }));
    const cards = view
      .getAllByRole("button")
      .filter((button) => button.classList.contains("eq-create-choice"))
      .map((button) => button.querySelector("strong")?.textContent);
    expect(cards).toEqual(["Match", "Solo Practice", "Authur"]);
    expect(view.queryByRole("button", { name: /Ranked|Survival|Study|ArchBot/ })).toBeNull();
  });

  it("introduces its setup form in the player's language", async () => {
    const user = userEvent.setup();
    chooseLocale("th");
    const { view } = renderPage({ preset: "custom" });
    const choices = () =>
      view.getAllByRole("button").filter((button) => button.classList.contains("eq-create-choice"));
    await user.click(choices()[0]);
    await user.click(choices()[0]);
    expect(view.getByText("ตั้งค่าเกมของคุณ")).toBeVisible();
    expect(view.queryByText("Set up your game.")).toBeNull();
  });
});

describe("older Create addresses", () => {
  it("still read as before", () => {
    expect(parseHash("#/create")).toEqual({ kind: "create", visibility: "public" });
    expect(parseHash("#/region/create")).toEqual({ kind: "create", visibility: "region" });
    expect(parseHash("#/public/create?mode=solo")).toEqual({
      kind: "create",
      visibility: "public",
      preset: "solo",
    });
    expect(parseHash("#/create?space=region&mode=bot&from=region%2Fhistory")).toEqual({
      kind: "create",
      visibility: "region",
      preset: "bot",
      returnTo: { kind: "home", visibility: "region", section: "history" },
    });
    expect(parseHash("#/create?mode=ranked")).toEqual({
      kind: "create",
      visibility: "public",
      preset: "ranked",
    });
    // An unknown mode is the chooser, not an error.
    expect(parseHash("#/create?mode=stage5b")).toEqual({ kind: "create", visibility: "public" });
  });

  it("keeps the Ranked page's create address working without offering it in Create", () => {
    const { view } = renderPage({ preset: "ranked" });
    expect(view.getByRole("heading", { level: 1, name: "Configure ranked match" })).toBeVisible();
  });

  it("keeps the vs Authur address working behind the space step", async () => {
    const user = userEvent.setup();
    const { view } = renderPage({ preset: "bot" });
    expect(view.getByRole("heading", { level: 1, name: "Choose a space" })).toBeVisible();
    await user.click(view.getByRole("button", { name: /^Private/ }));
    expect(view.getByRole("heading", { level: 1, name: "Play vs Authur" })).toBeVisible();
  });
});

describe("creation failures", () => {
  it("still reach the player as the localised active-board-limit message", async () => {
    invoke.mockReset().mockResolvedValue({
      data: null,
      error: { message: "active_board_limit: you have 3 active boards already (limit 3)" },
    });
    const game = createNewGame({ ...DEFAULT_NEW_GAME_SETTINGS, tileDrawMode: "play" });
    const attempt = () =>
      createRoom(
        game,
        "11111111-1111-4111-8111-111111111111",
        emptyLiveSession(null),
        { visibility: "public", regionId: null },
        {
          accessScope: "private",
          archivePolicy: "private",
          joinPolicy: "invite_only",
          regionId: null,
        },
      );
    await expect(attempt()).rejects.toThrow(
      "You already have the maximum number of active boards. Finish or cancel one before starting another.",
    );
    chooseLocale("th");
    await expect(attempt()).rejects.toThrow(
      "คุณมีกระดานที่กำลังเล่นครบจำนวนแล้ว — จบหรือยกเลิกเกมเดิมก่อนเริ่มเกมใหม่",
    );
    // Both retries use the server-created live protocol.
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(["live-game", "live-game"]);
  });
});
