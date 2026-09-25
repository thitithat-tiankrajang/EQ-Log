import { FolderLock, Globe2, MapPin, Plus, UserRound } from "lucide-react";
import { routeToHash, useRoute } from "../../router";

/**
 * The five application destinations. One element serves both layouts: a fixed
 * bar above the thumb on phones, a static strip under the header on desktop.
 * Rendering two navigations instead would put a duplicate set of links and a
 * second landmark in the accessibility tree.
 *
 * It is deliberately a sibling of the header rather than a child: the header
 * sets `backdrop-filter`, which would make it the containing block for the
 * fixed mobile bar and pin the nav to the header instead of the viewport.
 */
export function PrimaryNavigation() {
  const route = useRoute();
  const active =
    route.kind === "home"
      ? route.visibility
      : route.kind === "private" || route.kind === "profile" || route.kind === "create"
        ? route.kind
        : null;
  const createHref =
    route.kind === "private"
      ? routeToHash({ kind: "create", visibility: "public", returnTo: route })
      : route.kind === "home" && route.section === "history"
        ? routeToHash({
            kind: "create",
            visibility: route.visibility,
            returnTo: { kind: "home", visibility: route.visibility, section: "history" },
          })
        : route.kind === "create"
          ? routeToHash(route)
          : active === "region"
            ? "#/create?space=region"
            : "#/create";

  return (
    <nav className="eq-primary-nav" aria-label="Primary navigation">
      <NavItem href="#/public" active={active === "public"} label="Public">
        <Globe2 aria-hidden size={21} />
      </NavItem>
      <NavItem href="#/region" active={active === "region"} label="Region">
        <MapPin aria-hidden size={21} />
      </NavItem>
      <a
        className={`eq-primary-nav-create${active === "create" ? " is-active" : ""}`}
        href={createHref}
        aria-current={active === "create" ? "page" : undefined}
        aria-label="Create game"
      >
        <span>
          <Plus aria-hidden size={29} />
        </span>
        <small>Play</small>
      </a>
      <NavItem href="#/private" active={active === "private"} label="Private">
        <FolderLock aria-hidden size={21} />
      </NavItem>
      <NavItem href="#/profile" active={active === "profile"} label="Profile">
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
