import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrimaryNavigation, primaryDestinationFor } from "../src/app/shells/PrimaryNavigation";
import { ApplicationShell } from "../src/app/shells/ApplicationShell";
import { LanguageSwitch } from "../src/components/ui/LanguageSwitch";
import { LocaleProvider } from "../src/i18n/LocaleProvider";
import { chooseLocale, resetActiveLocale } from "../src/i18n/locale";
import { parseHash } from "../src/router";

function at(hash: string) {
  window.history.replaceState(null, "", `/${hash}`);
}

function navigation() {
  return screen.getByRole("navigation", { name: "Primary navigation" });
}

function current() {
  return within(navigation())
    .queryAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.getAttribute("aria-label") ?? link.textContent);
}

beforeEach(() => {
  window.localStorage.clear();
  resetActiveLocale();
  at("#/");
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window.navigator, "language", { configurable: true, value: "en-US" });
});

describe("the five destinations", () => {
  it("are Home, Learn, Create, Ranked and Me, in that order, and nothing else", () => {
    render(<PrimaryNavigation />);
    const links = within(navigation()).getAllByRole("link");
    expect(
      links.map((link) => [
        link.getAttribute("aria-label") ?? link.textContent,
        link.getAttribute("href"),
      ]),
    ).toEqual([
      ["Home", "#/"],
      ["Learn", "#/learn"],
      ["Create game", "#/create"],
      ["Ranked", "#/ranked"],
      ["Me", "#/me"],
    ]);
    for (const retired of ["Public", "Region", "Private", "Profile", "Stage"]) {
      expect(within(navigation()).queryByRole("link", { name: retired })).toBeNull();
    }
  });

  it("each leads to its platform route", () => {
    render(<PrimaryNavigation />);
    for (const [name, kind] of [
      ["Home", "arena"],
      ["Learn", "learn"],
      ["Ranked", "ranked"],
      ["Me", "me"],
    ] as const) {
      const href = within(navigation()).getByRole("link", { name }).getAttribute("href")!;
      expect(parseHash(href).kind, name).toBe(kind);
    }
    expect(
      parseHash(
        within(navigation()).getByRole("link", { name: "Create game" }).getAttribute("href")!,
      ).kind,
    ).toBe("create");
  });

  it("show Create as an action with its own label", () => {
    render(<PrimaryNavigation />);
    const create = within(navigation()).getByRole("link", { name: "Create game" });
    expect(create).toHaveClass("eq-primary-nav-create");
    expect(create).toHaveTextContent("Create");
  });
});

describe("which destination is current", () => {
  it("follows what the route means", () => {
    const cases: Array<[string, string | null]> = [
      ["#/", "home"],
      ["#/home", "home"],
      ["#/learn", "learn"],
      ["#/study", "learn"],
      ["#/ranked", "ranked"],
      ["#/ranked/3f0c1d2e-aaaa-4bbb-8ccc-123456789abc", "ranked"],
      ["#/me", "me"],
      ["#/profile", "me"],
      ["#/private/folder-1", "me"],
      ["#/private?view=trash", "me"],
      // The live-games lobby is not the Arena Home, though it serves #/ for now.
      ["#/public", null],
      ["#/region", null],
      ["#/public/history", null],
      ["#/public/join", null],
      ["#/create", null],
      ["#/stage", null],
      ["#/survival", null],
      ["#/room/abc", null],
      ["#/play/abc", null],
      ["#/admin/bots", null],
      ["#/admin/plans", null],
    ];
    for (const [hash, expected] of cases) {
      expect(primaryDestinationFor(parseHash(hash)), hash).toBe(expected);
    }
  });

  it("marks Home on the Arena route, and nothing on the live-games lobby", () => {
    render(<PrimaryNavigation />);
    expect(current()).toEqual(["Home"]);
    cleanup();
    at("#/public");
    render(<PrimaryNavigation />);
    expect(current()).toEqual([]);
    cleanup();
    at("#/region");
    render(<PrimaryNavigation />);
    expect(current()).toEqual([]);
  });

  it("keeps Ranked current on a match", () => {
    at("#/ranked/3f0c1d2e-aaaa-4bbb-8ccc-123456789abc");
    render(<PrimaryNavigation />);
    expect(current()).toEqual(["Ranked"]);
  });

  it("marks only the Create action while creating", () => {
    at("#/create?space=region");
    render(<PrimaryNavigation />);
    expect(current()).toEqual(["Create game"]);
    expect(within(navigation()).getByRole("link", { name: "Create game" })).toHaveAttribute(
      "href",
      "#/create?space=region",
    );
  });

  it("still starts Create in the space the player came from", () => {
    for (const [hash, href] of [
      ["#/region", "#/create?space=region"],
      ["#/private", "#/create?from=private"],
      ["#/public/history", "#/create?from=public%2Fhistory"],
      ["#/", "#/create"],
    ]) {
      at(hash);
      render(<PrimaryNavigation />);
      expect(within(navigation()).getByRole("link", { name: "Create game" }), hash).toHaveAttribute(
        "href",
        href,
      );
      cleanup();
    }
  });
});

describe("language", () => {
  it("starts in English even when the browser prefers Thai", () => {
    Object.defineProperty(window.navigator, "language", { configurable: true, value: "th-TH" });
    resetActiveLocale();
    render(
      <LocaleProvider>
        <PrimaryNavigation />
      </LocaleProvider>,
    );
    expect(within(navigation()).getByRole("link", { name: "Home" })).toBeVisible();
  });

  it("switches the shell at once when the player chooses Thai, and remembers it", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <LocaleProvider>
        <PrimaryNavigation />
        <LanguageSwitch />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: "ไทย" }));
    const thaiNav = screen.getByRole("navigation", { name: "เมนูหลัก" });
    expect(within(thaiNav).getByRole("link", { name: "หน้าหลัก" })).toHaveAttribute("href", "#/");
    expect(within(thaiNav).getByRole("link", { name: "สร้างเกม" })).toBeVisible();
    unmount();

    resetActiveLocale(); // a reload
    render(
      <LocaleProvider>
        <PrimaryNavigation />
      </LocaleProvider>,
    );
    expect(screen.getByRole("navigation", { name: "เมนูหลัก" })).toBeVisible();
  });

  it("keeps the product name canonical in Thai", () => {
    chooseLocale("th");
    render(
      <LocaleProvider>
        <ApplicationShell title="x">
          <p>content</p>
        </ApplicationShell>
      </LocaleProvider>,
    );
    expect(screen.getByRole("link", { name: "หน้าหลัก EQ Lab" })).toHaveTextContent("EQ Lab");
  });
});

describe("brand", () => {
  it("goes to the Arena Home", () => {
    render(
      <ApplicationShell title="x">
        <p>content</p>
      </ApplicationShell>,
    );
    expect(screen.getByRole("link", { name: "EQ Lab home" })).toHaveAttribute("href", "#/");
  });
});
