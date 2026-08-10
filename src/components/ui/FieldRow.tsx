import type { ReactNode } from "react";

/**
 * Label + control + one-line purpose hint + error. Fixed positions on every
 * form so users always know where to look: hint under the control, error
 * (red, with text) replaces the hint when present.
 */
export function FieldRow({
  controlId,
  label,
  hint,
  error,
  children,
}: {
  controlId: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className={`field-row ${error ? "has-error" : ""}`}>
      <label className="field-row-label" id={`${controlId}-label`} htmlFor={controlId}>
        {label}
      </label>
      {children}
      {error ? (
        <em className="field-row-error" id={`${controlId}-message`} role="alert">
          {error}
        </em>
      ) : hint ? (
        <em className="field-row-hint" id={`${controlId}-message`}>
          {hint}
        </em>
      ) : null}
    </div>
  );
}
