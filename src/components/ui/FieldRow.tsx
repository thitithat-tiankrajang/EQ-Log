import type { ReactNode } from "react";

/**
 * Label + control + one-line purpose hint + error. Fixed positions on every
 * form so users always know where to look: hint under the control, error
 * (red, with text) replaces the hint when present.
 */
export function FieldRow({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className={`field-row ${error ? "has-error" : ""}`}>
      <span className="field-row-label">{label}</span>
      {children}
      {error ? (
        <em className="field-row-error">{error}</em>
      ) : hint ? (
        <em className="field-row-hint">{hint}</em>
      ) : null}
    </label>
  );
}
