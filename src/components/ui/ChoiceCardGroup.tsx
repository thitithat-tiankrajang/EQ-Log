import { Check } from "lucide-react";
import type { ReactNode } from "react";

export type Choice<T extends string> = {
  value: T;
  icon?: ReactNode;
  label: string;
  /** One-line consequence shown on screen at all times — never a tooltip. */
  description: string;
  disabled?: boolean;
  /** Visible explanation when disabled (e.g. "Needs online setup"). */
  disabledReason?: string;
};

/**
 * Vertical radio cards for the big decisions (play mode, role, tile draw).
 * Users must be able to compare options BEFORE choosing, so the description
 * is always rendered, and disabled options say why.
 */
export function ChoiceCardGroup<T extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: Array<Choice<T>>;
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div className="choice-cards" role="radiogroup" aria-label={label}>
      {choices.map((choice) => {
        const active = choice.value === value;
        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`choice-card ${active ? "active" : ""}`}
            disabled={choice.disabled}
            onClick={() => onChange(choice.value)}
          >
            {choice.icon && <span className="choice-card-icon">{choice.icon}</span>}
            <span className="choice-card-copy">
              <strong>{choice.label}</strong>
              <span>{choice.disabled && choice.disabledReason ? choice.disabledReason : choice.description}</span>
            </span>
            <span className="choice-card-check" aria-hidden>
              {active && <Check size={17} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
