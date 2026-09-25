import { describe, expect, it } from "vitest";
import { parseHash, routeToHash } from "../src/router";

describe("application routes", () => {
  it("makes Public and Region live/history destinations addressable", () => {
    expect(parseHash("#/public")).toEqual({ kind: "home", visibility: "public", section: "live" });
    expect(parseHash("#/region/history")).toEqual({
      kind: "home",
      visibility: "region",
      section: "history",
    });
  });

  it("keeps legacy workspace links safe without restoring legacy navigation", () => {
    expect(parseHash("#/public/rooms")).toEqual({
      kind: "home",
      visibility: "public",
      section: "live",
    });
    expect(parseHash("#/region/members")).toEqual({ kind: "profile" });
    expect(parseHash("#/public/not-a-page")).toEqual({
      kind: "home",
      visibility: "public",
      section: "live",
    });
  });

  it("addresses the central create, private library, and profile destinations", () => {
    expect(parseHash("#/create")).toEqual({ kind: "create", visibility: "public" });
    expect(parseHash("#/private/folder-1")).toEqual({
      kind: "private",
      folderId: "folder-1",
      trash: false,
    });
    expect(parseHash("#/private?view=trash")).toEqual({
      kind: "private",
      folderId: null,
      trash: true,
    });
    expect(parseHash("#/profile")).toEqual({ kind: "profile" });
    expect(routeToHash({ kind: "create", visibility: "public" })).toBe("#/create");
  });

  it("keeps room, replay, and admin links compatible", () => {
    expect(parseHash("#/room/ABC123")).toEqual({ kind: "room", roomId: "ABC123" });
    expect(parseHash("#/play/ABC123")).toEqual({ kind: "play", roomId: "ABC123" });
    expect(routeToHash({ kind: "admin", section: "regions" })).toBe("#/admin/regions");
  });

  it("opens ranked lobby and shareable ranked matches", () => {
    expect(parseHash("#/ranked")).toEqual({ kind: "ranked" });
    expect(parseHash(routeToHash({ kind: "ranked", matchId: "abc-123" }))).toEqual({
      kind: "ranked",
      matchId: "abc-123",
    });
  });

  it("opens ranked configuration inside the shared create-room flow", () => {
    const route = {
      kind: "create" as const,
      visibility: "public" as const,
      preset: "ranked" as const,
    };
    expect(parseHash(routeToHash(route))).toEqual(route);
  });

  it("keeps the exact History or private folder destination through room and play links", () => {
    const destinations = [
      { kind: "home" as const, visibility: "region" as const, section: "history" as const },
      { kind: "private" as const, folderId: "folder/one", trash: false },
      { kind: "private" as const, folderId: null, trash: true },
    ];
    for (const returnTo of destinations) {
      for (const kind of ["room", "play"] as const) {
        const route = { kind, roomId: "game/id", returnTo };
        expect(parseHash(routeToHash(route))).toEqual(route);
      }
    }
  });

  it("keeps the source page when Create is opened from History or a private folder", () => {
    for (const returnTo of [
      { kind: "home" as const, visibility: "region" as const, section: "history" as const },
      { kind: "private" as const, folderId: "folder/one", trash: false },
    ]) {
      const route = { kind: "create" as const, visibility: "public" as const, returnTo };
      expect(parseHash(routeToHash(route))).toEqual(route);
    }
  });

  it("ignores untrusted or unsupported return destinations in shared links", () => {
    expect(parseHash("#/play/game-1?from=play%2Fother-game")).toEqual({
      kind: "play",
      roomId: "game-1",
    });
    expect(parseHash("#/play/game-1?from=https%3A%2F%2Fexample.com")).toEqual({
      kind: "play",
      roomId: "game-1",
    });
  });

  it("preserves a room code in a shareable join route", () => {
    expect(parseHash("#/region/join?code=AB12CD34EF56")).toEqual({
      kind: "join",
      visibility: "region",
      code: "AB12CD34EF56",
    });
    expect(routeToHash({ kind: "join", visibility: "public", code: "AB12 CD34" })).toBe(
      "#/public/join?code=AB12%20CD34",
    );
  });
});
