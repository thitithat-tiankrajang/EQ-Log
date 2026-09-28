import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { servedRoute } from "../src/app/servedRoute";
import { PrimaryNavigation } from "../src/app/shells/PrimaryNavigation";
import { navigate, parseHash, useRoute, type Route } from "../src/router";

beforeEach(() => {
  window.history.replaceState(null, "", "/#/public");
});

afterEach(() => {
  cleanup();
});

describe("pages serving the platform destinations until they are built", () => {
  it("serves the Arena Home with the Public live-games lobby and Learn with Study", () => {
    expect(servedRoute({ kind: "arena" })).toEqual({
      kind: "home",
      visibility: "public",
      section: "live",
    });
    expect(servedRoute({ kind: "learn" })).toEqual({ kind: "study" });
  });

  it("leaves every destination that has its own page alone", () => {
    const routes: Route[] = [
      // Me has its own page now.
      { kind: "me" },
      { kind: "stage" },
      { kind: "ranked" },
      { kind: "ranked", matchId: "m-1" },
      { kind: "study" },
      { kind: "profile" },
      { kind: "home", visibility: "region", section: "history" },
      { kind: "private", folderId: null },
      { kind: "create", visibility: "public" },
      { kind: "admin", section: "plans" },
      { kind: "play", roomId: "g", returnTo: { kind: "arena" } },
    ];
    for (const route of routes) expect(servedRoute(route)).toBe(route);
  });
});

describe("primary navigation during the transition", () => {
  it("marks Home on the site root by what the route means, not by the page serving it", () => {
    window.history.replaceState(null, "", "/#/");
    render(<PrimaryNavigation />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });

  it("marks Me on #/me", () => {
    window.history.replaceState(null, "", "/#/me");
    render(<PrimaryNavigation />);
    expect(screen.getByRole("link", { name: "Me" })).toHaveAttribute("aria-current", "page");
  });

  it("still offers Create and the same five destinations", () => {
    window.history.replaceState(null, "", "/#/learn");
    const { container } = render(<PrimaryNavigation />);
    expect(screen.getByRole("link", { name: "Create game" })).toHaveAttribute("href", "#/create");
    expect(container.querySelectorAll("nav > a")).toHaveLength(5);
  });
});

describe("browser navigation", () => {
  it("writes an empty address as the Arena Home without adding history", () => {
    window.history.replaceState(null, "", "/");
    const before = window.history.length;
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ kind: "arena" });
    expect(window.location.hash).toBe("#/");
    expect(window.history.length).toBe(before);
  });

  it("follows hash changes, including Back to where it came from", async () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ kind: "home", visibility: "public", section: "live" });
    act(() => navigate({ kind: "learn" }));
    await waitFor(() => expect(result.current).toEqual({ kind: "learn" }));
    expect(window.location.hash).toBe("#/learn");
    act(() => navigate({ kind: "arena" }));
    await waitFor(() => expect(result.current).toEqual({ kind: "arena" }));
    expect(window.location.hash).toBe("#/");
    act(() => window.history.back());
    await waitFor(() => expect(result.current).toEqual({ kind: "learn" }));
    // A replacing navigation takes effect at once and adds no entry.
    const before = window.history.length;
    act(() => navigate({ kind: "stage" }, true));
    expect(result.current).toEqual({ kind: "stage" });
    expect(parseHash(window.location.hash)).toEqual({ kind: "stage" });
    expect(window.history.length).toBe(before);
  });
});
