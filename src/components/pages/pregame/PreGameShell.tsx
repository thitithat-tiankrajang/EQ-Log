import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { AccountChip } from "../../../auth";
import { AdminButton } from "../../../admin";

export function PreGameShell({
  children,
  eyebrow,
  title,
  subtitle,
  actions,
  onBack,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** Page-level controls (e.g. an overflow menu) shown beside the title. */
  actions?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <main className="pregame-shell">
      <div className="pregame-inner">
        <header className="pregame-header">
          <div className="pregame-heading-row">
            {onBack && (
              <button className="pregame-back" type="button" aria-label="Back" onClick={onBack}>
                <ArrowLeft size={18} />
              </button>
            )}
            <div>
              <span className="pregame-eyebrow">{eyebrow}</span>
              <h1>{title}</h1>
              {subtitle && <p>{subtitle}</p>}
            </div>
            {actions && <div className="pregame-heading-actions">{actions}</div>}
          </div>
          <div className="pregame-account-actions">
            <AccountChip />
            <AdminButton />
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}
