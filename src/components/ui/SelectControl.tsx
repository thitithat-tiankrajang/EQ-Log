import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export type SelectOption<T extends string> = {
  value: T | "";
  label: string;
  disabled?: boolean;
};

export function SelectControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  className,
  disabled = false,
  invalid = false,
  required = false,
  id,
  placeholder = "Choose an option",
}: {
  value: T | "";
  options: Array<SelectOption<T>>;
  onChange: (value: T | "") => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  className?: string;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
  id?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);

  useLayoutEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !listboxRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const positionMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
      setMenuStyle({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
        width: rect.width,
        maxHeight: Math.max(120, openUp ? spaceAbove : spaceBelow),
        ...(openUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      });
    };
    positionMenu();
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const optionButtons = listboxRef.current?.querySelectorAll<HTMLButtonElement>(
      ".ui-select-option:not(:disabled)",
    );
    const target = [...(optionButtons ?? [])].find((option) => option.dataset.value === value);
    (target ?? optionButtons?.[0])?.focus();
  }, [open, value]);

  function closeAndFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      ref={rootRef}
      className={`ui-select-control${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid}
        aria-required={required}
        className="ui-select-button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={selected ? "" : "is-placeholder"}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={listboxRef}
            id={listboxId}
            className="ui-select-listbox"
            role="listbox"
            style={menuStyle}
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className="ui-select-option"
                data-value={option.value}
                disabled={option.disabled}
                onClick={() => {
                  onChange(option.value);
                  closeAndFocus();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeAndFocus();
                    return;
                  }
                  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const items = [
                    ...(listboxRef.current?.querySelectorAll<HTMLButtonElement>(
                      ".ui-select-option:not(:disabled)",
                    ) ?? []),
                  ];
                  const current = items.indexOf(event.currentTarget);
                  const next =
                    event.key === "Home"
                      ? items[0]
                      : event.key === "End"
                        ? items.at(-1)
                        : event.key === "ArrowDown"
                          ? items[(current + 1) % items.length]
                          : items[(current - 1 + items.length) % items.length];
                  next?.focus();
                }}
              >
                <span>{option.label}</span>
                {option.value === value && <Check size={15} aria-hidden="true" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
