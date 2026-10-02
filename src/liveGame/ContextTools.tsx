import { ChevronRight, Wrench } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { PanelHeading } from "../components/layout/PanelHeading";
import { Sheet } from "../components/ui/Sheet";

/** The width below which the play rails disappear (99-mobile-play.css). */
const MOBILE_PLAY_QUERY = "(max-width: 759px)";

export function useMobilePlay() {
  const [mobile, setMobile] = useState(() =>
    typeof window.matchMedia === "function" ? window.matchMedia(MOBILE_PLAY_QUERY).matches : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(MOBILE_PLAY_QUERY);
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

/** One compact group of game tools. */
export function ToolSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="live-tool" aria-label={title}>
      <h3 className="live-tool-title">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Secondary in-game tools stay beside the board, never above it: a rail panel
 * on desktop; on phones, one tools button below the board that opens a Sheet,
 * so the board keeps its place above the fixed rack dock.
 */
export function ContextTools({
  mobile,
  summary,
  children,
}: {
  mobile: boolean;
  /** The tool groups present, e.g. "Analysis · History". */
  summary: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!mobile)
    return (
      <section className="rail-panel live-context-tools" aria-label="Game tools">
        <PanelHeading title="Game tools" detail="" />
        <div className="live-tools-body">{children}</div>
      </section>
    );
  return (
    <section className="mobile-play-tools" aria-label="เครื่องมือระหว่างเล่น">
      <div className="mobile-play-tool-list">
        <button
          type="button"
          className="mobile-tool-button"
          aria-label="Game tools"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <span className="mobile-tool-icon">
            <Wrench size={17} aria-hidden />
          </span>
          <span className="mobile-tool-copy">
            <strong>Game tools</strong>
            <small>{summary}</small>
          </span>
          <ChevronRight className="mobile-tool-arrow" size={15} aria-hidden />
        </button>
      </div>
      <Sheet open={open} title="Game tools" onClose={() => setOpen(false)}>
        <div className="live-tools-body">{children}</div>
      </Sheet>
    </section>
  );
}
