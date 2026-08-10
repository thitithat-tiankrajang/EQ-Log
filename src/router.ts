import { useEffect, useState } from "react";
import type { RoomVisibility } from "./roomScope";

// Hash routing keeps shared room links working on static hosting without
// requiring server-side rewrite rules.

export type Route =
  | { kind: "home"; visibility: RoomVisibility; section?: LobbySection }
  | { kind: "create"; visibility: RoomVisibility; preset?: "solo" | "bot" }
  | { kind: "join"; visibility: RoomVisibility; code?: string }
  | { kind: "private"; folderId: string | null; trash?: boolean }
  | { kind: "profile" }
  | { kind: "admin"; section: AdminSection }
  | { kind: "room"; roomId: string }
  | { kind: "play"; roomId: string };

export type LobbySection = "live" | "history" | "rooms" | "members" | "stats";
export type AdminSection = "users" | "regions";

export function parseHash(hash: string): Route {
  const cleaned = hash.replace(/^#\/?/, "");
  if (!cleaned) return { kind: "home", visibility: "public", section: "live" };
  const [path, query = ""] = cleaned.split("?", 2);
  const segments = path.split("/").filter(Boolean);
  const visibility = segments[0] === "region" ? "region" : "public";
  const scopedPage =
    segments[0] === "public" || segments[0] === "region" ? segments[1] : segments[0];

  if (segments[0] === "admin") {
    return { kind: "admin", section: segments[1] === "regions" ? "regions" : "users" };
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
  if (segments[0] === "create") {
    const params = new URLSearchParams(query);
    const mode = params.get("mode");
    return {
      kind: "create",
      visibility: params.get("space") === "region" ? "region" : "public",
      preset: mode === "solo" ? "solo" : mode === "bot" ? "bot" : undefined,
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
    return {
      kind: "create",
      visibility,
      preset: mode === "solo" ? "solo" : mode === "bot" ? "bot" : undefined,
    };
  }
  if (scopedPage === "join") {
    const code = new URLSearchParams(query).get("code")?.trim();
    return { kind: "join", visibility, code: code || undefined };
  }
  if (segments[0] === "room" && segments[1]) {
    return { kind: "room", roomId: decodeURIComponent(segments[1]) };
  }
  if (segments[0] === "play" && segments[1]) {
    return { kind: "play", roomId: decodeURIComponent(segments[1]) };
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
  if (route.kind === "admin") return `#/admin/${route.section}`;
  if (route.kind === "play") return `#/play/${encodeURIComponent(route.roomId)}`;
  return `#/room/${encodeURIComponent(route.roomId)}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    if (!window.location.hash) {
      const url = `${window.location.pathname}${window.location.search}#/public`;
      window.history.replaceState(null, "", url);
    }
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return route;
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
