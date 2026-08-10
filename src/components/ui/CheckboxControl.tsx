import { Check, Minus } from "lucide-react";
import type { ReactNode } from "react";

export function CheckboxControl({
  checked,
  mixed = false,
  disabled = false,
  ariaLabel,
  className,
  children,
  onChange,
}: {
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  children?: ReactNode;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : checked}
      aria-label={ariaLabel}
      className={`ui-checkbox-control${checked || mixed ? " is-checked" : ""}${className ? ` ${className}` : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-checkbox-box" aria-hidden="true">
        {mixed ? <Minus size={13} /> : checked ? <Check size={13} /> : null}
      </span>
      {children}
    </button>
  );
}
