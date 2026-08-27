import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { RoomVisibility } from "../../roomScope";
import { PrimaryNavigation } from "./PrimaryNavigation";

export function ApplicationShell({
  actions,
  backLabel = "Back",
  children,
  description,
  documentTitle,
  eyebrow,
  onBack,
  routeKey,
  secondaryNavigation,
  title,
  utilityNavigation,
}: {
  actions?: ReactNode;
  backLabel?: string;
  children: ReactNode;
  description?: string;
  documentTitle?: string;
  eyebrow?: string;
  onBack?: () => void;
  regionName?: string | null;
  routeKey?: string;
  secondaryNavigation?: ReactNode;
  title: string;
  utilityNavigation?: ReactNode;
  visibility?: RoomVisibility;
}) {
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    document.title = `${documentTitle ?? title} · EQ Lab`;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    mainRef.current?.focus({ preventScroll: true });
  }, [documentTitle, routeKey, title]);

  return (
    <div className="eq-app-shell">
      <a className="eq-skip-link" href="#main-content">
        Skip to content
      </a>

      <header className="eq-app-header">
        <div className="eq-app-header-start">
          {onBack && (
            <button
              className="eq-icon-button eq-back-button"
              type="button"
              aria-label={backLabel}
              onClick={onBack}
            >
              <ArrowLeft aria-hidden="true" size={19} />
            </button>
          )}
          <a className="eq-brand" href="#/public" aria-label="EQ Lab home">
            <img src="/icons/eqlab-mark.svg" alt="" width="34" height="34" />
            <span>
              <strong>EQ Lab</strong>
              <small>Equation game workspace</small>
            </span>
          </a>
        </div>
        <div className="eq-header-actions">
          {utilityNavigation}
          {actions}
        </div>
      </header>

      <PrimaryNavigation />

      <main ref={mainRef} className="eq-main" id="main-content" tabIndex={-1}>
        <header className="eq-page-header">
          <div className="eq-page-title-row">
            <div className="eq-page-heading">
              {eyebrow && <span className="eq-eyebrow">{eyebrow}</span>}
              <h1>{title}</h1>
              {description && <p>{description}</p>}
            </div>
          </div>
        </header>

        {secondaryNavigation}
        <div className="eq-page-content">{children}</div>
      </main>
    </div>
  );
}
