import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { RoomVisibility } from "./roomScope";

// Hash routing keeps shared room links working on static hosting without
// requiring server-side rewrite rules.

export type Route =
  | { kind: "home"; visibility: RoomVisibility; section?: LobbySection }
  | {
      kind: "create";
      visibility: RoomVisibility;
      preset?: "solo" | "bot" | "ranked";
      returnTo?: ReturnDestination;
    }
  | { kind: "join"; visibility: RoomVisibility; code?: string }
  | { kind: "private"; folderId: string | null; trash?: boolean }
  | { kind: "profile" }
  | { kind: "study" }
  | { kind: "survival" }
  | { kind: "ranked"; matchId?: string }
  | { kind: "admin"; section: AdminSection }
  | { kind: "room"; roomId: string; returnTo?: ReturnDestination }
  | { kind: "play"; roomId: string; returnTo?: ReturnDestination };

export type LobbySection = "live" | "history" | "rooms" | "members" | "stats";
export type AdminSection = "users" | "regions" | "vision" | "survival" | "study";
export type ReturnDestination =
  | { kind: "home"; visibility: RoomVisibility; section: "live" | "history" }
  | { kind: "private"; folderId: string | null; trash?: boolean };

export function returnDestinationFor(route: Route): ReturnDestination | null {
  if (route.kind === "home") {
    return {
      kind: "home",
      visibility: route.visibility,
      section: route.section === "history" ? "history" : "live",
    };
  }
  if (route.kind === "private") return route;
  if (route.kind === "create") {
    return route.returnTo ?? { kind: "home", visibility: route.visibility, section: "live" };
  }
  if (route.kind === "join") {
    return { kind: "home", visibility: route.visibility, section: "live" };
  }
  if (route.kind === "room" || route.kind === "play") return route.returnTo ?? null;
  return null;
}

function returnDestinationFromQuery(query: string): ReturnDestination | undefined {
  const path = new URLSearchParams(query).get("from");
  if (!path) return undefined;
  const isHome = ["public", "region", "public/history", "region/history"].includes(path);
  const isPrivate =
    path === "private" || path === "private?view=trash" || path.startsWith("private/");
  if (!isHome && !isPrivate) return undefined;
  try {
    const route = parseHash(`#/${path}`);
    if (
      (route.kind === "home" || route.kind === "private") &&
      routeToHash(route).slice(2) === path
    ) {
      return returnDestinationFor(route) ?? undefined;
    }
  } catch {
    // A malformed or obsolete return path must not prevent the room from opening.
  }
  return undefined;
}

export function parseHash(hash: string): Route {
  const cleaned = hash.replace(/^#\/?/, "");
  if (!cleaned) return { kind: "home", visibility: "public", section: "live" };
  const [path, query = ""] = cleaned.split("?", 2);
  const segments = path.split("/").filter(Boolean);
  const visibility = segments[0] === "region" ? "region" : "public";
  const scopedPage =
    segments[0] === "public" || segments[0] === "region" ? segments[1] : segments[0];

  if (segments[0] === "admin") {
    const section =
      segments[1] === "regions" ||
      segments[1] === "vision" ||
      segments[1] === "survival" ||
      segments[1] === "study"
        ? segments[1]
        : "users";
    return { kind: "admin", section };
  }

  if (segments[0] === "private") {
    const params = new URLSearchParams(query);
    return {
      kind: "private",
      folderId: segments[1] ? decodeURIComponent(segments[1]) : null,
      trash: params.get("view") === "trash",
    };
  }
  if (segments[0] === "profile") return { kind: "profile" };
  if (segments[0] === "study") return { kind: "study" };
  if (segments[0] === "survival") return { kind: "survival" };
  if (segments[0] === "ranked")
    return { kind: "ranked", ...(segments[1] ? { matchId: decodeURIComponent(segments[1]) } : {}) };
  if (segments[0] === "create") {
    const params = new URLSearchParams(query);
    const mode = params.get("mode");
    const returnTo = returnDestinationFromQuery(query);
    return {
      kind: "create",
      visibility: params.get("space") === "region" ? "region" : "public",
      preset:
        mode === "solo"
          ? "solo"
          : mode === "bot"
            ? "bot"
            : mode === "ranked"
              ? "ranked"
              : undefined,
      ...(returnTo ? { returnTo } : {}),
    };
  }

  if (!scopedPage) return { kind: "home", visibility, section: "live" };
  if (scopedPage === "live" || scopedPage === "history") {
    return { kind: "home", visibility, section: scopedPage };
  }
  if (scopedPage === "rooms") {
    return { kind: "home", visibility, section: "live" };
  }
  if (scopedPage === "members" || scopedPage === "stats") {
    return { kind: "profile" };
  }
  if (scopedPage === "create") {
    const params = new URLSearchParams(query);
    const mode = params.get("mode");
    const returnTo = returnDestinationFromQuery(query);
    return {
      kind: "create",
      visibility,
      preset:
        mode === "solo"
          ? "solo"
          : mode === "bot"
            ? "bot"
            : mode === "ranked"
              ? "ranked"
              : undefined,
      ...(returnTo ? { returnTo } : {}),
    };
  }
  if (scopedPage === "join") {
    const code = new URLSearchParams(query).get("code")?.trim();
    return { kind: "join", visibility, code: code || undefined };
  }
  if (segments[0] === "room" && segments[1]) {
    const returnTo = returnDestinationFromQuery(query);
    return {
      kind: "room",
      roomId: decodeURIComponent(segments[1]),
      ...(returnTo ? { returnTo } : {}),
    };
  }
  if (segments[0] === "play" && segments[1]) {
    const returnTo = returnDestinationFromQuery(query);
    return {
      kind: "play",
      roomId: decodeURIComponent(segments[1]),
      ...(returnTo ? { returnTo } : {}),
    };
  }
  return { kind: "home", visibility, section: "live" };
}

export function routeToHash(route: Route): string {
  if (route.kind === "home") {
    return route.section && route.section !== "live" && route.section !== "rooms"
      ? `#/${route.visibility}/${route.section}`
      : `#/${route.visibility}`;
  }
  if (route.kind === "create") {
    const params = new URLSearchParams();
    if (route.visibility === "region") params.set("space", "region");
    if (route.preset) params.set("mode", route.preset);
    if (route.returnTo) params.set("from", routeToHash(route.returnTo).slice(2));
    const query = params.toString();
    return `#/create${query ? `?${query}` : ""}`;
  }
  if (route.kind === "join") {
    return `#/${route.visibility}/join${route.code ? `?code=${encodeURIComponent(route.code)}` : ""}`;
  }
  if (route.kind === "private") {
    const path = route.folderId ? `#/private/${encodeURIComponent(route.folderId)}` : "#/private";
    return route.trash ? `${path}?view=trash` : path;
  }
  if (route.kind === "profile") return "#/profile";
  if (route.kind === "survival") return "#/survival";
  if (route.kind === "ranked")
    return route.matchId ? `#/ranked/${encodeURIComponent(route.matchId)}` : "#/ranked";
  if (route.kind === "study") return "#/study";
  if (route.kind === "admin") return `#/admin/${route.section}`;
  const path = `#/${route.kind}/${encodeURIComponent(route.roomId)}`;
  return route.returnTo
    ? `${path}?from=${encodeURIComponent(routeToHash(route.returnTo).slice(2))}`
    : path;
}

function subscribeToHashChange(notify: () => void): () => void {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
}

function currentHash(): string {
  return window.location.hash;
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribeToHashChange, currentHash, () => "#/public");
  useEffect(() => {
    if (!hash) {
      const url = `${window.location.pathname}${window.location.search}#/public`;
      window.history.replaceState(null, "", url);
    }
  }, [hash]);
  return useMemo(() => parseHash(hash), [hash]);
}

export function navigate(route: Route, replace = false): void {
  const target = routeToHash(route);
  if (window.location.hash === target) return;
  if (replace) {
    const url = `${window.location.pathname}${window.location.search}${target}`;
    window.history.replaceState(null, "", url);
    // replaceState doesn't fire hashchange, so notify listeners manually
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = target;
  }
}
