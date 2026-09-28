import { GraduationCap, House, Plus, Trophy, UserRound } from "lucide-react";
import { useLocale } from "../../i18n/LocaleProvider";
import { routeToHash, useRoute, type Route } from "../../router";

export type PrimaryDestination = "home" | "learn" | "ranked" | "me";

/**
 * Which destination a route belongs to, by what the route MEANS. The page
 * serving a destination for now (see servedRoute) never decides this: the
 * Public lobby behind `#/` is still the Arena Home's place in the product, and
 * the same lobby at `#/public` belongs to no destination at all.
 */
export function primaryDestinationFor(route: Route): PrimaryDestination | null {
  switch (route.kind) {
    case "arena":
      return "home";
    case "learn":
    case "study":
      return "learn";
    case "ranked":
      return "ranked";
    case "me":
    case "profile":
    case "private":
      return "me";
    default:
      return null;
  }
}

/** Create keeps the space the player came from, as it always has. */
function createHrefFor(route: Route): string {
  if (route.kind === "create") return routeToHash(route);
  if (route.kind === "private") {
    return routeToHash({ kind: "create", visibility: "public", returnTo: route });
  }
  if (route.kind === "home" && route.section === "history") {
    return routeToHash({
      kind: "create",
      visibility: route.visibility,
      returnTo: { kind: "home", visibility: route.visibility, section: "history" },
    });
  }
  if (route.kind === "home" && route.visibility === "region") return "#/create?space=region";
  return "#/create";
}

/**
 * Home · Learn · (+) Create · Ranked · Me. One element serves both layouts: a
 * fixed bar above the thumb on phones, a static strip under the header on
 * desktop. Rendering two navigations instead would put a duplicate set of
 * links and a second landmark in the accessibility tree.
 *
 * It is deliberately a sibling of the header rather than a child: the header
 * sets `backdrop-filter`, which would make it the containing block for the
 * fixed mobile bar and pin the nav to the header instead of the viewport.
 */
export function PrimaryNavigation() {
  const route = useRoute();
  const { t } = useLocale();
  const active = primaryDestinationFor(route);
  const creating = route.kind === "create";

  return (
    <nav className="eq-primary-nav" aria-label={t("nav.label")}>
      <NavItem href="#/" active={active === "home"} label={t("nav.home")}>
        <House aria-hidden size={21} />
      </NavItem>
      <NavItem href="#/learn" active={active === "learn"} label={t("nav.learn")}>
        <GraduationCap aria-hidden size={21} />
      </NavItem>
      {/* An action, not a tab: it starts something rather than showing a place. */}
      <a
        className={`eq-primary-nav-create${creating ? " is-active" : ""}`}
        href={createHrefFor(route)}
        aria-current={creating ? "page" : undefined}
        aria-label={t("nav.createGame")}
      >
        <span>
          <Plus aria-hidden size={29} />
        </span>
        <small>{t("nav.create")}</small>
      </a>
      <NavItem href="#/ranked" active={active === "ranked"} label={t("nav.ranked")}>
        <Trophy aria-hidden size={21} />
      </NavItem>
      <NavItem href="#/me" active={active === "me"} label={t("nav.me")}>
        <UserRound aria-hidden size={21} />
      </NavItem>
    </nav>
  );
}

function NavItem({
  active,
  children,
  href,
  label,
}: {
  active: boolean;
  children: React.ReactNode;
  href: string;
  label: string;
}) {
  return (
    <a className={active ? "is-active" : ""} href={href} aria-current={active ? "page" : undefined}>
      {children}
      <span>{label}</span>
    </a>
  );
}
