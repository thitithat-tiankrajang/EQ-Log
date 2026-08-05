import { useEffect, useState } from "react";

// Hash routing keeps shared room links working on static hosting without
// requiring server-side rewrite rules.

export type Route =
  | { kind: "home" }
  | { kind: "create"; preset?: "solo" | "bot" }
  | { kind: "join" }
  | { kind: "room"; roomId: string }
  | { kind: "play"; roomId: string };

function parseHash(hash: string): Route {
  const cleaned = hash.replace(/^#\/?/, "");
  if (!cleaned) return { kind: "home" };
  const [path, query = ""] = cleaned.split("?", 2);
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "create") {
    const params = new URLSearchParams(query);
    const mode = params.get("mode");
    return { kind: "create", preset: mode === "solo" ? "solo" : mode === "bot" ? "bot" : undefined };
  }
  if (segments[0] === "join") return { kind: "join" };
  if (segments[0] === "room" && segments[1]) {
    return { kind: "room", roomId: decodeURIComponent(segments[1]) };
  }
  if (segments[0] === "play" && segments[1]) {
    return { kind: "play", roomId: decodeURIComponent(segments[1]) };
  }
  return { kind: "home" };
}

export function routeToHash(route: Route): string {
  if (route.kind === "home") return "#/";
  if (route.kind === "create") {
    if (route.preset === "solo") return "#/create?mode=solo";
    if (route.preset === "bot") return "#/create?mode=bot";
    return "#/create";
  }
  if (route.kind === "join") return "#/join";
  if (route.kind === "play") return `#/play/${encodeURIComponent(route.roomId)}`;
  return `#/room/${encodeURIComponent(route.roomId)}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
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
