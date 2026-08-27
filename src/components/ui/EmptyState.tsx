import type { ReactNode } from "react";

/**
 * The shared "nothing here yet" block. An empty screen is the moment to say
 * what to do next, so `action` is part of the component rather than something
 * each caller bolts on afterwards.
 *
 * `title` is optional on purpose: inside a section that already carries a
 * heading, repeating it as another heading only adds noise to the document
 * outline.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: ReactNode;
  title?: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`eq-state${compact ? " eq-state-compact" : ""}`}>
      {icon && (
        <span className="eq-state-mark" aria-hidden="true">
          {icon}
        </span>
      )}
      {title && <h3 className="eq-state-title">{title}</h3>}
      <p className="eq-state-copy">{description}</p>
      {action && <div className="eq-state-action">{action}</div>}
    </div>
  );
}
