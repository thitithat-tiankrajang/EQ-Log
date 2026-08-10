import { FolderLock, Globe2, MapPin, Plus, UserRound } from "lucide-react";
import { useRoute } from "../../router";

export function BottomNavigation() {
  const route = useRoute();
  const active =
    route.kind === "home"
      ? route.visibility
      : route.kind === "private" || route.kind === "profile" || route.kind === "create"
        ? route.kind
        : null;

  return (
    <nav className="eq-bottom-nav" aria-label="Primary navigation">
      <NavItem href="#/public" active={active === "public"} label="Public">
        <Globe2 aria-hidden size={21} />
      </NavItem>
      <NavItem href="#/region" active={active === "region"} label="Region">
        <MapPin aria-hidden size={21} />
      </NavItem>
      <a
        className={`eq-bottom-nav-create${active === "create" ? " is-active" : ""}`}
        href="#/create"
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
