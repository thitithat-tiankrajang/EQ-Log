import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Bottom action bar. On phones (≤759px) it sticks to the bottom of the
 * viewport inside the page scroll; on desktop it renders as a normal block
 * at the end of the page. `reason` is the always-visible explanation for a
 * disabled primary action — never put that text in a title tooltip.
 */
export function ActionDock({ reason, children }: { reason?: string | null; children: ReactNode }) {
  return (
    <div className="action-dock">
      {reason && (
        <p className="action-dock-reason" role="status">
          <AlertTriangle size={14} aria-hidden />
          {reason}
        </p>
      )}
      <div className="action-dock-buttons">{children}</div>
    </div>
  );
}
