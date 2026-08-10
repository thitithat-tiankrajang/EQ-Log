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
        const enabledChoices = choices.filter((item) => !item.disabled);
        const tabbableValue = value ?? enabledChoices[0]?.value ?? null;
        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-choice-value={choice.value}
            tabIndex={choice.disabled || choice.value !== tabbableValue ? -1 : 0}
            className={`choice-card ${active ? "active" : ""}`}
            disabled={choice.disabled}
            onClick={() => onChange(choice.value)}
            onKeyDown={(event) => {
              if (
                !["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(
                  event.key,
                )
              ) {
                return;
              }
              event.preventDefault();
              const currentIndex = enabledChoices.findIndex((item) => item.value === choice.value);
              const nextIndex =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? enabledChoices.length - 1
                    : event.key === "ArrowDown" || event.key === "ArrowRight"
                      ? (currentIndex + 1) % enabledChoices.length
                      : (currentIndex - 1 + enabledChoices.length) % enabledChoices.length;
              const next = enabledChoices[nextIndex];
              if (!next) return;
              onChange(next.value);
              event.currentTarget
                .closest("[role='radiogroup']")
                ?.querySelector<HTMLElement>(`[data-choice-value='${CSS.escape(next.value)}']`)
                ?.focus();
            }}
          >
            {choice.icon && <span className="choice-card-icon">{choice.icon}</span>}
            <span className="choice-card-copy">
              <strong>{choice.label}</strong>
              <span>
                {choice.disabled && choice.disabledReason
                  ? choice.disabledReason
                  : choice.description}
              </span>
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
