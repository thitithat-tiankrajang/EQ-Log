import type { ReactNode } from "react";

export function PanelHeading({
  title,
  detail,
  actions,
}: {
  title: string;
  detail: string;
  /** Small controls at the right end of the heading, after the detail. */
  actions?: ReactNode;
}) {
  return (
    <div className={`panel-heading${actions ? " has-actions" : ""}`}>
      <h2>{title}</h2>
      <span>{detail}</span>
      {actions}
    </div>
  );
}
