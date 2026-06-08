import { useEffect, useState } from "react";

// Minimal hash-based router for two routes:
//   #/         → lobby
//   #/room/{id} → room
// Hash routing avoids any server config and works on any static host.

export type Route =
  | { kind: "lobby" }
  | { kind: "room"; roomId: string };

function parseHash(hash: string): Route {
  const cleaned = hash.replace(/^#\/?/, "");
  if (!cleaned) return { kind: "lobby" };
  const segments = cleaned.split("/").filter(Boolean);
  if (segments[0] === "room" && segments[1]) {
    return { kind: "room", roomId: decodeURIComponent(segments[1]) };
  }
  return { kind: "lobby" };
}

export function routeToHash(route: Route): string {
  if (route.kind === "lobby") return "#/";
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
