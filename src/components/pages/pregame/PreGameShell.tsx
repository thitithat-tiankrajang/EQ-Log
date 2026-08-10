import type { ReactNode } from "react";
import { AccountChip } from "../../../auth";
import { AdminButton } from "../../../admin";
import type { RoomVisibility } from "../../../roomScope";
import { ApplicationShell } from "../../../app/shells/ApplicationShell";

export function PreGameShell({
  children,
  eyebrow,
  title,
  subtitle,
  actions,
  onBack,
  visual,
  visibility,
  regionName,
  variant = "form",
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  onBack?: () => void;
  visual?: "glass";
  visibility?: RoomVisibility;
  regionName?: string | null;
  variant?: "form" | "join" | "waiting";
}) {
  return (
    <ApplicationShell
      eyebrow={eyebrow}
      title={title}
      description={subtitle}
      onBack={onBack}
      visibility={visibility}
      regionName={regionName}
      actions={
        <>
          {actions}
          <AccountChip />
          <AdminButton />
        </>
      }
    >
      <div className={`eq-flow-page eq-flow-${variant}`} data-visual={visual}>
        {children}
      </div>
    </ApplicationShell>
  );
}
