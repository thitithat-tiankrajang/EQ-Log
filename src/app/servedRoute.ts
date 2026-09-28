import type { Route } from "../router";

/**
 * The page that serves a route today.
 *
 * The platform destinations are routable before their own pages exist. Until
 * each is built, an existing page serves it and the URL stays the platform
 * one, so links written now keep working when the real page arrives:
 *
 *   #/, #/home  Arena Home   → the Public live-games lobby (the page `#/` has
 *                              always shown); the Arena Home itself comes later
 *
 * Learn and Me have their own pages now.
 *
 * Nothing is presented as the finished destination: each shows exactly the page
 * it replaces, with that page's own title. One router, one table; the rollout
 * switch (`isArenaPlatformEnabled`) will choose between the transitional page
 * and the real Arena Home here, once the latter exists.
 */
export function servedRoute(route: Route): Route {
  switch (route.kind) {
    case "arena":
      return { kind: "home", visibility: "public", section: "live" };
    default:
      return route;
  }
}
